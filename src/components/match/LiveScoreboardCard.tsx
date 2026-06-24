// LiveScoreboardCard — the merged top card for the advanced live match:
// the timer in the CENTER, flanked by each on-pitch team's live score and an
// "הוסף גול" button (admin only). A collapsible scorer log sits below.
//
// This unifies what used to be a separate timer card + goal card so the timer
// and the score read as one block at the very top (the design the owner asked
// for). Goal writes go through gameService; the score fans out via the live
// listener.

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
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
  const [pickSide, setPickSide] = useState<'A' | 'B' | null>(null);
  // After a real scorer is picked we ask "who assisted?" — this holds the
  // in-progress goal until the assist step resolves.
  const [pendingAssist, setPendingAssist] = useState<{
    side: 'A' | 'B';
    scorerId: string;
  } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolve = useMemo(() => makeResolver(playersMap, guests), [playersMap, guests]);
  const teams = useMemo(
    () => draftTeams.teams.map((t) => ({ index: t.index, playerIds: t.playerIds })),
    [draftTeams],
  );
  const [aIdx, bIdx] = rotation.playing;
  const rosterA = useMemo(() => buildRoster(aIdx, teams, rotation, resolve), [aIdx, teams, rotation, resolve]);
  const rosterB = useMemo(() => buildRoster(bIdx, teams, rotation, resolve), [bIdx, teams, rotation, resolve]);
  const goals = live.goals ?? [];

  const addGoal = async (
    team: 'A' | 'B',
    scorerId: string | null,
    ownGoal?: boolean,
    assisterId?: string | null,
  ) => {
    setPickSide(null);
    setPendingAssist(null);
    if (busy) return;
    setBusy(true);
    try {
      await gameService.recordGoal(gameId, { team, scorerId, assisterId, ownGoal, minute });
    } finally {
      setBusy(false);
    }
  };
  const undo = async (goalId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await gameService.removeGoal(gameId, goalId);
    } finally {
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
      {/* Top row: team A (right) · timer (center) · team B (left). */}
      <View style={styles.row}>
        <ScoreSide
          label={teamName(aIdx)}
          score={live.scoreA}
          tint={teamColor(aIdx)}
          canEdit={canEdit}
          onAdd={() => setPickSide('A')}
        />

        <View style={styles.timerCol}>
          <Text style={[styles.timer, props.danger && styles.timerDanger]} numberOfLines={1}>
            {props.timerText}
          </Text>
          {props.totalMinutes ? (
            <Text style={styles.ofTotal}>
              {he.liveTimerOfTotal(props.totalMinutes)}
            </Text>
          ) : null}
          {props.overtimeText ? (
            <Text style={styles.overtime}>+{props.overtimeText}</Text>
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
          label={teamName(bIdx)}
          score={live.scoreB}
          tint={teamColor(bIdx)}
          canEdit={canEdit}
          onAdd={() => setPickSide('B')}
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
                    <Text style={styles.logMin}>{g.minute}'</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.logName} numberOfLines={1}>
                      {goalLabel(g)}
                    </Text>
                    <View
                      style={[styles.logDot, { backgroundColor: g.team === 'A' ? teamColor(aIdx) : teamColor(bIdx) }]}
                    />
                  </View>
                ))}
            </View>
          ) : null}
        </View>
      ) : null}

      <ScorerPicker
        visible={pickSide !== null}
        teamLabel={pickSide === 'A' ? teamName(aIdx) : teamName(bIdx)}
        roster={pickSide === 'A' ? rosterA : rosterB}
        onPick={(id) => {
          if (!pickSide) return;
          // Real scorer → ask who assisted (step 2). Unknown / own goal skip it.
          setPendingAssist({ side: pickSide, scorerId: id });
          setPickSide(null);
        }}
        onUnknown={() => pickSide && addGoal(pickSide, null)}
        onOwnGoal={() => pickSide && addGoal(pickSide, null, true)}
        onClose={() => setPickSide(null)}
      />

      <AssisterPicker
        visible={pendingAssist !== null}
        teamLabel={pendingAssist?.side === 'A' ? teamName(aIdx) : teamName(bIdx)}
        // The other players on the scorer's team — you can't assist your own goal.
        roster={(pendingAssist?.side === 'A' ? rosterA : rosterB).filter(
          (m) => m.id !== pendingAssist?.scorerId,
        )}
        onPick={(id) =>
          pendingAssist && addGoal(pendingAssist.side, pendingAssist.scorerId, false, id)
        }
        onNone={() =>
          pendingAssist && addGoal(pendingAssist.side, pendingAssist.scorerId, false, null)
        }
        onClose={() => setPendingAssist(null)}
      />
    </View>
  );
}

function ScoreSide({
  label,
  score,
  tint,
  canEdit,
  onAdd,
}: {
  label: string;
  score: number;
  tint: string;
  canEdit: boolean;
  onAdd: () => void;
}) {
  return (
    <View style={styles.side}>
      <Text style={[styles.sideName, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.sideScore, { color: tint }]}>{score}</Text>
      {canEdit ? (
        <Pressable
          style={[styles.addBtn, { backgroundColor: tint }]}
          onPress={onAdd}
          accessibilityRole="button"
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

function ScorerPicker({
  visible,
  teamLabel,
  roster,
  onPick,
  onUnknown,
  onOwnGoal,
  onClose,
}: {
  visible: boolean;
  teamLabel: string;
  roster: RosterMember[];
  onPick: (id: string) => void;
  onUnknown: () => void;
  onOwnGoal: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{he.goalScorerPickTitle(teamLabel)}</Text>
          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
            {roster.map((m) => (
              <Pressable key={m.id} style={styles.scorerRow} onPress={() => onPick(m.id)}>
                <UserAvatar user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }} size={34} />
                <Text style={styles.scorerName} numberOfLines={1}>
                  {m.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.specialRow}>
            <Pressable style={styles.specialBtn} onPress={onUnknown}>
              <Text style={styles.specialTxt}>{he.goalUnknownScorer}</Text>
            </Pressable>
            <Pressable style={styles.specialBtn} onPress={onOwnGoal}>
              <Text style={styles.specialTxt}>{he.goalOwnGoal}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelTxt}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Step 2 of goal entry — "who assisted?". Shows the scorer's teammates plus a
 *  "no one" option (a goal can have no assist). Reuses the scorer-picker chrome. */
function AssisterPicker({
  visible,
  teamLabel,
  roster,
  onPick,
  onNone,
  onClose,
}: {
  visible: boolean;
  teamLabel: string;
  roster: RosterMember[];
  onPick: (id: string) => void;
  onNone: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>{he.goalAssistPickTitle(teamLabel)}</Text>
          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
            {roster.map((m) => (
              <Pressable key={m.id} style={styles.scorerRow} onPress={() => onPick(m.id)}>
                <UserAvatar user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }} size={34} />
                <Text style={styles.scorerName} numberOfLines={1}>
                  {m.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.specialRow}>
            <Pressable style={styles.specialBtn} onPress={onNone}>
              <Text style={styles.specialTxt}>{he.goalAssistNone}</Text>
            </Pressable>
          </View>
          <Pressable style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelTxt}>{he.cancel}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
    shadowColor: '#0B1220',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  // ── Team score side ──
  side: { flex: 1, alignItems: 'center', gap: 4 },
  sideName: { ...typography.bodyBold, fontWeight: '800', textAlign: 'center' },
  sideScore: { fontSize: 40, fontWeight: '900', lineHeight: 44 },
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
