// HomeDashboardParts — presentational pieces of the redesigned home screen.
// All logic/data lives in ProfileScreen; these are pure views so the RTL
// layout stays predictable. Pieces: top bar (centered Teamder logo), smart
// contextual banner, "recommended day" flame banner, three action tiles,
// and the evening-availability podium.

import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/UserAvatar';
import type { User } from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

// The real Teamder brand mark (TD monogram + ball) — app icon.
const LOGO: ImageSourcePropType = require('../../assets/images/logo.png');

/** Top bar: menu + bell on the leading-left, centered Teamder logo, avatar
 *  on the trailing-right (mockup layout). */
export function HomeTopBar({
  user,
  hasNotif,
  onMenu,
  onBell,
  onAvatar,
}: {
  user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>;
  hasNotif: boolean;
  onMenu: () => void;
  onBell: () => void;
  onAvatar: () => void;
}) {
  return (
    <View style={styles.topBar}>
      {/* First child → visual RIGHT in forceRTL: the avatar. */}
      <Pressable style={styles.avatarWrap} onPress={onAvatar} hitSlop={6}>
        <UserAvatar user={user} size={40} ring />
        <Ionicons name="chevron-down" size={14} color={colors.textMuted} />
      </Pressable>

      {/* Last child → visual LEFT: menu + bell. */}
      <View style={styles.leftCluster}>
        <Pressable style={styles.iconBtn} onPress={onMenu} hitSlop={6}>
          <Ionicons name="menu" size={22} color={colors.text} />
        </Pressable>
        <Pressable style={styles.iconBtn} onPress={onBell} hitSlop={6}>
          <Ionicons name="notifications-outline" size={20} color={colors.text} />
          {hasNotif ? <View style={styles.notifDot} /> : null}
        </Pressable>
      </View>

      {/* Centered brand logo (absolute so it's a true center regardless of
          the clusters' widths). */}
      <View style={styles.logoWrap} pointerEvents="none">
        <Image source={LOGO} style={styles.logoImg} resizeMode="contain" />
        <Text style={styles.logoText}>{he.homeBrandName}</Text>
      </View>
    </View>
  );
}

/** Smart contextual banner — one tappable line chosen by player state. */
export function HomeSmartBanner({
  text,
  onPress,
}: {
  text: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.banner, pressed && onPress ? { opacity: 0.9 } : null]}
      accessibilityRole={onPress ? 'button' : undefined}
    >
      <Ionicons name="chevron-back" size={18} color={colors.primary} />
      <Text style={styles.bannerText} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  );
}

/** "Recommended day to open a game" — flame banner with the busiest day. */
export function HomeRecommendedDay({
  dayLetter,
  count,
  onPress,
}: {
  dayLetter: string;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recCard, pressed && { opacity: 0.92 }]}
      accessibilityRole="button"
    >
      <View style={styles.recCalIcon}>
        <Ionicons name="calendar" size={20} color={colors.primary} />
      </View>
      <View style={styles.recMid}>
        <Text style={styles.recTitle} numberOfLines={1}>
          {he.homeRecommendedTitle}
        </Text>
        <Text style={styles.recLine} numberOfLines={1}>
          {he.homeRecommendedLine(dayLetter, count)}
        </Text>
      </View>
      <View style={styles.recFlame}>
        <Text style={styles.recFlameEmoji}>🔥</Text>
      </View>
    </Pressable>
  );
}

/** Three action tiles: open a game / mark availability / join a game. */
export function HomeActionTiles({
  onOpen,
  onAvailability,
  onJoin,
}: {
  onOpen: () => void;
  onAvailability: () => void;
  onJoin: () => void;
}) {
  return (
    <View style={styles.tilesRow}>
      <ActionTile
        icon="calendar-outline"
        title={he.homeActionOpenTitle}
        sub={he.homeActionOpenSub}
        onPress={onOpen}
      />
      <ActionTile
        icon="people-outline"
        title={he.homeActionAvailTitle}
        sub={he.homeActionAvailSub}
        onPress={onAvailability}
      />
      <ActionTile
        icon="person-add-outline"
        title={he.homeActionJoinTitle}
        sub={he.homeActionJoinSub}
        onPress={onJoin}
      />
    </View>
  );
}

function ActionTile({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.9 }]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <Text style={styles.tileTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.tileSub} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  );
}

export interface WindowDay {
  letter: string;
  count: number;
  dateMs: number;
  best: boolean;
}

/** Evening-availability podium — three day cards, the busiest highlighted. */
export function HomeAvailabilityWindows({
  days,
  maxCount,
  onShowWeek,
  onPickDay,
}: {
  days: WindowDay[];
  maxCount: number;
  onShowWeek: () => void;
  onPickDay: (dateMs: number) => void;
}) {
  return (
    <View style={styles.windowsCard}>
      <View style={styles.windowsHeader}>
        <View style={styles.windowsTitleWrap}>
          <Ionicons name="people" size={18} color={colors.primary} />
          <Text style={styles.windowsTitle}>{he.homeWindowsTitle}</Text>
        </View>
        <Pressable onPress={onShowWeek} hitSlop={6} style={styles.showWeek}>
          <Text style={styles.showWeekText}>{he.homeWindowsShowWeek}</Text>
          <Ionicons name="chevron-back" size={14} color={colors.primary} />
        </Pressable>
      </View>
      <View style={styles.windowsRow}>
        {days.map((d) => {
          const pct = maxCount > 0 ? Math.max(0.08, d.count / maxCount) : 0;
          return (
            <Pressable
              key={d.dateMs}
              onPress={() => onPickDay(d.dateMs)}
              style={({ pressed }) => [
                styles.dayCard,
                d.best && styles.dayCardBest,
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
            >
              {d.best ? (
                <View style={styles.starBadge}>
                  <Ionicons name="star" size={11} color="#FFFFFF" />
                </View>
              ) : null}
              <View style={styles.dayHead}>
                <Ionicons
                  name="people-outline"
                  size={14}
                  color={d.best ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.dayLetter, d.best && styles.dayLetterBest]}>
                  {he.homeDayLabel(d.letter)}
                </Text>
              </View>
              <Text style={[styles.dayCount, d.best && styles.dayCountBest]}>
                {d.count}
              </Text>
              <Text style={styles.dayUnit}>{he.availabilityTimeEvening}</Text>
              <View style={styles.dayBarTrack}>
                <View
                  style={[
                    styles.dayBarFill,
                    { flex: pct },
                    d.best && styles.dayBarFillBest,
                  ]}
                />
                <View style={{ flex: 1 - pct }} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // ── top bar ──
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    minHeight: 56,
  },
  avatarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  leftCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  notifDot: {
    position: 'absolute',
    top: 9,
    right: 11,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  logoWrap: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  logoImg: {
    width: 30,
    height: 30,
    borderRadius: 8,
  },
  logoText: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.text,
  },
  // ── smart banner ──
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary + '12',
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bannerText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  // ── recommended day ──
  recCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  recCalIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recMid: { flex: 1 },
  recTitle: {
    ...typography.body,
    color: colors.primaryDark,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  recLine: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 2,
  },
  recFlame: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recFlameEmoji: { fontSize: 22 },
  // ── action tiles ──
  tilesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    backgroundColor: colors.primary + '0D',
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: 3,
  },
  tileTitle: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '900',
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  tileSub: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
    textAlign: 'center',
  },
  // ── evening podium ──
  windowsCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: spacing.md,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  windowsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  windowsTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  windowsTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  showWeek: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  showWeekText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  windowsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-end',
  },
  dayCard: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 16,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    gap: 4,
  },
  dayCardBest: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  starBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 22,
    height: 22,
    borderTopLeftRadius: 16,
    borderBottomRightRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dayLetter: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  dayLetterBest: { color: colors.primary },
  dayCount: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  dayCountBest: { color: colors.primary },
  dayUnit: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: '600',
  },
  dayBarTrack: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'stretch',
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  dayBarFill: {
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  dayBarFillBest: { backgroundColor: colors.primary },
});
