// StatTile — a single metric tile for the profile / stats hero.
//
// Two visual sizes:
//   `lg`  — the "headline" stat. Big number, bold green label below.
//           Used as the hero stat at the top of the profile.
//   `md`  — secondary stat. Smaller number, muted label, fits in a row
//           of three under the hero.
//
// Optional `tone` colors the number (default = primary text). An
// optional `icon` sits above the number for extra identity.

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '@/theme';

type Tone = 'primary' | 'info' | 'warning' | 'danger' | 'accent' | 'neutral';

interface Props {
  label: string;
  value: string;
  size?: 'md' | 'lg';
  tone?: Tone;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

const TONE_COLOR: Record<Tone, string> = {
  // Brand-blue (was the legacy #16A34A green). The "primary" tone is
  // shared with the rest of the redesigned chrome — keep it aligned.
  primary: '#1E40AF',
  info: '#2563EB',
  warning: '#EA580C',
  danger: '#DC2626',
  accent: '#CA8A04',
  neutral: '#111827',
};

export function StatTile({
  label,
  value,
  size = 'md',
  tone = 'neutral',
  icon,
  style,
}: Props) {
  const isLg = size === 'lg';
  const valueColor = TONE_COLOR[tone];
  return (
    <View style={[styles.tile, isLg && styles.tileLg, style]}>
      {icon ? (
        <Ionicons
          name={icon}
          size={isLg ? 22 : 16}
          color={valueColor}
          style={{ marginBottom: isLg ? spacing.xs : 2 }}
        />
      ) : null}
      <Text
        style={[
          styles.value,
          isLg && styles.valueLg,
          { color: valueColor },
        ]}
        allowFontScaling={false}
      >
        {value}
      </Text>
      <Text style={[styles.label, isLg && styles.labelLg]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    ...shadows.card,
  },
  tileLg: {
    paddingVertical: spacing.xl,
  },
  value: {
    ...typography.h2,
    fontWeight: '800',
  },
  valueLg: {
    fontSize: 42,
    lineHeight: 48,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelLg: {
    fontSize: 13,
    marginTop: spacing.xs,
  },
});
