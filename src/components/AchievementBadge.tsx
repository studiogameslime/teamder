// AchievementBadge — medal-style icon whose colour reflects the badge's
// current TIER (bronze / silver / gold). Locked badges are faded grey but
// keep the ring + glyph so the slot still reads as "achievement".

import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { LivingIcon } from '@/components/anim/LivingIcon';
import { TIER_META, type AchievementDef } from '@/data/achievements';
import type { AchievementTier } from '@/types';

interface Props {
  /** Only the fields this badge actually renders — so both the personal
   *  `AchievementDef` and the club `ClubAchievementDef` can be passed in. */
  def: Pick<AchievementDef, 'icon' | 'titleHe' | 'oneOff'>;
  /** Current tier, or null when the badge is still locked. */
  tier: AchievementTier | null;
  /** Outer-ring diameter in dp. Default 72. */
  size?: number;
  /** Hide the title label under the badge. */
  hideTitle?: boolean;
  /** Show the Hebrew tier name (ברונזה/כסף/זהב) under the title. */
  showTierLabel?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}

export function AchievementBadge({
  def,
  tier,
  size = 72,
  hideTitle,
  showTierLabel,
  onPress,
  style,
}: Props) {
  const unlocked = tier !== null;
  const tint = tier ? TIER_META[tier].color : colors.textMuted;
  // Inner disk is ~78% of the outer ring, leaving a colored halo.
  const inner = Math.round(size * 0.78);
  const iconSize = Math.round(size * 0.42);

  const ringStyle = unlocked
    ? { backgroundColor: tintWithAlpha(tint, 0.18), borderColor: tint }
    : { backgroundColor: colors.surfaceMuted, borderColor: colors.border };

  const diskStyle = unlocked
    ? {
        backgroundColor: tint,
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

  const fg = unlocked ? '#FFFFFF' : colors.textMuted;

  const body = (
    <>
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
          {unlocked ? (
            <LivingIcon motion="pulse" speed={1.4}>
              <Ionicons name={def.icon} size={iconSize} color={fg} />
            </LivingIcon>
          ) : (
            <Ionicons name={def.icon} size={iconSize} color={fg} />
          )}
        </View>
      </View>
      {hideTitle ? null : (
        <Text
          numberOfLines={2}
          allowFontScaling={false}
          style={[styles.title, !unlocked && styles.titleLocked]}
        >
          {def.titleHe}
        </Text>
      )}
      {showTierLabel && tier && !def.oneOff ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.tierLabel, { color: tint }]}
        >
          {TIER_META[tier].he}
        </Text>
      ) : null}
    </>
  );

  // The `style` (e.g. a grid column width) must land on the OUTER element —
  // the actual flex item — not the inner View, or the Pressable collapses to
  // content width and the grid columns break.
  if (!onPress) return <View style={[styles.root, style]}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.root, style, pressed && { opacity: 0.75 }]}
    >
      {body}
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
    alignSelf: 'stretch',
    // Reserve two lines so 1-line and 2-line titles align across the grid
    // (keeps every tier label on the same baseline).
    lineHeight: 14,
    minHeight: 28,
  },
  titleLocked: {
    color: colors.textMuted,
    fontWeight: '500',
  },
  tierLabel: {
    ...typography.caption,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: -2,
  },
});
