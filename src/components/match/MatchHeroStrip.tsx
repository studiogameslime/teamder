// MatchHeroStrip — three-line summary block at the top of the
// MatchDetailsScreen.
//
// The strip is purely informational — actions live below in the
// PrimaryCTA + QuickActionsRow.
//
// Two design notes worth remembering:
//   • Weather chip is TIME-AWARE. Evening / night kickoffs (≥18:00
//     or <06:00) get the moon icon + blue tone; otherwise sunny.
//     A soccer-app weather chip showing a sun for an 8 PM game
//     looked broken.
//   • Status chip directly under the progress bar uses three tiers
//     based on capacity ratio so admins can scan readiness at a
//     glance: "חסרים N" (green) → "כמעט מלא" (yellow) → "מלא" (red).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  startsAt?: number;
  location?: string;
  onLocationPress?: () => void;
  registered: number;
  capacity: number;
  weather?: { tempC: number; rainProb: number };
}

export function MatchHeroStrip({
  startsAt,
  location,
  onLocationPress,
  registered,
  capacity,
  weather,
}: Props) {
  const ratio = capacity > 0 ? Math.min(1, registered / capacity) : 0;
  const isNight = isNightTime(startsAt);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Ionicons
          name="calendar-outline"
          size={16}
          color={colors.textMuted}
        />
        <Text style={styles.line} numberOfLines={1}>
          {startsAt ? formatWhen(startsAt) : '—'}
        </Text>
        {weather ? (
          <View
            style={[
              styles.weatherChip,
              isNight ? styles.weatherChipNight : styles.weatherChipDay,
            ]}
          >
            <Ionicons
              name={isNight ? 'moon-outline' : 'sunny-outline'}
              size={12}
              color={isNight ? NIGHT_FG : DAY_FG}
            />
            <Text
              style={[
                styles.weatherText,
                { color: isNight ? NIGHT_FG : DAY_FG },
              ]}
            >
              {weather.tempC}° · {weather.rainProb}%
            </Text>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={onLocationPress}
        disabled={!onLocationPress}
        style={({ pressed }) => [
          styles.row,
          onLocationPress && pressed && { opacity: 0.7 },
        ]}
        accessibilityRole={onLocationPress ? 'button' : undefined}
        accessibilityLabel={
          onLocationPress ? he.matchDetailsNavigateWaze : undefined
        }
      >
        <Ionicons
          name="location-outline"
          size={16}
          color={colors.textMuted}
        />
        <Text style={styles.line} numberOfLines={1}>
          {location && location.trim().length > 0
            ? location
            : he.matchHeroNoLocation}
        </Text>
        {onLocationPress ? (
          // Inline "ניווט עם Waze" affordance — replaces the
          // standalone Waze pill in the quick-actions row. Sits on
          // the leading edge so the location and the action read as
          // one unit.
          <View style={styles.wazeInline}>
            <Ionicons
              name="navigate-outline"
              size={14}
              color={colors.primary}
            />
            <Text style={styles.wazeInlineText}>
              {he.matchDetailsNavigateWaze}
            </Text>
          </View>
        ) : null}
      </Pressable>

      {/* Players count + thick rounded progress bar. */}
      <View style={styles.playersBlock}>
        <View style={styles.row}>
          <Ionicons
            name="people-outline"
            size={16}
            color={colors.textMuted}
          />
          <Text style={styles.line} numberOfLines={1}>
            {he.matchHeroPlayers(registered, capacity)}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round(ratio * 100)}%` },
              ratio >= 1
                ? styles.progressFull
                : ratio >= 0.8
                  ? styles.progressNearFull
                  : null,
            ]}
          />
        </View>
      </View>
    </View>
  );
}

function formatWhen(ms: number): string {
  const d = new Date(ms);
  const days = [
    'יום ראשון',
    'יום שני',
    'יום שלישי',
    'יום רביעי',
    'יום חמישי',
    'יום שישי',
    'שבת',
  ];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${day} · ${dd}.${mm} · ${hh}:${mn}`;
}

function isNightTime(startsAt?: number): boolean {
  if (typeof startsAt !== 'number') return false;
  const h = new Date(startsAt).getHours();
  // Treat 18:00–05:59 as evening / night for visual purposes.
  return h >= 18 || h < 6;
}

const NIGHT_FG = '#1E40AF';
const DAY_FG = colors.warning;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  line: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
    flex: 1,
  },
  weatherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  weatherChipDay: {
    backgroundColor: 'rgba(245,158,11,0.12)',
  },
  weatherChipNight: {
    backgroundColor: 'rgba(30,64,175,0.12)',
  },
  weatherText: {
    fontSize: 11,
    fontWeight: '700',
  },
  playersBlock: {
    gap: 6,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  progressNearFull: {
    backgroundColor: '#D97706',
  },
  progressFull: {
    backgroundColor: '#B91C1C',
  },
  // Inline Waze affordance on the location row.
  wazeInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
  },
  wazeInlineText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
});
