// Which slice of a club's history a screen is showing.
//
// Lifted out of `CommunityStatsScreen`, which invented this control and still
// owns the hardest version of it. The two-player screen needs the same thing
// — the same union, the same option list, the same bar — and the one thing
// that must not happen is a second implementation that drifts: two screens
// that disagree about what "כל העונות" includes would be worse than either of
// them being wrong on its own.
//
// Deliberately NOT a data loader. This is the control and the vocabulary; what
// each scope MEANS for a given screen's numbers is that screen's business.

import { ChangeMotion } from '@/components/anim/ChangeMotion';
import { HeightReveal } from '@/components/anim/HeightReveal';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, RTL_LABEL_ALIGN } from '@/theme';
import { scopeTitleOf as titleOf, type ScopeOption, type StatsScope } from '@/utils/statsScope';
import { clubAccent, clubShadow, clubSurface } from '@/theme/clubAccents';
import { he } from '@/i18n/he';

// The vocabulary — the union, the option list, the "does this club even have
// slices" rule — lives in `@/utils/statsScope`, pure and testable. Re-exported
// here so a caller still imports the control and its type from one place.
export {
  buildScopeOptions,
  clubHasScopes,
  scopeTitleOf,
  type ScopeOption,
  type ScopeSeason,
  type StatsScope,
} from '@/utils/statsScope';

/**
 * The bar, and the list it opens.
 *
 * A row of its own — never inside a tab strip. It scopes everything below it,
 * including the tabs, so it has to sit above them and read as a separate
 * control.
 */
export function SeasonScopeBar({
  options,
  open,
  onToggle,
  onSelect,
  title,
}: {
  options: readonly ScopeOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (scope: StatsScope) => void;
  /**
   * Override for the CLOSED bar's label only.
   *
   * The club stats screen names the running season without its "· עכשיו"
   * suffix when the bar is shut — in a list of seasons that suffix is what
   * tells you which one is running, and alone on the bar it is decoration.
   * The list itself always uses the option's own text, so the two can still
   * never name different scopes.
   */
  title?: string;
}) {
  if (options.length === 0) return null;
  return (
    <View>
      {/* Calendar on the leading edge (the visual RIGHT under forceRTL,
          because it is written first), the chosen scope filling the middle,
          the chevron closing the row on the left. */}
      <Pressable
        style={styles.bar}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={he.communityStatsScopeLabel}
      >
        <ChangeMotion triggerKey={title ?? titleOf(options)} pulse><Ionicons name="calendar" size={20} color={clubAccent.blue} /></ChangeMotion>
        <Text style={styles.current} numberOfLines={1}>
          {title ?? titleOf(options)}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={clubAccent.blue}
        />
      </Pressable>
      <HeightReveal visible={open}>
        <View style={styles.menu}>
          {options.map((o, idx) => (
            <Pressable
              key={o.key}
              style={({ pressed }) => [
                styles.item,
                idx > 0 && styles.itemDivider,
                pressed && styles.itemPressed,
              ]}
              onPress={() => onSelect(o.scope)}
              accessibilityRole="button"
              accessibilityState={{ selected: o.active }}
            >
              <Text style={[styles.itemText, o.active && styles.itemTextActive]}>
                {o.text}
              </Text>
              {o.active ? (
                <Ionicons name="checkmark" size={18} color={clubAccent.blue} />
              ) : null}
            </Pressable>
          ))}
        </View>
      </HeightReveal>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.md,
    height: 46,
    ...clubShadow,
  },
  current: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  // The open drop-list. Same surface, radius and shadow as the bar it hangs
  // under, so the two read as one control rather than as a control and a
  // separate row of tabs.
  menu: {
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: 14,
    overflow: 'hidden',
    ...clubShadow,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
  },
  itemDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: clubSurface.divider,
  },
  itemPressed: { backgroundColor: clubSurface.divider },
  itemText: {
    fontSize: 14.5,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  itemTextActive: { color: colors.text, fontWeight: '800' },
});
