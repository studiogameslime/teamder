// RadiusSelector — pill row for choosing the "near me" search radius.
// Shared by the games + communities filter sheets. Matches the radius
// pills on the availability screen ([10,20,30,50,100] km) for consistency.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export const RADIUS_OPTIONS = [10, 20, 30, 50, 100];

export function RadiusSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (km: number) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{he.filterRadiusLabel(value)}</Text>
      <View style={styles.row}>
        {RADIUS_OPTIONS.map((km) => {
          const active = value === km;
          return (
            <Pressable
              key={km}
              onPress={() => onChange(km)}
              style={({ pressed }) => [
                styles.pill,
                active && styles.pillActive,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>
                {he.filterRadiusKm(km)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, paddingTop: spacing.xs },
  label: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 48,
    alignItems: 'center',
  },
  pillActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  pillText: { ...typography.body, color: colors.textMuted },
  pillTextActive: { color: colors.primary, fontWeight: '700' },
});
