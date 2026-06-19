// GoalEntryCard — admin-only live goal entry for the advanced (rotation) match.
//
// Shows the two on-pitch teams with their live score and a "⚽ שער" button
// under each. Tapping opens a scorer picker (that team's roster + "לא ידוע" +
// "שער עצמי"). Each goal stamps the current match minute behind the scenes.
// A goal log underneath lets the admin undo any goal. All writes go through
// gameService (recordGoal / removeGoal); the score is derived server-side and
// fans out to every device via the live listener.

import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import {
  buildRoster,
  makeResolver,
  teamName,
  type PlayerLite,
  type RosterMember,
} from '@/components/match/rotationView';
import { gameService } from '@/services/gameService';
import type { DraftTeamsResult, GameGuest, LiveMatchState, MatchRotation } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
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
}

export function GoalEntryCard({ gameId, live, draftTeams, rotation, playersMap, guests, minute }: Props) {
  const [pickSide, setPickSide] = useState<'A' | 'B' | null>(null);
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

  const addGoal = async (team: 'A' | 'B', scorerId: string | null, ownGoal?: boolean) => {
    setPickSide(null);
    if (busy) return;
    setBusy(true);
    try {
      await gameService.recordGoal(gameId, { team, scorerId, ownGoal, minute });
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
    return resolve(g.scorerId).displayName ?? '…';
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{he.goalSectionTitle}</Text>

      {/* Live score + per-team goal buttons */}
      <View style={styles.scoreRow}>
        <TeamGoalSide
          name={teamName(aIdx)}
          score={live.scoreA}
          tint={colors.team1}
          onAdd={() => setPickSide('A')}
        />
        <Text style={styles.dash}>—</Text>
        <TeamGoalSide
          name={teamName(bIdx)}
          score={live.scoreB}
          tint={colors.team2}
          onAdd={() => setPickSide('B')}
        />
      </View>

      {/* Goal log */}
      {goals.length > 0 ? (
        <View style={styles.log}>
          {goals
            .slice()
            .reverse()
            .map((g) => (
              <View key={g.id} style={styles.logRow}>
                <Pressable onPress={() => undo(g.id)} hitSlop={8} style={styles.undoBtn}>
                  <Ionicons name="close" size={15} color={colors.textMuted} />
                </Pressable>
                <View style={[styles.logDot, { backgroundColor: g.team === 'A' ? colors.team1 : colors.team2 }]} />
                <Text style={styles.logName} numberOfLines={1}>
                  {goalLabel(g)}
                </Text>
                <Text style={styles.logMin}>{g.minute}'</Text>
              </View>
            ))}
        </View>
      ) : (
        <Text style={styles.empty}>{he.goalLogEmpty}</Text>
      )}

      {/* Scorer picker */}
      <ScorerPicker
        visible={pickSide !== null}
        teamLabel={pickSide === 'A' ? teamName(aIdx) : teamName(bIdx)}
        roster={pickSide === 'A' ? rosterA : rosterB}
        onPick={(id) => pickSide && addGoal(pickSide, id)}
        onUnknown={() => pickSide && addGoal(pickSide, null)}
        onOwnGoal={() => pickSide && addGoal(pickSide, null, true)}
        onClose={() => setPickSide(null)}
      />
    </View>
  );
}

function TeamGoalSide({
  name,
  score,
  tint,
  onAdd,
}: {
  name: string;
  score: number;
  tint: string;
  onAdd: () => void;
}) {
  return (
    <View style={styles.side}>
      <Text style={styles.sideName} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[styles.sideScore, { color: tint }]}>{score}</Text>
      <Pressable style={[styles.goalBtn, { backgroundColor: tint }]} onPress={onAdd} accessibilityRole="button">
        <Ionicons name="football" size={16} color="#FFFFFF" />
        <Text style={styles.goalBtnTxt} numberOfLines={1}>
          {he.goalAdd}
        </Text>
      </Pressable>
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
                <Ionicons name="football-outline" size={18} color={colors.primary} />
                <Text style={styles.scorerName} numberOfLines={1}>
                  {m.name}
                </Text>
                <UserAvatar user={{ id: m.id, name: m.name, avatarId: m.avatarId, photoUrl: m.photoUrl }} size={34} />
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

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  title: { ...typography.bodyBold, color: colors.text, textAlign: 'center' },
  scoreRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: spacing.md },
  dash: { ...typography.h1, color: colors.textMuted, marginTop: 18 },
  side: { flex: 1, alignItems: 'center', gap: 4 },
  sideName: { ...typography.caption, color: colors.textMuted, fontWeight: '700', textAlign: 'center' },
  sideScore: { fontSize: 40, fontWeight: '900', lineHeight: 46 },
  goalBtn: {
    alignSelf: 'stretch',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.md,
    marginTop: 4,
  },
  goalBtnTxt: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  log: { gap: 6, marginTop: 4 },
  logRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  undoBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logDot: { width: 9, height: 9, borderRadius: 5 },
  logName: { flex: 1, ...typography.body, color: colors.text, textAlign: 'right' },
  logMin: { ...typography.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  empty: { ...typography.caption, color: colors.textMuted, textAlign: 'center', paddingVertical: 4 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  sheet: { width: '100%', maxWidth: 380, backgroundColor: colors.bg, borderRadius: 24, padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { ...typography.h2, color: colors.text, fontWeight: '800', textAlign: 'center', marginBottom: spacing.xs },
  scorerRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  scorerName: { flex: 1, ...typography.body, color: colors.text, textAlign: 'right', fontWeight: '600' },
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
