// SeasonsCard — where the club's season STANDS. Nothing is managed here.
//
// It used to carry the admin controls too, reached through a chain of alert
// dialogs. That was the quick path and the wrong one: turning seasons on is a
// setting, and a setting belongs in the club's settings beside every other
// switch — which is where it lives now (SeasonsSettings). Ending a season went
// with it, so an admin has one place to manage seasons instead of two.
//
// What is left is the part everyone needs: which season it is, when it ends,
// and the way into my own summary.

import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Button } from '@/components/Button';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function SeasonsCard({
  groupId,
  seasons,
}: {
  groupId: string;
  seasons?: GroupSeasons;
}) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const openMySummary = useCallback(() => {
    nav.navigate('SeasonSummary', { groupId });
  }, [nav, groupId]);
  const openHistory = useCallback(() => {
    nav.navigate('SeasonHistory', { groupId });
  }, [nav, groupId]);

  // A club that does not run seasons has nothing to say here — not even to an
  // admin, who meets the switch in settings where they went looking for it.
  if (seasons?.enabled !== true) return null;

  const cadence = seasons.cadence;
  const line =
    cadence?.type === 'rounds' && typeof cadence.targetRounds === 'number'
      ? he.seasonsTargetRounds(cadence.targetRounds)
      : typeof cadence?.endsAt === 'number'
        ? he.seasonsTargetDate(formatDate(cadence.endsAt))
        : '';

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {he.seasonsCardTitle} · {he.seasonNumberLabel(seasons.currentNo ?? 1)}
      </Text>
      {line ? <Text style={styles.note}>{line}</Text> : null}
      <Button
        title={he.seasonsMySummaryCta}
        variant="outline"
        fullWidth
        onPress={openMySummary}
      />
      {/* Only once there is history to look at — a club in its first season
          would otherwise be offered an empty room. */}
      {(seasons.count ?? 0) > 0 ? (
        <Button
          title={he.seasonHistoryCta}
          variant="outline"
          fullWidth
          onPress={openHistory}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { ...typography.h3, color: colors.text, textAlign: RTL_LABEL_ALIGN },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
