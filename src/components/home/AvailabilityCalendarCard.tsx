// AvailabilityCalendarCard — home-screen "פנויים לשחק לידך" weekly heatmap.
//
// Shows, for today + the next 6 days, how many players are available in each
// time-window near the viewer (count only, never identities). Tapping a window
// starts a quick game for it. Fail-soft: if there's no data / no location, it
// renders a gentle prompt or nothing — it must never crash the home screen.

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import {
  availabilityFeedService,
  TIME_WINDOWS,
  type AvailabilityCounts,
} from '@/services/availabilityFeedService';
import type { TimeBucket } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const WINDOW_LABEL: Record<TimeBucket, string> = {
  morning: he.availabilityTimeMorning,
  noon: he.availabilityTimeNoon,
  evening: he.availabilityTimeEvening,
  night: he.availabilityTimeNight,
};

// Count → heat level (drives the cell colour).
function level(n: number): 0 | 1 | 2 | 3 | 4 {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n <= 4) return 2;
  if (n <= 7) return 3;
  return 4;
}

function dayLabel(dateMs: number, isToday: boolean): { top: string; date: string } {
  const d = new Date(dateMs);
  const letter = he.availabilityDayLetter[d.getDay()] ?? '';
  const date = `${d.getDate()}.${d.getMonth() + 1}`;
  return { top: isToday ? `היום · ${letter}׳` : `${letter}׳`, date };
}

export function AvailabilityCalendarCard({
  onCreateGame,
  onSetAvailability,
}: {
  /** Start a quick game for a given day + window. */
  onCreateGame: (dateMs: number, window: TimeBucket) => void;
  /** Viewer hasn't set a home location yet → send them to the availability screen. */
  onSetAvailability: () => void;
}) {
  const [data, setData] = useState<AvailabilityCounts | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    availabilityFeedService
      .getAvailabilityCounts()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) return null; // never crash the home screen
  if (!data) return null; // still loading — no skeleton needed, it's below the fold

  // No location set → gentle prompt instead of an empty grid.
  if (!data.hasLocation) {
    return (
      <Card style={styles.promptCard}>
        <Text style={styles.promptTitle}>{he.availFeedPromptTitle}</Text>
        <Text style={styles.promptBody}>{he.availFeedPromptBody}</Text>
        <Pressable style={styles.promptBtn} onPress={onSetAvailability}>
          <Text style={styles.promptBtnText}>{he.availFeedPromptCta}</Text>
        </Pressable>
      </Card>
    );
  }

  // Hottest window across the week — drives the "הכי חם" call-to-action.
  let hero: { dateMs: number; window: TimeBucket; n: number } | null = null;
  for (const day of data.days) {
    for (const w of TIME_WINDOWS) {
      const n = day.windows[w];
      if (!hero || n > hero.n) hero = { dateMs: day.dateMs, window: w, n };
    }
  }

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{he.availFeedTitle}</Text>
        <View style={styles.radiusChip}>
          <Text style={styles.radiusText}>
            {he.availFeedRadius(data.radiusKm)}
          </Text>
        </View>
      </View>
      <Text style={styles.sub}>{he.availFeedSub}</Text>

      {/* Window column headers */}
      <View style={styles.gridHeader}>
        <View style={styles.dayCol} />
        {TIME_WINDOWS.map((w) => (
          <Text key={w} style={styles.wHead}>
            {WINDOW_LABEL[w]}
          </Text>
        ))}
      </View>

      {data.days.map((day) => {
        const dl = dayLabel(day.dateMs, day.isToday);
        return (
          <View
            key={day.dateMs}
            style={[styles.row, day.isToday && styles.rowToday]}
          >
            <View style={styles.dayCol}>
              <Text style={[styles.dayTop, day.isToday && styles.dayTopToday]}>
                {dl.top}
              </Text>
              <Text style={styles.dayDate}>{dl.date}</Text>
            </View>
            {TIME_WINDOWS.map((w) => {
              const n = day.windows[w];
              const lv = level(n);
              return (
                <Pressable
                  key={w}
                  style={[styles.cell, CELL_STYLE[lv]]}
                  onPress={() => onCreateGame(day.dateMs, w)}
                  accessibilityRole="button"
                  accessibilityLabel={`${dl.top} ${WINDOW_LABEL[w]} ${n}`}
                >
                  <Text style={[styles.cellNum, lv === 4 && styles.cellNumHot]}>
                    {n}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      {hero && hero.n > 0 ? (
        <View style={styles.hero}>
          <Text style={styles.heroText}>
            {he.availFeedHottest}{' '}
            <Text style={styles.heroBold}>
              {dayLabel(hero.dateMs, false).top} {WINDOW_LABEL[hero.window]} ·{' '}
              {hero.n}
            </Text>
          </Text>
          <Pressable
            style={styles.heroCta}
            onPress={() => onCreateGame(hero!.dateMs, hero!.window)}
          >
            <Text style={styles.heroCtaText}>{he.availFeedCreateCta}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.tapHint}>{he.availFeedTapHint}</Text>
    </Card>
  );
}

const CELL_STYLE = StyleSheet.create({
  0: { backgroundColor: '#F3F5FA' },
  1: { backgroundColor: '#EAF0FF' },
  2: { backgroundColor: '#D3E0FF' },
  3: { backgroundColor: '#A9C4FF' },
  4: { backgroundColor: colors.primary },
});

const styles = StyleSheet.create({
  card: { gap: 0, padding: spacing.md },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { ...typography.h3, color: colors.text, fontWeight: '900' },
  radiusChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  radiusText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  sub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  gridHeader: { flexDirection: 'row', gap: 6, marginBottom: 4 },
  dayCol: { width: 62, justifyContent: 'center' },
  wHead: {
    flex: 1,
    textAlign: 'center',
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'stretch',
    marginBottom: 6,
  },
  rowToday: {
    backgroundColor: '#F7F9FF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#DCE6FF',
    padding: 4,
    margin: -4,
    marginBottom: 2,
  },
  dayTop: {
    ...typography.caption,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  dayTopToday: { color: colors.primary },
  dayDate: {
    ...typography.caption,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  cell: {
    flex: 1,
    height: 40,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellNum: {
    ...typography.body,
    fontWeight: '900',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  cellNumHot: { color: '#FFFFFF' },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: '#EAF7EE',
    borderWidth: 1,
    borderColor: '#C7ECD3',
    borderRadius: 14,
    padding: spacing.sm,
  },
  heroText: { ...typography.body, color: colors.text, flexShrink: 1 },
  heroBold: { fontWeight: '900', color: '#15803D' },
  heroCta: {
    backgroundColor: '#16A34A',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  heroCtaText: { ...typography.body, color: '#fff', fontWeight: '800' },
  tapHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  promptCard: { gap: spacing.xs, padding: spacing.md, alignItems: 'flex-start' },
  promptTitle: { ...typography.h3, color: colors.text, fontWeight: '800' },
  promptBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  promptBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  promptBtnText: { ...typography.body, color: '#fff', fontWeight: '800' },
});
