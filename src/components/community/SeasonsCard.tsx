// SeasonsCard — where the club's season STANDS. Nothing is managed here.
//
// It used to carry the admin controls too, reached through a chain of alert
// dialogs. That was the quick path and the wrong one: turning seasons on is a
// setting, and a setting belongs in the club's settings beside every other
// switch — which is where it lives now (SeasonsSettings). Ending a season went
// with it, so an admin has one place to manage seasons instead of two.
//
// What is left is the part everyone needs: which season it is and where it has
// got to. A personal summary is NOT here — it belongs to a season that ended,
// and by the time one has, the club is already playing the next. It lives in
// the club's stats screen instead, under the finished season it describes.

import React, { useCallback } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/Button';
import { InfoTip } from '@/components/InfoTip';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { isCalendarDate, formatCalendarDate } from '@/utils/seasonDates';
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
          size="lg"
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
      ? // Only what is LEFT. The headline below carries "12 מתוך 22 מחזורים"
        // now, and the old sentence said the same thing again in grey.
        he.seasonsCardRemaining(
          Math.max(0, cadence.targetRounds - (seasons.playedRounds ?? 0)),
        )
      : // The CALENDAR end first. A season opened while carrying a club's
        // history on has its deadline only here — `endsAt` is null for it — so
        // reading the epoch alone left those clubs with no date at all.
        isCalendarDate(cadence?.endsOn)
        ? he.seasonsTargetDate(formatCalendarDate(cadence!.endsOn as string))
        : typeof cadence?.endsAt === 'number'
        ? he.seasonsTargetDate(formatDate(cadence.endsAt))
        : '';
  // Days left, from EITHER boundary.
  //
  // This read `endsAt` alone, and a season opened while carrying a club's
  // history has `endsAt: null` and only `endsOn` — so the clubs most likely to
  // be watching a deadline were the ones shown none. Six lines above, the
  // sentence already knows this; the countdown did not.
  const daysLeft = (() => {
    if (cadence?.type === 'rounds') return null;
    if (isCalendarDate(cadence?.endsOn)) {
      return daysUntil(cadence!.endsOn as string);
    }
    if (typeof cadence?.endsAt === 'number') {
      return Math.ceil((cadence.endsAt - Date.now()) / (24 * 60 * 60 * 1000));
    }
    return null;
  })();

  /** How far through, 0–1. A season is a competition with a finish line, and
   *  the card said so in words only — there was no way to glance at it and
   *  know whether the club was at the start or one evening from the end. */
  const progress = (() => {
    if (cadence?.type === 'rounds' && typeof cadence.targetRounds === 'number') {
      const t = cadence.targetRounds;
      return t > 0 ? Math.min(1, Math.max(0, (seasons.playedRounds ?? 0) / t)) : null;
    }
    const started = seasons.startedAt ?? 0;
    if (daysLeft === null || !started) return null;
    const total = Math.round((Date.now() - started) / 86_400_000) + Math.max(0, daysLeft);
    return total > 0 ? Math.min(1, Math.max(0, 1 - Math.max(0, daysLeft) / total)) : null;
  })();

  const rounds =
    cadence?.type === 'rounds' && typeof cadence.targetRounds === 'number';

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Ionicons name="trophy" size={18} color={colors.primary} />
        <Text style={styles.title}>
          {he.seasonsCardTitle} · {he.seasonNumberLabel(seasons.currentNo ?? 1)}
        </Text>
        {/* The number nobody could interpret — the owner watched "22 מתוך 22"
            while the archive recorded 19 — with no way to ask what a מחזור is
            or what happens at the end. InfoTip has been in the repo the whole
            time and this feature used it nowhere. */}
        <InfoTip title={he.seasonsCardTitle} text={he.seasonsCardInfo} />
      </View>

      {/* The headline is the PROGRESS, not the word "עונות". Everything here
          used to be the same grey caption at the same 4px rhythm, so the most
          important number on the card was also its faintest. */}
      {rounds ? (
        <View style={styles.bigRow}>
          <Text style={styles.big}>{seasons.playedRounds ?? 0}</Text>
          <Text style={styles.bigOf}>
            {he.seasonsCardOfTarget(cadence!.targetRounds as number)}
          </Text>
        </View>
      ) : null}

      {progress !== null ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%` },
              progress >= 1 ? styles.fillDone : null,
            ]}
          />
        </View>
      ) : null}

      {line ? <Text style={styles.note}>{line}</Text> : null}
      {daysLeft !== null ? (
        <Text style={styles.note}>{he.seasonsProgressDays(daysLeft)}</Text>
      ) : null}

      {/* Only once there is history to look at — a club in its first season
          would otherwise be offered an empty room. */}
      {closedSeasons > 0 ? (
        <Button
          title={he.seasonHistoryCta}
          variant="outline"
          fullWidth
          iconLeft="time-outline"
          onPress={openHistory}
        />
      ) : null}
    </View>
  );
}

/** Whole days from today to a calendar date, in the club's own calendar. */
function daysUntil(endsOn: string): number {
  const [y, m, d] = endsOn.split('-').map(Number);
  const end = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    // The app's own token and the app's own shadow. This drew #FFFFFF on the
    // screen's #F9FAFB with no border and no elevation — a 1.05:1 difference,
    // so the card had no edge at all and its contents read as loose text on
    // the page. Every neighbouring surface goes through these two.
    borderRadius: radius.xl,
    ...shadows.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  // The progress, at the size a headline deserves.
  bigRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  big: {
    ...typography.h1,
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  bigOf: { ...typography.body, color: colors.textMuted },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  /** At the finish line it stops being progress and becomes a result. */
  fillDone: { backgroundColor: colors.success },
  note: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
});
