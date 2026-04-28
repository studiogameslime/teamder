// Yellow + red card indicators. Two stacked rounded rectangles in the
// classic referee colors, with the count in white text. Pure View/Text.
//
// Sizes match the AchievementBadge style level:
//   sm — small inline indicator (alongside name)
//   md — Player Card section header
//   lg — single big card preview (unused for v1)

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, typography } from '@/theme';

const YELLOW = '#FACC15';
const RED = '#DC2626';

interface CardProps {
  type: 'yellow' | 'red';
  count: number;
  size?: number; // height in dp; width tracks ~0.7
  muted?: boolean; // gray-out when count is 0
}

export function CardIndicator({ type, count, size = 28, muted }: CardProps) {
  const bg = type === 'yellow' ? YELLOW : RED;
  const fg = type === 'yellow' ? '#1F2937' : '#FFF';
  const width = Math.round(size * 0.72);
  const fontSize = Math.max(10, size * 0.5);
  return (
    <View
      style={[
        styles.card,
        {
          width,
          height: size,
          backgroundColor: bg,
          borderRadius: Math.max(2, size * 0.12),
          opacity: muted ? 0.4 : 1,
        },
      ]}
    >
      <Text
        allowFontScaling={false}
        style={[styles.count, { color: fg, fontSize }]}
      >
        {count}
      </Text>
    </View>
  );
}

interface RowProps {
  yellowCards: number;
  redCards: number;
  size?: number;
  /** Hide cards entirely when count is 0 (instead of showing greyed-out). */
  hideEmpty?: boolean;
  style?: ViewStyle;
}

/**
 * Compact row of yellow + red counters. Default rendering greys out the
 * "0" cards so the slot is reserved; pass `hideEmpty` to suppress them
 * entirely (used inline next to a name when discipline shouldn't take
 * visual weight on a clean record).
 */
export function DisciplineCards({
  yellowCards,
  redCards,
  size = 28,
  hideEmpty,
  style,
}: RowProps) {
  if (hideEmpty && yellowCards === 0 && redCards === 0) return null;
  return (
    <View style={[styles.row, style]}>
      {!hideEmpty || yellowCards > 0 ? (
        <CardIndicator
          type="yellow"
          count={yellowCards}
          size={size}
          muted={yellowCards === 0}
        />
      ) : null}
      {!hideEmpty || redCards > 0 ? (
        <CardIndicator
          type="red"
          count={redCards}
          size={size}
          muted={redCards === 0}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  card: {
    alignItems: 'center',
    justifyContent: 'center',
    // subtle inner shadow line via border for definition on light bg
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  count: {
    ...typography.caption,
    fontWeight: '900',
    includeFontPadding: false,
  },
});
