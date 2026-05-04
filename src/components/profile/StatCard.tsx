// StatCard — single tile in the profile stats grid.
// Compact, equal-size, soft shadow. Centered number + label.

import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';

interface Props {
  label: string;
  value: string;
  /** Optional accent colour for the value (e.g. green for positive
   *  attendance, red for high cancel rate). Defaults to text colour. */
  tint?: string;
  /** Optional small icon shown next to the value (subtle, not big). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom outer style — caller controls flex/width in the grid. */
  style?: ViewStyle;
}

export function StatCard({ label, value, tint, icon, style }: Props) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.valueRow}>
        {icon ? (
          <Ionicons
            name={icon}
            size={14}
            color={tint ?? colors.textMuted}
            style={styles.icon}
          />
        ) : null}
        <Text style={[styles.value, tint ? { color: tint } : null]}>
          {value}
        </Text>
      </View>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    // Soft, not-heavy shadow.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  icon: {
    marginTop: 1,
  },
  value: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
