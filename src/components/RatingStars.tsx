// RatingStars — 5-star tappable rating row.
//
// Used by RatingModal and any future "rate the player" surface. Stars
// fill from the start (right in RTL), with an optional "tap an active
// star to clear" affordance: tapping the same star that's already at
// the top of the filled range resets to 0.
//
// Visual: large gold-yellow filled stars (`colors.warning`) when active,
// muted outlines otherwise. Centered horizontally so it sits below the
// player avatar like the reference design.

import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing } from '@/theme';

interface Props {
  /** Currently selected count (0..5). */
  value: number;
  onChange?: (next: number) => void;
  size?: number;
  style?: ViewStyle;
  /** When true the stars become read-only (no callbacks fire). */
  readonly?: boolean;
}

export function RatingStars({
  value,
  onChange,
  size = 40,
  style,
  readonly = false,
}: Props) {
  return (
    <View style={[styles.row, style]} accessibilityRole="adjustable">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= value;
        return (
          <Pressable
            key={n}
            disabled={readonly}
            onPress={() => onChange?.(value === n ? 0 : n)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.cell,
              pressed && !readonly && { transform: [{ scale: 0.92 }] },
            ]}
          >
            <Ionicons
              name={filled ? 'star' : 'star-outline'}
              size={size}
              color={filled ? colors.warning : colors.border}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  cell: {
    padding: 2,
  },
});
