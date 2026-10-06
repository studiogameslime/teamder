// HomeAvailabilityPanel — the week's availability and the opening
// recommendation, in ONE card.
//
// This replaces two stacked cards that were saying the same thing twice: a
// banner announcing "the recommended day to open a round is Wednesday", and
// directly beneath it a podium of three days in which Wednesday already wore
// a star. One fact, stated once, is the whole point of the merge.
//
// ── What belongs to this file and what does not ────────────────────────────
// Nothing here is computed. The three days, their headcounts, the bar
// denominator and the recommendation all arrive decided from
// `buildAvailabilityView`. This file chooses colours and order of writing —
// and the order of writing IS the layout, which is why the RTL note below
// matters more than usual.
//
// ── RTL ────────────────────────────────────────────────────────────────────
// Under `I18nManager.forceRTL` the FIRST child of a row lands on the visual
// RIGHT, and `textAlign: RTL_LABEL_ALIGN` ('left') anchors text to the visual
// RIGHT. Nothing here uses `row-reverse`: under forceRTL that reverses an
// already-reversed row and puts everything back on the wrong side.
//
// The one rule worth stating out loud, because it is a hard requirement and
// not a preference: the recommended day KEEPS ITS PLACE IN THE WEEK. Its
// position comes from the date order `buildAvailabilityView` hands over;
// `best` changes nothing but colour and a badge. A card that jumped to one
// end whenever it became the busiest would make the row unreadable as a week.

import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { EveningDay, WindowDay } from '@/utils/homeAvailabilityView';

/** The floodlit night pitch — texture under the header wash, not a picture. */
const NIGHT_PITCH: ImageSourcePropType = require('../../assets/images/stadium-bg.png');

const R = 20;
const CARD_SHADOW = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14,
  elevation: 2,
} as const;

export function HomeAvailabilityPanel({
  days,
  maxCount,
  recommended,
  onShowWeek,
  onPickDay,
  onPressRecommended,
}: {
  /** In DATE order already. This component never re-sorts them. */
  days: WindowDay[];
  maxCount: number;
  /** Null when nobody is free — the recommendation block is then omitted. */
  recommended: EveningDay | null;
  onShowWeek: () => void;
  onPickDay: (dateMs: number) => void;
  onPressRecommended: () => void;
}) {
  return (
    <View style={styles.panel}>
      <ImageBackground
        source={NIGHT_PITCH}
        style={StyleSheet.absoluteFill}
        resizeMode="cover"
        imageStyle={styles.panelImg}
      />
      <LinearGradient
        colors={['#2563EB', '#4338CA', '#6D28D9']}
        start={{ x: 1, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Header. Title first → visual RIGHT, where a Hebrew reader starts;
          the calendar closes the row on the left. */}
      <View style={styles.header}>
        <View style={styles.headerTexts}>
          <Text
            style={styles.headerTitle}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {he.homeAvailPanelTitle}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {he.homeAvailPanelSub}
          </Text>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="calendar" size={21} color={colors.primary} />
        </View>
      </View>

      <View style={styles.inner}>
        {/* The recommendation, stated ONCE. Absent entirely when there is no
            recommendation — an invented one would be worse than none. */}
        {recommended ? (
          <Pressable
            onPress={onPressRecommended}
            style={({ pressed }) => [styles.recPlate, pressed && { opacity: 0.92 }]}
            accessibilityRole="button"
            accessibilityLabel={`${he.homeRecommendedTitle} ${he.homeRecommendedLine(
              recommended.letter,
              recommended.count,
            )}`}
          >
            <View style={styles.recTexts}>
              <Text style={styles.recLabel} numberOfLines={1}>
                {he.homeRecommendedTitleColon}
              </Text>
              <Text
                style={styles.recValue}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                {he.homeRecommendedLine(recommended.letter, recommended.count)}
              </Text>
            </View>
            <View style={styles.recFlame}>
              <Text style={styles.recFlameEmoji}>🔥</Text>
            </View>
          </Pressable>
        ) : null}

        {/* Bottom-aligned: the recommended card is taller by its badge, and
            the three should sit on one floor rather than one ceiling. */}
        <View style={styles.daysRow}>
          {days.map((d) => (
            <DayCard
              key={d.dateMs}
              day={d}
              maxCount={maxCount}
              onPress={() => onPickDay(d.dateMs)}
            />
          ))}
        </View>

        {/* Closes the card on the visual LEFT — where a Hebrew reader
            finishes. Text first → right, chevron after it → left. */}
        <Pressable
          onPress={onShowWeek}
          hitSlop={8}
          style={styles.showWeek}
          accessibilityRole="button"
          accessibilityLabel={he.homeWindowsShowWeek}
        >
          <Text style={styles.showWeekText}>{he.homeWindowsShowWeek}</Text>
          {/* `chevron-back` points LEFT, which is "onward" under RTL. */}
          <Ionicons name="chevron-back" size={14} color={colors.primary} />
        </Pressable>
      </View>
    </View>
  );
}

function DayCard({
  day,
  maxCount,
  onPress,
}: {
  day: WindowDay;
  maxCount: number;
  onPress: () => void;
}) {
  // A floor of 8% so a day with one lonely player still shows a sliver rather
  // than an empty track that reads as "no data".
  const pct = maxCount > 0 ? Math.max(0.08, day.count / maxCount) : 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.dayCard,
        day.best && styles.dayCardBest,
        pressed && { opacity: 0.9 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        `${he.homeDayLabel(day.letter)} — ${day.count} ${he.homeWindowsPlayersUnit}` +
        (day.best ? ` · ${he.homeAvailRecommendedBadge}` : '')
      }
    >
      {/* Inline, not absolutely positioned: a badge drawn outside its
          parent's bounds is not hit-tested on Android, and clipping it to the
          card would cost the overlap the design wants. Occupying real height
          also makes the recommended card taller, which is what sets it apart
          in a bottom-aligned row. */}
      {day.best ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{he.homeAvailRecommendedBadge}</Text>
          <Ionicons name="star" size={11} color="#FFFFFF" />
        </View>
      ) : null}

      <View style={styles.dayHead}>
        <Text
          style={[styles.dayLetter, day.best && styles.dayLetterBest]}
          numberOfLines={1}
        >
          {he.homeDayLabel(day.letter)}
        </Text>
        <Ionicons
          name="people-outline"
          size={13}
          color={day.best ? colors.primary : colors.textMuted}
        />
      </View>

      <Text
        style={[styles.dayCount, day.best && styles.dayCountBest]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {day.count}
      </Text>
      <Text style={styles.dayUnit} numberOfLines={1}>
        {he.homeWindowsPlayersUnit}
      </Text>

      {/* The fill is written FIRST so it grows from the visual RIGHT. */}
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { flex: pct }]} />
        <View style={{ flex: 1 - pct }} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: R,
    overflow: 'hidden',
    backgroundColor: colors.primary,
    padding: spacing.md,
    gap: spacing.md,
    ...CARD_SHADOW,
  },
  panelImg: { opacity: 0.32 },

  // ── header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  headerTexts: { flex: 1, minWidth: 0 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#FFFFFF',
    textAlign: RTL_LABEL_ALIGN,
    textShadowColor: 'rgba(5,16,40,0.45)',
    textShadowRadius: 6,
  },
  headerSub: {
    fontSize: 12.5,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.90)',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── white body ──
  inner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: spacing.sm,
    gap: spacing.sm,
  },

  // ── the recommendation, once ──
  recPlate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#EFF6FF',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  recTexts: { flex: 1, minWidth: 0 },
  recLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.primaryDark,
    textAlign: RTL_LABEL_ALIGN,
  },
  recValue: {
    fontSize: 16,
    fontWeight: '900',
    color: colors.primary,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
  },
  recFlame: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...CARD_SHADOW,
  },
  recFlameEmoji: { fontSize: 21 },

  // ── the three days ──
  daysRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' },
  dayCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: 2,
    borderWidth: 1.5,
    borderColor: '#EEF2F7',
  },
  dayCardBest: {
    backgroundColor: '#EFF6FF',
    borderColor: colors.primary,
    paddingTop: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    marginBottom: 2,
  },
  badgeText: { fontSize: 10.5, fontWeight: '900', color: '#FFFFFF' },

  dayHead: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dayLetter: { fontSize: 12, color: colors.textMuted, fontWeight: '800' },
  dayLetterBest: { color: colors.primary },
  dayCount: {
    fontSize: 27,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  dayCountBest: { color: colors.primary },
  dayUnit: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  barTrack: {
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
    alignSelf: 'stretch',
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  barFill: { backgroundColor: colors.primary, borderRadius: 3 },

  // `flex-end` on the cross axis is the visual LEFT under forceRTL.
  showWeek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  showWeekText: { fontSize: 13, color: colors.primary, fontWeight: '800' },
});
