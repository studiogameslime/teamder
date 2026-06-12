// StatsScreen — secondary stats surface.
//
// History: round-winner stats (wins/losses/win%) died with the timer-only
// pivot (2026-05-27); attendance/games stats on the player doc are never
// written either. As of 2026-06-12 this surface shows REAL counts: games
// played (live — was in the drawn teams + game passed), clubs, and friends.

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Card } from '@/components/Card';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { gameService } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

export function StatsScreen() {
  const user = useUserStore((s) => s.currentUser);
  const clubs = useGroupStore((s) => s.groups).length;
  const [playedCount, setPlayedCount] = useState<number | null>(null);

  useEffect(() => {
    logEvent(AnalyticsEvent.StatsOpened);
  }, []);

  const uid = user?.id;
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    gameService
      .getPlayedGames(uid)
      .then((list) => {
        if (alive) setPlayedCount(list.length);
      })
      .catch(() => {
        if (alive) setPlayedCount(0);
      });
    return () => {
      alive = false;
    };
  }, [uid]);

  if (!user) return null;

  const friends = user.friends?.length ?? 0;
  const gamesPlayed = playedCount ?? 0;
  // Loading until the live count lands; then show data when anything is
  // non-zero, else the empty state.
  const hasData = playedCount !== null && (gamesPlayed > 0 || clubs > 0 || friends > 0);

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
            <StatCell value={gamesPlayed} label={he.statsGames} highlight />
            <StatCell value={clubs} label={he.profileStatClubs} />
            <StatCell value={friends} label={he.profileStatFriends} />
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
