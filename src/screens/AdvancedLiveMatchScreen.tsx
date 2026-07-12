// LiveMatchScreen — pure match timer.
//
// Deliberately minimal: NO teams, NO "כוחות"/balancing, NO formations,
// scores, rounds, bench or drag-and-drop. The live surface is now nothing
// but a shared stopwatch — start / pause / resume / reset — plus an
// "end game" action. Everything the watch needs (timerRunning,
// timerLastStartedAt, timerAccumulatedMs) is written by the same
// gameService timer methods, so the paired Wear OS app reconstructs the
// identical clock and stays in lockstep on every start/stop/resume.
//
// The clock is derived from three Firestore primitives via
// `useSyncedTimer`, so every phone AND watch sees the same time without
// per-tick pushes.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';

import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { communityEventsService } from '@/services/communityEventsService';
import {
  EquipmentHandoffModal,
  type EquipmentHolders,
} from '@/components/match/EquipmentHandoffModal';
import { logError } from '@/services/errorLog';
import { lightHaptic, successHaptic, warningHaptic } from '@/utils/haptics';
import {
  canEnterLive,
  isCancelled as isCancelledHelper,
  isFinished as isFinishedHelper,
} from '@/services/gameLifecycle';
import { useGameEvents } from '@/services/useGameEvents';
import { useSyncedTimer } from '@/services/useSyncedTimer';
import { serverNow } from '@/services/serverClock';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { Game, LiveMatchState, TimerEvent, MatchRotation, DraftTeamsResult, isGuestId } from '@/types';
import { RotationPanel } from '@/components/match/RotationPanel';
import { WinnerPickerModal } from '@/components/match/WinnerPickerModal';
import { LiveScoreboardCard } from '@/components/match/LiveScoreboardCard';
import {
  FillerPickerModal,
  type FillRequestView,
} from '@/components/match/FillerPickerModal';
import {
  nextFillNeeded,
  applyChosenFill,
  pickRandom,
  rosterOf,
  type RotationFillState,
  type RotationTeam,
} from '@/services/rotationEngine';
import { teamName, teamColor } from '@/components/match/rotationView';
import { useGameStore } from '@/store/gameStore';
import { he } from '@/i18n/he';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { GameStackParamList } from '@/navigation/GameStack';

/** mm:ss from a millisecond elapsed value. */
function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Time-of-day HH:MM for a stoppage-log row. */
function formatClock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

interface StoppageRow {
  type: 'start' | 'resume' | 'pause';
  at: number;
  byName?: string | null;
  /** For 'pause': how long the clock ran since the previous start/resume. */
  ranForMs?: number;
  /** For 'resume': how long the clock was stopped since the previous pause. */
  stoppedForMs?: number;
}

/**
 * Turn the synced `timerEvents` log into displayable rows + totals. All
 * durations come from the events' shared-clock timestamps, so every device
 * shows identical numbers — the whole point (settling "the clock kept
 * running!" arguments). `nowMs` (server-time) drives the still-ongoing
 * stoppage when the match is currently paused.
 */
function buildStoppages(
  events: TimerEvent[] | undefined,
  nowMs: number,
): {
  rows: StoppageRow[];
  totalStoppedMs: number;
  ongoingStoppedMs: number;
  stopCount: number;
} {
  const rows: StoppageRow[] = [];
  if (!events || events.length === 0) {
    return { rows, totalStoppedMs: 0, ongoingStoppedMs: 0, stopCount: 0 };
  }
  // Dedupe exact (type, at) collisions — two admins (or an SDK retry) can
  // arrayUnion near-identical timer events, which would otherwise double-count
  // a stoppage. Then walk in time order, ignoring events that don't match the
  // current run/pause state (a stray 'resume' with no open 'pause', a 'pause'
  // while already paused) so the pairing can't drift.
  const seen = new Set<string>();
  const sorted = [...events]
    .sort((a, b) => a.at - b.at)
    .filter((e) => {
      const key = `${e.type}_${e.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  let lastRunStart: number | null = null;
  let lastPauseAt: number | null = null;
  let totalStoppedMs = 0;
  let stopCount = 0;
  for (const e of sorted) {
    if (e.type === 'start') {
      // A 'start'/'resume' while already running is a duplicate signal — ignore.
      if (lastRunStart != null && lastPauseAt == null) continue;
      rows.push({ type: 'start', at: e.at, byName: e.byName });
      lastRunStart = e.at;
      lastPauseAt = null;
    } else if (e.type === 'resume') {
      if (lastPauseAt == null) continue; // no open stoppage → nothing to resume
      const stoppedForMs = Math.max(0, e.at - lastPauseAt);
      totalStoppedMs += stoppedForMs;
      rows.push({ type: 'resume', at: e.at, byName: e.byName, stoppedForMs });
      lastRunStart = e.at;
      lastPauseAt = null;
    } else if (e.type === 'pause') {
      if (lastPauseAt != null) continue; // already paused → not a new stoppage
      const ranForMs = lastRunStart != null ? Math.max(0, e.at - lastRunStart) : 0;
      rows.push({ type: 'pause', at: e.at, byName: e.byName, ranForMs });
      lastPauseAt = e.at;
      lastRunStart = null;
      stopCount += 1;
    }
  }
  // Still paused right now → count the open stoppage as it grows.
  const ongoingStoppedMs =
    lastPauseAt != null ? Math.max(0, nowMs - lastPauseAt) : 0;
  return { rows, totalStoppedMs, ongoingStoppedMs, stopCount };
}

type Params = RouteProp<GameStackParamList, 'LiveMatch'>;

export function AdvancedLiveMatchScreen() {
  const route = useRoute<Params>();
  const nav = useNavigation();
  const gameId = route.params?.gameId ?? null;
  const me = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);

  // Realtime banners for live events (status changes, cancellations).
  useGameEvents(gameId ?? undefined);

  const [game, setGame] = useState<Game | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [live, setLive] = useState<LiveMatchState | null>(null);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  // After ending a COMMUNITY evening, ask who took the ball / jerseys home.
  const [handoff, setHandoff] = useState<{
    players: { id: string; name: string; avatarId?: string; photoUrl?: string }[];
    initial: EquipmentHolders;
    lastTaken?: import('@/services/communityEventsService').LastTakenMap;
  } | null>(null);
  const [stoppagesOpen, setStoppagesOpen] = useState(false);
  const [winnerOpen, setWinnerOpen] = useState(false);
  // Interactive team-completion flow. The modal request is render state; the
  // in-progress working rosters + queue live in a ref (mutated between popups).
  const [fillRequest, setFillRequest] = useState<FillRequestView | null>(null);
  const fillFlowRef = useRef<{
    draft: DraftTeamsResult;
    baseTeams?: { index: number; playerIds: string[] }[];
    working: { teams: RotationTeam[]; loans: MatchRotation['loans'] };
    rotationBase: MatchRotation;
    perTeam: number;
    fillMode: RotationFillState['fillMode'];
    loserFirst: number | null;
    playing: [number, number];
    queue: number[];
    current: number | null;
    // Mid-evening substitution → keep the running clock/score on final commit.
    keepClock: boolean;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 1s ticker so the still-ongoing stoppage duration counts up while paused
  // (the synced-timer hook only ticks while RUNNING).
  const [nowTick, setNowTick] = useState(() => serverNow());
  useEffect(() => {
    const id = setInterval(() => setNowTick(serverNow()), 1000);
    return () => clearInterval(id);
  }, []);

  // Synced clock — derived from the three `liveMatch.timer*` primitives.
  const timerView = useSyncedTimer(live);
  const timerMs = timerView.displayMs;
  const timerRunning = timerView.running;
  const timerStarted = timerView.started;

  // ─── Timer math (computed before any early return so the haptics effect
  //     below can depend on it without breaking hook order). ──────────────
  const totalMinutes = game?.matchDurationMinutes ?? 0;
  const totalMs = totalMinutes * 60_000;
  // Overtime: once the configured duration is exceeded the MAIN clock
  // freezes at the duration (e.g. 08:00) and a separate red "+MM:SS" added-
  // time counter runs below — the regular minutes stay pinned at the limit.
  const inOvertime = totalMs > 0 && timerMs > totalMs;
  const overtimeMs = inOvertime ? timerMs - totalMs : 0;
  const clockMs = inOvertime ? totalMs : timerMs;
  const remainingMs = totalMs > 0 ? totalMs - timerMs : Infinity;
  // Final minute before time → "redder" ring + clock and a gentle haptic.
  const inLastMinute =
    timerRunning && totalMs > 0 && !inOvertime && remainingMs <= 60_000;
  const danger = inOvertime || inLastMinute;
  // The match already has progress (score/goals/elapsed) even though the timer
  // is currently stopped — e.g. after a reset, or re-entering a played evening.
  // The start CTA then reads "המשך" (continue) instead of "התחל" (start a new
  // game) (user request).
  const hasLiveProgress =
    (live?.goals?.length ?? 0) > 0 ||
    (live?.scoreA ?? 0) > 0 ||
    (live?.scoreB ?? 0) > 0;

  // Synced stoppages log — drives the "history of stops/resumes" chip + sheet.
  const stoppages = buildStoppages(live?.timerEvents, nowTick);
  const totalStoppedMs = stoppages.totalStoppedMs + stoppages.ongoingStoppedMs;

  // ─── Load the game once + lifecycle guard ──────────────────────────────
  useEffect(() => {
    if (!gameId || !me) return;
    let alive = true;
    (async () => {
      // Fetch by id (not getMyGames — that filters by status and would
      // hide an already-active game). The guards below gate entry.
      const g = await gameService.getGameById(gameId).catch(() => null);
      if (!alive) return;
      setGame(g);
      // Distinguish "still loading" from "game is gone" — otherwise a
      // deleted/failed game leaves the screen on a perpetual spinner.
      if (!g) {
        setNotFound(true);
        return;
      }
      logEvent(AnalyticsEvent.LiveMatchOpened, { gameId: g.id });

      const terminal = isFinishedHelper(g) || isCancelledHelper(g);
      const adminHere =
        !!me &&
        (g.createdBy === me.id ||
          myCommunities.some(
            (c) => c.id === g.groupId && c.adminIds.includes(me.id),
          ));
      const isParticipant =
        !!me &&
        ((g.players ?? []).includes(me.id) ||
          (g.waitlist ?? []).includes(me.id));
      if (terminal) {
        toast.info(he.matchDetailsAlreadyFinished);
        if (nav.canGoBack()) nav.goBack();
      } else if (
        !canEnterLive(g, { isOrganizerOrAdmin: adminHere, isParticipant }) &&
        !adminHere
      ) {
        toast.info(he.liveMatchNotActiveYet);
        if (nav.canGoBack()) nav.goBack();
      }
    })();
    return () => {
      alive = false;
    };
  }, [gameId, me, myCommunities, nav]);

  // Live rotation (winner-stays teams) — separate top-level Game fields.
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);
  const [rotation, setRotation] = useState<MatchRotation | null>(null);
  const [draftTeams, setDraftTeams] = useState<DraftTeamsResult | null>(null);
  // Opening order of team indices — the first two play first, the rest wait in
  // this order. RANDOMISED by default once teams are drafted; the admin can
  // re-shuffle or tap a waiting team to swap it in (preview controls below).
  // The two team indices the admin chose to play FIRST (the rest wait in
  // order). Admin-selectable (was a fixed random first-two); seeded with a
  // random pair when teams load.
  const [firstTwo, setFirstTwo] = useState<number[]>([]);

  // Goals per player for the WHOLE evening — shown in each roster row's badge.
  // Prefer the persistent `goalTally` (accumulates across rounds); fall back to
  // summing the current round's log for legacy live states without the tally.
  const goalsByPlayer = useMemo(() => {
    if (live?.goalTally && Object.keys(live.goalTally).length > 0) {
      return live.goalTally;
    }
    const acc: Record<string, number> = {};
    for (const g of live?.goals ?? []) {
      // Skip own goals, unknown scorers, AND guests — guests carry no stats and
      // are dropped at commit, so the live badge must not credit them either
      // (matches the goalTally path, which already excludes guests). N1.
      if (g.ownGoal || !g.scorerId || isGuestId(g.scorerId)) continue;
      acc[g.scorerId] = (acc[g.scorerId] ?? 0) + 1;
    }
    return acc;
  }, [live?.goalTally, live?.goals]);

  // One listener on the game doc delivers liveMatch + rotation + draftTeams.
  // Halves reads vs. separate subscribeLiveMatch + subscribeRotation on the
  // same doc — every game write used to fire two listeners on this device.
  useEffect(() => {
    if (!gameId) return;
    const unsub = gameService.subscribeLiveGame(
      gameId,
      ({ liveMatch, rotation: r, draftTeams: d }) => {
        setLive(liveMatch ?? null);
        setRotation(r ?? null);
        setDraftTeams(d ?? null);
        // Hydrate team players AND anyone who went home (they're off their team
        // now, so they wouldn't be fetched otherwise — their name would be
        // missing in the "הלכו הביתה" section).
        const ids = (d?.teams ?? []).flatMap((t) => t.playerIds);
        const leftIds = (d?.leftHome ?? []).map((l) => l.playerId);
        const all = [...ids, ...leftIds];
        if (all.length > 0) hydratePlayers(all);
      },
    );
    return unsub;
  }, [gameId, hydratePlayers]);

  const onRotationWinner = async (teamIndex: number) => {
    if (!gameId || !me) return;
    try {
      await gameService.recordWinner(gameId, me.id, teamIndex);
    } catch (err) {
      logError('liveRecordWinner', err, { gameId, userId: me.id });
      toast.error(he.roundFinalizeFailed);
      if (__DEV__) console.warn('[live] recordWinner failed', err);
    }
  };

  // End the round: winner is derived from the live score. A tie opens the
  // manual picker (players decide off-app, admin marks who won).
  // `finalizingRef` blocks a double-fire (rapid taps / re-render) from
  // committing the round's stats twice.
  const finalizingRef = useRef(false);
  // Latch that spans the ASYNC rotation commit at the end of the fill flow.
  // finalizingRef clears in onEndRound's synchronous finally (before the fill
  // flow's await resolves) and fillFlowRef is nulled just before the commit, so
  // without this a fast second "סיים משחקון" tap during the ~commit round‑trip
  // re-runs onEndRound against an already-cleared score (read as a tie) and
  // corrupts the rotation. Held true across commitFilledRotation.
  const committingRef = useRef(false);
  // Latch around the timer/round START so a rapid double-tap can't run
  // prepareStartRotation / beginFillFlow twice and clobber fillFlowRef.
  const startingRef = useRef(false);
  // Latch around the "הלך הביתה" / "החזר למשחק" confirm so a rapid double-tap
  // can't run markPlayerWentHome / a fill flow twice and race fillFlowRef (B25).
  const homeActionRef = useRef(false);
  // Resolve a roster id (registered uid OR guest id) to a display card.
  const resolveFillPlayer = (
    id: string,
  ): { id: string; name: string; avatarId?: string; photoUrl?: string } => {
    const u = playersMap[id];
    if (u) return { id, name: u.displayName ?? id, avatarId: u.avatarId, photoUrl: u.photoUrl };
    const guest = (game?.guests ?? []).find((x) => x.id === id);
    return { id, name: guest?.name ?? he.guestLabel };
  };

  // Kick off the team-completion flow from an engine skeleton: seed the working
  // rosters, queue the short playing teams (RANDOM order when both are short),
  // then drive the popups.
  const beginFillFlow = (
    skeleton: RotationFillState,
    draft: DraftTeamsResult,
    baseTeams?: { index: number; playerIds: string[] }[],
    // Mid-evening substitution (went-home refill) → keep the running clock/score
    // on commit. Round transitions (start/end) leave this false → clock zeroed.
    keepClock = false,
  ) => {
    const working = {
      teams: skeleton.teams,
      loans: skeleton.rotation.loans,
    };
    const short = skeleton.playing.filter(
      (t) => skeleton.perTeam - rosterOf(t, working.teams, working.loans).length > 0,
    );
    // Random which short team completes (and so picks) first.
    const queue =
      short.length > 1 && Math.random() < 0.5 ? [short[1], short[0]] : short.slice();
    fillFlowRef.current = {
      draft,
      baseTeams,
      working,
      rotationBase: skeleton.rotation,
      perTeam: skeleton.perTeam,
      fillMode: skeleton.fillMode,
      loserFirst: skeleton.loserFirst,
      playing: skeleton.playing,
      queue,
      current: null,
      keepClock,
    };
    advanceFillFlow();
  };

  // Show the next short team's picker, or — when none remain — persist the
  // fully-filled rotation.
  const advanceFillFlow = async () => {
    const flow = fillFlowRef.current;
    if (!flow) return;
    while (flow.queue.length > 0) {
      const team = flow.queue.shift() as number;
      const other = flow.playing[0] === team ? flow.playing[1] : flow.playing[0];
      const req = nextFillNeeded(
        [team, other],
        flow.working.teams,
        flow.working.loans,
        flow.perTeam,
        flow.loserFirst,
      );
      if (req && req.team === team && req.deficit > 0) {
        // No donors available at all → the team simply plays short this round
        // rather than popping a picker that can never be satisfied (user
        // report: stuck "מי מחליף?" modal, had to "continue with 4"). Tell the
        // admin instead of leaving them staring at a screen where nothing
        // happened (B15).
        if (req.donors.length === 0) {
          toast.info(he.rotationFillNoDonor);
          continue;
        }
        flow.current = team;
        // Never ask for more than the pool can supply — otherwise the confirm
        // button stays permanently disabled.
        const need = Math.min(req.deficit, req.donors.length);
        setFillRequest({
          teamLabel: teamName(team, draftTeams?.teams),
          players: req.donors.map(resolveFillPlayer),
          recommendedIds: pickRandom(req.donors, need),
          requiredCount: need,
        });
        return; // wait for the admin to confirm
      }
      // team already full → skip to the next in the queue
    }
    // Nothing left to fill → commit.
    setFillRequest(null);
    fillFlowRef.current = null;
    if (!gameId) return;
    const rotation = { ...flow.rotationBase, loans: flow.working.loans };
    committingRef.current = true;
    try {
      // Commit the rotation. For a round transition we ALSO zero the new round's
      // clock+score in the same atomic write (a concurrent admin's timer-start
      // can't slip between two writes). For a mid-evening substitution
      // (keepClock) we DON'T reset — the current משחקון keeps running.
      await gameService.commitFilledRotation(
        gameId,
        flow.draft,
        { rotation, teams: flow.working.teams },
        flow.baseTeams,
        !flow.keepClock && me ? { userId: me.id, userName: me.name ?? '' } : undefined,
      );
    } catch (err) {
      logError('liveCommitFilledRotation', err, { gameId });
      if (__DEV__) console.warn('[live] commitFilledRotation failed', err);
    } finally {
      committingRef.current = false;
    }
  };

  // Admin confirmed who completes the current team → apply + advance.
  const onFillConfirm = (chosen: string[]) => {
    const flow = fillFlowRef.current;
    if (!flow || flow.current == null) return;
    flow.working = applyChosenFill(
      flow.working.teams,
      flow.working.loans,
      flow.current,
      chosen,
      flow.fillMode,
    );
    flow.current = null;
    setFillRequest(null);
    advanceFillFlow();
  };

  // Admin dismissed the fill picker (e.g. the donor pool can't satisfy the
  // deficit, or it popped up unexpectedly). Abort the in-memory fill flow
  // WITHOUT committing — the round result already recorded stands, and the
  // admin can adjust the rosters manually from the rotation panel. Prevents a
  // stuck modal (user report).
  const onFillCancel = () => {
    fillFlowRef.current = null;
    setFillRequest(null);
    // The round's stats were already committed; aborting here leaves the
    // rotation frozen. Advance its identity so the NEXT round-commit by the
    // same teams gets a fresh idempotency key and isn't dropped as a duplicate
    // (B03/B04). Fire-and-forget — a failure only risks the rare collision.
    if (gameId) void gameService.nudgeRotationAfterFillCancel(gameId);
  };

  // "סיים משחקון" → confirm first, naming the winner + who comes on next, so
  // the admin doesn't accidentally end a round (and sees the rotation result).
  // A tie skips straight to the manual winner picker.
  const confirmEndRound = () => {
    // Same re-entry guard as onEndRound — also covers the confirm-dialog path.
    if (finalizingRef.current || committingRef.current || fillFlowRef.current || winnerOpen) return;
    if (!rotation || !live) {
      void onEndRound();
      return;
    }
    const [a, b] = rotation.playing;
    const winnerIdx =
      (live.scoreA ?? 0) > (live.scoreB ?? 0)
        ? a
        : (live.scoreB ?? 0) > (live.scoreA ?? 0)
          ? b
          : null;
    if (winnerIdx == null) {
      void onEndRound(); // tie → picker
      return;
    }
    const next = rotation.waiting[0];
    appAlert(
      he.rotationEndRoundConfirmTitle(teamName(winnerIdx, draftTeams?.teams)),
      next != null
        ? he.rotationEndRoundConfirmBody(teamName(next, draftTeams?.teams))
        : he.rotationEndRoundConfirmBodyNoNext,
      [
        { text: he.cancel, style: 'cancel' },
        { text: he.rotationEndRoundConfirmOk, onPress: () => void onEndRound() },
      ],
    );
  };

  const onEndRound = async () => {
    // Block re-entry while a round transition is already in flight: finalizing,
    // the manual winner picker is open, or a fill flow is mid-way. Without this
    // a second "סיים משחקון" tap (the ref clears in `finally` BEFORE the async
    // fill flow finishes) re-runs prepareRoundResult and double-commits the
    // round's goals/wins (user-facing stat corruption).
    if (!gameId || !me || finalizingRef.current || committingRef.current || fillFlowRef.current || winnerOpen) return;
    finalizingRef.current = true;
    try {
      // STOP (don't reset) the clock the moment the round ends — it shouldn't
      // keep ticking through the fill flow. It's zeroed after the new round is
      // committed (see advanceFillFlow).
      await gameService.pauseTimer(gameId, me.id, me.name ?? '').catch(() => {});
      // Commit stats + build the post-round skeleton (no rotate yet). A 4-team
      // tie auto-resolves; a 2–3 team tie returns outcome null → manual picker.
      const res = await gameService.prepareRoundResult(gameId, me.id);
      if (!res) return;
      if (res.outcome === null) {
        setWinnerOpen(true);
        return;
      }
      beginFillFlow(res.skeleton, res.draft);
    } catch (err) {
      logError('liveFinalizeRound', err, { gameId, userId: me.id });
      toast.error(he.roundFinalizeFailed);
      if (__DEV__) console.warn('[live] finalizeRound failed', err);
    } finally {
      finalizingRef.current = false;
    }
  };

  // Tie resolved manually in the picker → that side is recorded as the winner.
  const onTieWinner = async (teamIndex: number) => {
    setWinnerOpen(false);
    // Full re-entrancy guard (mirrors onEndRound) — not just finalizingRef — so
    // a second confirmation can't double-commit the tie while a fill/commit is
    // already running.
    if (
      !gameId ||
      !me ||
      !rotation ||
      finalizingRef.current ||
      committingRef.current ||
      fillFlowRef.current
    )
      return;
    const side: 'A' | 'B' = teamIndex === rotation.playing[0] ? 'A' : 'B';
    finalizingRef.current = true;
    try {
      const res = await gameService.prepareRoundResult(gameId, me.id, side);
      if (res && res.outcome !== null) beginFillFlow(res.skeleton, res.draft);
    } catch (err) {
      logError('liveFinalizeRoundTie', err, { gameId, userId: me.id });
      toast.error(he.roundFinalizeFailed);
      if (__DEV__) console.warn('[live] finalizeRound (tie) failed', err);
    } finally {
      finalizingRef.current = false;
    }
  };

  // "התחל משחקון" — kick off a round: draft rotation + start the match clock
  // together so the live state goes straight to "running" (matches the design).
  const onStartRound = async () => {
    if (!gameId || !me || startingRef.current || committingRef.current) return;
    startingRef.current = true;
    try {
      // Build the start skeleton (no persist). The admin then completes the two
      // playing teams via the picker; the rotation is committed at the end.
      const prep = await gameService.prepareStartRotation(
        gameId,
        effectiveStartOrder,
      );
      if (!prep) return; // gate: not enough players for two teams
      await gameService.markGameStarted(gameId);
      await gameService.startTimer(gameId, me.id, me.name ?? '');
      beginFillFlow(prep.skeleton, prep.draft, prep.baseTeams);
    } catch (err) {
      logError('liveStartRound', err, { gameId, userId: me?.id });
      if (__DEV__) console.warn('[live] startRound failed', err);
    } finally {
      startingRef.current = false;
    }
  };

  // Hint when ANOTHER admin touches the timer (so the state never seems
  // to change "by itself"). We don't toast for our own presses.
  const lastCtrlRef = useRef<string | null>(null);
  const lastRunningRef = useRef<boolean | null>(null);
  useEffect(() => {
    const ctrlId = timerView.controlledById;
    const ctrlName = timerView.controlledByName;
    const running = timerView.running;
    const prevCtrl = lastCtrlRef.current;
    const prevRunning = lastRunningRef.current;
    if (prevCtrl === null && prevRunning === null) {
      lastCtrlRef.current = ctrlId;
      lastRunningRef.current = running;
      return;
    }
    if (ctrlId && ctrlId !== me?.id && running !== prevRunning) {
      const who = ctrlName || 'אדמין אחר';
      toast.info(running ? `${who} הפעיל את הטיימר` : `${who} עצר את הטיימר`, 1800);
    }
    lastCtrlRef.current = ctrlId;
    lastRunningRef.current = running;
  }, [timerView.controlledById, timerView.controlledByName, timerView.running, me?.id]);

  // ─── Role detection ────────────────────────────────────────────────────
  const isAdmin = useMemo(() => {
    if (!me || !game) return false;
    if (game.createdBy === me.id) return true;
    const grp = myCommunities.find((g) => g.id === game.groupId);
    return !!grp && grp.adminIds.includes(me.id);
  }, [me, game, myCommunities]);

  // ─── Timer controls (flow through Firestore transactions) ──────────────
  const onTimerStart = async () => {
    if (!gameId || !me || startingRef.current || committingRef.current) return;
    startingRef.current = true;
    try {
      // First press flips Game.status→'active' and stamps
      // liveMatch.startedAt (and creates liveMatch if absent — required
      // before startTimer can run). Idempotent on subsequent presses.
      await gameService.markGameStarted(gameId);
      await gameService.startTimer(gameId, me.id, me.name ?? '');
    } catch (err) {
      logError('liveTimerStart', err, { gameId, userId: me?.id });
      if (__DEV__) console.warn('[live] startTimer failed', err);
    } finally {
      startingRef.current = false;
    }
  };
  const onTimerPause = async () => {
    if (!gameId || !me) return;
    try {
      await gameService.pauseTimer(gameId, me.id, me.name ?? '');
    } catch (err) {
      logError('liveTimerPause', err, { gameId, userId: me?.id });
      if (__DEV__) console.warn('[live] pauseTimer failed', err);
    }
  };
  const onTimerResume = async () => {
    if (!gameId || !me) return;
    try {
      await gameService.startTimer(gameId, me.id, me.name ?? '');
    } catch (err) {
      logError('liveTimerResume', err, { gameId, userId: me?.id });
      if (__DEV__) console.warn('[live] resumeTimer failed', err);
    }
  };
  const onTimerReset = () => {
    if (!gameId || !me) return;
    // Reset is the one irreversible timer control — confirm before wiping
    // the running clock.
    appAlert(
      he.liveTimerResetConfirmTitle,
      he.liveTimerResetConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.liveTimerReset,
          style: 'destructive',
          onPress: async () => {
            try {
              await gameService.resetTimer(gameId, me.id, me.name ?? '');
            } catch (err) {
              logError('liveTimerReset', err, { gameId, userId: me?.id });
              if (__DEV__) console.warn('[live] resetTimer failed', err);
            }
          },
        },
      ],
    );
  };
  const leaveLiveScreen = () => {
    if (nav.canGoBack()) nav.goBack();
  };
  const onEndGame = async () => {
    if (!gameId) return;
    setEnding(true);
    try {
      await gameService.endEvening(gameId);
      setEndOpen(false);
      // For a COMMUNITY game, ask who took the club's ball / jerseys home so
      // the holders persist to the next game. Registered players only (a holder
      // is a community-member state). One-off games just leave the screen.
      const grpId = game?.groupId;
      const grp = grpId ? myCommunities.find((g) => g.id === grpId) : undefined;
      const registered = (game?.players ?? []).map(resolveFillPlayer);
      // Only ask about equipment if the evening was ACTUALLY played (the timer
      // started at least once). Ending a called-off game that no one played must
      // not overwrite the community's real ball/jersey holder state.
      // Read from the LIVE-synced state, not the `game` snapshot: `game` is
      // fetched once on mount and never refreshed by the listener, so in the
      // common flow (open screen before kickoff → start → play → end) its
      // startedAt is still null and the handoff prompt would be skipped.
      const wasPlayed =
        game?.status === 'finished' ||
        live?.startedAt != null ||
        (live?.goals?.length ?? 0) > 0;
      if (grpId && registered.length > 0 && wasPlayed) {
        // "Last took" hints so the admin can hand off fairly (who took it
        // longest ago). Non-blocking — an empty map just hides the hints.
        const lastTaken = await communityEventsService
          .getLastTakenMap(grpId)
          .catch(() => ({}));
        setHandoff({
          players: registered,
          initial: {
            ballHolderIds: grp?.ballHolderIds ?? [],
            jerseysHolderIds: grp?.jerseysHolderIds ?? [],
          },
          lastTaken,
        });
      } else {
        leaveLiveScreen();
      }
    } catch (err) {
      logError('endEvening', err, { gameId });
      if (__DEV__) console.warn('[live] endEvening failed', err);
      leaveLiveScreen();
    } finally {
      setEnding(false);
    }
  };
  const onSaveHandoff = async (holders: EquipmentHolders) => {
    const grpId = game?.groupId;
    setHandoff(null);
    if (grpId) {
      try {
        await groupService.setEquipmentHolders(grpId, holders);
        successHaptic();
        // Log timestamped events so the timeline + next "last took" hint update.
        await communityEventsService.logEquipmentEvents(
          grpId,
          gameId ?? '',
          holders.ballHolderIds,
          holders.jerseysHolderIds,
        );
      } catch (err) {
        logError('setEquipmentHolders', err, { gameId, grpId });
      }
    }
    leaveLiveScreen();
  };
  const onSkipHandoff = () => {
    setHandoff(null);
    leaveLiveScreen();
  };

  // ─── Pulse while running ───────────────────────────────────────────────
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (timerRunning) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.035, { duration: 650 }),
          withTiming(1, { duration: 650 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [timerRunning, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  // ─── Flash the timer in the final minute ───────────────────────────────
  const flash = useSharedValue(1);
  useEffect(() => {
    if (inLastMinute) {
      flash.value = withRepeat(
        withSequence(
          withTiming(0.35, { duration: 350 }),
          withTiming(1, { duration: 350 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(flash);
      flash.value = withTiming(1, { duration: 150 });
    }
  }, [inLastMinute, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  // ─── Gentle haptics near time + at overtime ────────────────────────────
  // A single light tap when the final minute begins, a light tap on each of
  // the last 5 seconds (countdown feel), and one soft "warning" buzz the
  // moment the configured duration is exceeded. All fire-and-forget; a
  // device without haptics silently no-ops.
  const enteredLastMinRef = useRef(false);
  const enteredOvertimeRef = useRef(false);
  const lastTickSecRef = useRef(-1);
  useEffect(() => {
    if (!timerRunning) {
      enteredLastMinRef.current = false;
      enteredOvertimeRef.current = false;
      lastTickSecRef.current = -1;
      return;
    }
    if (inLastMinute && !enteredLastMinRef.current) {
      enteredLastMinRef.current = true;
      lightHaptic();
    }
    if (!inLastMinute) enteredLastMinRef.current = false;
    if (inLastMinute) {
      // A small buzz on EVERY second of the final minute (user request — was
      // only the last 5s). `inLastMinute` already bounds this to ≤60s.
      const sec = Math.ceil(remainingMs / 1000);
      if (sec >= 1 && sec !== lastTickSecRef.current) {
        lastTickSecRef.current = sec;
        lightHaptic();
      }
    }
    if (inOvertime && !enteredOvertimeRef.current) {
      enteredOvertimeRef.current = true;
      warningHaptic();
    }
    if (!inOvertime) enteredOvertimeRef.current = false;
  }, [timerRunning, inLastMinute, inOvertime, remainingMs]);

  // Seed a random starting PAIR once teams are drafted (re-seed if the team
  // set changes). Stable across renders. MUST stay above the early returns so
  // the hook order never changes (no conditional hooks).
  useEffect(() => {
    if (rotation || !draftTeams) return;
    const idx = draftTeams.teams.map((t) => t.index);
    setFirstTwo((prev) => {
      const stillValid = prev.length === 2 && prev.every((i) => idx.includes(i));
      if (stillValid) return prev;
      return [...idx].sort(() => Math.random() - 0.5).slice(0, 2);
    });
  }, [draftTeams, rotation]);

  // Effective opening order = the two chosen starters first, then the rest in
  // index order. Empty until exactly two valid starters are picked (gates the
  // preview + the start button). Above the early returns for stable hooks.
  const effectiveStartOrder = useMemo<number[]>(() => {
    if (!draftTeams) return [];
    const idx = draftTeams.teams.map((t) => t.index);
    const starters = firstTwo.filter((i) => idx.includes(i));
    if (starters.length !== 2) return [];
    const rest = idx.filter((i) => !starters.includes(i)).sort((a, b) => a - b);
    return [...starters, ...rest];
  }, [draftTeams, firstTwo]);

  // ─── Not found ─────────────────────────────────────────────────────────
  // Game was deleted or failed to load — give the user an explanation and
  // a way out instead of an endless spinner.
  if (notFound) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>{he.liveMatchNotFound}</Text>
          <Pressable
            onPress={() => nav.canGoBack() && nav.goBack()}
            style={styles.notFoundBack}
            accessibilityRole="button"
          >
            <Text style={styles.notFoundBackText}>{he.back}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ─── Loading ───────────────────────────────────────────────────────────
  if (!game) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>{he.gameLoading}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const statusLabel = timerRunning ? 'רץ' : timerStarted ? 'מושהה' : 'מוכן';
  // Persistent "controlled by X" chip — visible whenever the timer has
  // been touched by another admin (running OR paused). Previously this
  // hid the moment the other admin paused the timer, which made the
  // pause look unattributed; the toast still fires but is fleeting. A
  // persistent chip is the dependable signal.
  const showController =
    timerStarted &&
    !!timerView.controlledByName &&
    timerView.controlledById !== me?.id;

  // Control-state derivation for the bottom bar.
  const hasTeams = !!draftTeams && draftTeams.teams.length >= 2;
  const rotationActive = !!rotation;
  const totalDrafted = (draftTeams?.teams ?? []).reduce(
    (s, t) => s + t.playerIds.length,
    0,
  );
  const perTeam =
    game.format === '4v4' ? 4 : game.format === '6v6' ? 6 : game.format === '7v7' ? 7 : 5;
  const enoughPlayers = hasTeams && totalDrafted >= perTeam * 2;
  // Also require exactly two chosen starters (effectiveStartOrder is empty
  // until then) so we never start with an ambiguous opening pair.
  const canStartRound = enoughPlayers && effectiveStartOrder.length >= 2;

  const reshuffleStart = () => {
    if (!draftTeams) return;
    const idx = draftTeams.teams.map((t) => t.index);
    setFirstTwo([...idx].sort(() => Math.random() - 0.5).slice(0, 2));
  };
  // Tap a team to select/deselect it as one of the two starters. Capped at
  // two: tapping a third replaces the older selection so you always converge
  // on exactly two.
  const toggleStartTeam = (teamIdx: number) =>
    setFirstTwo((prev) => {
      if (prev.includes(teamIdx)) return prev.filter((i) => i !== teamIdx);
      if (prev.length < 2) return [...prev, teamIdx];
      return [prev[1], teamIdx];
    });

  // ─── Per-player actions from the live roster popover menu ───────────────
  // "כרטיס שחקן" → open the player's card (community-scoped for head-to-head).
  const openPlayerCard = (userId: string) =>
    (nav as unknown as { navigate: (s: string, p: object) => void }).navigate(
      'PlayerCard',
      game?.groupId ? { userId, groupId: game.groupId } : { userId },
    );
  // "הלך הביתה" — remove a player for the rest of the evening. Allowed at any
  // point in an active rotation (mid-round too, not just between משחקונים): if a
  // playing team is left short we immediately offer a replacement, and the
  // fill is committed WITHOUT resetting the running clock (keepClock).
  const onPlayerWentHome = (player: { id: string; name: string }) => {
    if (!gameId) return;
    appAlert(
      he.wentHomeConfirmTitle(player.name),
      he.wentHomeConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.wentHomeConfirmOk,
          style: 'destructive',
          onPress: async () => {
            if (homeActionRef.current) return; // double-tap guard (B25)
            homeActionRef.current = true;
            try {
              await gameService.markPlayerWentHome(gameId, player.id);
              // If they were on a playing team that's now short, offer to borrow
              // a replacement (same fill flow as a round transition). No-op when
              // no playing team is short or a transition is already in flight.
              if (!finalizingRef.current && !fillFlowRef.current && !winnerOpen) {
                const refill = await gameService.prepareRefillPlaying(gameId);
                // keepClock: this is a mid-evening substitution, not a round
                // transition — the current משחקון's clock + score must keep
                // running through the swap (don't zero them on commit).
                if (refill) beginFillFlow(refill.skeleton, refill.draft, undefined, true);
              }
            } catch (err) {
              logError('markPlayerWentHome', err, { gameId, playerId: player.id });
            } finally {
              homeActionRef.current = false;
            }
          },
        },
      ],
    );
  };
  // "החזר למשחק" — bring a departed player back onto their team. Allowed
  // mid-round too: `restorePlayer` re-adds them and undoes the fill that covered
  // them (drops the loan / ejects the over-fill, B01) WITHOUT touching the
  // timer, so the running round's clock is unaffected.
  const onRestorePlayer = (player: { id: string; name: string }) => {
    if (!gameId) return;
    appAlert(
      he.restoreConfirmTitle(player.name),
      he.restoreConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.restoreConfirmOk,
          onPress: async () => {
            if (homeActionRef.current) return; // double-tap guard (B25)
            homeActionRef.current = true;
            try {
              await gameService.restorePlayer(gameId, player.id);
            } catch (err) {
              logError('restorePlayer', err, { gameId, playerId: player.id });
            } finally {
              homeActionRef.current = false;
            }
          },
        },
      ],
    );
  };

  // "החלפה" — swap two on-field players between their teams. No confirm dialog:
  // picking a source + a target IS the confirmation. Guarded against a
  // double-fire like the other roster mutations.
  const onSwapPlayers = (aId: string, bId: string) => {
    if (!gameId || !aId || !bId || aId === bId) return;
    if (homeActionRef.current) return;
    homeActionRef.current = true;
    void (async () => {
      try {
        await gameService.swapPlayers(gameId, aId, bId);
      } catch (err) {
        logError('swapPlayers', err, { gameId, aId, bId });
      } finally {
        homeActionRef.current = false;
      }
    })();
  };

  // Before the round starts, synthesize a PREVIEW rotation (the chosen two
  // teams play, the rest wait) so the admin sees "who's vs who / who waits" up
  // front. Completion (filling teams) happens on start.
  const previewRotation: MatchRotation | null =
    !rotationActive && hasTeams && draftTeams && effectiveStartOrder.length >= 2
      ? {
          playing: [effectiveStartOrder[0], effectiveStartOrder[1]] as [
            number,
            number,
          ],
          waiting: effectiveStartOrder.slice(2),
          loans: [],
          wins: {},
          round: 0,
          updatedAt: 0,
        }
      : null;

  // The admin team-selection control (pick 2 starters / shuffle / waiting
  // queue) only makes sense with MORE than 2 teams. With exactly 2 teams there's
  // nothing to choose, shuffle, or queue — go straight to the match preview.
  const showStartCtrl =
    !rotationActive && hasTeams && isAdmin && !!draftTeams && draftTeams.teams.length > 2;

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => nav.canGoBack() && nav.goBack()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="חזרה"
        >
          <Ionicons name="chevron-forward" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {game.title}
        </Text>
        {isAdmin && (timerStarted || rotationActive) ? (
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="עוד"
          >
            <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {/* Timer card (+ rotation scoreboard) — scrollable so teams fit below. */}
      <ScrollView style={styles.center} contentContainerStyle={styles.centerContent}>
        {/* Hierarchy: timer + scores at top, then the two playing teams, then
            the waiting queue. During an active round the timer is MERGED with
            the two team scores into one card; otherwise a plain timer card. */}
        {rotationActive && live && draftTeams && rotation ? (
          <LiveScoreboardCard
            gameId={gameId!}
            live={live}
            draftTeams={draftTeams}
            rotation={rotation}
            playersMap={playersMap}
            guests={game?.guests}
            // Goal minute from the CAPPED clock so it matches the frozen
            // '+MM:SS' scoreboard in overtime (was raw timerMs, which kept
            // climbing while the displayed clock was pinned).
            minute={Math.floor((totalMs > 0 ? clockMs : timerMs) / 60000)}
            canEdit={isAdmin}
            totalMinutes={totalMinutes || undefined}
            timerText={formatTime(totalMs > 0 ? clockMs : timerMs)}
            statusLabel={statusLabel}
            running={timerRunning}
            danger={danger}
            overtimeText={inOvertime ? formatTime(overtimeMs) : null}
            stoppagesText={he.rotationStoppagesInline(
              stoppages.stopCount,
              formatTime(totalStoppedMs),
            )}
            onStoppages={() => setStoppagesOpen(true)}
            controllerName={showController ? timerView.controlledByName : null}
          />
        ) : (
          <Animated.View style={[styles.timerCard, pulseStyle, flashStyle]}>
            <Text
              style={[
                styles.timerBig,
                timerRunning ? styles.timerBigRunning : null,
                danger ? styles.timerBigDanger : null,
              ]}
            >
              {formatTime(totalMs > 0 ? clockMs : timerMs)}
            </Text>

            {inOvertime ? (
              <View style={styles.overtimePill}>
                <Text style={styles.overtimePillText}>
                  {/* Bidi-isolate the signed time so "+01:23" doesn't render
                      as "01:23+" under the RTL paragraph. */}
                  {he.liveTimerOvertime} {`⁦+${formatTime(overtimeMs)}⁩`}
                </Text>
              </View>
            ) : null}

            <View style={styles.statusRow}>
              {timerRunning ? <View style={styles.redDot} /> : null}
              <Text style={[styles.statusWord, timerRunning ? styles.statusWordRunning : null]}>
                {statusLabel}
              </Text>
            </View>

            {showController ? (
              <View style={styles.controllerChip}>
                <Ionicons name="person-circle" size={14} color="#1D4ED8" />
                <Text style={styles.controllerChipText}>
                  מופעל ע״י {timerView.controlledByName}
                </Text>
              </View>
            ) : null}

            {/* Stoppages summary on its own centered row under a divider. */}
            {timerStarted ? (
              <>
                <View style={styles.timerDivider} />
                <Pressable
                  style={styles.stoppagesRow}
                  onPress={() => setStoppagesOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={he.liveStoppagesTitle}
                >
                  <Ionicons name="stopwatch-outline" size={16} color="#64748B" />
                  <Text style={styles.stoppagesRowText}>
                    {he.rotationStoppagesInline(stoppages.stopCount, formatTime(totalStoppedMs))}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </Animated.View>
        )}

        {/* Live rotation scoreboard (2 playing teams) + waiting queue. Before
            the round starts we show a PREVIEW (who's vs who / who waits). */}
        <View style={styles.rotationWrap}>
          {previewRotation && !showStartCtrl ? (
            <Text style={styles.previewLabel}>{he.rotationPreviewLabel}</Text>
          ) : null}
          {showStartCtrl && draftTeams ? (
            <View style={styles.startCtrl}>
              <View style={styles.startCtrlHead}>
                <Text style={styles.startCtrlTitle}>
                  {he.rotationPickStartingTeams}
                </Text>
                <Pressable onPress={reshuffleStart} style={styles.shuffleBtn}>
                  <Ionicons name="shuffle" size={16} color={colors.primary} />
                  <Text style={styles.shuffleBtnText}>{he.rotationShuffle}</Text>
                </Pressable>
              </View>
              <View style={styles.startChips}>
                {draftTeams.teams.map((t) => {
                  const idx = t.index;
                  const selected = firstTwo.includes(idx);
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => toggleStartTeam(idx)}
                      style={[
                        styles.teamChip,
                        selected ? styles.teamChipPlaying : styles.teamChipWaiting,
                      ]}
                    >
                      <View
                        style={[styles.teamDot, { backgroundColor: teamColor(idx, draftTeams?.teams) }]}
                      />
                      <Text
                        style={[
                          styles.teamChipText,
                          selected && styles.teamChipTextPlaying,
                        ]}
                      >
                        {teamName(idx, draftTeams?.teams)}
                      </Text>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={13} color={colors.primary} />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
              <Text style={styles.startCtrlHint}>
                {firstTwo.length === 2
                  ? he.rotationPickStartingHint
                  : he.rotationPickStartingNeedTwo}
              </Text>
            </View>
          ) : null}
          {/* The admin start-control already lists every team, so don't also
              render the RotationPanel on top of it (would duplicate each team
              title). Show the panel only when the start-control ISN'T up:
              live rounds, or a non-admin viewer in preview. */}
          {!showStartCtrl ? (
            <RotationPanel
              draftTeams={draftTeams ?? undefined}
              rotation={rotation ?? previewRotation ?? undefined}
              playersMap={playersMap}
              guests={game?.guests}
              goalsByPlayer={goalsByPlayer}
              isAdmin={isAdmin}
              // Marking "went home" (and restoring) is allowed at any point in
              // an active rotation — mid-round too. A mid-round removal offers an
              // immediate replacement and keeps the clock running.
              canMarkHome={isAdmin && rotationActive}
              onPlayerCard={openPlayerCard}
              onPlayerWentHome={onPlayerWentHome}
              onRestorePlayer={onRestorePlayer}
              onSwapPlayers={onSwapPlayers}
            />
          ) : null}
        </View>
      </ScrollView>

      {/* Controls */}
      <View style={styles.controls}>
        {!isAdmin ? (
          <Text style={styles.viewerHint}>{he.liveTimerViewerHint}</Text>
        ) : !hasTeams ? (
          // ── Timer-only game (no drafted teams) ──────────────────────────
          <>
            {!timerStarted ? (
              <Pressable
                style={[styles.primaryBtn, styles.startBtn]}
                onPress={onTimerStart}
                accessibilityRole="button"
              >
                <Ionicons name="play" size={26} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>
                  {hasLiveProgress ? he.liveResumeMatch : he.liveStartMatch}
                </Text>
              </Pressable>
            ) : timerRunning ? (
              <Pressable
                style={[styles.primaryBtn, styles.pauseBtn]}
                onPress={onTimerPause}
                accessibilityRole="button"
              >
                <Ionicons name="pause" size={26} color="#FFFFFF" />
                <Text style={styles.primaryBtnText}>{he.liveTimerPause}</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <Pressable
                  style={[styles.primaryBtn, styles.resumeBtn, styles.flex1]}
                  onPress={onTimerResume}
                  accessibilityRole="button"
                >
                  <Ionicons name="play" size={26} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>{he.liveTimerResume}</Text>
                </Pressable>
                <Pressable style={styles.resetBtn} onPress={onTimerReset}>
                  <Ionicons name="refresh" size={22} color="#1D4ED8" />
                  <Text style={styles.resetBtnText}>{he.liveTimerReset}</Text>
                </Pressable>
              </View>
            )}
            {timerStarted ? (
              <Pressable style={styles.endBtn} onPress={() => setEndOpen(true)}>
                <Text style={styles.endBtnText}>{he.liveEndEvening}</Text>
              </Pressable>
            ) : null}
          </>
        ) : !rotationActive ? (
          // ── Teams drafted, round not started → single CTA ───────────────
          <>
            <Pressable
              style={[styles.primaryBtn, styles.startBtn, !canStartRound && styles.btnDisabled]}
              onPress={onStartRound}
              disabled={!canStartRound}
              accessibilityRole="button"
            >
              <Ionicons name="play" size={26} color="#FFFFFF" />
              <Text style={styles.primaryBtnText}>{he.rotationStartRound}</Text>
            </Pressable>
            {!enoughPlayers ? (
              <Text style={styles.warnText}>{he.rotationNotEnough}</Text>
            ) : !canStartRound ? (
              <Text style={styles.warnText}>{he.rotationPickStartingNeedTwo}</Text>
            ) : null}
            {timerStarted ? (
              <Pressable style={styles.endBtn} onPress={() => setEndOpen(true)}>
                <Text style={styles.endBtnText}>{he.liveEndEvening}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          // ── Active rotation → [אפס] [סיים משחקון] [השהה / המשך] ──────────
          <View style={styles.controlRow}>
            <Pressable style={styles.sideBtn} onPress={onTimerReset}>
              <Ionicons name="refresh" size={22} color="#1D4ED8" />
              <Text style={styles.sideBtnText}>{he.liveTimerReset}</Text>
            </Pressable>
            <Pressable style={styles.roundBtn} onPress={confirmEndRound}>
              <Ionicons name="flag" size={22} color="#FFFFFF" />
              <Text style={styles.roundBtnText}>{he.rotationEndRound}</Text>
            </Pressable>
            {timerRunning ? (
              <Pressable style={styles.sideBtn} onPress={onTimerPause}>
                <Ionicons name="pause" size={22} color="#1D4ED8" />
                <Text style={styles.sideBtnText}>{he.liveTimerPause}</Text>
              </Pressable>
            ) : (
              <Pressable
                style={styles.sideBtn}
                onPress={timerStarted ? onTimerResume : onTimerStart}
              >
                <Ionicons name="play" size={22} color="#1D4ED8" />
                <Text style={styles.sideBtnText}>
                  {timerStarted ? he.liveTimerResume : he.liveTimerStart}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        {/* End the whole evening — available in advanced mode too (was only on
            the timer-only screen). Hidden before kickoff. */}
        {isAdmin && hasTeams && (rotationActive || timerStarted) ? (
          <Pressable style={styles.endEveningLink} onPress={() => setEndOpen(true)}>
            <Text style={styles.endEveningLinkText}>{he.liveEndEvening}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Stoppages history — the synced log of every start / pause / resume
          so players can see exactly when (and for how long) the clock was
          stopped. */}
      <Modal
        visible={stoppagesOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setStoppagesOpen(false)}
      >
        <Pressable
          style={styles.backdrop}
          onPress={() => setStoppagesOpen(false)}
        />
        <View style={styles.stoppagesSheet}>
          <View style={styles.stoppagesHandle} />
          <Text style={styles.stoppagesTitle}>{he.liveStoppagesTitle}</Text>
          <Text style={styles.stoppagesTotal}>
            {he.liveStoppagesTotal(formatTime(totalStoppedMs))}
          </Text>
          {stoppages.rows.length === 0 ? (
            <Text style={styles.stoppagesEmpty}>{he.liveStoppagesEmpty}</Text>
          ) : (
            <ScrollView
              style={styles.stoppagesList}
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              {stoppages.rows.map((r, i) => {
                const isPause = r.type === 'pause';
                const isResume = r.type === 'resume';
                const label = isPause
                  ? he.liveStoppagePaused
                  : isResume
                    ? he.liveStoppageResumed
                    : he.liveStoppageStarted;
                const sub = isPause
                  ? he.liveStoppageRanFor(formatTime(r.ranForMs ?? 0))
                  : isResume
                    ? he.liveStoppageStoppedFor(formatTime(r.stoppedForMs ?? 0))
                    : '';
                return (
                  <View key={`${r.at}-${i}`} style={styles.stoppageRow}>
                    <View
                      style={[
                        styles.stoppageIcon,
                        isPause ? styles.stoppageIconPause : styles.stoppageIconPlay,
                      ]}
                    >
                      <Ionicons
                        name={isPause ? 'pause' : 'play'}
                        size={13}
                        color="#FFFFFF"
                      />
                    </View>
                    <View style={styles.stoppageBody}>
                      <Text style={styles.stoppageLabel}>
                        {label}
                        {r.byName ? (
                          <Text style={styles.stoppageBy}> · {r.byName}</Text>
                        ) : null}
                      </Text>
                      {sub ? <Text style={styles.stoppageSub}>{sub}</Text> : null}
                    </View>
                    <Text style={styles.stoppageClock}>{formatClock(r.at)}</Text>
                  </View>
                );
              })}
              {/* Currently paused → show the open stoppage ticking up. */}
              {stoppages.ongoingStoppedMs > 0 && !timerRunning ? (
                <View style={styles.stoppageRow}>
                  <View style={[styles.stoppageIcon, styles.stoppageIconPause]}>
                    <Ionicons name="hourglass" size={13} color="#FFFFFF" />
                  </View>
                  <View style={styles.stoppageBody}>
                    <Text style={[styles.stoppageLabel, styles.stoppageOngoing]}>
                      {he.liveStoppageStoppedNow(
                        formatTime(stoppages.ongoingStoppedMs),
                      )}
                    </Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}
          <Pressable
            style={styles.stoppagesClose}
            onPress={() => setStoppagesOpen(false)}
          >
            <Text style={styles.stoppagesCloseText}>{he.close}</Text>
          </Pressable>
        </View>
      </Modal>

      {/* End-game confirm */}
      <Modal
        visible={endOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEndOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => !ending && setEndOpen(false)}>
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>{he.liveEndEveningTitle}</Text>
            <Text style={styles.modalBody}>{he.liveEndEveningBody}</Text>
            <View style={styles.modalActions}>
              <Pressable
                style={[styles.modalBtn, styles.modalCancel]}
                onPress={() => setEndOpen(false)}
                disabled={ending}
              >
                <Text style={styles.modalCancelText}>{he.cancel}</Text>
              </Pressable>
              <Pressable
                style={[styles.modalBtn, styles.modalConfirm]}
                onPress={onEndGame}
                disabled={ending}
              >
                {ending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmText}>{he.liveEndEveningConfirm}</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Round winner picker — "מי ניצחה במשחקון?" */}
      <WinnerPickerModal
        visible={winnerOpen}
        draftTeams={draftTeams ?? undefined}
        rotation={rotation ?? undefined}
        playersMap={playersMap}
        guests={game?.guests}
        onPick={(idx) => onTieWinner(idx)}
        onClose={() => setWinnerOpen(false)}
      />

      {/* Team-completion picker — admin chooses who comes up to fill a short
          playing team (random order when both are short). */}
      <FillerPickerModal
        request={fillRequest}
        onConfirm={onFillConfirm}
        onCancel={onFillCancel}
      />

      {/* End-of-evening handoff — who took the ball / jerseys home (community
          games only). Saved on the group so the next game knows. */}
      <EquipmentHandoffModal
        visible={!!handoff}
        players={handoff?.players ?? []}
        initial={handoff?.initial ?? { ballHolderIds: [], jerseysHolderIds: [] }}
        lastTaken={handoff?.lastTaken}
        onSave={onSaveHandoff}
        onSkip={onSkipHandoff}
      />

      {/* Overflow menu — end evening (rare destructive bits). */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuCard} onPress={() => undefined}>
            <Pressable
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                setEndOpen(true);
              }}
            >
              <Ionicons name="flag-outline" size={20} color="#DC2626" />
              <Text style={[styles.menuItemText, styles.menuItemDanger]}>
                {he.liveEndEvening}
              </Text>
            </Pressable>
            <Pressable style={styles.menuCancel} onPress={() => setMenuOpen(false)}>
              <Text style={styles.menuCancelText}>{he.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 15,
    fontWeight: '600',
  },
  notFoundBack: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
  },
  notFoundBackText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backBtn: {
    width: 26,
    alignItems: 'center',
  },
  headerSpacer: {
    width: 26,
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    // Breathing room so a long Hebrew title doesn't butt against the back /
    // overflow icons when it ellipsizes.
    marginHorizontal: spacing.sm,
  },
  center: { flex: 1 },
  centerContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 16,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  rotationWrap: { width: '100%' },
  previewLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  startCtrl: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  startCtrlHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  startCtrlTitle: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '800',
  },
  shuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(29,78,216,0.08)',
  },
  shuffleBtnText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  startChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  teamChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  teamChipPlaying: {
    backgroundColor: 'rgba(29,78,216,0.10)',
    borderColor: 'rgba(29,78,216,0.35)',
  },
  teamChipWaiting: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
  },
  teamDot: { width: 10, height: 10, borderRadius: 5 },
  teamChipText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  teamChipTextPlaying: { fontWeight: '800', color: colors.primary },
  startCtrlHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  timerCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    paddingVertical: 20,
    paddingHorizontal: 20,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 3,
  },
  timerBig: {
    alignSelf: 'stretch',
    textAlign: 'center',
    fontSize: 60,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  timerBigRunning: { color: '#0F172A' },
  timerBigDanger: { color: '#DC2626' },
  timerDivider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#E2E8F0',
    marginTop: 4,
  },
  stoppagesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingTop: 6,
  },
  stoppagesRowText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
    fontVariant: ['tabular-nums'],
  },
  overtimePill: {
    alignSelf: 'center',
    backgroundColor: '#FEE2E2',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  overtimePillText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  redDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#DC2626' },
  statusWord: { fontSize: 15, fontWeight: '700', color: '#64748B' },
  statusWordRunning: { color: '#0F172A' },
  controlRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  endEveningLink: { alignSelf: 'center', paddingVertical: 10, marginTop: 6 },
  endEveningLinkText: { ...typography.body, color: colors.danger, fontWeight: '700' },
  sideBtn: {
    width: 84,
    borderRadius: 18,
    backgroundColor: 'rgba(29,78,216,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
  },
  sideBtnText: { color: '#1D4ED8', fontSize: 14, fontWeight: '800' },
  roundBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 999,
    backgroundColor: '#1D4ED8',
    paddingVertical: 18,
  },
  roundBtnText: { color: '#FFFFFF', fontSize: 19, fontWeight: '800' },
  btnDisabled: { opacity: 0.5 },
  warnText: { textAlign: 'center', color: '#DC2626', fontSize: 13, fontWeight: '600' },
  menuCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 12,
    gap: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  menuItemText: { fontSize: 16, fontWeight: '700', color: '#1D4ED8' },
  menuItemDanger: { color: '#DC2626' },
  menuCancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  menuCancelText: { fontSize: 15, fontWeight: '700', color: '#475569' },
  timerCardRunning: {
    borderColor: '#1D4ED8',
  },
  // Inside the progress ring the colored arc IS the edge — drop the card's
  // own heavy border and shrink it so it nests within the ring.
  timerCardRinged: {
    width: 270,
    height: 270,
    borderRadius: 135,
    borderColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  timerOfTotal: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '700',
    color: '#64748B',
    fontVariant: ['tabular-nums'],
  },
  timerText: {
    fontSize: 78,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
    letterSpacing: 2,
  },
  timerTextRunning: {
    color: '#1D4ED8',
  },
  timerTextDanger: {
    color: '#DC2626',
  },
  overtimeLabel: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  overtimeText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#DC2626',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
  },
  statusPillRunning: {
    backgroundColor: 'rgba(29,78,216,0.12)',
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#1D4ED8',
  },
  statusText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#475569',
  },
  statusTextRunning: {
    color: '#1D4ED8',
  },
  // Persistent chip when another admin holds the timer — pill shape so
  // it reads as a discrete signal vs the surrounding text, brand-tinted
  // background, matches the watch/widget "controlled by" treatment.
  controllerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(29,78,216,0.10)',
  },
  controllerChipText: {
    fontSize: 13,
    color: '#1D4ED8',
    fontWeight: '700',
  },
  stoppagesChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  stoppagesChipText: { fontSize: 13, color: '#475569', fontWeight: '700' },
  stoppagesSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '70%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  stoppagesHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    marginBottom: 12,
  },
  stoppagesTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  stoppagesTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D4ED8',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
    marginBottom: 8,
  },
  stoppagesEmpty: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 24,
  },
  stoppagesList: { alignSelf: 'stretch' },
  stoppageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F1F5F9',
  },
  stoppageIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stoppageIconPlay: { backgroundColor: '#16A34A' },
  stoppageIconPause: { backgroundColor: '#EA580C' },
  stoppageBody: { flex: 1 },
  stoppageLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  stoppageBy: { fontWeight: '500', color: '#94A3B8' },
  stoppageSub: {
    fontSize: 12,
    color: '#64748B',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  stoppageOngoing: { color: '#EA580C' },
  stoppageClock: { fontSize: 13, fontWeight: '700', color: '#475569' },
  stoppagesClose: {
    marginTop: 14,
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  stoppagesCloseText: { fontSize: 15, fontWeight: '700', color: '#1D4ED8' },
  controls: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  flex1: {
    flex: 1,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 18,
    borderRadius: 18,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
  },
  startBtn: {
    backgroundColor: '#16A34A',
  },
  pauseBtn: {
    backgroundColor: '#DC2626',
  },
  resumeBtn: {
    backgroundColor: '#16A34A',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
    paddingHorizontal: 22,
    borderRadius: 18,
    backgroundColor: 'rgba(29,78,216,0.10)',
  },
  resetBtnText: {
    color: '#1D4ED8',
    fontSize: 17,
    fontWeight: '800',
  },
  endBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  endBtnText: {
    color: '#DC2626',
    fontSize: 16,
    fontWeight: '700',
  },
  viewerHint: {
    textAlign: 'center',
    color: '#64748B',
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 18,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 22,
    gap: 12,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 6,
  },
  modalBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
  },
  modalCancel: {
    backgroundColor: '#F1F5F9',
  },
  modalCancelText: {
    color: '#475569',
    fontSize: 16,
    fontWeight: '700',
  },
  modalConfirm: {
    backgroundColor: '#DC2626',
  },
  modalConfirmText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
