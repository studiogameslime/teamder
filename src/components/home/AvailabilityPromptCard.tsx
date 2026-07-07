// AvailabilityPromptCard — the home "hero" shown when the user has NO upcoming
// game and hasn't marked their availability yet. Its whole job is to drive the
// single most valuable activation action: set availability, so we can then show
// them who's free to play nearby. Deliberately large and prominent.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';

export function AvailabilityPromptCard({
  onSetAvailability,
}: {
  onSetAvailability: () => void;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.iconBadge}>
        <Ionicons name="calendar" size={26} color={colors.primary} />
      </View>
      <Text style={styles.title}>{he.availFeedPromptTitle}</Text>
      <Text style={styles.body}>{he.availFeedPromptBody}</Text>
      <Pressable
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
        onPress={onSetAvailability}
        accessibilityRole="button"
        accessibilityLabel={he.availFeedPromptCta}
      >
        <Ionicons name="calendar-outline" size={18} color="#fff" />
        <Text style={styles.ctaText}>{he.availFeedPromptCta}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.lg,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  ctaText: { ...typography.body, color: '#fff', fontWeight: '800' },
});
