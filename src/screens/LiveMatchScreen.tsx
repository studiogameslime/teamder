// LiveMatchScreen — on-field actions only.
//
// Anything that isn't actively used while playing on the pitch (add
// guest, cancel game, search for replacement players) lives in
// MatchDetailsScreen. This screen keeps a tight surface:
//
//   • Timer (start / pause / resume / reset)
//   • Per-team score cards — supports 2..5 teams. ≤3 fits in one row;
//     4..5 scroll horizontally.
//   • Field with formation placeholders matching the game format.
//     `getFormationSlots(format)` returns exactly playersPerTeam slots
//     per team (1 GK + N-1 outfield).
//   • Drag-and-drop to move players between teams / bench (admin only)
//   • Drag-over highlight on the destination zone
//   • For 3..5-team games the non-active teams render below the field
//     as compact horizontal cards.
//   • Teams overview bottom sheet (everyone) showing per-team avg
//     rating + roster
//   • Shuffle + Undo (admin only)
//
// Permissions:
//   - admin (game.createdBy or community admin) ⇒ all controls
//   - everyone else ⇒ view-only

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { TeamsOverviewSheet, TeamSlot } from '@/components/TeamsOverviewSheet';
import { gameService } from '@/services/gameService';
import {
  Game,
  GameFormat,
  GameGuest,
  LiveMatchState,
  LiveMatchZone,
  parseGuestRosterId,
  toGuestRosterId,
  UserId,
} from '@/types';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Zone = LiveMatchZone;
type ZoneRect = { x: number; y: number; w: number; h: number };
type TeamLetter = 'A' | 'B' | 'C' | 'D' | 'E';

const DEFAULT_DURATION_MIN = 8;
const TEAM_LETTERS: TeamLetter[] = ['A', 'B', 'C', 'D', 'E'];

// Tints for up to 5 teams. The first three come from the design
// system; teams 4–5 fall back to additional accents so the score-card
// dots stay visually distinct.
const TEAM_TINTS = [
  colors.team1,
  colors.team2,
  colors.team3,
  colors.warning,
  colors.info,
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function shuffle<T>(xs: T[]): T[] {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Outfield slot count = playersPerTeam - 1 (the GK has its own zone). */
function outfieldCountForFormat(format: GameFormat | undefined): number {
  if (format === '6v6') return 5;
  if (format === '7v7') return 6;
  return 4; // 5v5 default
}

interface FormationSlot {
  /** Horizontal position 0..1, left→right inside the half. */
  x: number;
  /**
   * Vertical position 0..1. 0 = center line, 1 = own goal line. The
   * top half mirrors this at render time so y=1 reads "closest to the
   * top edge" for that half.
   */
  y: number;
  kind: 'gk' | 'outfield';
}

/**
 * Layout for one team's half of the pitch. Returns EXACTLY
 * `playersPerTeam(format)` slots — the first is the goalkeeper at
 * the goal line, the rest are outfield positions evenly spread
 * across one horizontal line near the center of the half.
 */
function getFormationSlots(format: GameFormat | undefined): FormationSlot[] {
  const f = format ?? '5v5';
  const outfieldCount = f === '5v5' ? 4 : f === '6v6' ? 5 : 6;
  // Outfield x positions are evenly spaced across the half so that 4
  // / 5 / 6 players line up cleanly without crowding the edges.
  // The GK sits at y=0.8 (closer to the goal line, but with enough
  // breathing room that the 70px circle never spills past the field
  // edge and gets clipped by `overflow: hidden`).
  const outfieldY = 0.4;
  const slots: FormationSlot[] = [
    { x: 0.5, y: 0.8, kind: 'gk' },
  ];
  for (let i = 0; i < outfieldCount; i++) {
    const x = (i + 1) / (outfieldCount + 1);
    slots.push({ x, y: outfieldY, kind: 'outfield' });
  }
  return slots;
}

/** Fresh state — everyone on the bench in registration order. */
function makeFreshState(playerIds: UserId[]): LiveMatchState {
  const assignments: Record<UserId, Zone> = {};
  playerIds.forEach((uid) => {
    assignments[uid] = 'bench';
  });
  return {
    phase: 'organizing',
    assignments,
    benchOrder: [...playerIds],
    scoreA: 0,
    scoreB: 0,
    scoreC: 0,
    scoreD: 0,
    scoreE: 0,
    lateUserIds: [],
  };
}

/** Add new players to bench / drop departed ones. */
function reconcile(
  state: LiveMatchState,
  rosterIds: UserId[],
): LiveMatchState {
  const roster = new Set(rosterIds);
  const next: LiveMatchState = {
    ...state,
    assignments: { ...state.assignments },
    benchOrder: state.benchOrder.filter((id) => roster.has(id)),
    lateUserIds: state.lateUserIds.filter((id) => roster.has(id)),
  };
  for (const uid of Object.keys(next.assignments)) {
    if (!roster.has(uid)) delete next.assignments[uid];
  }
  for (const uid of rosterIds) {
    if (!next.assignments[uid]) {
      next.assignments[uid] = 'bench';
      if (!next.benchOrder.includes(uid)) next.benchOrder.push(uid);
    }
  }
  return next;
}

const teamZoneFor = (l: TeamLetter): Zone => `team${l}` as Zone;
const gkZoneFor = (l: 'A' | 'B'): Zone => `gk${l}` as Zone;

const scoreOf = (state: LiveMatchState, l: TeamLetter): number => {
  if (l === 'A') return state.scoreA;
  if (l === 'B') return state.scoreB;
  if (l === 'C') return state.scoreC ?? 0;
  if (l === 'D') return state.scoreD ?? 0;
  return state.scoreE ?? 0;
};

const setScoreOf = (
  state: LiveMatchState,
  l: TeamLetter,
  v: number,
): LiveMatchState => ({
  ...state,
  scoreA: l === 'A' ? v : state.scoreA,
  scoreB: l === 'B' ? v : state.scoreB,
  scoreC: l === 'C' ? v : (state.scoreC ?? 0),
  scoreD: l === 'D' ? v : (state.scoreD ?? 0),
  scoreE: l === 'E' ? v : (state.scoreE ?? 0),
});

// ─── Screen ───────────────────────────────────────────────────────────────

type Params = RouteProp<GameStackParamList, 'LiveMatch'>;

export function LiveMatchScreen() {
  const route = useRoute<Params>();
  const nav = useNavigation();
  const gameId = route.params?.gameId ?? null;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  const [game, setGame] = useState<Game | null>(null);
  const [live, setLive] = useState<LiveMatchState | null>(null);

  // Local timer (not persisted).
  const [timerMs, setTimerMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStarted, setTimerStarted] = useState(false);

  const [overviewOpen, setOverviewOpen] = useState(false);

  // 1-step undo for drag/shuffle.
  const undoStackRef = useRef<LiveMatchState[]>([]);
  const [hasUndo, setHasUndo] = useState(false);

  // Shared value updated during a pan to highlight the destination
  // zone or slot. Slot keys look like `slot:A:2`; zones use the
  // bare `Zone` string ('teamA', 'gkB', 'bench', …).
  const hoverZone = useSharedValue<string>('');

  // Page-coord rectangles per zone for hit-testing during drag. Every
  // possible zone is keyed up-front so the refs stay stable across
  // 2-team and 5-team renders.
  const zoneRefs = useRef<Record<Zone, RNView | null>>({
    teamA: null,
    teamB: null,
    teamC: null,
    teamD: null,
    teamE: null,
    bench: null,
    gkA: null,
    gkB: null,
  });
  const zoneRectsRef = useRef<Record<Zone, ZoneRect | null>>({
    teamA: null,
    teamB: null,
    teamC: null,
    teamD: null,
    teamE: null,
    bench: null,
    gkA: null,
    gkB: null,
  });
  // Per-slot rects for the on-field outfield positions. Keys are
  // `slot:A:0`, `slot:A:1`, …, `slot:B:0`, …. Hit-tested before zone
  // rects so a drop on a specific empty slot routes to that slot
  // rather than to the surrounding team area.
  const slotRectsRef = useRef<Map<string, ZoneRect>>(new Map());
  const slotRefsRef = useRef<Map<string, RNView | null>>(new Map());

  const remeasureZone = useCallback((z: Zone) => {
    const v = zoneRefs.current[z];
    if (!v) return;
    v.measureInWindow((x, y, w, h) => {
      zoneRectsRef.current[z] = { x, y, w, h };
    });
  }, []);
  const remeasureSlot = useCallback((key: string) => {
    const v = slotRefsRef.current.get(key);
    if (!v) return;
    v.measureInWindow((x, y, w, h) => {
      slotRectsRef.current.set(key, { x, y, w, h });
    });
  }, []);
  const remeasureZones = useCallback(() => {
    (Object.keys(zoneRefs.current) as Zone[]).forEach((z) => remeasureZone(z));
    slotRefsRef.current.forEach((_, key) => remeasureSlot(key));
  }, [remeasureZone, remeasureSlot]);

  // ─── Load the game once ────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      const myCommunityIds = myCommunities.map((g) => g.id);
      const [mine, community] = await Promise.all([
        gameService.getMyGames(me.id).catch(() => [] as Game[]),
        gameService
          .getCommunityGames(me.id, myCommunityIds)
          .catch(() => [] as Game[]),
      ]);
      const g =
        mine.find((x) => x.id === gameId) ??
        community.find((x) => x.id === gameId) ??
        null;
      if (alive) setGame(g);
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities]);

  // Roster = real players + guests (encoded as `guest:<id>`).
  const rosterIds = useMemo<UserId[]>(() => {
    if (!game) return [];
    const guestRoster = (game.guests ?? []).map((g) => toGuestRosterId(g.id));
    return [...game.players, ...guestRoster];
  }, [game?.players, game?.guests]);

  // Hydrate user → display name / jersey lookup.
  useEffect(() => {
    if (!game) return;
    hydratePlayers(game.players);
  }, [game?.id, hydratePlayers]);

  // Realtime sync of LiveMatchState.
  useEffect(() => {
    if (!gameId || !game) return;
    const unsub = gameService.subscribeLiveMatch(gameId, (state) => {
      const initial = state ?? makeFreshState(rosterIds);
      setLive(reconcile(initial, rosterIds));
    });
    return unsub;
  }, [gameId, game, rosterIds]);

  // Local timer tick.
  useEffect(() => {
    if (!timerRunning) return;
    const id = setInterval(() => setTimerMs((t) => t + 1000), 1000);
    return () => clearInterval(id);
  }, [timerRunning]);

  // ─── Role detection ────────────────────────────────────────────────────
  const isAdmin = useMemo(() => {
    if (!me || !game) return false;
    if (game.createdBy === me.id) return true;
    const grp = myCommunities.find((g) => g.id === game.groupId);
    return !!grp && grp.adminIds.includes(me.id);
  }, [me, game, myCommunities]);

  // Clamp game.numberOfTeams to {2,3,4,5}. A reading of `1` (legacy
  // single-team mock data) and anything above 5 collapse to the
  // closest valid value the UI knows how to render.
  const teamCount: 2 | 3 | 4 | 5 = useMemo(() => {
    const n = game?.numberOfTeams ?? 2;
    if (n <= 2) return 2;
    if (n >= 5) return 5;
    return n as 3 | 4;
  }, [game?.numberOfTeams]);

  /** Letters of the active teams for this match (always starts at A). */
  const teamLetters: TeamLetter[] = useMemo(
    () => TEAM_LETTERS.slice(0, teamCount),
    [teamCount],
  );

  // The first two letters are the "on-field" matchup; the rest wait
  // below the pitch. A future swap UI can change which letters fill
  // those slots; for now it's always A vs B.
  const waitingLetters: TeamLetter[] = teamLetters.slice(2);

  // ─── Persist + commit helpers ──────────────────────────────────────────
  const commit = useCallback(
    (
      next: LiveMatchState,
      opts: { undoable?: boolean; markEdited?: boolean } = {},
    ) => {
      if (!gameId) return;
      if (live && opts.undoable) {
        undoStackRef.current.push(live);
        if (undoStackRef.current.length > 1) {
          undoStackRef.current = undoStackRef.current.slice(-1);
        }
        setHasUndo(true);
      }
      setLive(next);
      gameService
        .setLiveMatch(gameId, next, {
          markTeamsEditedManually: !!opts.markEdited,
        })
        .catch((err) => {
          if (__DEV__) console.warn('[live] setLiveMatch failed', err);
        });
    },
    [gameId, live],
  );

  // ─── Mutations (admin-only) ────────────────────────────────────────────

  /** Drop on a plain zone — assigns membership but no specific slot. */
  const place = useCallback(
    (uid: UserId, zone: Zone) => {
      if (!live || !isAdmin) return;
      const next: LiveMatchState = {
        ...live,
        assignments: { ...live.assignments },
        benchOrder: live.benchOrder.slice(),
        teamASlots: { ...(live.teamASlots ?? {}) },
        teamBSlots: { ...(live.teamBSlots ?? {}) },
      };
      // Drag away from any prior on-field slot — slot maps are only
      // valid while the player is actually in that team's outfield.
      // (teamASlots/teamBSlots are guaranteed-defined here because we
      // just initialised them from `?? {}` above.)
      delete next.teamASlots![uid];
      delete next.teamBSlots![uid];

      // GK zones (gkA/gkB) are single-occupancy. Bump any existing
      // keeper into their team's outfield.
      if (zone === 'gkA' || zone === 'gkB') {
        const teamZone: Zone = zone === 'gkA' ? 'teamA' : 'teamB';
        const existing = (Object.keys(next.assignments) as UserId[]).find(
          (k) => next.assignments[k] === zone && k !== uid,
        );
        if (existing) next.assignments[existing] = teamZone;
      }
      next.assignments[uid] = zone;
      next.benchOrder = next.benchOrder.filter((x) => x !== uid);
      if (zone === 'bench') next.benchOrder.push(uid);
      commit(next, { undoable: true, markEdited: true });
    },
    [live, isAdmin, commit],
  );

  /**
   * Drop on a specific outfield slot. If the slot is empty the
   * player just moves there. If another player already occupies it:
   *   - same team → swap positions
   *   - different team / bench / GK → evict the occupant to the bench
   */
  const placeInSlot = useCallback(
    (uid: UserId, team: 'A' | 'B', slotIdx: number) => {
      if (!live || !isAdmin) return;
      const teamZone: Zone = team === 'A' ? 'teamA' : 'teamB';
      const slotsKey = team === 'A' ? 'teamASlots' : 'teamBSlots';
      const otherSlotsKey = team === 'A' ? 'teamBSlots' : 'teamASlots';

      const next: LiveMatchState = {
        ...live,
        assignments: { ...live.assignments },
        benchOrder: live.benchOrder.slice(),
        teamASlots: { ...(live.teamASlots ?? {}) },
        teamBSlots: { ...(live.teamBSlots ?? {}) },
      };

      const sameTeamSlots = next[slotsKey] ?? {};
      const otherTeamSlots = next[otherSlotsKey] ?? {};
      // Clear the dragged player's previous slot bookkeeping in both
      // teams — they're now strictly in the target team.
      const draggedPrevIdx =
        next.assignments[uid] === teamZone
          ? sameTeamSlots[uid]
          : undefined;
      delete sameTeamSlots[uid];
      delete otherTeamSlots[uid];

      // Find any current occupant of the target slot.
      const occupant = Object.entries(sameTeamSlots).find(
        ([, idx]) => idx === slotIdx,
      )?.[0] as UserId | undefined;

      if (occupant && draggedPrevIdx !== undefined) {
        // Swap within the same team.
        sameTeamSlots[occupant] = draggedPrevIdx;
      } else if (occupant) {
        // Evict to bench.
        next.assignments[occupant] = 'bench';
        delete sameTeamSlots[occupant];
        next.benchOrder = next.benchOrder.filter((x) => x !== occupant);
        next.benchOrder.push(occupant);
      }

      sameTeamSlots[uid] = slotIdx;
      next.assignments[uid] = teamZone;
      next.benchOrder = next.benchOrder.filter((x) => x !== uid);
      next[slotsKey] = sameTeamSlots;
      next[otherSlotsKey] = otherTeamSlots;
      commit(next, { undoable: true, markEdited: true });
    },
    [live, isAdmin, commit],
  );

  // Hit-test page-coords against slot rects first (per-slot precision)
  // and then zone rects (team areas, bench, GK pads). Returns either a
  // slot key like `slot:A:2` or a zone string.
  const targetAt = useCallback(
    (pageX: number, pageY: number): string | null => {
      // Slots first — they're the most specific drop target.
      let bestSlot: { key: string; r: ZoneRect } | null = null;
      slotRectsRef.current.forEach((r, key) => {
        if (
          pageX >= r.x &&
          pageX <= r.x + r.w &&
          pageY >= r.y &&
          pageY <= r.y + r.h
        ) {
          // Pick the smallest matching rect — slot circles are
          // smaller than the surrounding team area, so the smallest
          // match is the most precise.
          if (!bestSlot || r.w * r.h < bestSlot.r.w * bestSlot.r.h) {
            bestSlot = { key, r };
          }
        }
      });
      if (bestSlot !== null) {
        // Narrow `bestSlot` for TS — Map.forEach doesn't carry the
        // refinement out of the callback.
        return (bestSlot as { key: string; r: ZoneRect }).key;
      }

      const rects = zoneRectsRef.current;
      const order: Zone[] = [
        'gkA',
        'gkB',
        'teamA',
        'teamB',
        'teamC',
        'teamD',
        'teamE',
        'bench',
      ];
      for (const z of order) {
        const r = rects[z];
        if (!r) continue;
        if (
          pageX >= r.x &&
          pageX <= r.x + r.w &&
          pageY >= r.y &&
          pageY <= r.y + r.h
        ) {
          return z;
        }
      }
      return null;
    },
    [],
  );

  const handleDrop = useCallback(
    (uid: UserId, pageX: number, pageY: number) => {
      if (!isAdmin) return;
      const target = targetAt(pageX, pageY);
      if (!target) return;
      if (target.startsWith('slot:')) {
        const [, team, idxStr] = target.split(':');
        const idx = Number(idxStr);
        if ((team === 'A' || team === 'B') && Number.isFinite(idx)) {
          placeInSlot(uid, team, idx);
        }
        return;
      }
      place(uid, target as Zone);
    },
    [place, placeInSlot, isAdmin, targetAt],
  );

  const handleHover = useCallback(
    (pageX: number, pageY: number) => {
      const t = targetAt(pageX, pageY);
      hoverZone.value = t ?? '';
    },
    [targetAt, hoverZone],
  );

  const clearHover = useCallback(() => {
    hoverZone.value = '';
  }, [hoverZone]);

  const handleShuffle = useCallback(() => {
    if (!game || !live || !isAdmin) return;
    const shuffled = shuffle(rosterIds);
    const slotsPerTeam =
      game.format === '6v6' ? 6 : game.format === '7v7' ? 7 : 5;
    const buckets = teamLetters.length;
    const assignments: Record<UserId, Zone> = {};
    const benchOrder: UserId[] = [];
    const teamASlots: Record<UserId, number> = {};
    const teamBSlots: Record<UserId, number> = {};
    // Fill team A up to capacity, then team B, etc. The first player
    // of each on-field team becomes that team's keeper; the rest fill
    // outfield slots in order. Players beyond `buckets * slotsPerTeam`
    // overflow onto the bench so the visible formation always lines
    // up with the chosen format.
    let teamACounter = 0;
    let teamBCounter = 0;
    shuffled.forEach((uid, i) => {
      const bucketIdx = Math.floor(i / slotsPerTeam);
      const positionInBucket = i % slotsPerTeam;
      if (bucketIdx >= buckets) {
        assignments[uid] = 'bench';
        benchOrder.push(uid);
        return;
      }
      const letter = teamLetters[bucketIdx];
      if (bucketIdx === 0) {
        // On-field team A: first player is keeper, rest go in slots
        if (positionInBucket === 0) {
          assignments[uid] = 'gkA';
        } else {
          assignments[uid] = 'teamA';
          teamASlots[uid] = teamACounter++;
        }
      } else if (bucketIdx === 1) {
        // On-field team B: same shape.
        if (positionInBucket === 0) {
          assignments[uid] = 'gkB';
        } else {
          assignments[uid] = 'teamB';
          teamBSlots[uid] = teamBCounter++;
        }
      } else {
        // Waiting team — no GK / slot distinction yet.
        assignments[uid] = teamZoneFor(letter);
      }
    });
    commit(
      {
        ...live,
        assignments,
        benchOrder,
        teamASlots,
        teamBSlots,
      },
      { undoable: true, markEdited: true },
    );
  }, [game, live, isAdmin, commit, rosterIds, teamLetters]);

  const handleUndo = useCallback(() => {
    if (!isAdmin || !gameId) return;
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setHasUndo(undoStackRef.current.length > 0);
    setLive(prev);
    gameService
      .setLiveMatch(gameId, prev, { markTeamsEditedManually: true })
      .catch((err) => {
        if (__DEV__) console.warn('[live] undo persist failed', err);
      });
  }, [isAdmin, gameId]);

  const handleScore = (letter: TeamLetter, delta: number) => {
    if (!live || !isAdmin) return;
    const prev = scoreOf(live, letter);
    commit(setScoreOf(live, letter, Math.max(0, prev + delta)));
  };

  // ─── Timer controls ────────────────────────────────────────────────────
  const onTimerStart = () => {
    setTimerStarted(true);
    setTimerRunning(true);
  };
  const onTimerPause = () => setTimerRunning(false);
  const onTimerResume = () => setTimerRunning(true);
  const onTimerReset = () => {
    setTimerRunning(false);
    setTimerStarted(false);
    setTimerMs(0);
  };

  // ─── Derived rosters per zone ──────────────────────────────────────────
  const inZone = useCallback(
    (z: Zone): UserId[] => {
      if (!live) return [];
      if (z === 'bench') {
        return live.benchOrder.filter(
          (uid) => live.assignments[uid] === 'bench',
        );
      }
      return (Object.keys(live.assignments) as UserId[])
        .filter((uid) => live.assignments[uid] === z)
        .sort();
    },
    [live],
  );

  /**
   * Resolve the on-field outfield → slot mapping for one of the two
   * playing teams. Returns an array of length `outfieldCount` where
   * each element is either the uid at that slot or `undefined`.
   *
   * Honours `teamASlots` / `teamBSlots` for explicit positioning; any
   * team member without a recorded slot is dropped into the lowest
   * empty index so the formation never has gaps unless the coach
   * intentionally leaves one.
   */
  const outfieldByIdx = useCallback(
    (team: 'A' | 'B', outfieldCount: number): (UserId | undefined)[] => {
      if (!live) return new Array(outfieldCount).fill(undefined);
      const teamZone: Zone = team === 'A' ? 'teamA' : 'teamB';
      const slotMap = (team === 'A' ? live.teamASlots : live.teamBSlots) ?? {};
      const members = (Object.keys(live.assignments) as UserId[])
        .filter((uid) => live.assignments[uid] === teamZone)
        .sort();
      const result: (UserId | undefined)[] = new Array(outfieldCount).fill(
        undefined,
      );
      const orphans: UserId[] = [];
      for (const uid of members) {
        const idx = slotMap[uid];
        if (
          typeof idx === 'number' &&
          idx >= 0 &&
          idx < outfieldCount &&
          result[idx] === undefined
        ) {
          result[idx] = uid;
        } else {
          orphans.push(uid);
        }
      }
      // Place orphans (no slot, slot out-of-range, or slot collision)
      // into the first available empty index.
      let cursor = 0;
      for (const uid of orphans) {
        while (cursor < outfieldCount && result[cursor] !== undefined) cursor++;
        if (cursor >= outfieldCount) break;
        result[cursor] = uid;
        cursor++;
      }
      return result;
    },
    [live],
  );

  // Total match duration (ms) for the timer ceiling.
  const totalMs =
    (game?.matchDurationMinutes ?? DEFAULT_DURATION_MIN) * 60 * 1000;

  // Build the team-slot list — same shape passed to TeamsOverviewSheet
  // and the score header. One slot per active team; rosters include
  // both the GK (when `letter` is on-field) and outfield.
  const teamSlots: TeamSlot[] = useMemo(() => {
    if (!live) return [];
    return teamLetters.map((letter, i): TeamSlot => {
      const tint = TEAM_TINTS[i] ?? colors.text;
      const teamZone = teamZoneFor(letter);
      const onField = i < 2;
      const ids = (Object.keys(live.assignments) as UserId[]).filter((uid) => {
        const z = live.assignments[uid];
        if (z === teamZone) return true;
        if (onField) {
          if (i === 0 && z === 'gkA') return true;
          if (i === 1 && z === 'gkB') return true;
        }
        return false;
      });
      return {
        index: i,
        tint,
        playerIds: ids,
        score: scoreOf(live, letter),
        isWaiting: !onField,
      };
    });
  }, [live, teamLetters]);

  // ─── Render ───────────────────────────────────────────────────────────
  if (!gameId || !game || !live) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.gameLoading}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        {/* ─── HEADER — back button to MatchDetails ─── */}
        <View style={styles.headerBar}>
          <Pressable
            onPress={() => nav.goBack()}
            hitSlop={8}
            style={({ pressed }) => [
              styles.backBtn,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityLabel={he.liveBackToDetails}
          >
            {/* In RTL, `chevron-forward` (>) points right — the
                correct "back" direction in Hebrew. */}
            <Ionicons name="chevron-forward" size={20} color={colors.text} />
            <Text style={styles.backLabel} numberOfLines={1}>
              {he.liveBackToDetails}
            </Text>
          </Pressable>
        </View>

        {/* ─── TIMER ─── */}
        <View style={styles.timerCard}>
          <Text style={styles.timerValue}>
            {formatTime(timerMs)}
            <Text style={styles.timerCeiling}>
              {`  /  ${formatTime(totalMs)}`}
            </Text>
          </Text>
          {isAdmin ? (
            <View style={styles.timerBtnRow}>
              {!timerStarted ? (
                <TimerBtn
                  label={he.liveTimerStart}
                  icon="play"
                  primary
                  onPress={onTimerStart}
                />
              ) : timerRunning ? (
                <TimerBtn
                  label={he.liveTimerPause}
                  icon="pause"
                  onPress={onTimerPause}
                />
              ) : (
                <TimerBtn
                  label={he.liveTimerResume}
                  icon="play"
                  primary
                  onPress={onTimerResume}
                />
              )}
              <TimerBtn
                label={he.liveTimerReset}
                icon="refresh"
                onPress={onTimerReset}
                disabled={!timerStarted && timerMs === 0}
              />
            </View>
          ) : null}
        </View>

        {/* ─── SCORE CARDS — only the on-field matchup ─── */}
        {/* The pitch only shows two teams at a time (A vs B), so the
            scoreboard up here mirrors that. Waiting teams keep their
            score on their own strip below the pitch. */}
        <View style={styles.scoreRow}>
          {teamSlots.slice(0, 2).map((slot, i) => (
            <ScoreCard
              key={slot.index}
              label={he.liveTeamLabel(slot.index)}
              tint={slot.tint}
              value={slot.score}
              isAdmin={isAdmin}
              onPlus={() => handleScore(teamLetters[i], 1)}
              onMinus={() => handleScore(teamLetters[i], -1)}
              expand
            />
          ))}
        </View>

        {/* ─── FIELD — always teamA (top) vs teamB (bottom) ─── */}
        <View style={styles.field} onLayout={remeasureZones}>
          <PitchBackground />
          <TeamHalf
            half="top"
            team="A"
            zoneRefs={zoneRefs}
            remeasureZone={remeasureZone}
            slotRefs={slotRefsRef}
            remeasureSlot={remeasureSlot}
            outfieldByIdx={outfieldByIdx('A', outfieldCountForFormat(game.format))}
            gkPlayer={inZone('gkA')[0]}
            tint={TEAM_TINTS[0]}
            format={game.format}
            isAdmin={isAdmin}
            meId={me?.id}
            onDrop={handleDrop}
            onHover={handleHover}
            onClearHover={clearHover}
            remeasure={remeasureZones}
            guests={game.guests}
            hoverZone={hoverZone}
          />
          <View style={styles.centerLine} />
          <TeamHalf
            half="bottom"
            team="B"
            zoneRefs={zoneRefs}
            remeasureZone={remeasureZone}
            slotRefs={slotRefsRef}
            remeasureSlot={remeasureSlot}
            outfieldByIdx={outfieldByIdx('B', outfieldCountForFormat(game.format))}
            gkPlayer={inZone('gkB')[0]}
            tint={TEAM_TINTS[1]}
            format={game.format}
            isAdmin={isAdmin}
            meId={me?.id}
            onDrop={handleDrop}
            onHover={handleHover}
            onClearHover={clearHover}
            remeasure={remeasureZones}
            guests={game.guests}
            hoverZone={hoverZone}
          />
        </View>

        {/* ─── WAITING TEAMS — one full-width row per team ─── */}
        {/* Stacks vertically: 3 teams → 1 row, 4 → 2 rows, 5 → 3.
            Each row is its own drop target (teamC/D/E zone). */}
        {waitingLetters.length > 0 ? (
          <View style={styles.waitingStack}>
            {waitingLetters.map((letter, idx) => {
              const slotIndex = idx + 2; // letters[0..1] are on-field
              const tint = TEAM_TINTS[slotIndex] ?? colors.text;
              const players = inZone(teamZoneFor(letter));
              return (
                <WaitingTeamRow
                  key={letter}
                  letter={letter}
                  slotIndex={slotIndex}
                  tint={tint}
                  players={players}
                  score={scoreOf(live, letter)}
                  guests={game.guests}
                  meId={me?.id}
                  isAdmin={isAdmin}
                  onDrop={handleDrop}
                  onHover={handleHover}
                  onClearHover={clearHover}
                  remeasure={remeasureZones}
                  zoneRefs={zoneRefs}
                  remeasureZone={remeasureZone}
                  hoverZone={hoverZone}
                />
              );
            })}
          </View>
        ) : null}

        {/* ─── BOTTOM ACTION BAR ─── */}
        <View style={styles.actionBar}>
          <Pressable
            onPress={() => setOverviewOpen(true)}
            style={({ pressed }) => [
              styles.actionPrimary,
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name="people-outline" size={18} color="#fff" />
            <Text style={styles.actionPrimaryText}>{he.liveTeamsOverview}</Text>
          </Pressable>
          {isAdmin ? (
            <>
              <Pressable
                onPress={handleShuffle}
                style={({ pressed }) => [
                  styles.actionSecondary,
                  pressed && { opacity: 0.7 },
                ]}
                accessibilityLabel={he.liveShuffleTeams}
              >
                <Ionicons name="shuffle" size={18} color={colors.text} />
                <Text style={styles.actionSecondaryText} numberOfLines={1}>
                  {he.liveShuffleTeams}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleUndo}
                disabled={!hasUndo}
                style={({ pressed }) => [
                  styles.actionIconBtn,
                  !hasUndo && { opacity: 0.3 },
                  pressed && hasUndo && { opacity: 0.7 },
                ]}
                accessibilityLabel={he.liveUndo}
              >
                <Ionicons name="arrow-undo" size={20} color={colors.text} />
              </Pressable>
            </>
          ) : null}
        </View>

        {!isAdmin ? (
          <Text style={styles.viewerHint}>{he.liveViewerOnly}</Text>
        ) : null}

        <TeamsOverviewSheet
          visible={overviewOpen}
          groupId={game.groupId}
          teams={teamSlots}
          guests={game.guests ?? []}
          onClose={() => setOverviewOpen(false)}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ScoreCard({
  label,
  value,
  tint,
  isAdmin,
  onPlus,
  onMinus,
  expand,
}: {
  label: string;
  value: number;
  tint: string;
  isAdmin: boolean;
  onPlus: () => void;
  onMinus: () => void;
  /** When true, card uses flex:1 to fill the row. Otherwise content-sized. */
  expand?: boolean;
}) {
  return (
    <View style={[styles.scoreCard, expand && styles.scoreCardExpand]}>
      <View style={styles.scoreCardHeader}>
        <View style={[styles.scoreCardDot, { backgroundColor: tint }]} />
        <Text style={styles.scoreCardLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.scoreCardRow}>
        {isAdmin ? (
          <Pressable onPress={onMinus} hitSlop={8} style={styles.scoreBtn}>
            <Ionicons name="remove" size={16} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={[styles.scoreCardValue, { color: tint }]}>{value}</Text>
        {isAdmin ? (
          <Pressable onPress={onPlus} hitSlop={8} style={styles.scoreBtn}>
            <Ionicons name="add" size={16} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TimerBtn({
  label,
  icon,
  onPress,
  disabled,
  primary,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.timerBtn,
        primary ? styles.timerBtnPrimary : styles.timerBtnSecondary,
        disabled && { opacity: 0.4 },
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={primary ? '#fff' : colors.text}
      />
      <Text
        style={[
          styles.timerBtnText,
          { color: primary ? '#fff' : colors.text },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One half of the field. Lays out exactly `playersPerTeam(format)`
 * slots — 1 GK at the goal line + (N-1) outfield positions in a single
 * row across the half. Each outfield slot is its own drop target
 * (registered in `slotRefs`) so the coach can drag a player from one
 * specific slot to another.
 */
function TeamHalf({
  half,
  team,
  zoneRefs,
  remeasureZone,
  slotRefs,
  remeasureSlot,
  outfieldByIdx,
  gkPlayer,
  tint,
  format,
  isAdmin,
  meId,
  onDrop,
  onHover,
  onClearHover,
  remeasure,
  guests,
  hoverZone,
}: {
  half: 'top' | 'bottom';
  team: 'A' | 'B';
  zoneRefs: React.MutableRefObject<Record<Zone, RNView | null>>;
  remeasureZone: (z: Zone) => void;
  slotRefs: React.MutableRefObject<Map<string, RNView | null>>;
  remeasureSlot: (key: string) => void;
  /**
   * Slot-indexed roster for this team's outfield. Length matches
   * `outfieldCountForFormat(format)`; each element is either the
   * uid currently in that slot or `undefined` for an empty slot.
   */
  outfieldByIdx: (UserId | undefined)[];
  /** Single GK player (if assigned). */
  gkPlayer: UserId | undefined;
  tint: string;
  format: GameFormat | undefined;
  isAdmin: boolean;
  meId: UserId | undefined;
  onDrop: (uid: UserId, x: number, y: number) => void;
  onHover: (x: number, y: number) => void;
  onClearHover: () => void;
  remeasure: () => void;
  guests: GameGuest[] | undefined;
  hoverZone: Animated.SharedValue<string>;
}) {
  const slots = getFormationSlots(format);
  // y=1 means "own goal end". For the top half, the own goal is the
  // top edge → we mirror y so y=1 maps to top:0%. For the bottom half
  // we use y as-is (own goal at bottom edge).
  const mapY = (y: number) => (half === 'top' ? 1 - y : y);
  const outfieldSlots = slots.filter((s) => s.kind === 'outfield');
  const teamZoneKey: Zone = team === 'A' ? 'teamA' : 'teamB';
  const gkZoneKey: Zone = team === 'A' ? 'gkA' : 'gkB';
  // Looked up here (not inside DraggablePlayer) so the GK label below
  // the placeholder lines up with the empty-state "שוער" label.
  const gkPlayerName = usePlayerName(gkPlayer, guests);
  // Shrink jersey-size for tighter formations so adjacent slots don't
  // overlap on narrow phones (5v5 → 4 slots → 40dp; 7v7 → 6 → 32dp).
  const outfieldJerseySize =
    outfieldSlots.length <= 4 ? 40 : outfieldSlots.length === 5 ? 36 : 32;

  return (
    <View
      ref={(v) => {
        zoneRefs.current[teamZoneKey] = v;
      }}
      onLayout={() => remeasureZone(teamZoneKey)}
      style={styles.teamHalf}
    >
      <ZoneHighlight zoneKey={teamZoneKey} hoverZone={hoverZone} />

      {/* Outfield slots. Each slot has its own ref/rect so a drop
          on slot N routes to that exact position. Filled slots
          render the player; empty slots render a dashed circle —
          they never co-render, so they cannot overlap. */}
      {outfieldSlots.map((s, i) => {
        const uid = outfieldByIdx[i];
        const slotKey = `slot:${team}:${i}`;
        const left = `${s.x * 100}%` as const;
        const top = `${mapY(s.y) * 100}%` as const;
        return (
          <SlotCell
            key={`o-${i}`}
            slotKey={slotKey}
            left={left}
            top={top}
            uid={uid}
            tint={tint}
            jerseySize={outfieldJerseySize}
            slotRefs={slotRefs}
            remeasureSlot={remeasureSlot}
            hoverZone={hoverZone}
            isAdmin={isAdmin}
            meId={meId}
            onDrop={onDrop}
            onHover={onHover}
            onClearHover={onClearHover}
            remeasure={remeasure}
            guests={guests}
            emptyLabel={he.liveSlotEmpty}
          />
        );
      })}

      {/* GK slot — single occupancy, its own zone so a drop on the
          keeper routes to gkA/gkB instead of teamA/B. Same jersey-
          shaped placeholder as the outfield slots, just larger. */}
      {slots
        .filter((s) => s.kind === 'gk')
        .map((s) => {
          const left = `${s.x * 100}%` as const;
          const top = `${mapY(s.y) * 100}%` as const;
          return (
            <View
              key="gk"
              ref={(v) => {
                zoneRefs.current[gkZoneKey] = v;
              }}
              onLayout={() => remeasureZone(gkZoneKey)}
              style={[styles.gkSlotWrap, { left, top }]}
              pointerEvents="box-none"
            >
              <View style={styles.gkJerseyArea} pointerEvents="box-none">
                <JerseyPlaceholder size={GK_JERSEY_SIZE} tint={tint} />
                {gkPlayer ? (
                  <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
                    <DraggablePlayer
                      uid={gkPlayer}
                      isMe={gkPlayer === meId}
                      isAdmin={isAdmin}
                      size={GK_JERSEY_SIZE}
                      onDrop={onDrop}
                      onHover={onHover}
                      onClearHover={onClearHover}
                      remeasure={remeasure}
                      badge="🧤"
                      guests={guests}
                      hideLabel
                    />
                  </View>
                ) : null}
              </View>
              <ZoneHighlight zoneKey={gkZoneKey} hoverZone={hoverZone} />
              <Text style={styles.slotLabel} numberOfLines={1}>
                {gkPlayer
                  ? gkPlayerName
                  : he.liveGkSlot}
              </Text>
            </View>
          );
        })}
    </View>
  );
}

/**
 * One outfield formation slot. Always renders the dashed jersey
 * placeholder; when occupied the player's colored jersey overlays
 * the placeholder at the same shape and size, and the player's name
 * appears below where the empty-state "פנוי" label would be.
 */
function SlotCell({
  slotKey,
  left,
  top,
  uid,
  tint,
  jerseySize,
  slotRefs,
  remeasureSlot,
  hoverZone,
  isAdmin,
  meId,
  onDrop,
  onHover,
  onClearHover,
  remeasure,
  guests,
  emptyLabel,
}: {
  slotKey: string;
  left: `${number}%`;
  top: `${number}%`;
  uid: UserId | undefined;
  tint: string;
  jerseySize: number;
  slotRefs: React.MutableRefObject<Map<string, RNView | null>>;
  remeasureSlot: (key: string) => void;
  hoverZone: Animated.SharedValue<string>;
  isAdmin: boolean;
  meId: UserId | undefined;
  onDrop: (uid: UserId, x: number, y: number) => void;
  onHover: (x: number, y: number) => void;
  onClearHover: () => void;
  remeasure: () => void;
  guests: GameGuest[] | undefined;
  emptyLabel: string;
}) {
  const playerName = usePlayerName(uid, guests);
  // Wrap dimensions = jersey area + label area below. Pre-computed
  // here so the wrap is centered cleanly around its (left, top)
  // anchor regardless of jersey size.
  const wrapWidth = jerseySize + 16;
  const wrapHeight = jerseySize + SLOT_LABEL_GAP + LABEL_HEIGHT;
  return (
    <View
      ref={(v) => {
        if (v) slotRefs.current.set(slotKey, v);
        else slotRefs.current.delete(slotKey);
      }}
      onLayout={() => remeasureSlot(slotKey)}
      style={[
        styles.slotWrap,
        {
          left,
          top,
          width: wrapWidth,
          height: wrapHeight,
          marginLeft: -wrapWidth / 2,
          marginTop: -wrapHeight / 2,
        },
      ]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.slotJerseyArea,
          { width: jerseySize, height: jerseySize },
        ]}
        pointerEvents="box-none"
      >
        <JerseyPlaceholder size={jerseySize} tint={tint} />
        {uid ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <DraggablePlayer
              uid={uid}
              isMe={uid === meId}
              isAdmin={isAdmin}
              size={jerseySize}
              onDrop={onDrop}
              onHover={onHover}
              onClearHover={onClearHover}
              remeasure={remeasure}
              guests={guests}
              hideLabel
            />
          </View>
        ) : null}
      </View>
      <SlotHighlight slotKey={slotKey} hoverZone={hoverZone} />
      <Text style={styles.slotLabel} numberOfLines={1}>
        {uid ? playerName : emptyLabel}
      </Text>
    </View>
  );
}

/**
 * Full-width row strip for a team that's waiting off the pitch
 * (numberOfTeams ≥ 3). One row per team — they stack vertically. Each
 * row acts as a drop target via its `team{X}` zone ref.
 *
 * Layout (RTL — first JSX child renders on the RIGHT):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  • קבוצה 3 · ממתינה            [0]           │ header
 *   │  👕 👕 👕 👕                                 │ horizontal scroll
 *   └──────────────────────────────────────────────┘
 */
function WaitingTeamRow({
  letter,
  slotIndex,
  tint,
  players,
  score,
  guests,
  meId,
  isAdmin,
  onDrop,
  onHover,
  onClearHover,
  remeasure,
  zoneRefs,
  remeasureZone,
  hoverZone,
}: {
  letter: TeamLetter;
  slotIndex: number;
  tint: string;
  players: UserId[];
  score: number;
  guests: GameGuest[] | undefined;
  meId: UserId | undefined;
  isAdmin: boolean;
  onDrop: (uid: UserId, x: number, y: number) => void;
  onHover: (x: number, y: number) => void;
  onClearHover: () => void;
  remeasure: () => void;
  zoneRefs: React.MutableRefObject<Record<Zone, RNView | null>>;
  remeasureZone: (z: Zone) => void;
  hoverZone: Animated.SharedValue<string>;
}) {
  const zoneKey = teamZoneFor(letter);
  return (
    <View
      ref={(v) => {
        zoneRefs.current[zoneKey] = v;
      }}
      onLayout={() => remeasureZone(zoneKey)}
      style={[styles.waitingRow, { borderColor: tint }]}
    >
      <ZoneHighlight zoneKey={zoneKey} hoverZone={hoverZone} />
      <View style={styles.waitingRowHeader}>
        <View style={styles.waitingRowTitleWrap}>
          <View style={[styles.waitingDot, { backgroundColor: tint }]} />
          <Text style={styles.waitingRowTitle} numberOfLines={1}>
            {`${he.liveTeamLabel(slotIndex)} · ${he.liveTeamWaiting}`}
          </Text>
        </View>
        <View style={[styles.waitingScoreChip, { backgroundColor: tint }]}>
          <Text style={styles.waitingScoreText}>{score}</Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.waitingPlayersRow}
      >
        {players.length === 0 ? (
          <Text style={styles.waitingEmpty}>{he.liveTeamRosterEmpty}</Text>
        ) : (
          players.map((uid) => (
            <DraggablePlayer
              key={uid}
              uid={uid}
              isMe={uid === meId}
              isAdmin={isAdmin}
              size={32}
              onDrop={onDrop}
              onHover={onHover}
              onClearHover={onClearHover}
              remeasure={remeasure}
              guests={guests}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/**
 * Soccer-pitch backdrop. Pure presentation: alternating mowing
 * stripes for the grass effect, white touchlines around the
 * perimeter, a centre circle + spot, and penalty / goal areas at
 * each end. Renders as the first child of `styles.field` so all the
 * formation slots layer on top.
 */
function PitchBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Mowing stripes — 8 horizontal bands, alternating bands tinted
          slightly lighter so the grass reads as "mown". */}
      {Array.from({ length: 8 }).map((_, i) => (
        <View
          key={`stripe-${i}`}
          style={[
            styles.pitchStripe,
            {
              top: `${i * 12.5}%`,
              backgroundColor:
                i % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'transparent',
            },
          ]}
        />
      ))}

      {/* Touchlines — thin white border around the entire pitch. */}
      <View style={styles.pitchOuterBorder} />

      {/* Centre circle + spot, centred via flex. */}
      <View style={styles.pitchCenterWrap}>
        <View style={styles.pitchCenterCircle}>
          <View style={styles.pitchCenterSpot} />
        </View>
      </View>

      {/* Top half — penalty area / goal area / goal mouth. */}
      <View style={[styles.pitchPenaltyArea, styles.pitchPenaltyTop]} />
      <View style={[styles.pitchGoalArea, styles.pitchGoalTop]} />
      <View style={[styles.pitchGoalLine, styles.pitchGoalLineTop]} />

      {/* Bottom half — same set, mirrored. */}
      <View style={[styles.pitchPenaltyArea, styles.pitchPenaltyBottom]} />
      <View style={[styles.pitchGoalArea, styles.pitchGoalBottom]} />
      <View style={[styles.pitchGoalLine, styles.pitchGoalLineBottom]} />
    </View>
  );
}

function ZoneHighlight({
  zoneKey,
  hoverZone,
  round,
}: {
  zoneKey: Zone;
  hoverZone: Animated.SharedValue<string>;
  round?: boolean;
}) {
  const isHovered = useDerivedValue(() => hoverZone.value === zoneKey);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isHovered.value ? 1 : 0, { duration: 120 }),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        styles.zoneHighlight,
        round && { borderRadius: 999 },
        animatedStyle,
      ]}
    />
  );
}

/** Like ZoneHighlight but keyed off a `slot:<letter>:<idx>` string. */
function SlotHighlight({
  slotKey,
  hoverZone,
}: {
  slotKey: string;
  hoverZone: Animated.SharedValue<string>;
}) {
  const isHovered = useDerivedValue(() => hoverZone.value === slotKey);
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: withTiming(isHovered.value ? 1 : 0, { duration: 120 }),
    transform: [{ scale: withTiming(isHovered.value ? 1.05 : 1, { duration: 120 }) }],
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.slotHighlight, animatedStyle]}
    />
  );
}

interface DragProps {
  uid: UserId;
  isMe: boolean;
  isAdmin: boolean;
  size: number;
  onDrop: (uid: UserId, pageX: number, pageY: number) => void;
  onHover: (pageX: number, pageY: number) => void;
  onClearHover: () => void;
  remeasure: () => void;
  badge?: string;
  guests?: GameGuest[];
  /**
   * When true, suppress the in-component name label. Used by the
   * formation slots (the slot wrapper renders its own label below
   * the placeholder so that filled and empty slots line up).
   */
  hideLabel?: boolean;
}

function DraggablePlayer({
  uid,
  isMe,
  isAdmin,
  size,
  onDrop,
  onHover,
  onClearHover,
  remeasure,
  badge,
  guests,
  hideLabel,
}: DragProps) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const z = useSharedValue(0);

  const playersMap = useGameStore((s) => s.players);
  const guestId = parseGuestRosterId(uid);
  const guest = guestId ? guests?.find((g) => g.id === guestId) : undefined;
  const p = playersMap[uid];
  const name = guest ? guest.name : (p?.displayName ?? '');
  const jersey = guest ? undefined : p?.jersey;
  const cornerBadge = guest ? null : badge;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
    zIndex: z.value,
  }));

  const handleEnd = (pageX: number, pageY: number) => {
    onDrop(uid, pageX, pageY);
    onClearHover();
    requestAnimationFrame(remeasure);
  };

  const pan = Gesture.Pan()
    .enabled(isAdmin)
    .onStart(() => {
      'worklet';
      scale.value = withSpring(1.15);
      z.value = 100;
    })
    .onUpdate((e) => {
      'worklet';
      tx.value = e.translationX;
      ty.value = e.translationY;
      runOnJS(onHover)(e.absoluteX, e.absoluteY);
    })
    .onEnd((e) => {
      'worklet';
      runOnJS(handleEnd)(e.absoluteX, e.absoluteY);
      tx.value = withSpring(0);
      ty.value = withSpring(0);
      scale.value = withSpring(1);
      z.value = 0;
    });

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.draggable, animatedStyle]}>
        <View
          style={[
            styles.playerOuter,
            { width: size + 4 },
            isMe && styles.playerOuterMe,
          ]}
        >
          <PlayerIdentity
            user={{ id: uid, name: name || '?', jersey }}
            size={size}
          />
          {cornerBadge ? (
            <View style={styles.gkBadge}>
              <Text style={styles.gkBadgeText}>{cornerBadge}</Text>
            </View>
          ) : null}
          {!hideLabel && name ? (
            <Text
              style={styles.playerName}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {name}
            </Text>
          ) : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * Lookup helper used by formation slots so the slot wrap can render
 * the player's name below the placeholder (matching the empty-slot
 * "פנוי" position). Returns the same display name DraggablePlayer
 * uses internally.
 */
function usePlayerName(
  uid: UserId | undefined,
  guests: GameGuest[] | undefined,
): string {
  const playersMap = useGameStore((s) => s.players);
  if (!uid) return '';
  const gid = parseGuestRosterId(uid);
  if (gid) return guests?.find((g) => g.id === gid)?.name ?? '';
  return playersMap[uid]?.displayName ?? '';
}

/**
 * Dashed jersey-shaped placeholder. Mirrors the geometry the `Jersey`
 * component uses (sleeves + body), so when a player is placed at the
 * slot their colored jersey overlays this outline at the same shape
 * and size — the placeholder visually "frames" the player.
 */
function JerseyPlaceholder({
  size,
  tint,
}: {
  size: number;
  tint: string;
}) {
  // Geometry copied verbatim from the Jersey component so the colored
  // jersey rendered on top fits exactly inside the dashed outline.
  const bodyW = Math.round(size * 0.7);
  const bodyH = Math.round(size * 0.86);
  const bodyTop = Math.round(size * 0.07);
  const bodyLeft = Math.round((size - bodyW) / 2);
  const bodyRadius = Math.round(size * 0.14);

  const sleeveW = Math.round(size * 0.24);
  const sleeveH = Math.round(size * 0.22);
  const sleeveTop = Math.round(size * 0.1);
  const sleeveR = Math.round(sleeveH * 0.6);
  const sleeveSm = Math.round(sleeveH * 0.18);

  const sleeveCommon = {
    position: 'absolute' as const,
    top: sleeveTop,
    width: sleeveW,
    height: sleeveH,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    borderColor: tint,
    backgroundColor: 'rgba(255,255,255,0.06)',
  };

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          ...sleeveCommon,
          left: 0,
          borderTopLeftRadius: sleeveR,
          borderTopRightRadius: sleeveSm,
          borderBottomLeftRadius: sleeveSm,
          borderBottomRightRadius: 0,
        }}
      />
      <View
        style={{
          ...sleeveCommon,
          right: 0,
          borderTopLeftRadius: sleeveSm,
          borderTopRightRadius: sleeveR,
          borderBottomLeftRadius: 0,
          borderBottomRightRadius: sleeveSm,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: bodyTop,
          left: bodyLeft,
          width: bodyW,
          height: bodyH,
          borderRadius: bodyRadius,
          borderWidth: 2,
          borderStyle: 'dashed',
          borderColor: tint,
          backgroundColor: 'rgba(255,255,255,0.06)',
        }}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────

// Slot wrap dims are computed per-cell in `SlotCell` because the
// jersey size shrinks with the formation (5v5 → 40dp, 7v7 → 32dp).
// These shared constants drive the label band that's identical
// across every slot.
const GK_JERSEY_SIZE = 56;
const LABEL_HEIGHT = 16;
const SLOT_LABEL_GAP = 2;

const GK_WRAP_WIDTH = GK_JERSEY_SIZE + 20;
const GK_WRAP_HEIGHT = GK_JERSEY_SIZE + SLOT_LABEL_GAP + LABEL_HEIGHT;
const GK_WRAP_HALF_W = GK_WRAP_WIDTH / 2;
const GK_WRAP_HALF_H = GK_WRAP_HEIGHT / 2;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textMuted },

  headerBar: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
  },
  backLabel: {
    ...typography.bodyBold,
    color: colors.text,
  },

  timerCard: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  timerValue: {
    color: colors.text,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
    fontSize: 32,
    lineHeight: 38,
    textAlign: 'center',
  },
  timerCeiling: {
    color: colors.textMuted,
    fontSize: 18,
    fontWeight: '600',
  },
  timerBtnRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    minWidth: 96,
    justifyContent: 'center',
  },
  timerBtnPrimary: {
    backgroundColor: colors.primary,
  },
  timerBtnSecondary: {
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timerBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // Score row — only the on-field matchup (2 cards), flex-distributed.
  scoreRow: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 4,
    minWidth: 96,
  },
  scoreCardExpand: {
    flex: 1,
  },
  scoreCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scoreCardDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  scoreCardLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  scoreCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scoreCardValue: {
    fontSize: 26,
    fontWeight: '900',
    minWidth: 26,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  scoreBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },

  // Field
  field: {
    flex: 1,
    backgroundColor: colors.field,
    margin: spacing.md,
    borderRadius: radius.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  teamHalf: {
    flex: 1,
    position: 'relative',
  },
  centerLine: {
    // Soccer halfway line — full-width white line bisecting the pitch.
    height: 2,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },

  // Pitch backdrop — mowing stripes + touchlines + circles + boxes.
  pitchStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: '12.5%',
  },
  pitchOuterBorder: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: radius.lg,
  },
  /** Flex container that vertically + horizontally centres the centre
   *  circle. Using flexbox lets the circle stay perfectly centred
   *  without depending on measured field dimensions. */
  pitchCenterWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchCenterCircle: {
    width: '32%',
    aspectRatio: 1,
    borderRadius: 9999,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pitchCenterSpot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  /** Penalty area — wider rectangle anchored to the goal line. */
  pitchPenaltyArea: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    height: '15%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  pitchPenaltyTop: {
    top: 0,
    borderTopWidth: 0, // the touchline supplies the top edge
  },
  pitchPenaltyBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  /** Goal area (six-yard box) — smaller rectangle inside the penalty. */
  pitchGoalArea: {
    position: 'absolute',
    left: '34%',
    right: '34%',
    height: '6%',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  pitchGoalTop: {
    top: 0,
    borderTopWidth: 0,
  },
  pitchGoalBottom: {
    bottom: 0,
    borderBottomWidth: 0,
  },
  /** Goal mouth — bold white line on the goal side. */
  pitchGoalLine: {
    position: 'absolute',
    left: '42%',
    right: '42%',
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  pitchGoalLineTop: {
    top: -1, // hairline overlap with the touchline so they merge cleanly
  },
  pitchGoalLineBottom: {
    bottom: -1,
  },

  // Outfield slot wrap — column with jersey area on top + label
  // underneath. Width/height are set inline by SlotCell because the
  // jersey size adapts to the format.
  slotWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  /** Square area that holds the jersey-shaped placeholder + the
   *  optional player overlay. Sized to the jersey itself so the
   *  placeholder and the player jersey occupy the same bounds. */
  slotJerseyArea: {
    position: 'relative',
  },
  /** Label below the placeholder — shows the player's name when the
   *  slot is filled, "פנוי" otherwise. Same vertical position in
   *  both states so the layout doesn't jump on placement. */
  slotLabel: {
    marginTop: SLOT_LABEL_GAP,
    fontSize: 11,
    lineHeight: 14,
    height: LABEL_HEIGHT,
    color: '#fff',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 2,
  },

  // GK slot wrap — same column shape, larger jersey.
  gkSlotWrap: {
    position: 'absolute',
    width: GK_WRAP_WIDTH,
    height: GK_WRAP_HEIGHT,
    marginLeft: -GK_WRAP_HALF_W,
    marginTop: -GK_WRAP_HALF_H,
    alignItems: 'center',
  },
  gkJerseyArea: {
    width: GK_JERSEY_SIZE,
    height: GK_JERSEY_SIZE,
    position: 'relative',
  },

  // Drag-over highlight overlay
  zoneHighlight: {
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderWidth: 2,
    borderColor: 'rgba(34,197,94,0.7)',
    borderRadius: radius.md,
  },
  // Slot-specific highlight — fits inside the dashed circle with a
  // round filled shape for a precise "drop here" cue.
  slotHighlight: {
    position: 'absolute',
    width: 52,
    height: 52,
    left: '50%',
    top: '50%',
    marginLeft: -26,
    marginTop: -26,
    borderRadius: 26,
    backgroundColor: 'rgba(34,197,94,0.30)',
    borderWidth: 2,
    borderColor: 'rgba(34,197,94,0.85)',
  },

  // Waiting teams (numberOfTeams ≥ 3) — one full-width row per team.
  waitingStack: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: 6,
  },
  waitingRow: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    overflow: 'hidden',
  },
  waitingRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  waitingRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  waitingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  waitingRowTitle: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
  },
  waitingScoreChip: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  waitingScoreText: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  waitingPlayersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: 4,
    minHeight: 40,
  },
  waitingEmpty: {
    fontSize: 11,
    color: colors.textMuted,
    paddingVertical: 6,
  },

  // Bottom action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  actionPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  actionPrimaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  actionSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionSecondaryText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  actionIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  viewerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },

  // Players
  draggable: {
    margin: 2,
  },
  playerOuter: {
    alignItems: 'center',
    padding: 2,
    borderRadius: radius.md,
  },
  playerOuterMe: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  playerName: {
    ...typography.caption,
    color: '#fff',
    marginTop: 2,
    maxWidth: 60,
    textAlign: 'center',
  },
  gkBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  gkBadgeText: { fontSize: 11 },
});
