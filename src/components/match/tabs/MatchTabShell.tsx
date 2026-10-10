import { ScrollSurface } from '@/components/ScrollSurface';
// Shared scaffolding for the four match tabs.
//
// Each tab owns its own ScrollView, and the header travels INSIDE it: the hero
// scrolls away, the tab bar sticks to the top. A header pinned above all four
// panes was the first shape tried, and on a 2400px phone it held a third of the
// screen forever — a seven-row table had half a viewport to live in. The bar is
// the part that has to stay reachable; the cover photo is not.
//
// `stickyHeaderIndices={[1]}` is what does it: child 0 is the hero, child 1 is
// the bar, and the platform pins the bar once the hero has scrolled past. No
// measurement, no animation, no native-driver caveat.
//
// The cost is one hero per visited pane instead of one per screen. That is the
// right trade: the panes are mounted lazily and kept, so each instance mounts
// once and never swaps — this is NOT the remount bug the club screen had, where
// one header was handed to different sibling branches of the SAME pane and
// React rebuilt it on every switch.

import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

/**
 * One tab's scroll surface. Bottom padding clears the sticky CTA.
 *
 * Pull-to-refresh is opt-in per tab, because it no longer belongs to the screen
 * as a whole: before the tabs there was ONE scroll view and one gesture, and
 * splitting it into four means each tab has to say whether pulling on it
 * refetches anything. The tabs that render the game document take it; the ones
 * reading their own documents do not, so the gesture never lies about what it
 * reloaded.
 */
export function TabScroll({
  children,
  bottomInset = 0,
  refreshing,
  onRefresh,
  header,
  stickyHeader,
}: {
  children: React.ReactNode;
  bottomInset?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The hero. Scrolls away with the content. */
  header?: React.ReactNode;
  /** The tab bar. Pinned to the top once the hero is gone. */
  stickyHeader?: React.ReactNode;
}) {
  const pinned = header != null && stickyHeader != null;
  return (
    <ScrollSurface
      style={styles.flex}
      contentContainerStyle={
        pinned
          ? undefined
          : [
              styles.content,
              bottomInset > 0 ? { paddingBottom: bottomInset + spacing.lg } : null,
            ]
      }
      stickyHeaderIndices={pinned ? [1] : undefined}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing === true}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        ) : undefined
      }
      // The same opt-out the club screen needed: arriving from a feed whose
      // search box still holds focus, ScrollView's responder capture eats the
      // first tap on every button underneath it.
      keyboardShouldPersistTaps="handled"
    >
      {/* An ARRAY, never a fragment. `stickyHeaderIndices` counts the
          ScrollView's own children, and a fragment collapses all three into
          one — index 1 then points at nothing and the bar scrolls away with
          the hero, which is exactly what it did the first time. */}
      {pinned
        ? [
            <View key="hero">{header}</View>,
            <View key="bar">{stickyHeader}</View>,
            // The padding lives HERE, not on the content container: the hero
            // and the bar must sit flush with the screen edges, and a
            // container padding would inset them too.
            <View
              key="body"
              style={[
                styles.content,
                bottomInset > 0 ? { paddingBottom: bottomInset + spacing.lg } : null,
              ]}
            >
              {children}
            </View>,
          ]
        : children}
    </ScrollSurface>
  );
}

/**
 * A section heading: icon on the RIGHT, label beside it.
 *
 * Icon first in source order — under forceRTL that is the rightmost slot, and
 * it matches every other heading in the app (SectionTitle on the club screen,
 * the grid's title row).
 */
export function TabSectionTitle({
  icon,
  text,
  tint = colors.primary,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tint?: string;
}) {
  return (
    <View style={styles.titleRow}>
      <Ionicons name={icon} size={17} color={tint} />
      <Text style={styles.titleText}>{text}</Text>
    </View>
  );
}

/**
 * The empty state a tab shows when it has nothing to draw.
 *
 * Deliberately plain. There are three different reasons a tab can be empty —
 * not played yet, played before the data was recorded, and locked — and the
 * screen says which; a large illustrated onboarding panel would read as the
 * same "something is wrong" for all three.
 */
export function TabEmpty({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={26} color={colors.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    marginTop: spacing.xs,
  },
  titleText: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    fontSize: 15,
    textAlign: RTL_LABEL_ALIGN,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 19,
  },
});
