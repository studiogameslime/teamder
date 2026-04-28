import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { PlayerIdentity } from './PlayerIdentity';
import { Player, TeamColor } from '@/types';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  color: TeamColor;
  players: Player[];
  isWaiting?: boolean;
  onConfigureGoalkeepers?: () => void;
}

const TITLE: Record<TeamColor, string> = {
  team1: he.team1,
  team2: he.team2,
  team3: he.team3,
};

const ACCENT: Record<TeamColor, { dot: string; bg: string; border: string }> = {
  team1: { dot: colors.team1, bg: colors.team1Bg, border: colors.team1 },
  team2: { dot: colors.team2, bg: colors.team2Bg, border: colors.team2 },
  team3: { dot: colors.team3, bg: colors.team3Bg, border: colors.team3 },
};

export function TeamCard({ color, players, isWaiting, onConfigureGoalkeepers }: Props) {
  const accent = ACCENT[color];
  return (
    <View style={[styles.card, { backgroundColor: accent.bg, borderColor: accent.border }]}>
      <View style={styles.header}>
        <View style={[styles.dot, { backgroundColor: accent.dot }]} />
        <Text style={styles.title}>
          {TITLE[color]}
          {isWaiting ? ` ${he.teamWaitingLabel}` : ''}
        </Text>
      </View>
      <View style={styles.players}>
        {players.map((p) => (
          <View key={p.id} style={styles.playerCol}>
            <PlayerIdentity
              user={{ id: p.id, name: p.displayName, jersey: p.jersey }}
              size={42}
            />
            <Text style={styles.playerName} numberOfLines={1}>
              {p.displayName}
            </Text>
          </View>
        ))}
      </View>
      {onConfigureGoalkeepers && (
        <Pressable onPress={onConfigureGoalkeepers} style={styles.gkBtn}>
          <Text style={styles.gkBtnText}>{he.goalkeeperOrder}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
  },
  title: {
    ...typography.h3,
    color: colors.text,
  },
  players: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  playerCol: {
    alignItems: 'center',
    width: '18%',
  },
  playerName: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  gkBtn: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  gkBtnText: {
    ...typography.label,
    color: colors.primary,
  },
});
