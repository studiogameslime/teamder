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
import { StepIndicator } from '@/components/StepIndicator';
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
  // The "הוסף גול" wizard: which side's button was pressed (null = closed).
  const [goalSide, setGoalSide] = useState<'A' | 'B' | null>(null);
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
  ) => {
    setGoalSide(null);
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.recordGoal(gameId, { team, scorerId, assisterId, ownGoal, minute });
    } catch (err) {
      toast.error(he.goalSaveFailed);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  // Deleting a goal is destructive (drops it from the log + decrements the
  // score) and the ✕ is a tiny target next to other rows — confirm first.
  const undo = (goalId: string) => {
    Alert.alert('מחיקת גול', 'למחוק את הגול מהיומן?', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'מחק', style: 'destructive', onPress: () => doUndo(goalId) },
    ]);
  };
  const doUndo = async (goalId: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await gameService.removeGoal(gameId, goalId);
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
          onAdd={() => setGoalSide('A')}
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
          onAdd={() => setGoalSide('B')}
        />
      </View>

      {props.controllerName ? (
        <Text style={styles.controller} numberOfLines={1}>
          מופעל ע״י {props.controllerName}
        </Text>
      ) : null}

      {/* Collapsible scorer log. */}
      {goals.length > 0 ? (
        <View style={styles.logWrap}>
          <Pressable style={styles.logHeader} onPress={() => setLogOpen((v) => !v)}>
            <Ionicons name={logOpen ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primary} />
            <Text style={styles.logHeaderText}>{he.goalScorersLog(goals.length)}</Text>
          </Pressable>
          {logOpen ? (
            <View style={styles.log}>
              {goals
                .slice()
                .reverse()
                .map((g) => (
                  <View key={g.id} style={styles.logRow}>
                    {canEdit ? (
                      <Pressable onPress={() => undo(g.id)} hitSlop={8} style={styles.undoBtn}>
                        <Ionicons name="close" size={14} color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                    <Text style={styles.logMin}>{ltr(`${g.minute}'`)}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.logName} numberOfLines={1}>
                      {goalLabel(g)}
                    </Text>
                    <View
                      style={[styles.logDot, { backgroundColor: g.team === 'A' ? teamColor(aIdx, draftTeams.teams) : teamColor(bIdx, draftTeams.teams) }]}
                    />
                  </View>
                ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <GoalWizard
        side={goalSide}
        teamLabel={
          goalSide === 'A' ? teamName(aIdx, draftTeams.teams) : teamName(bIdx, draftTeams.teams)
        }
        roster={goalSide === 'A' ? rosterA : rosterB}
        onGoal={(scorerId, assisterId) =>
          goalSide && addGoal(goalSide, scorerId, false, assisterId)
        }
        onUnknownGoal={() => goalSide && addGoal(goalSide, null)}
        onOwnGoal={() => goalSide && addGoal(goalSide, null, true)}
        onClose={() => setGoalSide(null)}
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
            {he.goalAddGoal}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** One roster row (avatar + name) for the wizard steps. */
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
 * "הוסף גול" wizard — a 2-step flow with the rolling-ball StepIndicator header
 * (same component as the create-game wizard). Step 1 (⚽ כובש) picks the scorer;
 * step 2 (👟 מבשל) picks the assister. No penalties, no type step.
 */
function GoalWizard({
  side,
  teamLabel,
  roster,
  onGoal,
  onUnknownGoal,
  onOwnGoal,
  onClose,
}: {
  side: 'A' | 'B' | null;
  teamLabel: string;
  roster: RosterMember[];
  onGoal: (scorerId: string, assisterId: string | null) => void;
  onUnknownGoal: () => void;
  onOwnGoal: () => void;
  onClose: () => void;
}) {
  const visible = side !== null;
  const [step, setStep] = useState<1 | 2>(1);
  const [scorerId, setScorerId] = useState<string | null>(null);
  useEffect(() => {
    if (visible) {
      setStep(1);
      setScorerId(null);
    }
  }, [visible, side]);

  const assisterRoster = roster.filter((m) => m.id !== scorerId);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.wizSheet} onPress={(e) => e.stopPropagation()}>
          {/* Rolling-ball step header (like the create-game wizard). The active
             step is a clean BLUE ball; inactive steps are solid BLACK balls. */}
          <StepIndicator
            current={step}
            labels={[he.goalStepScorer, he.goalStepAssist]}
            inactiveColor="#0F172A"
          />
          <View style={styles.wizBody}>
            {step === 1 ? (
              <>
                <Text style={styles.sheetTitle}>{he.goalScorerPickTitle(teamLabel)}</Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {roster.length === 0 ? (
                    <Text style={styles.emptyRoster}>{he.goalPickerEmptyRoster}</Text>
                  ) : null}
                  {roster.map((m) => (
                    <PickRow
                      key={m.id}
                      m={m}
                      onPress={() => {
                        setScorerId(m.id);
                        setStep(2);
                      }}
                    />
                  ))}
                </ScrollView>
                <View style={styles.specialRow}>
                  <Pressable style={styles.specialBtn} onPress={onUnknownGoal}>
                    <Text style={styles.specialTxt}>{he.goalUnknownScorer}</Text>
                  </Pressable>
                  <Pressable style={styles.specialBtn} onPress={onOwnGoal}>
                    <Text style={styles.specialTxt}>{he.goalOwnGoal}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.sheetTitle}>{he.goalAssistPickTitle(teamLabel)}</Text>
                <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                  {assisterRoster.length === 0 ? (
                    <Text style={styles.emptyRoster}>{he.goalAssistEmptyRoster}</Text>
                  ) : null}
                  {assisterRoster.map((m) => (
                    <PickRow key={m.id} m={m} onPress={() => scorerId && onGoal(scorerId, m.id)} />
                  ))}
                </ScrollView>
                <View style={styles.specialRow}>
                  <Pressable
                    style={styles.specialBtn}
                    onPress={() => scorerId && onGoal(scorerId, null)}
                  >
                    <Text style={styles.specialTxt}>{he.goalAssistNone}</Text>
                  </Pressable>
                </View>
              </>
            )}
            <View style={styles.wizNav}>
              {step === 2 ? (
                <Pressable style={styles.backBtn} onPress={() => { setScorerId(null); setStep(1); }}>
                  <Text style={styles.backTxt}>{he.goalBack}</Text>
                </Pressable>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelTxt}>{he.cancel}</Text>
              </Pressable>
            </View>
          </View>
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
  logMin: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'], minWidth: 26 },
  // ── Scorer picker modal ──
  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheet: { width: '100%', maxWidth: 380, backgroundColor: colors.bg, borderRadius: 24, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
  // ── Goal wizard (StepIndicator header flush at top + padded body) ──
  wizSheet: { width: '100%', maxWidth: 380, backgroundColor: colors.bg, borderRadius: 24, overflow: 'hidden' },
  wizBody: { padding: spacing.lg, gap: spacing.sm },
  wizNav: {
    flexDirection: 'row-reverse',
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
