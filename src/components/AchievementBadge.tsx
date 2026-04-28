// AchievementBadge — medal-style icon with title underneath.
//
// Visual: outer ring (lighter tint), inner disk (full tint), centered
// glyph, soft drop shadow on unlocked. Locked state is faded but keeps
// the ring + outline so the slot still reads as "achievement".

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import type { AchievementDef } from '@/data/achievements';

interface Props {
  def: AchievementDef;
  unlocked: boolean;
  /** Outer-ring diameter in dp. Default 72. */
  size?: number;
  onPress?: () => void;
  style?: ViewStyle;
}

export function AchievementBadge({
  def,
  unlocked,
  size = 72,
  onPress,
  style,
}: Props) {
  const tint = def.tint;
  // Inner disk is ~78% of the outer ring, leaving a colored halo.
  const inner = Math.round(size * 0.78);
  const iconSize = Math.round(size * 0.42);

  const ringStyle = unlocked
    ? {
        backgroundColor: tintWithAlpha(tint, 0.18),
        borderColor: tint,
      }
    : {
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
      };

  const diskStyle = unlocked
    ? {
        backgroundColor: tint,
        // Subtle shadow on iOS (works through the halo) — Android picks
        // up the elevation field.
        shadowColor: tint,
        shadowOpacity: 0.35,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      }
    : {
        backgroundColor: colors.surface,
        borderWidth: 1.5,
        borderColor: colors.border,
      };

  // Foreground stays white on the colored disk regardless of theme — the
  // tint is bright enough in both modes.
  const fg = unlocked ? '#FFFFFF' : colors.textMuted;

  const content = (
    <View style={[styles.root, style]}>
      <View
        style={[
          styles.ring,
          ringStyle,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
      >
        <View
          style={[
            styles.disk,
            diskStyle,
            { width: inner, height: inner, borderRadius: inner / 2 },
          ]}
        >
          <Ionicons name={def.icon} size={iconSize} color={fg} />
        </View>
      </View>
      <Text
        numberOfLines={2}
        allowFontScaling={false}
        style={[
          styles.title,
          { width: size + 16 },
          !unlocked && styles.titleLocked,
        ]}
      >
        {def.titleHe}
      </Text>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { opacity: 0.75 }]}
    >
      {content}
    </Pressable>
  );
}

/**
 * Render a hex like "#7C3AED" with an alpha channel. We only get the
 * 8-digit form when the input is a clean #RRGGBB; otherwise return as-is.
 */
function tintWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${m[1]}${a}`;
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  disk: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    textAlign: 'center',
  },
  titleLocked: {
    color: colors.textMuted,
    fontWeight: '500',
  },
});
