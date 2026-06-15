// RotationPanel — the live "winner stays" rotation surface on LiveMatchScreen.
// Shows the two teams playing now (full rosters, borrowed fillers flagged),
// the waiting queue, and admin actions: start, "who won?", reset. All the
// math lives in rotationEngine; this is presentational + callbacks.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { UserAvatar } from '@/components/UserAvatar';
import { rosterOf, canStart, type RotationTeam } from '@/services/rotationEngine';
import type { DraftTeamsResult, MatchRotation } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה'];
const teamName = (i: number) => `${he.rotationTeamWord} ${LETTERS[i] ?? i + 1}`;

type PlayerLite = { displayName?: string; avatarId?: string; photoUrl?: string };

interface Props {
  draftTeams?: DraftTeamsResult;
  rotation?: MatchRotation;
  perTeam: number;
  playersMap: Record<string, PlayerLite>;
  isAdmin: boolean;
  onStart: () => void;
  onWinner: (teamIndex: number) => void;
  onStop: () => void;
}

export function RotationPanel({
  draftTeams,
  rotation,
  perTeam,
  playersMap,
  isAdmin,
  onStart,
  onWinner,
  onStop,
}: Props) {
  if (!draftTeams || draftTeams.teams.length < 2) return null;

  const teams: RotationTeam[] = draftTeams.teams.map((t) => ({
    index: t.index,
    playerIds: t.playerIds,
  }));

  // ── Not started yet → start CTA (admin) ────────────────────────────────
  if (!rotation) {
    const startable = canStart(teams, perTeam);
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>{he.rotationTitle}</Text>
        <Text style={styles.subtitle}>{he.rotationStartHint}</Text>
        {isAdmin ? (
          <Pressable
            onPress={onStart}
            disabled={!startable}
            style={({ pressed }) => [
              styles.startBtn,
              pressed && { opacity: 0.9 },
              !startable && { opacity: 0.5 },
            ]}
          >
            <Ionicons name="play" size={20} color="#FFFFFF" />
            <Text style={styles.startBtnText}>{he.rotationStartCta}</Text>
          </Pressable>
        ) : null}
        {!startable ? (
          <Text style={styles.warn}>{he.rotationNotEnough}</Text>
        ) : null}
      </Card>
    );
  }

  const [aIdx, bIdx] = rotation.playing;
  const loanedInOf = (teamIdx: number) =>
    new Set(rotation.loans.filter((l) => l.filledTeam === teamIdx).map((l) => l.playerId));

  const renderTeam = (teamIdx: number) => {
    const roster = rosterOf(teamIdx, teams, rotation.loans);
    const loanedIn = loanedInOf(teamIdx);
    const wins = rotation.wins?.[String(teamIdx)] ?? 0;
    return (
      <View style={styles.teamCol}>
        <View style={styles.teamHead}>
          <Text style={styles.teamName}>{teamName(teamIdx)}</Text>
          {wins > 0 ? <Text style={styles.wins}>🏆 {wins}</Text> : null}
        </View>
        {roster.map((uid) => {
          const p = playersMap[uid];
          const borrowed = loanedIn.has(uid);
          return (
            <View key={uid} style={styles.playerRow}>
              <UserAvatar
                user={{ id: uid, name: p?.displayName ?? '…', avatarId: p?.avatarId, photoUrl: p?.photoUrl }}
                size={24}
              />
              <Text style={styles.playerName} numberOfLines={1}>
                {p?.displayName ?? '…'}
              </Text>
              {borrowed ? (
                <Ionicons
                  name={draftTeams.fillMode === 'permanent' ? 'lock-closed' : 'swap-horizontal'}
                  size={13}
                  color={colors.primary}
                />
              ) : null}
            </View>
          );
        })}
        {isAdmin ? (
          <Pressable
            onPress={() => onWinner(teamIdx)}
            style={({ pressed }) => [styles.winBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.winBtnText}>{he.rotationWonCta}</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  return (
    <Card style={styles.card}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{he.rotationPlayingNow}</Text>
        {isAdmin ? (
          <Pressable onPress={onStop} hitSlop={8}>
            <Text style={styles.reset}>{he.rotationReset}</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.teamsRow}>
        {renderTeam(aIdx)}
        <View style={styles.vs}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        {renderTeam(bIdx)}
      </View>

      {rotation.waiting.length > 0 ? (
        <View style={styles.waitingRow}>
          <Ionicons name="hourglass-outline" size={15} color={colors.textMuted} />
          <Text style={styles.waitingLabel}>{he.rotationWaiting}:</Text>
          <Text style={styles.waitingTeams}>
            {rotation.waiting.map((i) => teamName(i)).join(' · ')}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginHorizontal: spacing.lg, marginTop: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...typography.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  subtitle: { ...typography.caption, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  reset: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  teamsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  teamCol: { flex: 1, gap: 6 },
  teamHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  teamName: { ...typography.body, color: colors.primary, fontWeight: '800' },
  wins: { ...typography.caption, color: colors.text, fontWeight: '700' },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  playerName: { ...typography.caption, color: colors.text, flex: 1, textAlign: RTL_LABEL_ALIGN },
  vs: { paddingTop: 24 },
  vsText: { ...typography.caption, color: colors.textMuted, fontWeight: '800' },
  winBtn: {
    marginTop: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 8,
    alignItems: 'center',
  },
  winBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  waitingLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  waitingTeams: { ...typography.caption, color: colors.text, fontWeight: '700', flex: 1, textAlign: RTL_LABEL_ALIGN },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
  },
  startBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  warn: { ...typography.caption, color: colors.danger, textAlign: 'center' },
});
