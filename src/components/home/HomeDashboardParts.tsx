// HomeDashboardParts — presentational pieces of the home screen.
//
// All logic and data live in ProfileScreen; these are pure views, which is
// what keeps the RTL layout predictable. Pieces: the smart contextual banner
// and the three action tiles.
//
// The recommended-day banner and the evening-availability podium used to live
// here too. They stated one fact twice — a banner naming the busiest day, and
// under it a podium in which that same day already wore a star — so they were
// merged into `HomeAvailabilityPanel`.
//
// ── The RTL rule used throughout ───────────────────────────────────────────
// The app runs under `I18nManager.forceRTL`, so the FIRST child of a row
// lands on the visual RIGHT and `textAlign:'left'` (RTL_LABEL_ALIGN) anchors
// text to the visual RIGHT. Nothing here uses `row-reverse`: under forceRTL
// that reverses an already-reversed row and puts things back on the wrong
// side. Source order is the layout.
//
// The top bar that used to live here moved into `HomeHero`, which now owns
// the whole top of the screen — the controls, the brand and the greeting over
// one photograph instead of a white strip above it.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

// ── one card system ─────────────────────────────────────────────────────────
// One radius for every card on this screen, and one shadow, so nothing
// looks like it was borrowed from a different app.
const R = 20;
const CARD_SHADOW = {
  shadowColor: '#0F172A',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 14,
  elevation: 2,
} as const;

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

// ── action tiles ────────────────────────────────────────────────────────────
// Three tiles, each with its own accent. The accent is a hint, not a
// statement: a soft tint behind the tile and full strength only on the icon
// and the chevron. Three fully coloured cards side by side would read as
// three warnings.
const TILE_TINTS = {
  orange: { from: '#FFF3E6', to: '#FFE8D1', ink: '#C2410C', disc: '#FFFFFF' },
  purple: { from: '#F3EEFF', to: '#E9E0FF', ink: '#6D28D9', disc: '#FFFFFF' },
  green: { from: '#E9FBF1', to: '#D6F5E4', ink: '#047857', disc: '#FFFFFF' },
} as const;

/**
 * Open a game / mark availability / join a game.
 *
 * Source order IS the RTL order: "פתח מחזור" is written first and lands on
 * the visual right, where the eye starts.
 */
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
        tint={TILE_TINTS.orange}
        title={he.homeActionOpenTitle}
        sub={he.homeActionOpenSub}
        onPress={onOpen}
      />
      <ActionTile
        icon="people-outline"
        tint={TILE_TINTS.purple}
        title={he.homeActionAvailTitle}
        sub={he.homeActionAvailSub}
        onPress={onAvailability}
      />
      <ActionTile
        icon="person-add-outline"
        tint={TILE_TINTS.green}
        title={he.homeActionJoinTitle}
        sub={he.homeActionJoinSub}
        onPress={onJoin}
      />
    </View>
  );
}

function ActionTile({
  icon,
  tint,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tint: (typeof TILE_TINTS)[keyof typeof TILE_TINTS];
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && { opacity: 0.88 }]}
      accessibilityRole="button"
      accessibilityLabel={`${title} — ${sub}`}
    >
      <LinearGradient
        colors={[tint.from, tint.to]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.tileDisc, { backgroundColor: tint.disc }]}>
        <Ionicons name={icon} size={20} color={tint.ink} />
      </View>
      {/* A third of a phone's width is about 105pt. The title shrinks rather
          than truncates, and the subtitle is allowed a second line — the
          previous build deleted the subtitle outright because it clipped. */}
      <Text
        style={styles.tileTitle}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
      >
        {title}
      </Text>
      <Text style={styles.tileSub} numberOfLines={2}>
        {sub}
      </Text>
      <View style={styles.tileChev}>
        {/* `chevron-back` points LEFT, which is "onward" under RTL. */}
        <Ionicons name="chevron-back" size={13} color={tint.ink} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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

  // ── action tiles ──
  tilesRow: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    borderRadius: R,
    overflow: 'hidden',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 3,
    ...CARD_SHADOW,
  },
  tileDisc: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  tileTitle: {
    fontSize: 13.5,
    fontWeight: '900',
    color: colors.text,
    textAlign: 'center',
  },
  tileSub: {
    fontSize: 10.5,
    lineHeight: 14,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: 'center',
  },
  tileChev: { marginTop: spacing.xs, opacity: 0.8 },
});
