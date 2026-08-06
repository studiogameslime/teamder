// HomeNextGameCard — the redesigned "your next game" hero for the home
// dashboard. Matches the mockup: a football tile on the leading-left, the
// game meta on the right (title + date/time + venue + format/occupancy box),
// a "roster full / N spots" badge, and a full-width "game details" button.
// Empty state: a gentle "find a game" card.

import React from 'react';
import {
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import type { Game } from '@/types';
import { activeGuestCount } from '@/types';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatGameDay, formatTime } from '@/utils/format';

// Ball-on-grass photo behind the card's tile — matches the sketch.
const BALL_FIELD: ImageSourcePropType = require('../../assets/images/ball-field.jpg');

export function HomeNextGameCard({
  game,
  communityName,
  onOpen,
  onFind,
}: {
  game: Game | null;
  /** Club / cycle name shown under the title (falls back to the game title). */
  communityName?: string;
  onOpen: (gameId: string) => void;
  onFind: () => void;
}) {
  if (!game) {
    return (
      <View style={styles.card}>
        <View style={styles.emptyWrap}>
          <View style={styles.emptyIcon}>
            <MaterialCommunityIcons name="soccer" size={26} color={colors.primary} />
          </View>
          <Text style={styles.emptyTitle}>{he.homeNoGameTitle}</Text>
          <Text style={styles.emptyBody}>{he.homeNoGameBody}</Text>
          <Pressable
            onPress={onFind}
            style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
            accessibilityRole="button"
          >
            <Text style={styles.ctaText}>{he.homeNoGameCta}</Text>
            <Ionicons name="chevron-back" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    );
  }

  const occupancy = game.players.length + activeGuestCount(game.guests);
  const spots = Math.max(0, (game.maxPlayers ?? 0) - occupancy);
  const full = game.maxPlayers ? spots <= 0 : false;
  const venue = [game.fieldName, game.city].filter(Boolean).join(', ');
  const clubName = (communityName || game.title || '').trim();

  return (
    <View style={styles.card}>
      {/* Top: meta on the right, football tile on the left (RTL row). */}
      <View style={styles.top}>
        <View style={styles.meta}>
          <View style={styles.titleRow}>
            <View style={styles.calChip}>
              <Ionicons name="calendar" size={16} color={colors.primary} />
            </View>
            <Text style={styles.title} numberOfLines={1}>
              {he.homeNextGameTitle}
            </Text>
          </View>

          {/* Club / cycle name — sits right under the title (pf3). */}
          {clubName ? (
            <Text style={styles.clubName} numberOfLines={1}>
              {clubName}
            </Text>
          ) : null}

          {/* Spacer pushes the time + location down to the bottom of the card
              (where the format/occupancy box used to be — removed per pf3). */}
          <View style={styles.metaSpacer} />

          <View style={styles.infoRow}>
            <Ionicons name="calendar-outline" size={15} color={colors.primary} />
            <Text style={styles.infoStrong} numberOfLines={1}>
              {formatGameDay(game.startsAt)} · {formatTime(game.startsAt)}
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
        </View>

        <View style={styles.tile}>
          <ImageBackground
            source={BALL_FIELD}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          {/* Fade the photo's inner edge into the card's white so the ball
              blends into the background (like the sketch) instead of a hard
              rectangle. White at the meta-facing (visual-right) edge. */}
          <LinearGradient
            colors={['#FFFFFF', 'rgba(255,255,255,0)']}
            locations={[0, 0.72]}
            start={{ x: 1, y: 0.5 }}
            end={{ x: 0, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.badge, full ? styles.badgeFull : styles.badgeOpen]}>
            <Ionicons
              name={full ? 'checkmark-circle' : 'flash'}
              size={12}
              color="#FFFFFF"
            />
            <Text style={styles.badgeText} numberOfLines={1}>
              {full ? he.homeRosterFull : he.homeSpotsLeft(spots)}
            </Text>
          </View>
        </View>
      </View>

      {/* Full-width details button */}
      <Pressable
        onPress={() => onOpen(game.id)}
        style={({ pressed }) => [styles.cta, pressed && { opacity: 0.9 }]}
        accessibilityRole="button"
        accessibilityLabel={he.homeGameDetailsCta}
      >
        {/* Icon AFTER the text → visual-left in RTL (user request); the old
            leading chevron was dropped (redundant with the ball icon). */}
        <Text style={styles.ctaText}>{he.homeGameDetailsCta}</Text>
        <MaterialCommunityIcons name="soccer" size={18} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  top: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'stretch',
    minHeight: 132,
  },
  meta: {
    flex: 1,
    gap: spacing.xs,
  },
  clubName: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  metaSpacer: {
    flex: 1,
    minHeight: spacing.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  calChip: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    flex: 1,
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
  tile: {
    width: 132,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  badgeOpen: { backgroundColor: '#2563EB' },
  badgeFull: { backgroundColor: '#15803D' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  ctaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  // empty state
  emptyWrap: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...typography.h3, color: colors.text, fontWeight: '900' },
  emptyBody: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
});
