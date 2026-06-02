// StatsScreen — secondary stats surface.
//
// Originally rendered wins/losses/ties/win% on top of attendance metrics.
// After the live-match pivot to timer-only (2026-05-27) the round-winner
// model no longer exists, so `Player.stats.wins/losses/ties` is never
// written and the win% always rendered 0%/0%. Those cells were removed
// (2026-05-29) — what's left is the small set that's actually populated:
// games played, attendance %, cancel rate.

import React, { useEffect } from 'react';
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
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

export function StatsScreen() {
  const user = useUserStore((s) => s.currentUser);
  const players = useGameStore((s) => s.players);
  useEffect(() => {
    logEvent(AnalyticsEvent.StatsOpened);
  }, []);
  if (!user) return null;
  const player = players[user.id];
  const stats = player?.stats;

  // In Firebase mode, fresh users have no stats document yet — render an
  // empty state instead of a zeroes grid that looks broken.
  const hasData =
    !!stats && (stats.gamesPlayed > 0 || stats.attendancePct > 0);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.statsTitle} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <PlayerIdentity user={user} size={72} />
          <Text style={styles.name}>{user.name}</Text>
        </View>

        {!hasData ? (
          <View style={styles.empty}>
            <Ionicons name="stats-chart-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>{he.statsEmpty}</Text>
            <Text style={styles.emptySub}>{he.statsEmptySub}</Text>
          </View>
        ) : (
          <View style={styles.grid}>
            <StatCell value={stats!.gamesPlayed} label={he.statsGames} />
            <StatCell
              value={`${stats!.attendancePct}%`}
              label={he.statsAttendance}
              highlight
            />
            <StatCell value={`${stats!.cancelRate}%`} label={he.statsCancelRate} />
          </View>
        )}
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
