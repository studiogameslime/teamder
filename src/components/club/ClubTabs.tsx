// The club screen's three tabs: מידע · שחקנים · סטטיסטיקות.
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

export type ClubTabKey = 'info' | 'players' | 'stats';

export interface ClubTab {
  key: ClubTabKey;
  label: string;
  /** Renders a lock and routes the press to `onLockedPress`. */
  locked?: boolean;
}

export interface ClubTabsProps {
  tabs: ClubTab[];
  active: ClubTabKey;
  onChange: (key: ClubTabKey) => void;
  /** What a locked tab does instead of switching. */
  onLockedPress?: (key: ClubTabKey) => void;
}

export function ClubTabs({ tabs, active, onChange, onLockedPress }: ClubTabsProps) {
  return (
    <View style={styles.bar}>
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
                isActive && styles.labelActive,
                t.locked && styles.labelLocked,
              ]}
              numberOfLines={1}
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
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    height: 52,
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
    fontSize: 15,
    fontWeight: '700',
    color: colors.textMuted,
    textAlign: 'center',
  },
  labelActive: { color: clubAccent.blue, fontWeight: '800' },
  labelLocked: { opacity: 0.6 },
});