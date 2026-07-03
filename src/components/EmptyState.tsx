// EmptyState — the app's single "nothing here yet" block: a centered
// icon-in-a-circle + title + optional hint, with an optional CTA button.
//
// Replaces the ~20 hand-rolled centered `View + Ionicons + emptyTitle +
// emptyHint` blocks that had drifted apart (icon sizes 40–64, some with a
// tinted circle, some bare; gaps and paddings all slightly different). One
// component = one consistent empty state everywhere.
//
// Kept deliberately small: callers pass an Ionicons name (or a custom node
// via `illustration` for the football/pitch cases). The icon sits in a soft
// tinted circle so empty states read as intentional art, not a missing asset.

import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@/components/Button';
import { colors, spacing, typography } from '@/theme';

interface Props {
  /** Ionicons glyph shown in the tinted circle. Ignored if `illustration` set. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Custom hero node (e.g. EmptyPitch) rendered instead of the icon circle. */
  illustration?: React.ReactNode;
  /** Tint for the icon + its circle. Default muted grey. */
  tint?: string;
  title: string;
  hint?: string;
  /** Optional CTA under the text. */
  ctaLabel?: string;
  onCtaPress?: () => void;
  ctaIcon?: keyof typeof Ionicons.glyphMap;
  /** Fill the parent (flex:1, centered). Default true. Set false to render
   *  inline inside a scroll/section without stretching. */
  fill?: boolean;
  style?: ViewStyle;
}

export function EmptyState({
  icon,
  illustration,
  tint = colors.textMuted,
  title,
  hint,
  ctaLabel,
  onCtaPress,
  ctaIcon,
  fill = true,
  style,
}: Props) {
  return (
    <View style={[fill ? styles.fill : styles.inline, style]}>
      {illustration ? (
        illustration
      ) : icon ? (
        <View style={[styles.iconCircle, { backgroundColor: tint + '1A' }]}>
          <Ionicons name={icon} size={30} color={tint} />
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {ctaLabel && onCtaPress ? (
        <Button
          title={ctaLabel}
          onPress={onCtaPress}
          iconLeft={ctaIcon}
          style={styles.cta}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  inline: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  hint: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  cta: { marginTop: spacing.md },
});
