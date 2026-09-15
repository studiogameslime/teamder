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
  // Somebody waiting for their join request can open the club screen, and
  // every collection behind these two buttons is bound to membership. Offering
  // them a door that answers "permission denied" is worse than not offering
  // one.
  isMember,
}: {
  groupId: string;
  seasons?: GroupSeasons;
  isMember: boolean;
}) {
  const nav = useNavigation<{ navigate: (s: string, p?: unknown) => void }>();
  const openMySummary = useCallback(() => {
    nav.navigate('SeasonSummary', { groupId });
  }, [nav, groupId]);
  const openHistory = useCallback(() => {
    nav.navigate('SeasonHistory', { groupId });
  }, [nav, groupId]);

  const closedSeasons = seasons?.count ?? 0;

  if (!isMember) return null;

  // Seasons off, but the club HAS closed some: the archives are untouched and
  // the titles in them are permanent, so the door to them stays. Switching the
  // feature off means "stop running a competition", not "erase the ones we
  // ran" — and without this the only way back to a club's own history was to
  // switch seasons on again.
  if (seasons?.enabled !== true) {
    if (closedSeasons === 0) return null;
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{he.seasonsCardTitle}</Text>
        <Text style={styles.note}>{he.seasonsOffButArchived}</Text>
        <Button
          title={he.seasonHistoryCta}
          variant="outline"
          fullWidth
          onPress={openHistory}
        />
      </View>
    );
  }

  const cadence = seasons.cadence;
  // Where the season has GOT to, not just where it ends. A constant sentence
  // reads the same on the first evening and the last, which is a label; a
  // season is supposed to build.
  const line =
    cadence?.type === 'rounds' && typeof cadence.targetRounds === 'number'
      ? he.seasonsProgressRounds(seasons.playedRounds ?? 0, cadence.targetRounds)
      : typeof cadence?.endsAt === 'number'
        ? he.seasonsTargetDate(formatDate(cadence.endsAt))
        : '';
  const daysLeft =
    cadence?.type !== 'rounds' && typeof cadence?.endsAt === 'number'
      ? Math.ceil((cadence.endsAt - Date.now()) / (24 * 60 * 60 * 1000))
      : null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {he.seasonsCardTitle} · {he.seasonNumberLabel(seasons.currentNo ?? 1)}
      </Text>
      {line ? <Text style={styles.note}>{line}</Text> : null}
      {daysLeft !== null ? (
        <Text style={styles.note}>{he.seasonsProgressDays(daysLeft)}</Text>
      ) : null}
      <Button
        title={he.seasonsMySummaryCta}
        variant="outline"
        fullWidth
        onPress={openMySummary}
      />
      {/* Only once there is history to look at — a club in its first season
          would otherwise be offered an empty room. */}
      {closedSeasons > 0 ? (
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
