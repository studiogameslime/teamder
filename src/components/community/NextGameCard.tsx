// NextGameCard — primary-focus dark blue card for the redesigned
// CommunityDetailsScreen. This is the loudest section in the body
// (after the hero) — visually larger and higher-contrast than the
// surrounding stat cards.
//
// Layout under forceRTL:
//
//   ┌──────────────────────────────────────────────┐
//   │  [□ לפרטי משחק]      המשחק הקרוב            │
//   │      → arrow         יום + תאריך            │
//   │                      19:30                  │
//   │                      📍 שם המגרש            │
//   └──────────────────────────────────────────────┘
//   ↑ leading (left)                  trailing (right) ↑
//
// The CTA square sits FIRST in the JSX → leading edge under RTL → the
// visual LEFT side of the card. The text block sits SECOND → trailing
// edge under RTL → visual RIGHT.
//
// When no upcoming game exists the card collapses to a muted empty
// state (no CTA) — the user still gets context that the section is
// here and intentionally empty, not broken.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import {
  formatDateShort,
  formatDayDate,
  formatTime,
} from '@/utils/format';

interface Props {
  /** ms epoch — undefined when there is no upcoming game. */
  startsAt?: number;
  /** Optional venue name shown under the time. */
  fieldName?: string;
  /** When set, registration hasn't opened yet — the card swaps the
   *  "לפרטי משחק" CTA for a muted "ההרשמה תיפתח ב..." badge. */
  registrationOpensAt?: number;
  onPress?: () => void;
}

export function NextGameCard({
  startsAt,
  fieldName,
  registrationOpensAt,
  onPress,
}: Props) {
  const hasGame = typeof startsAt === 'number';
  // Deferred-open mode: registration hasn't started yet. The card
  // shows "ההרשמה תיפתח ב-X" instead of the "לפרטי משחק" CTA, and tap
  // simply pops a non-blocking toast/alert (handled by the parent —
  // we expose `onPress` regardless and let the parent decide).
  const isDeferred =
    typeof registrationOpensAt === 'number' &&
    registrationOpensAt > Date.now();
  const inner = (
    <View style={styles.inner}>
      {hasGame && onPress && !isDeferred ? (
        <View style={styles.ctaSquare}>
          {/* Arrow points to the trailing edge of the card under RTL,
              so we use chevron-back (← under LTR is ← , under RTL it
              points right). */}
          <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          <Text style={styles.ctaText}>{he.communityNextGameDetailsCta}</Text>
        </View>
      ) : null}
      {hasGame && isDeferred ? (
        <View style={[styles.ctaSquare, styles.ctaSquareLocked]}>
          <Ionicons
            name="lock-closed"
            size={22}
            color="rgba(255,255,255,0.85)"
          />
          <Text style={styles.ctaText} numberOfLines={2}>
            {he.communityNextGameLocked}
          </Text>
          <Text style={styles.lockedTime} numberOfLines={1}>
            {formatLockTime(registrationOpensAt!)}
          </Text>
        </View>
      ) : null}

      <View style={styles.textBlock}>
        <Text style={styles.title}>{he.communityNextGameTitle}</Text>
        {hasGame ? (
          <>
            <Text style={styles.dateLine} numberOfLines={1}>
              {formatDateLine(startsAt!)}
            </Text>
            <Text style={styles.timeLine}>{formatTime(startsAt!)}</Text>
            {fieldName ? (
              <View style={styles.locationRow}>
                <Text style={styles.locationText} numberOfLines={1}>
                  {fieldName}
                </Text>
                <Ionicons
                  name="location"
                  size={14}
                  color="rgba(255,255,255,0.85)"
                />
              </View>
            ) : null}
          </>
        ) : (
          <Text style={styles.emptyLine}>{he.communityNextGameNone}</Text>
        )}
      </View>
    </View>
  );

  if (!hasGame || !onPress) {
    return (
      <View style={styles.card}>
        <LinearGradient
          colors={['#1E3A8A', '#1E40AF', '#0F172A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {inner}
      </View>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed && { opacity: 0.92 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        isDeferred
          ? he.communityNextGameLocked
          : he.communityNextGameDetailsCta
      }
    >
      <LinearGradient
        colors={['#1E3A8A', '#1E40AF', '#0F172A']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {inner}
    </Pressable>
  );
}

// Local composite — "DD.MM HH:MM" — only used for the lock badge.
function formatLockTime(ms: number): string {
  return `${formatDateShort(ms)} ${formatTime(ms)}`;
}

// Local composite — "{day-long} · DD.MM" — same as the canonical
// formatDayDate's defaults, kept named for in-JSX readability.
function formatDateLine(ms: number): string {
  return formatDayDate(ms);
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    borderRadius: 22,
    minHeight: 156,
    shadowColor: '#1E40AF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 8,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  // Big tappable square on the leading (left under RTL) edge. Hugged
  // to a square aspect so it reads as a button, not a label.
  ctaSquare: {
    width: 110,
    height: 110,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  // Locked variant — gray-tinted, signals "you can't enter yet".
  ctaSquareLocked: {
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  lockedTime: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '700',
  },
  // Text block — fills the rest, right-aligned under RTL.
  textBlock: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.6,
    textAlign: RTL_LABEL_ALIGN,
  },
  dateLine: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Time is the loudest single string in the card.
  timeLine: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    // Push to the trailing (right under RTL) edge so it lines up with
    // the right-aligned text above it.
    alignSelf: 'flex-end',
  },
  locationText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
  },
  emptyLine: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '500',
    fontStyle: 'italic',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 6,
  },
});
