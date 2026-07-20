// LiveScoreboardCard — the merged top card for the advanced live match:
// the timer in the CENTER, flanked by each on-pitch team's live score and an
// "הוסף גול" button (admin only). A collapsible scorer log sits below.
//
// This unifies what used to be a separate timer card + goal card so the timer
// and the score read as one block at the very top (the design the owner asked
// for). Goal writes go through gameService; the score fans out via the live
// listener.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import { toast } from '@/components/Toast';

// Wrap a sign/punctuation-bearing numeric in a bidi isolate so it can't be
// reordered by the surrounding RTL paragraph (e.g. "+01:23" rendering as
// "01:23+", or a minute "12'" flipping its apostrophe).
const ltr = (s: string | number) => `⁦${s}⁩`;
import {
  buildRoster,
  makeResolver,
  teamName,
  teamColor,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import { gameService } from '@/services/gameService';
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
  onStoppages: () => void;
  controllerName?: string | null;
}

export function LiveScoreboardCard(props: Props) {
  const { gameId, live, draftTeams, rotation, playersMap, guests, minute, canEdit } = props;
  // The "הוסף אירוע" wizard: which side's button was pressed (null = closed).
  // The wizard itself carries the goal/penalty toggle + its step state.
  const [eventSide, setEventSide] = useState<'A' | 'B' | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Synchronous guard: setBusy(true) only takes effect next render, so a fast
  // double-tap (row vs "none" button) could fire two writes before the state
  // flips. The ref blocks the second one in the same tick.
  const busyRef = useRef(false);

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
    pen?: { keeperId: string },
  ) => {
    setEventSide(null);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.recordGoal(gameId, {
        team,
        scorerId,
        assisterId,
        ownGoal,
        minute,
        ...(pen ? { penalty: true, keeperId: pen.keeperId } : {}),
      });
    } catch (err) {
      toast.error(he.goalSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // A MISSED penalty — not a goal (no score change); records the kicker's miss
  // + the keeper's save at round-end.
  const addMissedPenalty = async (
    team: 'A' | 'B',
    kickerId: string,
    keeperId: string,
  ) => {
    setEventSide(null);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.recordMissedPenalty(gameId, { team, kickerId, keeperId, minute });
    } catch (err) {
      toast.error(he.goalSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // Deleting a goal is destructive (drops it from the log + decrements the
  // score) and the ✕ is a tiny target next to other rows — confirm first.
  const undo = (id: string, missed: boolean) => {
    Alert.alert(
      missed ? he.penaltyDeleteTitle : 'מחיקת גול',
      missed ? he.penaltyDeleteBody : 'למחוק את הגול מהיומן?',
      [
        { text: 'ביטול', style: 'cancel' },
        { text: 'מחק', style: 'destructive', onPress: () => doUndo(id, missed) },
      ],
    );
  };
  const doUndo = async (id: string, missed: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (missed) await gameService.removeMissedPenalty(gameId, id);
      else await gameService.removeGoal(gameId, id);
    } catch (err) {
      toast.error(he.goalSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const goalLabel = (g: (typeof goals)[number]): string => {
    if (g.ownGoal) return he.goalOwnGoalShort;
    if (!g.scorerId) return he.goalUnknownScorer;
    const scorer = resolve(g.scorerId).displayName ?? '…';
    // Surface the assist inline (user report: "why are there no assists?").
    if (g.assisterId && g.assisterId !== g.scorerId) {
      const assister = resolve(g.assisterId).displayName ?? '…';
      return he.goalScorerWithAssist(scorer, assister);
    }
    return scorer;
  };
  // Merged, newest-first log: goals (incl. scored penalties) + missed penalties.
  // Each carries `missed` so the row can render a distinct marker + route undo.
  const missedPens = live.missedPenalties ?? [];
  const logEntries = useMemo(
    () =>
      [
        ...goals.map((g) => ({ g, missed: false })),
        ...missedPens.map((g) => ({ g, missed: true })),
      ].sort((a, b) => (b.g.at ?? 0) - (a.g.at ?? 0)),
    [goals, missedPens],
  );

  return (
    <View style={styles.card}>
      {/* Goal flash — tinted wash pinned to the card, behind the content. */}
      <Animated.View
        pointerEvents="none"
        style={[styles.flashOverlay, { backgroundColor: flashTint }, flashStyle]}
      />
      {/* Top row: team A (right) · timer (center) · team B (left). */}
      <View style={styles.row}>
        <ScoreSide
          label={teamName(aIdx, draftTeams.teams)}
          score={live.scoreA}
          tint={teamColor(aIdx, draftTeams.teams)}
          canEdit={canEdit}
          busy={busy}
          onAdd={() => setEventSide('A')}
        />

        <View style={styles.timerCol}>
          <Animated.Text
            style={[styles.timer, props.danger && styles.timerDanger, pulseStyle]}
            numberOfLines={1}
          >
            {props.timerText}
          </Animated.Text>
          {props.totalMinutes ? (
            <Text style={styles.ofTotal}>
              {he.liveTimerOfTotal(props.totalMinutes)}
            </Text>
          ) : null}
          {props.overtimeText ? (
            <Text style={styles.overtime}>{ltr(`+${props.overtimeText}`)}</Text>
          ) : null}
          <View style={styles.statusRow}>
            {props.running ? <View style={styles.redDot} /> : null}
            <Text style={[styles.statusWord, props.running && styles.statusRunning]}>
              {props.statusLabel}
            </Text>
          </View>
          <Pressable onPress={props.onStoppages} hitSlop={6} style={styles.stoppages}>
            <Ionicons name="stopwatch-outline" size={13} color={colors.textMuted} />
            <Text style={styles.stoppagesText} numberOfLines={1}>
              {props.stoppagesText}
            </Text>
          </Pressable>
        </View>

        <ScoreSide
          label={teamName(bIdx, draftTeams.teams)}
          score={live.scoreB}
          tint={teamColor(bIdx, draftTeams.teams)}
          canEdit={canEdit}
          busy={busy}
          onAdd={() => setEventSide('B')}
        />
      </View>

      {props.controllerName ? (
        <Text style={styles.controller} numberOfLines={1}>
          מופעל ע״י {props.controllerName}
        </Text>
      ) : null}

      {/* Collapsible event log (goals + penalties). */}
      {logEntries.length > 0 ? (
        <View style={styles.logWrap}>
          <Pressable style={styles.logHeader} onPress={() => setLogOpen((v) => !v)}>
            <Ionicons name={logOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
            <Text style={styles.logHeaderText}>{he.goalScorersLog(logEntries.length)}</Text>
          </Pressable>
          {logOpen ? (
            <View style={styles.log}>
              {logEntries.map(({ g, missed }) => {
                const isPen = missed || g.penalty;
                return (
                  <View key={g.id} style={styles.logRow}>
                    {canEdit ? (
                      <Pressable onPress={() => undo(g.id, missed)} hitSlop={8} style={styles.undoBtn}>
                        <Ionicons name="close" size={14} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                    <Text style={styles.logMin}>{ltr(`${g.minute}'`)}</Text>
                    <View style={{ flex: 1 }} />
                    {/* Penalty marker: 🥅 for a scored penalty, 🥅❌ for a miss. */}
                    {isPen ? (
                      <Text style={styles.logPen}>{missed ? he.penaltyMissedTag : he.penaltyTag}</Text>
                    ) : null}
                    <Text
                      style={[styles.logName, missed && styles.logNameMissed]}
                      numberOfLines={1}
                    >
                      {missed ? resolve(g.scorerId ?? '').displayName ?? '…' : goalLabel(g)}
                    </Text>
                    <View
                      style={[styles.logDot, { backgroundColor: g.team === 'A' ? teamColor(aIdx, draftTeams.teams) : teamColor(bIdx, draftTeams.teams) }]}
                    />
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      ) : null}

      <EventWizard
        side={eventSide}
        teamLabel={
          eventSide === 'A'
            ? teamName(aIdx, draftTeams.teams)
            : teamName(bIdx, draftTeams.teams)
        }
        opponentLabel={
          eventSide === 'A'
            ? teamName(bIdx, draftTeams.teams)
            : teamName(aIdx, draftTeams.teams)
        }
        ownRoster={eventSide === 'A' ? rosterA : rosterB}
        opponentRoster={eventSide === 'A' ? rosterB : rosterA}
        onGoal={(scorerId, assisterId) =>
          eventSide && addGoal(eventSide, scorerId, false, assisterId)
        }
        onUnknownGoal={() => eventSide && addGoal(eventSide, null)}
        onOwnGoal={() => eventSide && addGoal(eventSide, null, true)}
        onScoredPenalty={(kickerId, keeperId) =>
          eventSide && addGoal(eventSide, kickerId, false, null, { keeperId })
        }
        onMissedPenalty={(kickerId, keeperId) =>
          eventSide && addMissedPenalty(eventSide, kickerId, keeperId)
        }
        onClose={() => setEventSide(null)}
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
}: {
  label: string;
  score: number;
  tint: string;
  canEdit: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <View style={styles.side}>
      <Text style={[styles.sideName, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <AnimatedScore score={score} tint={tint} />

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
            {he.eventAdd}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Reusable roster row (avatar + name) for the wizard steps. */
function PickRow({ m, onPress }: { m: RosterMember; onPress: () => void }) {
  return (
    <Pressable style={styles.scorerRow} onPress={onPress}>
      <UserAvatar user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }} size={34} />
      <Text style={styles.scorerName} numberOfLines={1}>
        {m.name}
      </Text>
    </Pressable>
  );
}

/**
 * "הוסף אירוע" wizard. A neutral entry (so a MISSED penalty isn't a confusing
 * "add goal → missed"). Step 1: goal/penalty toggle (default goal) + pick the
 * scorer/kicker. Step 2 is dynamic — assister for a goal, keeper for a penalty
 * — and the step-2 preview flashes when the toggle flips so the switch is felt.
 * Step 3 (penalty only): scored / missed.
 */
function EventWizard({
  side,
  teamLabel,
  ownRoster,
  opponentRoster,
  onGoal,
  onUnknownGoal,
  onOwnGoal,
  onScoredPenalty,
  onMissedPenalty,
  onClose,
}: {
  side: 'A' | 'B' | null;
  teamLabel: string;
  opponentLabel: string;
  ownRoster: RosterMember[];
  opponentRoster: RosterMember[];
  onGoal: (scorerId: string, assisterId: string | null) => void;
  onUnknownGoal: () => void;
  onOwnGoal: () => void;
  onScoredPenalty: (kickerId: string, keeperId: string) => void;
  onMissedPenalty: (kickerId: string, keeperId: string) => void;
  onClose: () => void;
}) {
  const visible = side !== null;
  const [kind, setKind] = useState<'goal' | 'penalty'>('goal');
  const [scorerId, setScorerId] = useState<string | null>(null);
  const [keeperId, setKeeperId] = useState<string | null>(null);
  // Reset to a clean step-1/goal state each time the wizard opens for a side.
  useEffect(() => {
    if (visible) {
      setKind('goal');
      setScorerId(null);
      setKeeperId(null);
    }
  }, [visible, side]);

  // Flash the step-2 preview (icon + label) when the toggle flips, so the
  // מבשל↔שוער switch is obvious (user request).
  const flash = useSharedValue(0);
  const flashStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + flash.value * 0.45,
    transform: [{ scale: 1 + flash.value * 0.14 }],
  }));
  const switchKind = (k: 'goal' | 'penalty') => {
    if (k === kind) return;
    setKind(k);
    flash.value = 0;
    flash.value = withSequence(
      withTiming(1, { duration: 90 }),
      withTiming(0, { duration: 400 }),
    );
  };

  const assisterRoster = ownRoster.filter((m) => m.id !== scorerId);

  let body: React.ReactNode;
  if (scorerId == null) {
    // ── STEP 1: toggle + step preview + scorer/kicker picker ──
    body = (
      <>
        <View style={styles.toggle}>
          <Pressable
            style={[styles.toggleBtn, kind === 'goal' && styles.toggleBtnOn]}
            onPress={() => switchKind('goal')}
          >
            <Text style={[styles.toggleTxt, kind === 'goal' && styles.toggleTxtOn]}>
              {he.eventKindGoal}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toggleBtn, kind === 'penalty' && styles.toggleBtnOn]}
            onPress={() => switchKind('penalty')}
          >
            <Text style={[styles.toggleTxt, kind === 'penalty' && styles.toggleTxtOn]}>
              {he.eventKindPenalty}
            </Text>
          </Pressable>
        </View>
        {/* 2-step preview — dot 1 always כובש (⚽); dot 2 flashes on toggle. */}
        <View style={styles.steps}>
          <Text style={styles.stepChip}>⚽ {he.eventStepScorer}</Text>
          <Text style={styles.stepArrow}>›</Text>
          <Animated.Text style={[styles.stepChip, styles.stepChip2, flashStyle]}>
            {kind === 'goal' ? `👟 ${he.eventStepAssist}` : `🥅 ${he.eventStepKeeper}`}
          </Animated.Text>
        </View>
        <Text style={styles.sheetTitle}>
          {kind === 'goal' ? he.eventWhoScored(teamLabel) : he.eventWhoKicked(teamLabel)}
        </Text>
        <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
          {ownRoster.length === 0 ? (
            <Text style={styles.emptyRoster}>{he.goalPickerEmptyRoster}</Text>
          ) : null}
          {ownRoster.map((m) => (
            <PickRow key={m.id} m={m} onPress={() => setScorerId(m.id)} />
          ))}
        </ScrollView>
        {/* Unknown / own-goal only make sense for a real goal, not a penalty. */}
        {kind === 'goal' ? (
          <View style={styles.specialRow}>
            <Pressable style={styles.specialBtn} onPress={onUnknownGoal}>
              <Text style={styles.specialTxt}>{he.goalUnknownScorer}</Text>
            </Pressable>
            <Pressable style={styles.specialBtn} onPress={onOwnGoal}>
              <Text style={styles.specialTxt}>{he.goalOwnGoal}</Text>
            </Pressable>
          </View>
        ) : null}
      </>
    );
  } else if (kind === 'goal') {
    // ── STEP 2 (goal): who assisted? ──
    body = (
      <>
        <Text style={styles.sheetTitle}>{he.goalAssistPickTitle(teamLabel)}</Text>
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {assisterRoster.length === 0 ? (
            <Text style={styles.emptyRoster}>{he.goalAssistEmptyRoster}</Text>
          ) : null}
          {assisterRoster.map((m) => (
            <PickRow key={m.id} m={m} onPress={() => onGoal(scorerId, m.id)} />
          ))}
        </ScrollView>
        <View style={styles.specialRow}>
          <Pressable style={styles.specialBtn} onPress={() => onGoal(scorerId, null)}>
            <Text style={styles.specialTxt}>{he.goalAssistNone}</Text>
          </Pressable>
        </View>
      </>
    );
  } else if (keeperId == null) {
    // ── STEP 2 (penalty): who's in goal? (opponent team, mandatory) ──
    body = (
      <>
        <Text style={styles.sheetTitle}>{he.eventWhoKeeper}</Text>
        <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
          {opponentRoster.length === 0 ? (
            <Text style={styles.emptyRoster}>{he.goalPickerEmptyRoster}</Text>
          ) : null}
          {opponentRoster.map((m) => (
            <PickRow key={m.id} m={m} onPress={() => setKeeperId(m.id)} />
          ))}
        </ScrollView>
      </>
    );
  } else {
    // ── STEP 3 (penalty): scored or missed? ──
    body = (
      <>
        <Text style={styles.sheetTitle}>{he.eventPenaltyResult}</Text>
        <View style={styles.resultRow}>
          <Pressable
            style={[styles.resultBtn, styles.resultScored]}
            onPress={() => onScoredPenalty(scorerId, keeperId)}
          >
            <Text style={styles.resultScoredTxt}>{he.eventPenaltyScored}</Text>
          </Pressable>
          <Pressable
            style={[styles.resultBtn, styles.resultMissed]}
            onPress={() => onMissedPenalty(scorerId, keeperId)}
          >
            <Text style={styles.resultMissedTxt}>{he.eventPenaltyMissed}</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {body}
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelTxt}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The big score number, with a quick scale-bounce whenever it changes so a
 *  goal reads as an event instead of a silent number swap. */
function AnimatedScore({ score, tint }: { score: number; tint: string }) {
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
    <Animated.Text style={[styles.sideScore, { color: tint }, animStyle]}>
      {score}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    // NOTE: no `overflow:'hidden'` here — it would clip the iOS shadow. The
    // goal-flash overlay clips its own corners via its matching borderRadius.
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  flashOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // ── Team score side ──
  side: { flex: 1, alignItems: 'center', gap: 4 },
  sideName: { ...typography.bodyBold, fontWeight: '800', textAlign: 'center' },
  sideScore: { fontSize: 40, fontWeight: '900', lineHeight: 44, fontVariant: ['tabular-nums'] },
  addBtn: {
    flexDirection: 'row-reverse',
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
  timerCol: { flex: 1.1, alignItems: 'center', gap: 2, paddingHorizontal: 2 },
  timer: { fontSize: 38, fontWeight: '900', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: 1 },
  timerDanger: { color: colors.danger },
  overtime: { ...typography.caption, color: colors.danger, fontWeight: '800' },
  ofTotal: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
  statusRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5 },
  redDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  statusWord: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  statusRunning: { color: colors.danger },
  stoppages: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4, marginTop: 1 },
  stoppagesText: { fontSize: 11, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  controller: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  // ── Scorer log ──
  logWrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.xs },
  logHeader: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  logHeaderText: { ...typography.caption, color: colors.primary, fontWeight: '800' },
  log: { gap: 8, marginTop: 4 },
  logRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  undoBtn: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  logDot: { width: 9, height: 9, borderRadius: 5 },
  logName: { ...typography.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, fontWeight: '600' },
  logNameMissed: { color: colors.textMuted, textDecorationLine: 'line-through' },
  logPen: { fontSize: 12, marginHorizontal: 4 },
  logMin: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'], minWidth: 26 },
  // ── Event wizard (goal / penalty) ──
  toggle: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: 4,
  },
  toggleBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm },
  toggleBtnOn: { backgroundColor: colors.bg, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  toggleTxt: { ...typography.body, color: colors.textMuted, fontWeight: '700' },
  toggleTxtOn: { color: colors.primary, fontWeight: '900' },
  steps: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2 },
  stepChip: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  stepChip2: { color: colors.primary, fontWeight: '800' },
  stepArrow: { ...typography.caption, color: colors.textMuted },
  resultRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  resultBtn: { flex: 1, alignItems: 'center', paddingVertical: 18, borderRadius: radius.md, borderWidth: 1.5 },
  resultScored: { backgroundColor: '#ECFDF3', borderColor: '#16A34A' },
  resultScoredTxt: { ...typography.h3, color: '#16A34A', fontWeight: '900' },
  resultMissed: { backgroundColor: '#FEF2F2', borderColor: '#EF4444' },
  resultMissedTxt: { ...typography.h3, color: '#EF4444', fontWeight: '900' },
  // ── Scorer picker modal ──
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheet: { width: '100%', maxWidth: 380, backgroundColor: colors.bg, borderRadius: 24, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
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
  emptyRoster: { ...typography.body, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
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
