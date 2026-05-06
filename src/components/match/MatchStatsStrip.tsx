// MatchStatsStrip — 4-column horizontal info row sitting under the
// hero. Each cell: small icon + value + tiny label.
//
// Cells: שחקנים (count/cap) · משך משחק · קהילה · מזג אוויר.
// Weather cell flips to a moon icon + blue tone for evening kickoffs
// (≥18:00 or <06:00) so a 20:00 game never shows a sun.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  registered: number;
  capacity: number;
  durationMinutes?: number;
  startsAt?: number;
  weather?: { tempC: number; rainProb: number };
}

export function MatchStatsStrip({
  registered,
  capacity,
  durationMinutes,
  startsAt,
  weather,
}: Props) {
  const isNight = isNightTime(startsAt);
  return (
    <View style={styles.row}>
      <Cell
        icon="people-outline"
        iconColor={ACCENT}
        value={`${registered}/${capacity}`}
        label={he.matchStatsPlayers}
      />
      <Divider />
      <Cell
        icon="time-outline"
        iconColor={ACCENT}
        value={
          typeof durationMinutes === 'number' && durationMinutes > 0
            ? `${durationMinutes} ${he.matchStatsMinutesShort}`
            : '—'
        }
        label={he.matchStatsDuration}
      />
      <Divider />
      <Cell
        icon={isNight ? 'moon' : 'partly-sunny-outline'}
        iconColor={isNight ? '#1E40AF' : ACCENT}
        value={weather ? `${weather.tempC}°` : '—'}
        label={he.matchStatsWeather}
      />
    </View>
  );
}

const ACCENT = '#3B82F6';

function Cell({
  icon,
  iconColor,
  value,
  label,
}: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  iconColor?: string;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.cell}>
      <Ionicons
        name={icon}
        size={22}
        color={iconColor ?? colors.textMuted}
      />
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function isNightTime(ms?: number): boolean {
  if (typeof ms !== 'number') return false;
  const h = new Date(ms).getHours();
  return h >= 18 || h < 6;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    // Stronger shadow — this card now floats over the stadium
    // hero. The depth needs to be visible against a busy photo
    // background, not just against the white body.
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 8,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 6,
  },
  value: {
    // Deep navy — pulled out of the theme to match the reference's
    // exact tint (slightly cooler than the default colors.text).
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    // Slate-500 — bluer than the default muted gray, matches the
    // reference labels under the cells.
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  // Very subtle vertical divider — present enough to read as a
  // grouping cue, faint enough to not look like a table row.
  divider: {
    width: 1,
    backgroundColor: 'rgba(15,23,42,0.06)',
    marginVertical: spacing.sm,
  },
  // Reserved alias kept for tests/snapshots.
  _label: { textAlign: RTL_LABEL_ALIGN },
});
