// Badge — colored status pill.
//
// Use a `tone` instead of raw colors so badges stay consistent across
// the app. Each tone maps to a (background, text) pair derived from the
// theme palette.
//
//   primary   — green   (success / "joined" / approved)
//   info      — blue    (informational / neutral status)
//   warning   — orange  (highlight / events / "starting soon")
//   danger    — red     (destructive / errors / cancelled)
//   accent    — yellow  (achievements / streaks)
//   neutral   — light gray (low-emphasis statuses)
//
// Sizes:
//   sm  — caption-sized inline pills
//   md  — default
//   lg  — larger card-prominent badges
//
// Visual: rounded `pill` shape, NO border, colored background, bold
// text. Optional left icon (Ionicons glyph) for extra clarity.

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '@/theme';

export type BadgeTone =
  | 'primary'
  | 'info'
  | 'warning'
  | 'danger'
  | 'accent'
  | 'neutral';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface Props {
  label: string;
  tone?: BadgeTone;
  size?: BadgeSize;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

export function Badge({
  label,
  tone = 'primary',
  size = 'md',
  icon,
  style,
}: Props) {
  const palette = TONE_PALETTE[tone];
  const padV = size === 'sm' ? 2 : size === 'lg' ? 6 : 4;
  const padH = size === 'sm' ? spacing.sm : size === 'lg' ? spacing.md : 10;
  const fontSize = size === 'sm' ? 11 : size === 'lg' ? 14 : 12;
  const iconSize = size === 'sm' ? 10 : size === 'lg' ? 14 : 12;

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: palette.bg,
          paddingVertical: padV,
          paddingHorizontal: padH,
        },
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={iconSize}
          color={palette.fg}
          style={{ marginEnd: 4 }}
        />
      ) : null}
      <Text style={[styles.text, { color: palette.fg, fontSize }]}>{label}</Text>
    </View>
  );
}

const TONE_PALETTE: Record<BadgeTone, { bg: string; fg: string }> = {
  primary: { bg: '#DCFCE7', fg: '#166534' },
  info: { bg: '#DBEAFE', fg: '#1E40AF' },
  warning: { bg: '#FFEDD5', fg: '#C2410C' },
  danger: { bg: '#FEE2E2', fg: '#B91C1C' },
  accent: { bg: '#FEF3C7', fg: '#92400E' },
  neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
};

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.label,
    fontWeight: '700',
  },
});
