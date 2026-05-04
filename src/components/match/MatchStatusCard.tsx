// MatchStatusCard — slim, dismissible-looking card that surfaces the
// match's current state in plain language ("waiting for X more
// players", "teams are ready", etc.). Caller decides whether to
// render based on session status; the card just paints what it's
// given and keeps the visuals consistent.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

export type StatusTone = 'info' | 'positive' | 'warning';

interface Props {
  title: string;
  helper?: string;
  tone?: StatusTone;
  icon?: keyof typeof Ionicons.glyphMap;
}

export function MatchStatusCard({
  title,
  helper,
  tone = 'info',
  icon = 'information-circle-outline',
}: Props) {
  const toneStyle = TONE_STYLES[tone];
  return (
    <View style={[styles.card, { backgroundColor: toneStyle.bg }]}>
      <Ionicons name={icon} size={18} color={toneStyle.fg} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: toneStyle.fg }]}>{title}</Text>
        {helper ? (
          <Text style={[styles.helper, { color: toneStyle.fg }]}>{helper}</Text>
        ) : null}
      </View>
    </View>
  );
}

const TONE_STYLES: Record<StatusTone, { bg: string; fg: string }> = {
  info: { bg: '#EEF2FF', fg: '#4338CA' },
  positive: { bg: '#DCFCE7', fg: '#15803D' },
  warning: { bg: '#FEF3C7', fg: '#B45309' },
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.caption,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    fontSize: 13,
  },
  helper: {
    ...typography.caption,
    textAlign: RTL_LABEL_ALIGN,
    opacity: 0.85,
  },
});

// Reserved color tokens for future tones.
export const _TONE_COLORS = {
  primary: colors.primary,
};
