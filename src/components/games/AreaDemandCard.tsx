// AreaDemandCard — "ביקוש לכדורגל באזור שלך", shown on the matches tab when
// the open-games list is thin.
//
// The point: an empty list doesn't mean nobody wants to play — it means nobody
// has opened a match yet. This card turns declared availability into that
// signal, and hands the user the one action that resolves it (open a match) or
// the one that grows it (declare yourself available).
//
//   ┌─────────────────────────────────────────────┐
//   │ ביקוש לכדורגל באזור שלך        [רדיוס 25 ק״מ] │
//   │ ┌─────────────────────────────────────────┐ │
//   │ │ 🔥  12 שחקנים פנויים ביום חמישי בערב     │ │
//   │ │     נראה שיש פה מחזור שמחכה לקרות        │ │
//   │ │                    [ פתח מחזור לחמישי ]  │ │
//   │ └─────────────────────────────────────────┘ │
//   │ ┌─────────────────────────────────────────┐ │
//   │ │ ⚽  8 שחקנים מחפשים מחזור היום בערב       │ │
//   │ │                       [ גם אני פנוי ]    │ │
//   │ └─────────────────────────────────────────┘ │
//   └─────────────────────────────────────────────┘
//
// Data comes from `availabilityFeedService` → the `availabilityCounts`
// callable: for today + 6 days, how many opted-in players are free in each
// window within the viewer's radius and NOT already registered to a match.
// COUNTS ONLY — no identities ever leave the server.
//
// It never invents a number. Below `demandMin` available players the whole
// card renders nothing rather than dressing up "2 people are free" as demand,
// and a viewer with no home area gets an honest prompt instead of a grid.

import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/Card';
import {
  availabilityFeedService,
  type AvailabilityCounts,
} from '@/services/availabilityFeedService';
import { gamesFeedConfig } from '@/config/gamesFeedDiscovery';
import { rankSlots, type DemandSlot } from '@/utils/demandSlots';
import type { TimeBucket } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

const DAY_MS = 86_400_000;

/** "היום" / "מחר" / "יום חמישי" — for the headline. */
function dayPhrase(slot: DemandSlot, todayMs: number): string {
  if (slot.isToday) return he.gamesDemandDayToday;
  if (slot.dateMs - todayMs < 2 * DAY_MS) return he.gamesDemandDayTomorrow;
  return he.gamesDemandDayNamed(he.availabilityDayName[slot.weekday] ?? '');
}

/** "היום" / "מחר" / "חמישי" — the short form the CTA uses. */
function dayShort(slot: DemandSlot, todayMs: number): string {
  if (slot.isToday) return he.gamesDemandDayToday;
  if (slot.dateMs - todayMs < 2 * DAY_MS) return he.gamesDemandDayTomorrow;
  return he.availabilityDayName[slot.weekday] ?? '';
}

export function AreaDemandCard({
  onCreateGame,
  onSetAvailability,
}: {
  /** Open the quick-match wizard seeded with this day + window + the viewer's
   *  city, so the filler engine has somewhere to invite the free players from. */
  onCreateGame: (dateMs: number, window: TimeBucket, city: string | null) => void;
  /** Viewer has no home area yet, or wants to declare themselves free. */
  onSetAvailability: () => void;
}) {
  const [data, setData] = useState<AvailabilityCounts | null>(null);
  const [failed, setFailed] = useState(false);

  // Refetch on focus so returning from the availability editor (which calls
  // invalidate() on save) reflects immediately. The service's 15-minute cache
  // makes an unchanged refocus a no-op — no extra reads.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      availabilityFeedService
        .getAvailabilityCounts()
        .then((d) => alive && setData(d))
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }, []),
  );

  // Fail silently — this is supporting content, it must never take the
  // matches tab down with it or nag on a transient error.
  if (failed || !data || data.error) return null;

  // No home area → we genuinely can't compute demand. Offer the fix instead
  // of a fabricated number.
  if (!data.hasLocation) {
    return (
      <Card style={styles.promptCard}>
        <Text style={styles.promptTitle}>{he.gamesDemandPromptTitle}</Text>
        <Text style={styles.promptBody}>{he.gamesDemandPromptBody}</Text>
        <Pressable
          style={({ pressed }) => [styles.promptBtn, pressed && styles.pressed]}
          onPress={onSetAvailability}
          accessibilityRole="button"
          accessibilityLabel={he.gamesDemandPromptCta}
        >
          <Text style={styles.promptBtnText}>{he.gamesDemandPromptCta}</Text>
        </Pressable>
      </Card>
    );
  }

  const { demandMin } = gamesFeedConfig();
  const ranked = rankSlots(data, Date.now());
  const hero = ranked[0];
  // Not enough declared availability to call it demand — say nothing.
  if (!hero || hero.count < demandMin) return null;

  const todayMs = data.days[0]?.dateMs ?? hero.dateMs;
  // Second row: the busiest slot TODAY, when that isn't already the hero.
  // "There are people free tonight" is the most actionable version of this
  // signal, so it earns its own row when it exists.
  const today = ranked.find(
    (s) =>
      s.isToday &&
      s.count >= demandMin &&
      !(s.dateMs === hero.dateMs && s.window === hero.window),
  );

  const city = data.viewerCity ?? null;

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{he.gamesDemandTitle}</Text>
        <View style={styles.radiusChip}>
          <Text style={styles.radiusText}>
            {he.availFeedRadius(data.radiusKm)}
          </Text>
        </View>
      </View>

      {/* Hero row — the hottest window of the week. */}
      <View style={[styles.row, styles.rowHot]}>
        <View style={styles.rowHead}>
          <Text style={styles.rowEmoji}>🔥</Text>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>
              {he.gamesDemandFreeHeadline(
                hero.count,
                dayPhrase(hero, todayMs),
                he.gamesDemandWindowIn[hero.window],
              )}
            </Text>
            <Text style={styles.rowSub}>{he.gamesDemandHeroSub}</Text>
          </View>
        </View>
        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          onPress={() => onCreateGame(hero.dateMs, hero.window, city)}
          accessibilityRole="button"
          accessibilityLabel={he.gamesDemandOpenCta(dayShort(hero, todayMs))}
        >
          <Ionicons name="add-circle-outline" size={16} color="#FFFFFF" />
          <Text style={styles.ctaText}>
            {he.gamesDemandOpenCta(dayShort(hero, todayMs))}
          </Text>
        </Pressable>
      </View>

      {/* Today row — "people are looking for a match right now". */}
      {today ? (
        <View style={styles.row}>
          <View style={styles.rowHead}>
            <Text style={styles.rowEmoji}>⚽</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>
                {he.gamesDemandLookingHeadline(
                  today.count,
                  he.gamesDemandWindowIn[today.window],
                )}
              </Text>
            </View>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.ctaGhost,
              pressed && styles.pressed,
            ]}
            onPress={onSetAvailability}
            accessibilityRole="button"
            accessibilityLabel={he.gamesDemandImFreeCta}
          >
            <Text style={styles.ctaGhostText}>{he.gamesDemandImFreeCta}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.foot}>{he.gamesDemandFoot}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm },
  head: {
    flexDirection: 'row',
    // Top-aligned + a flexing title: the radius chip keeps its intrinsic
    // width and the title WRAPS beside it instead of being clipped mid-word
    // (which ate the "שלך" off the end).
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    flex: 1,
  },
  radiusChip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  radiusText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  row: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  rowHot: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
  },
  // Emoji + text sit on ONE row (emoji first → visually RIGHT under RTL).
  // The text column is a nested flex child so a long headline wraps inside
  // the column instead of stacking under the emoji.
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowEmoji: { fontSize: 20, lineHeight: 24 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  rowSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ctaText: { ...typography.body, color: '#FFFFFF', fontWeight: '800' },
  ctaGhost: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  ctaGhostText: { ...typography.body, color: colors.primary, fontWeight: '800' },
  foot: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  pressed: { opacity: 0.85 },
  promptCard: { padding: spacing.md, gap: spacing.xs, alignItems: 'flex-start' },
  promptTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  promptBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  promptBtn: {
    marginTop: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  promptBtnText: { ...typography.body, color: '#FFFFFF', fontWeight: '800' },
});
