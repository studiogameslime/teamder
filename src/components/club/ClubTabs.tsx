// The tab bar shared by the club screen (מידע · שחקנים · סטטיסטיקות) and the
// match screen (מידע · משחקים · סטטיסטיקות · שחקנים).
//
// A locked tab is still a TAB — visible, in place, and tappable. A visitor who
// cannot see the roster should learn that the roster exists and what unlocks
// it; hiding the tab instead would make the club look emptier than it is and
// would change the screen's shape between member and non-member, which is
// precisely what this refactor set out to stop.
//
// No absolutely-positioned sliding indicator. Each tab paints its own pill when
// active, so nothing here depends on measuring an x-offset — under `forceRTL`
// a measured `left` is the one thing that reliably lands on the wrong side.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, clubAccent, colors } from '@/theme';

/** The club screen's three. The bar itself is generic — see `ClubTabsProps`. */
export type ClubTabKey = 'info' | 'players' | 'stats';

export interface ClubTab<K extends string = ClubTabKey> {
  key: K;
  label: string;
  /** Renders a lock and routes the press to `onLockedPress`. */
  locked?: boolean;
}

/**
 * Generic over the key so the same bar serves the club's three tabs and the
 * match screen's four. One bar, one set of measurements, one RTL behaviour —
 * a second copy would drift the moment either screen was touched.
 */
export interface ClubTabsProps<K extends string = ClubTabKey> {
  tabs: ClubTab<K>[];
  active: K;
  onChange: (key: K) => void;
  /** What a locked tab does instead of switching. */
  onLockedPress?: (key: K) => void;
  /**
   * Drop the bar's own -22 overlap and let the CALLER own the join.
   *
   * The overlap exists so the strip's rounded top rides up over the bottom of
   * the hero photo. On the club screen the bar is an ordinary child and owning
   * the offset here is right. On the match screen it is a STICKY child, and a
   * box whose content starts 22pt above its own top loses those 22pt twice
   * over: the platform pins the box, so the strip's top is clipped off the
   * viewport, and on Android a child drawn outside its parent's bounds is not
   * hit-tested at all — "אי אפשר לעבור בין טאבים" once the hero has scrolled
   * away. The match screen passes `flush` and puts the same -22 on its hero's
   * bottom margin instead, which produces an identical join out of a box that
   * contains its own content.
   */
  flush?: boolean;
}

export function ClubTabs<K extends string = ClubTabKey>({
  tabs,
  active,
  onChange,
  onLockedPress,
  flush = false,
}: ClubTabsProps<K>) {
  // Four tabs share less room. Keep their compact base size, but let labels
  // wrap and the whole row grow when the user's font scale needs more room.
  // A fixed height or shrink-to-fit would defeat that accessibility setting.
  const dense = tabs.length > 3;
  return (
    <View style={[styles.bar, flush && styles.barFlush]}>
      {tabs.map((t) => {
        const isActive = t.key === active && !t.locked;
        return (
          <Pressable
            key={t.key}
            style={({ pressed }) => [
              styles.tab,
              isActive && styles.tabActive,
              pressed && styles.pressed,
            ]}
            onPress={() => (t.locked ? onLockedPress?.(t.key) : onChange(t.key))}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive, disabled: !!t.locked }}
            accessibilityLabel={t.label}
          >
            {t.locked ? (
              <Ionicons
                name="lock-closed"
                size={13}
                color={colors.textMuted}
                style={styles.lock}
              />
            ) : null}
            <Text
              style={[
                styles.label,
                dense && styles.labelDense,
                isActive && styles.labelActive,
                t.locked && styles.labelLocked,
              ]}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // A white strip that rides UP over the bottom of the hero photo, with only
  // its top corners rounded — the reference's join between the cover and the
  // content. The negative margin is what makes the overlap; the radius alone
  // would leave a seam of photo above the corners.
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    marginTop: -22,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // `flush` — the caller owns the overlap; see the prop's note.
  barFlush: { marginTop: 0 },
  tab: {
    // Share spare room after measuring each label, instead of assigning four
    // identical boxes that split a long Hebrew word despite room elsewhere.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 52,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 4,
    // The active underline sits ON the strip's bottom edge, so the tab owns
    // the full height and paints the bar itself.
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: clubAccent.blue,
  },
  pressed: { opacity: 0.6 },
  lock: { opacity: 0.85 },
  label: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  labelDense: { fontSize: 14 },
  labelActive: { color: clubAccent.blue, fontWeight: '800' },
  labelLocked: { opacity: 0.6 },
});
