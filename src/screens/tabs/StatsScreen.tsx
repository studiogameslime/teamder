import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGameStore } from '@/store/gameStore';

export function StatsScreen() {
  const user = useUserStore((s) => s.currentUser);
  const players = useGameStore((s) => s.players);
  if (!user) return null;
  const player = players[user.id];
  const stats = player?.stats;

  // In Firebase mode, fresh users have no stats document yet — render an
  // empty state instead of an all-zeros grid that looks broken.
  const hasData =
    !!stats &&
    (stats.gamesPlayed > 0 || stats.wins > 0 || stats.attendancePct > 0);

  const winPct = stats
    ? Math.round((stats.wins / Math.max(1, stats.gamesPlayed)) * 100)
    : 0;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.statsGames} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PlayerIdentity user={user} size={72} />
          <Text style={styles.name}>{user.name}</Text>
        </View>

        {!hasData ? (
          <View style={styles.empty}>
            <Ionicons name="stats-chart-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{he.statsEmpty}</Text>
            <Text style={styles.emptySub}>{he.statsEmptySub}</Text>
          </View>
        ) : (
          <>
            <View style={styles.grid}>
              <StatCell value={stats!.gamesPlayed} label={he.statsGames} />
              <StatCell value={stats!.wins} label={he.statsWins} />
              <StatCell value={`${winPct}%`} label={he.statsWinPct} highlight />
            </View>
            <View style={styles.grid}>
              <StatCell value={stats!.losses} label={he.statsLosses} />
              <StatCell value={stats!.ties} label={he.statsTies} />
              <StatCell
                value={`${stats!.attendancePct}%`}
                label={he.statsAttendance}
                highlight
              />
            </View>
            <View style={styles.grid}>
              <StatCell value={`${stats!.cancelRate}%`} label={he.statsCancelRate} />
              <View style={{ flex: 1 }} />
              <View style={{ flex: 1 }} />
            </View>
          </>
        )}

        <View style={{ marginTop: spacing.lg }}>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCell({
  value,
  label,
  highlight,
}: {
  value: number | string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <Card
      style={
        highlight
          ? {
              ...styles.cell,
              backgroundColor: colors.primaryLight,
              borderColor: colors.primary,
            }
          : styles.cell
      }
    >
      <Text style={[styles.cellValue, highlight && { color: colors.primary }]}>
        {value}
      </Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  name: { ...typography.h2, color: colors.text },
  grid: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: radius.lg,
  },
  cellValue: { ...typography.h2, color: colors.text },
  cellLabel: { ...typography.caption, color: colors.textMuted },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: { ...typography.h3, color: colors.text, marginTop: spacing.sm },
  emptySub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
});
