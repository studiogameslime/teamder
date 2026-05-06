// HeroStatsCard — dark navy floating stats strip that overlaps the
// bottom of the stadium hero. Five fixed columns:
//   משחקים · הופעות · שערים · ביטולים · הגעה %
//
// Each column = icon + bold number + small label. The dark
// background reads against the gradient finale of the hero, then
// gives way to the lighter content below.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  totalGames: number;
  attended: number;
  goals: number;
  attendancePct: number;
}

export function HeroStatsCard({
  totalGames,
  attended,
  goals,
  attendancePct,
}: Props) {
  return (
    <View style={styles.card}>
      <Cell
        icon="calendar-outline"
        iconColor="#FFFFFF"
        value={String(totalGames)}
        label={he.profileStatTotalGames}
      />
      <Divider />
      <Cell
        icon="trophy-outline"
        iconColor="#FFFFFF"
        value={String(attended)}
        label={he.profileStatAttended}
      />
      <Divider />
      <Cell
        icon="football-outline"
        iconColor="#FFFFFF"
        value={String(goals)}
        label={he.profileStatGoals}
      />
      <Divider />
      <Cell
        icon="checkmark-circle-outline"
        iconColor="#22C55E"
        value={`${attendancePct}%`}
        valueColor="#22C55E"
        label={he.profileStatAttendance}
      />
    </View>
  );
}

function Cell({
  icon,
  iconColor,
  value,
  valueColor,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  value: string;
  valueColor?: string;
  label: string;
}) {
  return (
    <View style={styles.cell}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <Text
        style={[styles.value, valueColor ? { color: valueColor } : null]}
        numberOfLines={1}
      >
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

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    backgroundColor: '#0F172A',
    borderRadius: 18,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.sm,
    // Slight shadow so the card lifts off the hero's dark base.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 6,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  value: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.65)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginVertical: spacing.xs,
  },
});
