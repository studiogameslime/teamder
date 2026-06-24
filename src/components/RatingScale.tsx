// RatingScale — a 1..N tappable number scale (default 1..10), used for the
// internal admin rating and guest skill estimate. Reads as a "magnitude":
// every chip up to the selected value fills, so 7/10 looks like seven filled
// chips. Tapping the currently-selected value clears it back to 0 (unrated).

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, typography } from '@/theme';
import { selectionHaptic } from '@/utils/haptics';

interface Props {
  /** Currently selected value (0 = unrated). */
  value: number;
  onChange?: (next: number) => void;
  /** Top of the scale. Default 10. */
  max?: number;
  style?: ViewStyle;
  readonly?: boolean;
}

export function RatingScale({
  value,
  onChange,
  max = 10,
  style,
  readonly = false,
}: Props) {
  // Render in rows of 5 so a 1..10 scale reads as a clean 5+5 grid (rather than
  // an awkward flex-wrap). Each row keeps natural RTL order (1 on the right).
  const perRow = max > 6 ? 5 : max;
  const rows: number[][] = [];
  for (let i = 0; i < max; i += perRow) {
    rows.push(Array.from({ length: Math.min(perRow, max - i) }, (_, k) => i + k + 1));
  }
  return (
    <View style={[styles.wrap, style]} accessibilityRole="adjustable">
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row.map((n) => {
            const filled = n <= value;
            const isPeak = n === value;
            return (
              <Pressable
                key={n}
                disabled={readonly}
                onPress={() => {
                  selectionHaptic();
                  onChange?.(value === n ? 0 : n);
                }}
                hitSlop={4}
                style={({ pressed }) => [
                  styles.chip,
                  filled && styles.chipFilled,
                  isPeak && styles.chipPeak,
                  pressed && !readonly && { transform: [{ scale: 0.9 }] },
                ]}
              >
                <Text
                  style={[
                    styles.num,
                    filled && styles.numFilled,
                    isPeak && styles.numPeak,
                  ]}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipFilled: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  // The selected number gets the strongest emphasis.
  chipPeak: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  num: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '800',
  },
  numFilled: {
    color: colors.primary,
  },
  numPeak: {
    color: '#FFFFFF',
  },
});
