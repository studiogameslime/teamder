// AssistantCard — "הודעה מהמאמן" on the home screen.
//
//   ┌──────────────────────────────────────────────┐
//   │                       🧢 הודעה מהמאמן        │
//   │  בוקר טוב, עוד 2 גולים ואתה מלך השערים        │
//   │              של כדורגל אנשים טובים 👑         │
//   │                              [ פתח מחזור ]   │  ← optional CTA
//   └──────────────────────────────────────────────┘
//
// The time-of-day greeting is part of the coach's sentence, not a separate
// banner above it: the home screen used to greet you on one line and then say
// something contextual on another, which read like two voices. The card owns
// the prefix so every rule can write a body and get "בוקר טוב, ..." for free.
//
// Deliberately modest: one card, one line, at most one action. It is NOT a
// feed — the resolver hands us exactly one message or none at all, and on none
// this renders nothing rather than padding the screen with filler.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import type { AssistantMessage } from '@/utils/assistant/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export function AssistantCard({
  message,
  greeting,
  onCta,
}: {
  message: AssistantMessage | null;
  /** Time-of-day greeting ("בוקר טוב") — prefixed onto the coach's sentence. */
  greeting: string;
  /** Invoked with the message's action; the screen maps it to navigation. */
  onCta: (message: AssistantMessage) => void;
}) {
  if (!message) return null;
  const cta = message.cta;
  const line = greeting
    ? `${he.assistantGreeting(greeting)} ${message.text}`
    : message.text;

  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.head}>
        <Ionicons name="megaphone-outline" size={14} color={colors.primary} />
        <Text style={styles.title}>{he.assistantTitle}</Text>
      </View>

      <Text style={styles.message}>{line}</Text>
      {message.sub ? <Text style={styles.sub}>{message.sub}</Text> : null}

      {cta ? (
        <Pressable
          onPress={() => onCta(message)}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
          {/* chevron-back points LEFT, which is "forward" under RTL. */}
          <Ionicons name="chevron-back" size={15} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Same rounded-white-card language as the rest of the home body, with a
  // faint blue wash + border so it reads as "Teamder speaking" rather than
  // another data card.
  card: {
    backgroundColor: '#F5F8FF',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#DCE6FF',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  title: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    flex: 1,
  },
  message: {
    ...typography.body,
    fontSize: 16,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  sub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  // Text-button rather than a filled one: the home screen already has filled
  // CTAs (action tiles, match card) and a second one here would compete.
  cta: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },
  ctaText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
  },
});
