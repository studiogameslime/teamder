import { observeCaughtError } from '../../utils/errorObservation';
import { overlaySurfaces, overlayTheme } from '@/theme/overlays';
// LiveScoreboardCard — the merged top card for the advanced live match:
// the timer in the CENTER, flanked by each on-pitch team's live score and an
// "הוסף גול" button (admin only). A collapsible scorer log sits below.
//
// This unifies what used to be a separate timer card + goal card so the timer
// and the score read as one block at the very top (the design the owner asked
// for). Goal writes go through gameService; the score fans out via the live
// listener.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { SafeModal as Modal } from '@/components/SafeModal';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { UserAvatar } from '@/components/UserAvatar';
import { toast } from '@/components/Toast';
import { ChangeMotion } from '@/components/anim/ChangeMotion';

// Wrap a sign/punctuation-bearing numeric in a bidi isolate so it can't be
// reordered by the surrounding RTL paragraph (e.g. "+01:23" rendering as
// "01:23+", or a minute "12'" flipping its apostrophe).
const ltr = (s: string | number) => `⁦${s}⁩`;
import {
  buildRoster,
  makeResolver,
  teamName,
  teamColor,
  teamTextColor,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { GoalEntryModal, type GoalEntry } from './GoalEntryModal';
import { TeamShirtIllustration } from './TeamShirt';
import { roundCommitKey } from '@/services/rotationEngine';
import type { DraftTeamsResult, GameGuest, LiveMatchState, MatchRotation } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  gameId: string;
  live: LiveMatchState;
  draftTeams: DraftTeamsResult;
  rotation: MatchRotation;
  playersMap: Record<string, PlayerLite>;
  guests?: GameGuest[];
  /** Current match-clock minute (0-based) — stamped on every goal. */
  minute: number;
  /** Admin can enter goals; viewers see scores only. */
  canEdit: boolean;
  // ── Timer display (computed by the screen from the synced clock) ──
  timerText: string;
  /** Match length in minutes → shows "מתוך X דקות" under the clock. */
  totalMinutes?: number;
  statusLabel: string;
  running: boolean;
  danger: boolean;
  overtimeText?: string | null;
  stoppagesText: string;
  onStoppages?: () => void;
  controllerName?: string | null;
  /** 1-based mini-game number within the evening. The scoreboard shows several
   *  mini-games in a row on the same card, and nothing on screen said WHICH one
   *  you were watching (Eliran's report) — this is that heading. */
  roundNumber?: number;
  goalRequest?: { side: 'A' | 'B'; key: number };
  hideGoalButtons?: boolean;
  /** Opening selection can leave either side unnamed without implying a choice. */
  sideLabels?: [string, string];
  sideTints?: [string, string];
}

export function LiveScoreboardCard(props: Props) {
  const { width, fontScale } = useWindowDimensions();
  const compact = width < 360 || fontScale > 1.2;
  const { gameId, live, draftTeams, rotation, playersMap, guests, minute, canEdit } = props;
  // The "הוסף גול" wizard: which side's button was pressed (null = closed).
  const [goalSide, setGoalSide] = useState<'A' | 'B' | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous guard: setBusy(true) only takes effect next render, so a fast
  // double-tap (row vs "none" button) could fire two writes before the state
  // flips. The ref blocks the second one in the same tick.
  const busyRef = useRef(false);
  useEffect(() => { if (!canEdit) setGoalSide(null); }, [canEdit]);
  useEffect(() => { if (props.goalRequest && canEdit) { setGoalSide(props.goalRequest.side); logEvent(AnalyticsEvent.GoalWizardOpened, { gameId, team: props.goalRequest.side, minute }); } }, [props.goalRequest?.key]);

  const resolve = useMemo(() => makeResolver(playersMap, guests), [playersMap, guests]);
  // Players who left during the evening are off their team — exclude them from
  // the scorer/assist pickers so a departed player can't be credited a goal.
  const leftHome = useMemo(
    () => new Set((draftTeams.leftHome ?? []).map((l) => l.playerId)),
    [draftTeams.leftHome],
  );
  const teams = useMemo(
    () =>
      draftTeams.teams.map((t) => ({
        index: t.index,
        playerIds: t.playerIds.filter((id) => !leftHome.has(id)),
      })),
    [draftTeams, leftHome],
  );
  const [aIdx, bIdx] = rotation.playing;
  const rosterA = useMemo(() => buildRoster(aIdx, teams, rotation, resolve), [aIdx, teams, rotation, resolve]);
  const rosterB = useMemo(() => buildRoster(bIdx, teams, rotation, resolve), [bIdx, teams, rotation, resolve]);
  const goals = live.goals ?? [];

  // ── Goal flash: a brief tinted wash over the whole card when a score ticks
  // up, so a goal reads as a card-wide event (not just the number bouncing).
  const flash = useSharedValue(0);
  const [flashTint, setFlashTint] = useState(colors.primary);
  const prevA = useRef(live.scoreA);
  const prevB = useRef(live.scoreB);
  useEffect(() => {
    const aUp = live.scoreA > prevA.current;
    const bUp = live.scoreB > prevB.current;
    if (aUp || bUp) {
      setFlashTint(aUp ? teamColor(aIdx, draftTeams.teams) : teamColor(bIdx, draftTeams.teams));
      flash.value = withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(0, { duration: 560 }),
      );
    }
    prevA.current = live.scoreA;
    prevB.current = live.scoreB;
  }, [live.scoreA, live.scoreB, aIdx, bIdx, draftTeams.teams, flash]);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value * 0.16 }));

  // ── Danger pulse: the timer breathes in the final-minute red state so the
  // "time almost up" cue is felt, not just coloured.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (props.danger && props.running) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.06, { duration: 450 }),
          withTiming(1, { duration: 450 }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 200 });
    }
    return () => cancelAnimation(pulse);
  }, [props.danger, props.running, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const addGoal = async (
    team: 'A' | 'B',
    scorerId: string | null,
    ownGoal?: boolean,
    assisterId?: string | null,
    entry?: Pick<GoalEntry, 'id' | 'assistStatus'>,
  ) => {
    if (!canEdit || busyRef.current) throw new Error('הזנת גול אינה זמינה כרגע');
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.recordGoal(gameId, { team, scorerId, assisterId, ownGoal, minute, ...entry, expectedRoundId: roundCommitKey(rotation) });
      logEvent(AnalyticsEvent.TeamScoreChanged, {
        gameId,
        team,
        delta: 1,
        kind: ownGoal ? 'own' : scorerId ? 'player' : 'unknown',
        hasAssist: !!assisterId && assisterId !== scorerId,
        minute,
      });
    } catch (err) {
    observeCaughtError(err, {"source":"src/components/match/LiveScoreboardCard.tsx","handler":"addGoal","site":"LiveScoreboardCard:35435900fa"});
      toast.error(he.goalSaveFailed);
      throw err;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // Deleting a goal is destructive (drops it from the log + decrements the
  // score) and the ✕ is a tiny target next to other rows — confirm first.
  const undo = (goalId: string) => {
    logEvent(AnalyticsEvent.GoalDeletePrompted, { gameId });
    appAlert('מחיקת גול', 'למחוק את הגול מהיומן?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק גול', style: 'destructive', onPress: () => doUndo(goalId) },
    ], {football:true});
  };
  const doUndo = async (goalId: string) => {
    if (!canEdit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.removeGoal(gameId, goalId);
      logEvent(AnalyticsEvent.TeamScoreChanged, { gameId, delta: -1, kind: 'undo' });
    } catch (err) {
    observeCaughtError(err, {"source":"src/components/match/LiveScoreboardCard.tsx","handler":"doUndo","site":"LiveScoreboardCard:5043902620"});
      toast.error(he.goalSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const goalLabel = (g: (typeof goals)[number]): string => {
    // Own goal → the player who scored it (on the conceding team) + the tag.
    if (g.ownGoal) {
      return g.scorerId
        ? he.goalOwnGoalBy(resolve(g.scorerId).displayName ?? '…')
        : he.goalOwnGoalShort;
    }
    if (!g.scorerId) return he.goalUnknownScorer;
    const scorer = resolve(g.scorerId).displayName ?? '…';
    // Surface the assist inline (user report: "why are there no assists?").
    if (g.assisterId && g.assisterId !== g.scorerId) {
      const assister = resolve(g.assisterId).displayName ?? '…';
      return he.goalScorerWithAssist(scorer, assister);
    }
    return scorer;
  };

  return (
    <View style={styles.card}>
      <View style={[styles.pitchPanel, compact && styles.compactPitch]}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none" accessible={false}>
        <Image source={require('@/assets/images/live-scoreboard-pitch.png')} style={[StyleSheet.absoluteFillObject,styles.pitchImage]} resizeMode="stretch" accessible={false}/>
        <View style={styles.pitchShade}/>
        <LinearGradient colors={['rgba(13,78,35,0)','rgba(13,78,35,0.55)','rgba(13,78,35,0.55)','rgba(13,78,35,0)']} locations={[0,0.25,0.75,1]} start={{x:0,y:0.5}} end={{x:1,y:0.5}} style={styles.timerReadingShade}/>
      </View>
      {/* Goal flash — tinted wash pinned to the card, behind the content. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flashOverlay, { backgroundColor: flashTint }, flashStyle]}
      />
      {/* Top row: team A (right) · timer (center) · team B (left). */}
      <View style={styles.row}>
        <ScoreSide
          label={props.sideLabels?.[0] ?? teamName(aIdx, draftTeams.teams)}
          score={live.scoreA}
          tint={props.sideTints?.[0] ?? teamColor(aIdx, draftTeams.teams)}
          canEdit={canEdit && !props.hideGoalButtons}
          busy={busy}
          compact={compact}
          onAdd={() => {
            logEvent(AnalyticsEvent.GoalWizardOpened, { gameId, team: 'A', minute });
            setGoalSide('A');
          }}
        />

        <View style={[styles.timerCol, compact && styles.compactTimerCol]}>
          {props.roundNumber ? (
            <View style={styles.roundChip}>
              <Text style={styles.roundChipText} maxFontSizeMultiplier={1.15}>{he.matchNumber(props.roundNumber)}</Text>
            </View>
          ) : null}
          <Animated.Text
            style={[styles.timer, compact && styles.compactTimer, props.danger && styles.timerDanger, pulseStyle]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.65}
            maxFontSizeMultiplier={compact ? 1.15 : 1.3}
            accessibilityLabel={props.timerText}
          >
            {props.timerText}
          </Animated.Text>
          {props.totalMinutes && (!compact || !props.statusLabel) ? (
            <Text style={[styles.ofTotal, compact && styles.compactMetadata]} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>
              {he.liveTimerOfTotal(props.totalMinutes)}
            </Text>
          ) : null}
          {props.overtimeText ? (
            <Text style={styles.overtime} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>{ltr(`+${props.overtimeText}`)}</Text>
          ) : null}
          {!!props.statusLabel && <ChangeMotion triggerKey={props.running} pulse duration={190} style={[styles.statusRow, compact && styles.compactStatusRow]}>
            {compact && props.totalMinutes ? <Text style={[styles.ofTotal, styles.compactMetadata]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} maxFontSizeMultiplier={1.15} accessibilityLabel={he.liveTimerOfTotal(props.totalMinutes)}>{he.liveTimerCompactTotal(props.totalMinutes)} ·</Text> : null}
            {props.running ? <View style={styles.redDot} /> : null}
            <Text style={[styles.statusWord, compact && styles.compactMetadata, props.running && styles.statusRunning]} maxFontSizeMultiplier={1.15}>
              {props.statusLabel}
            </Text>
          </ChangeMotion>}
          <Pressable onPress={props.onStoppages} disabled={!props.onStoppages} hitSlop={6} style={styles.stoppages}>
            <Ionicons name="stopwatch-outline" size={13} color="#E5FFEF" />
            <Text style={[styles.stoppagesText, compact && styles.compactStoppages]} numberOfLines={compact ? 2 : 1} maxFontSizeMultiplier={1.15}>
              {props.stoppagesText}
            </Text>
          </Pressable>
        </View>

        <ScoreSide
          label={props.sideLabels?.[1] ?? teamName(bIdx, draftTeams.teams)}
          score={live.scoreB}
          tint={props.sideTints?.[1] ?? teamColor(bIdx, draftTeams.teams)}
          canEdit={canEdit && !props.hideGoalButtons}
          busy={busy}
          compact={compact}
          onAdd={() => {
            logEvent(AnalyticsEvent.GoalWizardOpened, { gameId, team: 'B', minute });
            setGoalSide('B');
          }}
        />
      </View>

      {props.controllerName ? (
        <Text style={styles.controller} numberOfLines={1}>
          מופעל ע״י {props.controllerName}
        </Text>
      ) : null}
      </View>

      {/* Collapsible scorer log. */}
      {goals.length > 0 ? (
        <View style={styles.logWrap}>
          <Pressable
            style={styles.logHeader}
            onPress={() => {
              logEvent(AnalyticsEvent.GoalLogToggled, { gameId, open: !logOpen, goals: goals.length });
              setLogOpen((v) => !v);
            }}
          >
            <Ionicons name={logOpen ? 'chevron-up' : 'chevron-down'} size={16} color="#D1FAE5" />
            <Text style={styles.logHeaderText}>{he.goalScorersLog(goals.length)}</Text>
          </Pressable>
          {logOpen ? (
            <ScrollView style={{maxHeight:160}} contentContainerStyle={styles.log} nestedScrollEnabled>
              {goals
                .slice()
                .reverse()
                .map((g) => (
                  <View key={g.id} style={styles.logRow}>
                    <View
                      style={[styles.logDot, { backgroundColor: g.team === 'A' ? teamColor(aIdx, draftTeams.teams) : teamColor(bIdx, draftTeams.teams) }]}
                    />
                    <Text style={styles.logName} numberOfLines={1}>
                      {goalLabel(g)}
                    </Text>
                    <Text style={styles.logMin}>{ltr(`${g.minute}'`)}</Text>
                    {canEdit ? (
                      <Pressable onPress={() => undo(g.id)} disabled={busy}
                        accessibilityRole="button" accessibilityLabel={`ביטול הגול של ${goalLabel(g)}`}
                        accessibilityState={{ disabled: busy }} hitSlop={{ top: 1, bottom: 1 }} style={styles.undoBtn}>
                        <View style={styles.undoCircle}><Ionicons name="close" size={14} color={colors.textMuted} /></View>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}

      <GoalEntryModal
        gameId={gameId} side={goalSide}
        teamLabel={goalSide === 'A' ? teamName(aIdx, draftTeams.teams) : teamName(bIdx, draftTeams.teams)}
        teamColor={teamColor(goalSide === 'A' ? aIdx : bIdx, draftTeams.teams)}
        teamInk={teamTextColor(goalSide === 'A' ? aIdx : bIdx, draftTeams.teams)}
        otherTeamLabel={goalSide === 'A' ? teamName(bIdx, draftTeams.teams) : teamName(aIdx, draftTeams.teams)}
        otherTeamColor={teamColor(goalSide === 'A' ? bIdx : aIdx, draftTeams.teams)}
        otherTeamInk={teamTextColor(goalSide === 'A' ? bIdx : aIdx, draftTeams.teams)}
        roster={goalSide === 'A' ? rosterA : rosterB}
        ownGoalRoster={goalSide === 'A' ? rosterB : rosterA}
        minute={minute} roundNumber={props.roundNumber ?? 1}
        onSave={async entry => { await addGoal(entry.team, entry.scorerId, entry.ownGoal, entry.assisterId, entry); }}
        onClose={saved => {
          if (!saved && goalSide) logEvent(AnalyticsEvent.GoalWizardCancelled, { gameId, team: goalSide });
          setGoalSide(null);
        }}
      />
    </View>
  );
}

function ScoreSide({
  label,
  score,
  tint,
  canEdit,
  busy,
  onAdd,
  compact,
}: {
  label: string;
  score: number;
  tint: string;
  canEdit: boolean;
  busy: boolean;
  onAdd: () => void;
  compact?: boolean;
}) {
  return (
    <View style={[styles.side, compact && styles.compactSide]}>
      <TeamShirtIllustration color={tint} width={compact ? 34 : 42}/>
      <Text style={[styles.sideName, compact && styles.compactSideName]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} maxFontSizeMultiplier={compact ? 1.15 : 1.3}>
        {label}
      </Text>
      <AnimatedScore score={score} tint="#FFFFFF" compact={compact}/>

      {canEdit ? (
        <Pressable
          style={[styles.addBtn, { backgroundColor: tint }, busy && styles.addBtnBusy]}
          onPress={onAdd}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
        >
          <Ionicons name="football" size={15} color="#FFFFFF" />
          <Text style={styles.addBtnTxt} numberOfLines={1}>
            {he.goalAddGoal}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The big score number, with a quick scale-bounce whenever it changes so a
 *  goal reads as an event instead of a silent number swap. */
function AnimatedScore({ score, tint, compact }: { score: number; tint: string; compact?: boolean }) {
  const scale = useSharedValue(1);
  const prev = useRef(score);
  useEffect(() => {
    if (score !== prev.current) {
      scale.value = withSequence(
        withTiming(1.35, { duration: 130 }),
        withTiming(1, { duration: 200 }),
      );
      prev.current = score;
    }
  }, [score, scale]);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.Text style={[styles.sideScore, compact && styles.compactScore, { color: tint }, animStyle]} maxFontSizeMultiplier={1.2}>
      {score}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: '#155E35',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#196B3B',
    // NOTE: no `overflow:'hidden'` here — it would clip the iOS shadow. The
    // goal-flash overlay clips its own corners via its matching borderRadius.
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  pitchPanel: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.lg, overflow: 'hidden' },
  compactPitch: { padding: 8, gap: 4 },
  compactTimerCol: { flex: 1.25, minWidth: 102, paddingHorizontal: 0 },
  compactTimer: { fontSize: 28, letterSpacing: 0 },
  compactMetadata: { fontSize: 11, textAlign: 'center' },
  compactStatusRow: { gap: 3 },
  compactStoppages: { flexShrink: 1, fontSize: 10, textAlign: 'center' },
  compactSide: { minWidth: 0, gap: 2 },
  compactSideName: { fontSize: 16, width: '100%' },
  compactScore: { fontSize: 34, lineHeight: 38 },
  pitchImage: { width: '100%', height: '100%' },
  pitchShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,61,31,0.12)' },
  timerReadingShade: { position: 'absolute', top: 0, bottom: 0, left: '28%', right: '28%' },
  flashOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // ── Team score side ──
  side: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  sideName: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '800', textAlign: 'center', textShadowColor: 'rgba(3,30,15,0.3)', textShadowRadius: 2 },
  sideScore: { fontSize: 40, fontWeight: '900', lineHeight: 44, fontVariant: ['tabular-nums'] },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.md,
    alignSelf: 'stretch',
  },
  addBtnBusy: { opacity: 0.5 },
  addBtnTxt: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', flexShrink: 1 },
  // ── Timer center ──
  roundChip: {
    alignSelf: 'center',
    marginBottom: spacing.xs,
    paddingHorizontal: 12,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(220,252,231,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(220,252,231,0.28)',
  },
  roundChipText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  timerCol: { flex: 1.1, alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  timer: { fontSize: 38, fontWeight: '900', color: '#FFFFFF', fontVariant: ['tabular-nums'], letterSpacing: 1, textShadowColor: 'rgba(3,30,15,0.3)', textShadowRadius: 2 },
  timerDanger: { color: '#FECACA' },
  overtime: { ...typography.caption, color: '#FFF1F2', backgroundColor: 'rgba(153,27,27,0.85)', paddingHorizontal: 6, borderRadius: 6, fontWeight: '800' },
  ofTotal: { ...typography.caption, color: '#E5FFEF', fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  redDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FCA5A5' },
  statusWord: { ...typography.caption, color: '#D1FAE5', fontWeight: '700' },
  statusRunning: { color: '#FFFFFF' },
  stoppages: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  stoppagesText: { fontSize: 11, color: '#E5FFEF', fontVariant: ['tabular-nums'] },
  controller: { ...typography.caption, color: '#E5FFEF', textAlign: 'center' },
  // ── Scorer log ──
  logWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(220,252,231,0.3)', padding: spacing.md, paddingTop: spacing.xs },
  logHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  logHeaderText: { ...typography.caption, color: '#D1FAE5', fontWeight: '800' },
  log: { gap: 2, marginTop: 4 },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  undoBtn: { width: 44, height: 32, alignItems: 'center', justifyContent: 'center' },
  undoCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  logDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: '#D1FAE5' },
  logName: { flex: 1, minWidth: 0, ...typography.body, color: '#E2E8F0', textAlign: RTL_LABEL_ALIGN, fontWeight: '600' },
  logMin: { ...typography.caption, color: '#D1FAE5', fontVariant: ['tabular-nums'], minWidth: 26 },
  // ── Scorer picker modal ──
  backdrop: { backgroundColor: overlayTheme.backdrop,  flex: 1,  alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheet: { ...overlaySurfaces.dialog,  width: '100%', maxWidth: 380,   padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
  // ── Goal wizard (StepIndicator header flush at top + padded body) ──
  wizSheet: { ...overlaySurfaces.dialog,  width: '100%', maxWidth: 380,   overflow: 'hidden' },
  wizBody: { padding: spacing.lg, gap: spacing.sm },
  wizNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  backBtn: { paddingVertical: 12, paddingHorizontal: 6 },
  backTxt: { ...typography.body, color: colors.primary, fontWeight: '800' },
  scorerRow: {
    // `row` (NOT row-reverse): under the app's RTL the FIRST child (avatar)
    // lands on the RIGHT, the name right-aligned beside it, icon on the left.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  scorerName: { flex: 1, ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, fontWeight: '600' },
  emptyRoster: { ...typography.body, color: '#AFC2D8', textAlign: 'center', paddingVertical: spacing.md },
  specialRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  specialBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  specialTxt: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: spacing.xs },
  cancelTxt: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
});
