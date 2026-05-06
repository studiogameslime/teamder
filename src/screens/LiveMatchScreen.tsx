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
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type View as RNView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  GestureDetector,
  GestureHandlerRootView,
  Gesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
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
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import {
  canEnterLive,
  isCancelled as isCancelledHelper,
  isFinished as isFinishedHelper,
} from '@/services/gameLifecycle';
import { useGameEvents } from '@/services/useGameEvents';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
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

// Soft (low-saturation) variant of each team's accent — used as
// background tint for player rows / team headers in the redesigned
// live screen, so the colour reads as "this is team X" without
// stamping the card with a fully saturated band.
const TEAM_TINTS_SOFT = [
  '#DBEAFE', // blue-100
  '#FEE2E2', // red-100
  '#DCFCE7', // green-100
  '#FFEDD5', // orange-100
  '#F3E8FF', // purple-100
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

  // Realtime banners for live events — goals, status changes, late
  // joins/leaves, etc. Listener is shared with MatchDetailsScreen so
  // identical events surface consistently across the flow.
  useGameEvents(gameId ?? undefined);

  const [game, setGame] = useState<Game | null>(null);
  const [live, setLive] = useState<LiveMatchState | null>(null);

  // Local timer (not persisted).
  const [timerMs, setTimerMs] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerStarted, setTimerStarted] = useState(false);

  const [overviewOpen, setOverviewOpen] = useState(false);
  const [endRoundOpen, setEndRoundOpen] = useState(false);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  const [scoreEditOpen, setScoreEditOpen] = useState(false);

  // Round-finished summary (transient — captured at end-round, cleared
  // when the next round kicks off). When non-null, the screen is in the
  // `round_finished` state.
  const [lastSummary, setLastSummary] = useState<{
    winner: 'A' | 'B' | 'draw';
    scoreA: number;
    scoreB: number;
    roundNumber: number;
  } | null>(null);

  // Tick once a minute so the `scheduled → ready_to_start` transition
  // becomes visible without a manual refresh once the session time
  // arrives. Cheap; doesn't drive any other re-renders.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
      if (alive) {
        setGame(g);
        if (g) logEvent(AnalyticsEvent.LiveMatchOpened, { gameId: g.id });
        // Lifecycle guard:
        //   • Terminal (finished/cancelled) — always redirect; nothing
        //     to do or see.
        //   • Non-active and the viewer is NOT an admin — also
        //     redirect: regular players have nothing to do until the
        //     admin starts the evening.
        //   • Non-active but the viewer IS an admin — allow entry so
        //     the admin can preview the field/roster and reach the
        //     "התחל ערב" CTA from inside the live surface (the menu
        //     entry "ניהול משחק" lands the admin here).
        if (g) {
          const terminal = isFinishedHelper(g) || isCancelledHelper(g);
          const adminHere =
            !!me &&
            (g.createdBy === me.id ||
              myCommunities.some(
                (c) => c.id === g.groupId && c.adminIds.includes(me.id),
              ));
          if (terminal) {
            toast.info(he.matchDetailsAlreadyFinished);
            if (nav.canGoBack()) nav.goBack();
          } else if (!canEnterLive(g) && !adminHere) {
            toast.info(he.liveMatchNotActiveYet);
            if (nav.canGoBack()) nav.goBack();
          }
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities, nav]);

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
      // Phase transition analytics — fired whenever the live phase
      // actually changes between commits. Lets us measure how long
      // each phase typically lasts (organizing → roundReady →
      // roundRunning → roundEnded → finished).
      if (live && live.phase !== next.phase) {
        logEvent(AnalyticsEvent.LiveMatchPhaseTransition, {
          gameId,
          fromPhase: live.phase,
          toPhase: next.phase,
        });
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
    logEvent(AnalyticsEvent.PlayersShuffled, {
      gameId: game.id,
      teamCount: teamLetters.length,
      rosterSize: rosterIds.length,
    });
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
    if (gameId) {
      logEvent(AnalyticsEvent.TeamScoreChanged, {
        gameId,
        team: letter,
        delta,
      });
    }
    // The goal banner is fired by the realtime useGameEvents listener
    // (driven by the persisted score change) so every device sees it.
  };

  // ─── Session state machine ─────────────────────────────────────────────
  // Derived purely from start time + timer + round-finished flag.
  // Defined here (above the handlers) so handlers can guard against
  // illegal state transitions without forward references.
  type SessionState =
    | 'scheduled'
    | 'ready_to_start'
    | 'round_active'
    | 'round_paused'
    | 'round_finished';
  const sessionInFuture =
    !!game && typeof game.startsAt === 'number' && game.startsAt > Date.now();
  const sessionState: SessionState = (() => {
    if (sessionInFuture) return 'scheduled';
    if (lastSummary) return 'round_finished';
    if (!timerStarted) return 'ready_to_start';
    return timerRunning ? 'round_active' : 'round_paused';
  })();
  const canManageRound = isAdmin && sessionState !== 'scheduled';
  const canLogGoal = isAdmin && sessionState === 'round_active';
  const canEditScore =
    isAdmin && (sessionState === 'round_active' || sessionState === 'round_paused');

  /**
   * End the current round.
   *
   * "winner" is the on-field letter that won (A or B), or 'draw' for a
   * tie. With ≥3 teams the loser rotates to the tail of the waiting
   * queue, the front of the waiting queue takes the field, and the
   * winner stays. With 2 teams (no waiting) we just reset and bump the
   * round counter — same matchup plays again.
   *
   * Side effects: scores zero out, round counter increments, timer
   * resets locally. Slot maps for the team whose composition changed
   * are cleared so the auto-placer fills the formation cleanly.
   */
  const handleEndRound = useCallback(
    (winner: 'A' | 'B' | 'draw') => {
      if (!live || !isAdmin || !gameId) return;
      if (sessionState === 'scheduled' || sessionState === 'round_finished') {
        return; // can't end a round that hasn't started or already ended
      }
      const currentRoundNumber = live.roundNumber ?? 1;
      // Snapshot scores + winner for the summary banner that renders
      // while we're in `round_finished` state.
      setLastSummary({
        winner,
        scoreA: live.scoreA,
        scoreB: live.scoreB,
        roundNumber: currentRoundNumber,
      });

      const resetScores = {
        scoreA: 0,
        scoreB: 0,
        scoreC: 0,
        scoreD: 0,
        scoreE: 0,
      };

      // Persist a +1 to the winning team's position. A draw doesn't
      // count for either side. The loser's position keeps its tally
      // as long as the same players stay there; if rotation happens
      // below the loser's slot is wiped (new team starts fresh).
      const prevWins = live.winsByTeam ?? {};
      const winnerWins =
        winner === 'draw'
          ? prevWins
          : { ...prevWins, [winner]: (prevWins[winner] ?? 0) + 1 };

      let next: LiveMatchState;
      if (winner === 'draw' || waitingLetters.length === 0) {
        // No rotation — same matchup will play again next round. The
        // winner (if any) carries its updated tally forward.
        next = { ...live, ...resetScores, winsByTeam: winnerWins };
      } else {
        const loser: 'A' | 'B' = winner === 'A' ? 'B' : 'A';
        const loserZone: Zone = `team${loser}` as Zone;
        const loserGkZone: Zone = `gk${loser}` as Zone;
        const waitingZones: Zone[] = waitingLetters.map(
          (l) => `team${l}` as Zone,
        );

        // Queue: [active(loser), wait1, wait2, ...]. After rotation:
        //   • the first waiting team takes over the active (loser's)
        //     zone — they enter the field;
        //   • each subsequent waiting team moves up one slot;
        //   • the loser drops to the back of the queue.
        // Translated to a per-player remap (assignments[uid] = zone):
        // we move every player from their current zone to whichever
        // zone NOW holds that queue position.
        //
        // Earlier implementation rotated the queue in the wrong
        // direction (the loser moved into wait1, not the back) — so
        // the team that was supposed to enter the field never did.
        const positions: Zone[] = [loserZone, ...waitingZones];
        const remap = new Map<Zone, Zone>();
        for (let i = 0; i < positions.length; i++) {
          const dest =
            i === 0 ? positions[positions.length - 1] : positions[i - 1];
          remap.set(positions[i], dest);
        }
        // The loser's GK zone behaves the same as the rest of the
        // loser's roster — that player goes to the back of the queue
        // (last waiting position) and gets re-picked as a regular
        // outfield slot when the team comes back on later.
        remap.set(loserGkZone, positions[positions.length - 1]);

        const newAssignments: Record<UserId, Zone> = {};
        for (const uid of Object.keys(live.assignments) as UserId[]) {
          const cur = live.assignments[uid];
          newAssignments[uid] = remap.get(cur) ?? cur;
        }

        const nextTeamASlots = loser === 'A' ? {} : (live.teamASlots ?? {});
        const nextTeamBSlots = loser === 'B' ? {} : (live.teamBSlots ?? {});

        // Loser's position is now occupied by a fresh team — wipe its
        // win tally so the new players don't inherit the loser's
        // history. The winner's tally was already incremented above.
        const rotatedWins = { ...winnerWins, [loser]: 0 };

        next = {
          ...live,
          assignments: newAssignments,
          teamASlots: nextTeamASlots,
          teamBSlots: nextTeamBSlots,
          winsByTeam: rotatedWins,
          ...resetScores,
        };
      }

      commit(next, { undoable: false, markEdited: true });
      setEndRoundOpen(false);
      // Pause and freeze local timer until the next round is started.
      setTimerRunning(false);
      logEvent(AnalyticsEvent.MatchRoundCompleted, {
        gameId,
        roundNumber: currentRoundNumber,
        outcome: winner,
      });
    },
    [live, isAdmin, gameId, waitingLetters, commit, sessionState],
  );

  /**
   * Move from `round_finished` → `round_active` with the next round
   * number. Bumps `roundNumber` (persisted) and immediately starts the
   * timer for the new round.
   */
  const handleStartNextRound = useCallback(() => {
    if (!live || !isAdmin) return;
    const nextRoundNumber = (live.roundNumber ?? 1) + 1;
    commit(
      { ...live, roundNumber: nextRoundNumber },
      { undoable: false, markEdited: false },
    );
    setLastSummary(null);
    setTimerMs(0);
    setTimerStarted(true);
    setTimerRunning(true);
  }, [live, isAdmin, commit]);

  /**
   * Apply a goal — credits the team's score by 1. Used by the goal-log
   * modal. Honours the "own goal" toggle by crediting the OTHER team.
   */
  const handleLogGoal = useCallback(
    (scoringTeam: 'A' | 'B', isOwnGoal: boolean) => {
      if (!live || !canLogGoal) return;
      const credited: 'A' | 'B' = isOwnGoal
        ? scoringTeam === 'A'
          ? 'B'
          : 'A'
        : scoringTeam;
      const prev = scoreOf(live, credited);
      commit(setScoreOf(live, credited, prev + 1));
      setGoalModalOpen(false);
      toast.success(he.liveGoalRecorded);
      if (gameId) {
        logEvent(AnalyticsEvent.TeamScoreChanged, {
          gameId,
          team: credited,
          delta: 1,
          source: isOwnGoal ? 'own_goal' : 'goal',
        });
      }
    },
    [live, canLogGoal, commit, gameId],
  );

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

  // ─── Timer pulse animation ─────────────────────────────────────────────
  // While running, the displayed time pulses subtly so the eye knows
  // the round is active (vs paused). Final 60s tints amber (color-only
  // signal), final 10s adds a slightly stronger pulse + red tint.
  // Animation runs on the UI thread via Reanimated; we cancel + reset
  // whenever the timer pauses to keep the static state visually stable.
  const remainingMs = Math.max(0, totalMs - timerMs);
  const isLastTen = timerRunning && remainingMs > 0 && remainingMs <= 10_000;
  const isLastMinute =
    timerRunning && remainingMs > 0 && remainingMs <= 60_000;
  const timerPulse = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(timerPulse);
    if (!timerRunning) {
      timerPulse.value = withTiming(1, { duration: 150 });
      return;
    }
    // Calibrated to feel alive, not broken: barely-there 0.02 amplitude
    // by default, bumping to 0.04 only inside the final 10 seconds. The
    // final-minute amber tint is the color-only cue — no extra pulse.
    const amplitude = isLastTen ? 0.04 : 0.02;
    const period = isLastTen ? 360 : 700;
    timerPulse.value = withRepeat(
      withSequence(
        withTiming(1 + amplitude, { duration: period / 2 }),
        withTiming(1, { duration: period / 2 }),
      ),
      -1,
      false,
    );
  }, [timerRunning, isLastTen, timerPulse]);
  const timerPulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: timerPulse.value }],
  }));

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

  // ─── Tap-to-swap state ────────────────────────────────────────────────
  // Replaces the old drag-and-drop interaction. Tap a player to select;
  // tap another player on the OPPOSITE on-field team to swap them. Tap
  // the same player again to deselect. Non-admins are locked out.
  //
  // IMPORTANT: All hooks below MUST sit above the loading early-return
  // a few lines down. Moving any hook past the early return will fire
  // a different number of hooks on the loading vs loaded renders and
  // crash with "Rendered more hooks than during the previous render".
  const [selectedUid, setSelectedUid] = useState<UserId | null>(null);

  const handleSwap = useCallback(
    (a: UserId, b: UserId) => {
      if (!live || !isAdmin) return;
      const za = live.assignments[a];
      const zb = live.assignments[b];
      if (!za || !zb) return;
      // Guard: only allow cross-team swaps between teamA and teamB
      // (the two playing teams). Same-team taps just clear selection.
      const isTeamAZone = (z: Zone) => z === 'teamA' || z === 'gkA';
      const isTeamBZone = (z: Zone) => z === 'teamB' || z === 'gkB';
      const oneAndTwo =
        (isTeamAZone(za) && isTeamBZone(zb)) ||
        (isTeamBZone(za) && isTeamAZone(zb));
      if (!oneAndTwo) return;
      const next: LiveMatchState = {
        ...live,
        assignments: {
          ...live.assignments,
          [a]: zb,
          [b]: za,
        },
        // Slot maps are tied to specific uids — clear them so the new
        // formation auto-fills cleanly after the swap.
        teamASlots: {},
        teamBSlots: {},
      };
      commit(next, { undoable: false, markEdited: true });
    },
    [live, isAdmin, commit],
  );

  const handlePlayerTap = useCallback(
    (uid: UserId) => {
      if (!isAdmin) return;
      if (!selectedUid) {
        setSelectedUid(uid);
        return;
      }
      if (selectedUid === uid) {
        setSelectedUid(null);
        return;
      }
      handleSwap(selectedUid, uid);
      setSelectedUid(null);
    },
    [selectedUid, isAdmin, handleSwap],
  );

  // Players currently on the two playing teams (A on the right,
  // B on the left under RTL). Each entry includes both outfield and
  // GK roster members for that team.
  const teamAOnField: UserId[] = useMemo(() => {
    if (!live) return [];
    return (Object.keys(live.assignments) as UserId[]).filter((uid) => {
      const z = live.assignments[uid];
      return z === 'teamA' || z === 'gkA';
    });
  }, [live]);
  const teamBOnField: UserId[] = useMemo(() => {
    if (!live) return [];
    return (Object.keys(live.assignments) as UserId[]).filter((uid) => {
      const z = live.assignments[uid];
      return z === 'teamB' || z === 'gkB';
    });
  }, [live]);

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

  // Decide what the bottom-right primary CTA should do, based on the
  // current session state. `null` → no primary action available.
  const primaryAction = (() => {
    if (!canManageRound) return null;
    if (sessionState === 'ready_to_start')
      return { label: he.liveStartRound, icon: 'play' as const, onPress: onTimerStart };
    if (sessionState === 'round_active')
      return { label: he.liveLogGoal, icon: 'football' as const, onPress: () => setGoalModalOpen(true) };
    if (sessionState === 'round_paused')
      return {
        label: he.liveTimerResume,
        icon: 'play' as const,
        onPress: onTimerResume,
      };
    if (sessionState === 'round_finished')
      return {
        label: he.liveStartNextRound,
        icon: 'play-forward' as const,
        onPress: handleStartNextRound,
      };
    return null;
  })();

  const showEndRound =
    isAdmin &&
    (sessionState === 'round_active' || sessionState === 'round_paused');

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <LiveStadiumHero
          timerMs={timerMs}
          totalMs={totalMs}
          isLastTen={isLastTen}
          isLastMinute={isLastMinute}
          sessionStateLabel={sessionStateLabel(
            sessionState,
            live.roundNumber ?? 1,
          )}
          onBack={() => nav.goBack()}
        />

        <View style={styles.body}>
          <CurrentMatchPanel
            sessionState={sessionState}
            teamA={{
              tint: TEAM_TINTS[0],
              softTint: TEAM_TINTS_SOFT[0],
              name: he.liveTeamLabel(0),
              // The number under the team name is cumulative round
              // wins (not the in-round goal count). The big scoreboard
              // above the panel renders the live goal score.
              score: live.winsByTeam?.A ?? 0,
              players: teamAOnField,
            }}
            teamB={{
              tint: TEAM_TINTS[1],
              softTint: TEAM_TINTS_SOFT[1],
              name: he.liveTeamLabel(1),
              score: live.winsByTeam?.B ?? 0,
              players: teamBOnField,
            }}
            guests={game.guests ?? []}
            isAdmin={isAdmin}
            selectedUid={selectedUid}
            onPlayerTap={handlePlayerTap}
          />

          {waitingLetters.length > 0 ? (
            <TeamQueuePanel
              teams={waitingLetters.map((letter, idx) => {
                const slotIndex = idx + 2;
                return {
                  letter,
                  position: idx + 1,
                  name: he.liveTeamLabel(slotIndex),
                  tint: TEAM_TINTS[slotIndex] ?? colors.text,
                  softTint: TEAM_TINTS_SOFT[slotIndex] ?? '#F1F5F9',
                  // Same semantics as the active panel — show wins,
                  // not the (zero, since they're not playing) goal score.
                  score:
                    (live.winsByTeam as Record<string, number> | undefined)?.[
                      letter
                    ] ?? 0,
                };
              })}
            />
          ) : null}

          {!isAdmin ? (
            <Text style={styles.viewerHint}>{he.liveViewerOnly}</Text>
          ) : null}
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.actionBarSafe}>
        <View style={styles.actionBar}>
          {showEndRound ? (
            <Pressable
              onPress={() => setEndRoundOpen(true)}
              style={({ pressed }) => [
                styles.endMatchBtn,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.liveEndRound}
            >
              <Ionicons name="flag" size={18} color="#EF4444" />
              <Text style={styles.endMatchText}>{he.liveEndRound}</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setOverviewOpen(true)}
              style={({ pressed }) => [
                styles.endMatchBtn,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.liveTeamsOverview}
            >
              <Ionicons name="people-outline" size={18} color="#475569" />
              <Text style={[styles.endMatchText, { color: '#475569' }]}>
                {he.liveTeamsOverview}
              </Text>
            </Pressable>
          )}

          {primaryAction ? (
            <Pressable
              onPress={primaryAction.onPress}
              style={({ pressed }) => [
                styles.startMatchBtn,
                pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              ]}
              accessibilityRole="button"
              accessibilityLabel={primaryAction.label}
            >
              <Text style={styles.startMatchText}>{primaryAction.label}</Text>
              <Ionicons name={primaryAction.icon} size={20} color="#FFFFFF" />
            </Pressable>
          ) : (
            <View style={styles.startMatchBtn} pointerEvents="none">
              <Text style={[styles.startMatchText, { opacity: 0.5 }]}>
                {sessionState === 'scheduled'
                  ? he.liveStatusScheduled
                  : he.liveStartRound}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>

      <TeamsOverviewSheet
        visible={overviewOpen}
        groupId={game.groupId}
        teams={teamSlots}
        guests={game.guests ?? []}
        onClose={() => setOverviewOpen(false)}
      />

      <EndRoundModal
        visible={endRoundOpen}
        roundNumber={live.roundNumber ?? 1}
        teamATint={TEAM_TINTS[0]}
        teamBTint={TEAM_TINTS[1]}
        teamAScore={live.scoreA}
        teamBScore={live.scoreB}
        onCancel={() => setEndRoundOpen(false)}
        onSelect={handleEndRound}
      />

      <GoalLogModal
        visible={goalModalOpen}
        teamAPlayers={teamSlots[0]?.playerIds ?? []}
        teamBPlayers={teamSlots[1]?.playerIds ?? []}
        teamATint={TEAM_TINTS[0]}
        teamBTint={TEAM_TINTS[1]}
        guests={game.guests ?? []}
        onCancel={() => setGoalModalOpen(false)}
        onPick={(team, isOwn) => handleLogGoal(team, isOwn)}
      />

      <ScoreEditModal
        visible={scoreEditOpen}
        scoreA={live.scoreA}
        scoreB={live.scoreB}
        teamATint={TEAM_TINTS[0]}
        teamBTint={TEAM_TINTS[1]}
        onClose={() => setScoreEditOpen(false)}
        onAdjust={(team, delta) => {
          if (!live) return;
          const prev = scoreOf(live, team);
          commit(setScoreOf(live, team, Math.max(0, prev + delta)));
          if (gameId) {
            logEvent(AnalyticsEvent.TeamScoreChanged, {
              gameId,
              team,
              delta,
              source: 'manual',
            });
          }
        }}
      />
    </View>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ScoreCard({
  label,
  value,
  tint,
  expand,
}: {
  label: string;
  value: number;
  tint: string;
  /** When true, card uses flex:1 to fill the row. Otherwise content-sized. */
  expand?: boolean;
}) {
  // Display-only. Inline +/- adjusters are gone — goal logging is the
  // primary path and any correction goes through the admin-only score
  // edit modal.
  return (
    <View style={[styles.scoreCard, expand && styles.scoreCardExpand]}>
      <View style={styles.scoreCardHeader}>
        <View style={[styles.scoreCardDot, { backgroundColor: tint }]} />
        <Text style={styles.scoreCardLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.scoreCardValue, { color: tint }]}>{value}</Text>
    </View>
  );
}

/**
 * End-of-round confirmation modal. Admin picks the winner (or draw)
 * and we return that to the parent which performs the queue rotation.
 */
function EndRoundModal({
  visible,
  roundNumber,
  teamATint,
  teamBTint,
  teamAScore,
  teamBScore,
  onCancel,
  onSelect,
}: {
  visible: boolean;
  roundNumber: number;
  teamATint: string;
  teamBTint: string;
  teamAScore: number;
  teamBScore: number;
  onCancel: () => void;
  onSelect: (winner: 'A' | 'B' | 'draw') => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.endRoundBackdrop} onPress={onCancel}>
        <Pressable
          style={styles.endRoundCard}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.endRoundEyebrow}>
            {he.liveRoundLabel(roundNumber)}
          </Text>
          <Text style={styles.endRoundTitle}>{he.liveEndRoundTitle}</Text>
          <Text style={styles.endRoundQuestion}>{he.liveEndRoundQuestion}</Text>

          <Pressable
            onPress={() => onSelect('A')}
            style={({ pressed }) => [
              styles.endRoundOption,
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.endRoundDot, { backgroundColor: teamATint }]} />
            <Text style={styles.endRoundOptionLabel}>
              {he.liveTeamLabel(0)}
            </Text>
            <Text style={styles.endRoundScore}>{teamAScore}</Text>
          </Pressable>

          <Pressable
            onPress={() => onSelect('B')}
            style={({ pressed }) => [
              styles.endRoundOption,
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.endRoundDot, { backgroundColor: teamBTint }]} />
            <Text style={styles.endRoundOptionLabel}>
              {he.liveTeamLabel(1)}
            </Text>
            <Text style={styles.endRoundScore}>{teamBScore}</Text>
          </Pressable>

          <Pressable
            onPress={() => onSelect('draw')}
            style={({ pressed }) => [
              styles.endRoundOption,
              styles.endRoundOptionDraw,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="git-compare-outline" size={20} color={colors.textMuted} />
            <Text style={styles.endRoundOptionLabel}>{he.liveDrawLabel}</Text>
          </Pressable>

          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              styles.endRoundCancel,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.endRoundCancelText}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Maps the SessionState enum to its Hebrew banner label. */
function sessionStateLabel(
  state:
    | 'scheduled'
    | 'ready_to_start'
    | 'round_active'
    | 'round_paused'
    | 'round_finished',
  roundNumber: number,
): string {
  if (state === 'scheduled') return he.liveStatusScheduled;
  if (state === 'ready_to_start') return he.liveStatusReady(roundNumber);
  if (state === 'round_active') return he.liveStatusActive(roundNumber);
  if (state === 'round_paused') return he.liveStatusPaused(roundNumber);
  return he.liveStatusFinished(roundNumber);
}

/**
 * "Who scored?" bottom-sheet style modal. Lists the on-field rosters
 * grouped by team. Tapping a player credits their team with a goal —
 * unless the "גול עצמי" toggle is on, in which case the goal is
 * credited to the other team.
 */
function GoalLogModal({
  visible,
  teamAPlayers,
  teamBPlayers,
  teamATint,
  teamBTint,
  guests,
  onCancel,
  onPick,
}: {
  visible: boolean;
  teamAPlayers: UserId[];
  teamBPlayers: UserId[];
  teamATint: string;
  teamBTint: string;
  guests: GameGuest[];
  onCancel: () => void;
  onPick: (team: 'A' | 'B', isOwnGoal: boolean) => void;
}) {
  const [ownGoal, setOwnGoal] = useState(false);
  // Reset the toggle each time the modal reopens so a previous own-goal
  // pick doesn't silently persist.
  useEffect(() => {
    if (visible) setOwnGoal(false);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.modalBackdrop} onPress={onCancel}>
        <Pressable
          style={styles.goalModalCard}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.goalModalTitle}>{he.liveLogGoalTitle}</Text>

          <ScrollView
            contentContainerStyle={{ paddingVertical: spacing.sm }}
            showsVerticalScrollIndicator={false}
          >
            <GoalTeamSection
              label={he.liveTeamLabel(0)}
              tint={teamATint}
              players={teamAPlayers}
              guests={guests}
              onPick={() => onPick('A', ownGoal)}
            />
            <View style={{ height: spacing.md }} />
            <GoalTeamSection
              label={he.liveTeamLabel(1)}
              tint={teamBTint}
              players={teamBPlayers}
              guests={guests}
              onPick={() => onPick('B', ownGoal)}
            />
          </ScrollView>

          <Pressable
            onPress={() => setOwnGoal((v) => !v)}
            style={({ pressed }) => [
              styles.ownGoalRow,
              pressed && { opacity: 0.7 },
            ]}
          >
            <View
              style={[
                styles.ownGoalBox,
                ownGoal && styles.ownGoalBoxChecked,
              ]}
            >
              {ownGoal ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : null}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ownGoalLabel}>{he.liveLogGoalOwn}</Text>
              <Text style={styles.ownGoalHint}>{he.liveLogGoalOwnHint}</Text>
            </View>
          </Pressable>

          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [
              styles.endRoundCancel,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.endRoundCancelText}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function GoalTeamSection({
  label,
  tint,
  players,
  guests,
  onPick,
}: {
  label: string;
  tint: string;
  players: UserId[];
  guests: GameGuest[];
  onPick: (uid: UserId) => void;
}) {
  return (
    <View>
      <View style={styles.goalTeamHeader}>
        <View style={[styles.goalTeamDot, { backgroundColor: tint }]} />
        <Text style={styles.goalTeamLabel}>{label}</Text>
      </View>
      {players.length === 0 ? (
        <Text style={styles.goalEmptyText}>—</Text>
      ) : (
        <View style={styles.goalPlayerGrid}>
          {players.map((uid) => (
            <GoalPlayerChip
              key={uid}
              uid={uid}
              guests={guests}
              onPick={() => onPick(uid)}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function GoalPlayerChip({
  uid,
  guests,
  onPick,
}: {
  uid: UserId;
  guests: GameGuest[];
  onPick: () => void;
}) {
  const name = usePlayerName(uid, guests);
  return (
    <Pressable
      onPress={onPick}
      style={({ pressed }) => [
        styles.goalPlayerChip,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={styles.goalPlayerName} numberOfLines={1}>
        {name}
      </Text>
    </Pressable>
  );
}

/**
 * Manual score-correction modal. Hidden behind a small pencil icon so
 * it isn't a primary action. Per-team +/- adjusters with no auto-save.
 */
function ScoreEditModal({
  visible,
  scoreA,
  scoreB,
  teamATint,
  teamBTint,
  onClose,
  onAdjust,
}: {
  visible: boolean;
  scoreA: number;
  scoreB: number;
  teamATint: string;
  teamBTint: string;
  onClose: () => void;
  onAdjust: (team: 'A' | 'B', delta: number) => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={styles.endRoundCard}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={styles.endRoundTitle}>{he.liveEditScoreTitle}</Text>

          <EditableScoreRow
            label={he.liveTeamLabel(0)}
            tint={teamATint}
            value={scoreA}
            onMinus={() => onAdjust('A', -1)}
            onPlus={() => onAdjust('A', 1)}
          />
          <EditableScoreRow
            label={he.liveTeamLabel(1)}
            tint={teamBTint}
            value={scoreB}
            onMinus={() => onAdjust('B', -1)}
            onPlus={() => onAdjust('B', 1)}
          />

          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.endRoundCancel,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={styles.endRoundCancelText}>{he.save}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function EditableScoreRow({
  label,
  tint,
  value,
  onMinus,
  onPlus,
}: {
  label: string;
  tint: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.editScoreRow}>
      <View style={[styles.endRoundDot, { backgroundColor: tint }]} />
      <Text style={styles.endRoundOptionLabel}>{label}</Text>
      <Pressable onPress={onMinus} hitSlop={6} style={styles.editScoreBtn}>
        <Ionicons name="remove" size={16} color={colors.text} />
      </Pressable>
      <Text style={[styles.endRoundScore, { minWidth: 36, textAlign: 'center' }]}>
        {value}
      </Text>
      <Pressable onPress={onPlus} hitSlop={6} style={styles.editScoreBtn}>
        <Ionicons name="add" size={16} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** Banner shown while the screen is in `round_finished` state. */
function RoundFinishedSummary({
  summary,
  teamATint,
  teamBTint,
}: {
  summary: {
    winner: 'A' | 'B' | 'draw';
    scoreA: number;
    scoreB: number;
    roundNumber: number;
  };
  teamATint: string;
  teamBTint: string;
}) {
  const winnerTint =
    summary.winner === 'A'
      ? teamATint
      : summary.winner === 'B'
        ? teamBTint
        : colors.textMuted;
  const winnerLabel =
    summary.winner === 'draw'
      ? he.liveRoundFinishedDraw
      : he.liveRoundFinishedWinner(
          he.liveTeamLabel(summary.winner === 'A' ? 0 : 1),
        );
  return (
    <View style={[styles.summaryCard, { borderColor: winnerTint }]}>
      <View style={styles.summaryHeader}>
        <View style={[styles.summaryDot, { backgroundColor: winnerTint }]} />
        <Text style={styles.summaryTitle}>{winnerLabel}</Text>
      </View>
      <View style={styles.summaryScoreRow}>
        <Text style={[styles.summaryScore, { color: teamATint }]}>
          {summary.scoreA}
        </Text>
        <Text style={styles.summaryDivider}>–</Text>
        <Text style={[styles.summaryScore, { color: teamBTint }]}>
          {summary.scoreB}
        </Text>
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
                <JerseyPlaceholder
                  size={GK_PLACEHOLDER_SIZE}
                  tint={tint}
                />
                {gkPlayer ? (
                  // Same centring trick as the outfield slots — the
                  // keeper jersey sits in the geometric middle of the
                  // (slightly-larger) dashed placeholder so a thin
                  // tinted ring stays visible behind the colored shirt.
                  <View
                    style={[StyleSheet.absoluteFill, styles.slotPlayerCenter]}
                    pointerEvents="box-none"
                  >
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
  // Placeholder is slightly larger than the player jersey on every
  // side, so when a player is placed the dashed team-coloured outline
  // peeks out around them — keeping the team identity visible at a
  // glance even on a fully populated pitch. +8dp total = ~4dp ring.
  const placeholderSize = jerseySize + 8;
  // Wrap dimensions = placeholder area + label area below. Pre-computed
  // here so the wrap is centered cleanly around its (left, top)
  // anchor regardless of jersey size.
  const wrapWidth = placeholderSize + 8;
  const wrapHeight = placeholderSize + SLOT_LABEL_GAP + LABEL_HEIGHT;
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
          { width: placeholderSize, height: placeholderSize },
        ]}
        pointerEvents="box-none"
      >
        <JerseyPlaceholder size={placeholderSize} tint={tint} />
        {uid ? (
          // Centre the player jersey precisely inside the slightly
          // larger placeholder. flex centring + absoluteFill keeps the
          // jersey at the geometric middle of the dashed shape.
          <View
            style={[StyleSheet.absoluteFill, styles.slotPlayerCenter]}
            pointerEvents="box-none"
          >
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
/** Placeholder is +8dp wider than the jersey so a thin tinted ring
 *  shows around an occupied keeper. Matches SlotCell's outfield rule. */
const GK_PLACEHOLDER_SIZE = GK_JERSEY_SIZE + 8;
const LABEL_HEIGHT = 16;
const SLOT_LABEL_GAP = 2;

const GK_WRAP_WIDTH = GK_PLACEHOLDER_SIZE + 16;
const GK_WRAP_HEIGHT = GK_PLACEHOLDER_SIZE + SLOT_LABEL_GAP + LABEL_HEIGHT;
const GK_WRAP_HALF_W = GK_WRAP_WIDTH / 2;
const GK_WRAP_HALF_H = GK_WRAP_HEIGHT / 2;

// ─── New live-screen sub-components ──────────────────────────────────────
//
// Stadium-themed hero with a back link, LIVE pill, and a big timer.
// Replaces the old header bar + timer card combo.

function LiveStadiumHero({
  timerMs,
  totalMs,
  isLastTen,
  isLastMinute,
  sessionStateLabel,
  onBack,
}: {
  timerMs: number;
  totalMs: number;
  isLastTen: boolean;
  isLastMinute: boolean;
  sessionStateLabel: string;
  onBack: () => void;
}) {
  const remainingMs = Math.max(0, totalMs - timerMs);
  return (
    <View style={liveHeroStyles.wrap}>
      <LinearGradient
        colors={['#0F1B4D', '#1E3A8A', '#1E40AF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top']} style={liveHeroStyles.safe}>
        <View style={liveHeroStyles.topRow}>
          <Pressable
            onPress={onBack}
            hitSlop={10}
            style={({ pressed }) => [
              liveHeroStyles.backBtn,
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.liveBackToDetails}
          >
            <Text style={liveHeroStyles.backText}>{he.liveBackToDetails}</Text>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFF" />
          </Pressable>
          <View style={liveHeroStyles.livePill}>
            <View style={liveHeroStyles.liveDot} />
            <Text style={liveHeroStyles.liveText}>LIVE</Text>
          </View>
        </View>

        <View style={liveHeroStyles.timerWrap}>
          <Text
            style={[
              liveHeroStyles.timerValue,
              isLastTen
                ? { color: '#FCA5A5' }
                : isLastMinute
                  ? { color: '#FCD34D' }
                  : null,
            ]}
          >
            {formatTime(timerMs)}
          </Text>
          <Text style={liveHeroStyles.timerSubtitle}>
            {`${formatTime(remainingMs)} נותר`}
          </Text>
          <Text style={liveHeroStyles.statusLabel}>{sessionStateLabel}</Text>
        </View>

        <Ionicons
          name="football"
          size={120}
          color="rgba(255,255,255,0.08)"
          style={liveHeroStyles.bgIcon}
        />
      </SafeAreaView>
    </View>
  );
}

const liveHeroStyles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 22,
    elevation: 8,
  },
  safe: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.92)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  liveText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  timerWrap: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 4,
  },
  timerValue: {
    color: '#FFFFFF',
    fontSize: 56,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1.5,
  },
  timerSubtitle: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 14,
    fontWeight: '600',
  },
  statusLabel: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 4,
  },
  bgIcon: {
    position: 'absolute',
    top: 70,
    end: -20,
    transform: [{ rotate: '15deg' }],
  },
});

// ─── Current match panel ────────────────────────────────────────────────
//
// Two team headers + a VS divider, with a pair of player columns
// underneath. Tap a player to select; tap a player on the OPPOSITE
// team to swap them. The currently selected player gets a colored
// ring around their row.

interface MatchTeam {
  tint: string;
  softTint: string;
  name: string;
  score: number;
  players: UserId[];
}

function CurrentMatchPanel({
  sessionState,
  teamA,
  teamB,
  guests,
  isAdmin,
  selectedUid,
  onPlayerTap,
}: {
  sessionState: string;
  teamA: MatchTeam;
  teamB: MatchTeam;
  guests: GameGuest[];
  isAdmin: boolean;
  selectedUid: UserId | null;
  onPlayerTap: (uid: UserId) => void;
}) {
  const guestsById = useMemo(() => {
    const map: Record<string, GameGuest> = {};
    for (const g of guests) map[g.id] = g;
    return map;
  }, [guests]);
  const userMap = useGameStore((s) => s.players);

  // Pad the shorter list with `null` so the two columns always render
  // the same number of rows — keeps the VS divider centred and the
  // visual rhythm consistent regardless of imbalance.
  const rows = Math.max(teamA.players.length, teamB.players.length);
  const teamAPadded = useMemo(() => {
    const arr: (UserId | null)[] = [...teamA.players];
    while (arr.length < rows) arr.push(null);
    return arr;
  }, [teamA.players, rows]);
  const teamBPadded = useMemo(() => {
    const arr: (UserId | null)[] = [...teamB.players];
    while (arr.length < rows) arr.push(null);
    return arr;
  }, [teamB.players, rows]);

  const resolveDisplay = useCallback(
    (uid: UserId): { name: string; number: number | null } => {
      const guestId = parseGuestRosterId(uid);
      if (guestId) {
        const g = guestsById[guestId];
        return {
          name: g?.name ?? 'אורח',
          // Guests don't carry a jersey number — fall back to the
          // row index in PlayerRow.
          number: null,
        };
      }
      const u = userMap[uid];
      return {
        name: u?.displayName ?? 'שחקן',
        number: u?.jersey?.number ?? null,
      };
    },
    [guestsById, userMap],
  );

  return (
    <View style={currentMatchStyles.card}>
      <Text style={currentMatchStyles.title}>{he.liveCurrentMatchTitle}</Text>

      <View style={currentMatchStyles.headerRow}>
        <TeamHeader team={teamA} />
        <View style={currentMatchStyles.vsBadge}>
          <Text style={currentMatchStyles.vsText}>VS</Text>
        </View>
        <TeamHeader team={teamB} />
      </View>

      {rows === 0 ? (
        <Text style={currentMatchStyles.emptyHint}>
          {he.liveCurrentMatchEmpty}
        </Text>
      ) : (
        <View style={currentMatchStyles.columnsRow}>
          <View style={currentMatchStyles.column}>
            {teamAPadded.map((uid, i) => (
              <PlayerRow
                key={`A-${i}-${uid ?? 'empty'}`}
                uid={uid}
                index={i + 1}
                tint={teamA.tint}
                softTint={teamA.softTint}
                selected={!!uid && uid === selectedUid}
                onTap={onPlayerTap}
                resolveDisplay={resolveDisplay}
                isAdmin={isAdmin}
              />
            ))}
          </View>
          <View style={currentMatchStyles.divider} />
          <View style={currentMatchStyles.column}>
            {teamBPadded.map((uid, i) => (
              <PlayerRow
                key={`B-${i}-${uid ?? 'empty'}`}
                uid={uid}
                index={i + 1}
                tint={teamB.tint}
                softTint={teamB.softTint}
                selected={!!uid && uid === selectedUid}
                onTap={onPlayerTap}
                resolveDisplay={resolveDisplay}
                isAdmin={isAdmin}
              />
            ))}
          </View>
        </View>
      )}

      {isAdmin && rows > 0 ? (
        <Text style={currentMatchStyles.swapHint}>{he.liveSwapHint}</Text>
      ) : null}

      {/* Suppress unused-prop lint while we wire up state-aware copy. */}
      {sessionState === '__never__' ? <View /> : null}
    </View>
  );
}

function TeamHeader({ team }: { team: MatchTeam }) {
  return (
    <View style={currentMatchStyles.teamHeader}>
      <View
        style={[
          currentMatchStyles.jerseyDisc,
          { backgroundColor: team.tint },
        ]}
      >
        <Ionicons name="shirt" size={22} color="#FFFFFF" />
      </View>
      <Text style={currentMatchStyles.teamName} numberOfLines={1}>
        {team.name}
      </Text>
      <Text style={currentMatchStyles.teamWins}>
        {he.liveTeamWinsLabel(team.score)}
      </Text>
    </View>
  );
}

function PlayerRow({
  uid,
  index,
  tint,
  softTint,
  selected,
  onTap,
  resolveDisplay,
  isAdmin,
}: {
  uid: UserId | null;
  index: number;
  tint: string;
  softTint: string;
  selected: boolean;
  onTap: (uid: UserId) => void;
  resolveDisplay: (uid: UserId) => { name: string; number: number | null };
  isAdmin: boolean;
}) {
  if (!uid) {
    return <View style={[currentMatchStyles.row, currentMatchStyles.rowEmpty]} />;
  }
  const { name, number } = resolveDisplay(uid);
  return (
    <Pressable
      onPress={() => onTap(uid)}
      disabled={!isAdmin}
      style={({ pressed }) => [
        currentMatchStyles.row,
        { backgroundColor: softTint },
        selected && { borderColor: tint, borderWidth: 2 },
        pressed && { opacity: 0.85 },
      ]}
    >
      <View style={[currentMatchStyles.rowNumber, { backgroundColor: tint }]}>
        <Text style={currentMatchStyles.rowNumberText}>
          {number ?? index}
        </Text>
      </View>
      <Text
        style={[currentMatchStyles.rowName, { color: '#0F172A' }]}
        numberOfLines={1}
      >
        {name}
      </Text>
      {isAdmin ? (
        <Ionicons
          name="swap-horizontal"
          size={14}
          color="#94A3B8"
          style={{ marginStart: 4 }}
        />
      ) : null}
    </Pressable>
  );
}

const currentMatchStyles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.10,
    shadowRadius: 18,
    elevation: 4,
  },
  title: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  teamHeader: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  jerseyDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamName: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  teamWins: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  vsBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  vsText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  columnsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  column: {
    flex: 1,
    gap: 6,
  },
  divider: {
    width: 1,
    backgroundColor: '#E2E8F0',
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    minHeight: 38,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  rowEmpty: {
    backgroundColor: '#F8FAFC',
    minHeight: 38,
  },
  rowNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowNumberText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  rowName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  emptyHint: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  swapHint: {
    color: '#EF4444',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
});

// ─── Team queue panel ───────────────────────────────────────────────────
//
// Horizontal row of waiting teams in queue order. Each card shows the
// position number, a colored disc, the team's Hebrew name, and the
// running win count.

interface QueueTeam {
  letter: TeamLetter;
  position: number;
  name: string;
  tint: string;
  softTint: string;
  score: number;
}

function TeamQueuePanel({ teams }: { teams: QueueTeam[] }) {
  return (
    <View style={queueStyles.wrap}>
      <Text style={queueStyles.title}>{he.liveQueueTitle}</Text>
      <View style={queueStyles.row}>
        {teams.map((t, i) => (
          <React.Fragment key={t.letter}>
            <View
              style={[queueStyles.card, { backgroundColor: t.softTint }]}
            >
              <View
                style={[queueStyles.position, { backgroundColor: t.tint }]}
              >
                <Text style={queueStyles.positionText}>{t.position}</Text>
              </View>
              <View
                style={[queueStyles.disc, { backgroundColor: t.tint }]}
              >
                <Ionicons name="shield" size={20} color="#FFFFFF" />
              </View>
              <Text style={queueStyles.name} numberOfLines={1}>
                {t.name}
              </Text>
              <Text style={queueStyles.wins}>
                {he.liveTeamWinsLabel(t.score)}
              </Text>
            </View>
            {i < teams.length - 1 ? (
              <Ionicons
                name="chevron-back"
                size={16}
                color="#94A3B8"
                style={{ alignSelf: 'center' }}
              />
            ) : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const queueStyles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'right',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: 6,
    borderRadius: 16,
    gap: 4,
    minHeight: 110,
  },
  position: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    top: 6,
    end: 6,
  },
  positionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  name: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
  wins: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { ...typography.body, color: colors.textMuted },

  // ─── Redesigned screen layout ────────────────────────────────────────
  scroll: {
    paddingBottom: 120,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  viewerHint: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  // Bottom action bar — pinned to the bottom of the screen, sits above
  // the safe-area inset.
  actionBarSafe: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  // "סיים משחק" — small red outline pill on the visual LEFT.
  endMatchBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#FECACA',
    backgroundColor: '#FFFFFF',
  },
  endMatchText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '800',
  },
  // "הפעל משחק" — large green pill on the visual RIGHT, primary CTA.
  startMatchBtn: {
    flex: 1,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#22C55E',
    shadowColor: '#16A34A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 5,
  },
  startMatchText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

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
  roundLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  startRoundBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radius.pill,
    marginTop: 4,
    minWidth: 200,
  },
  startRoundBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
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
   *  optional player overlay. Sized to the placeholder (jerseySize+8dp)
   *  so the dashed team-coloured outline forms a thin ring around the
   *  inner colored jersey. */
  slotJerseyArea: {
    position: 'relative',
  },
  /** Centring overlay for the player jersey inside the placeholder.
   *  Used as `[StyleSheet.absoluteFill, slotPlayerCenter]` so the
   *  DraggablePlayer lands at the geometric middle of the slot. */
  slotPlayerCenter: {
    alignItems: 'center',
    justifyContent: 'center',
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
    width: GK_PLACEHOLDER_SIZE,
    height: GK_PLACEHOLDER_SIZE,
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

  // End-round modal
  endRoundBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  endRoundCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  endRoundEyebrow: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  endRoundTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
  },
  endRoundQuestion: {
    ...typography.body,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  endRoundOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  endRoundOptionDraw: {
    justifyContent: 'flex-start',
  },
  endRoundDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  endRoundOptionLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    flex: 1,
  },
  endRoundScore: {
    ...typography.h3,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    fontWeight: '900',
  },
  endRoundCancel: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  endRoundCancelText: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '600',
  },

  // Shared modal backdrop (goal-log + score-edit reuse)
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },

  // Goal-log modal
  goalModalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    maxHeight: '80%',
  },
  goalModalTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    marginBottom: spacing.sm,
  },
  goalTeamHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  goalTeamDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  goalTeamLabel: {
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '700',
  },
  goalEmptyText: {
    ...typography.caption,
    color: colors.textMuted,
    paddingVertical: 4,
  },
  goalPlayerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  goalPlayerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  goalPlayerName: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    maxWidth: 100,
  },
  ownGoalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  ownGoalBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  ownGoalBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  ownGoalLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  ownGoalHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  // Score-edit modal
  editScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  editScoreBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // Subtle pencil button next to the on-field score row.
  scoreEditBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
    alignSelf: 'center',
  },

  // Round-finished summary banner
  summaryCard: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    alignItems: 'center',
    gap: 6,
  },
  summaryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  summaryTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '800',
  },
  summaryScoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  summaryScore: {
    fontSize: 32,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  summaryDivider: {
    fontSize: 24,
    color: colors.textMuted,
    fontWeight: '700',
  },
});
