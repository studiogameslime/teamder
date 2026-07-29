// UpcomingScheduledGameCard — a read-only "coming soon" teaser for a community
// game whose registration hasn't opened yet (status:'scheduled'). Surfaces on
// the home no-game state and the games-feed "בקרוב" section so a member knows a
// game is on the way and exactly when they can register.
//
// No join button — registration is blocked until the `flipScheduledGames` CF
// flips the status to 'open' (which already pushes every community subscriber).
// A tap opens the community page (NOT MatchDetails — joins aren't possible yet).

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { Game } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDayDate, formatTime, joinLocation } from '@/utils/format';

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * The countdown clause after "ההרשמה":
 *   • final hour  → live "נפתחת בעוד 12:34 דק׳" (ticks every second)
 *   • earlier     → absolute "נפתחת מחר ב-18:00" / "נפתחת יום חמישי · 31.7 ב-18:00"
 *   • already due → "נפתחת עכשיו" (edge: the CF hasn't flipped it yet)
 */
function openLabel(opensAt: number, now: number): string {
  const diff = opensAt - now;
  if (diff <= 0) return he.homeUpcomingOpeningNow;
  if (diff < 60 * 60 * 1000) {
    const total = Math.floor(diff / 1000);
    return he.homeUpcomingOpensInMinutes(`${Math.floor(total / 60)}:${pad2(total % 60)}`);
  }
  return he.homeUpcomingOpensAt(
    formatDayDate(opensAt, { day: 'long' }),
    formatTime(opensAt),
  );
}

export function UpcomingScheduledGameCard({
  game,
  onOpen,
}: {
  game: Game;
  /** @deprecated no longer shown — the game title is the identifier. */
  communityName?: string;
  onOpen: (groupId: string) => void;
}) {
  const opensAt = game.registrationOpensAt ?? game.startsAt;
  // A 1s tick keeps the final-hour countdown live; torn down on unmount. The
  // pre-hour branch recomputes the same absolute string cheaply.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const venue = joinLocation(game.fieldName, game.city);

  return (
    <Pressable
      onPress={() => onOpen(game.groupId)}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.95 }]}
      accessibilityRole="button"
      accessibilityLabel={he.homeUpcomingBadge}
    >
      {/* Game title on the right (like a regular card), "משחק בדרך" badge left. */}
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={2}>
          {game.title}
        </Text>
        <View style={styles.chip}>
          <MaterialCommunityIcons name="lock-clock" size={15} color={colors.primary} />
          <Text style={styles.chipText}>{he.homeUpcomingBadge}</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="calendar-outline" size={15} color={colors.primary} />
        <Text style={styles.infoStrong} numberOfLines={1}>
          {formatDayDate(game.startsAt, {
            day: 'long',
            dayPrefix: true,
            withTime: true,
          })}
        </Text>
      </View>
      {venue ? (
        <View style={styles.infoRow}>
          <Ionicons name="location-outline" size={15} color={colors.textMuted} />
          <Text style={styles.infoMuted} numberOfLines={1}>
            {venue}
          </Text>
        </View>
      ) : null}

      <View style={styles.countdown}>
        <Ionicons name="time-outline" size={16} color={colors.primary} />
        <Text style={styles.countdownText} numberOfLines={1}>
          {he.homeUpcomingRegistration(openLabel(opensAt, now))}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.md,
    // Grey accent stripe on the visual-LEFT edge (end under RTL) — marks a
    // "registration not open yet" game. paddingEnd compensates so content
    // doesn't shift.
    borderEndWidth: 6,
    borderEndColor: '#94A3B8',
    paddingEnd: spacing.md - 5,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderStartWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.primary + '14',
  },
  chipText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  community: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  infoStrong: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  infoMuted: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary + '14',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
  },
  countdownText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
});
