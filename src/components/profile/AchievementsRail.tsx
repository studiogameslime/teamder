// AchievementsRail — horizontal row of circular achievement
// badges. Each badge is a thin outer ring + an icon centred
// inside; unlocked badges use the brand-blue ring + colored icon,
// locked badges fade to a muted gray. The "see all" link sits at
// the leading edge of the title row.
//
// Pure SVG arcs would give us partial-progress rings, but we
// don't currently surface partial progress (each achievement is a
// boolean threshold). Until that changes, a flat ring keeps the
// visual closer to the reference design without dragging in
// react-native-svg just for this.

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { AchievementListItem } from '@/services/achievementsService';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Props {
  items: AchievementListItem[];
  onSeeAll: () => void;
}

const SIZE = 64;

export function AchievementsRail({ items, onSeeAll }: Props) {
  if (items.length === 0) return null;
  // Order: unlocked first, then locked. Within each, catalog order.
  const ordered = [...items].sort((a, b) => {
    if (a.unlocked === b.unlocked) return 0;
    return a.unlocked ? -1 : 1;
  });
  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        {/* Order swapped: title first → renders on the leading
            (left) side under our flex flow; "הצג הכל" second →
            renders on the trailing (right) side. */}
        <Text style={styles.title}>{he.achievementsTitle}</Text>
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={styles.seeAll}>{he.achievementsSeeAll}</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {ordered.map((it) => (
          <View key={it.def.id} style={styles.cell}>
            <View
              style={[
                styles.ring,
                it.unlocked ? styles.ringUnlocked : styles.ringLocked,
              ]}
            >
              <View
                style={[
                  styles.bg,
                  it.unlocked ? styles.bgUnlocked : styles.bgLocked,
                ]}
              >
                <Ionicons
                  name={it.def.icon}
                  size={26}
                  color={it.unlocked ? '#3B82F6' : colors.textMuted}
                />
              </View>
            </View>
            <Text
              style={[
                styles.label,
                it.unlocked ? null : styles.labelLocked,
              ]}
              numberOfLines={1}
            >
              {it.def.titleHe}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  seeAll: {
    ...typography.caption,
    color: '#3B82F6',
    fontWeight: '700',
  },
  rail: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  cell: {
    alignItems: 'center',
    gap: 6,
    width: SIZE + 24,
  },
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringUnlocked: { borderColor: '#3B82F6' },
  ringLocked: { borderColor: colors.divider },
  bg: {
    width: SIZE - 8,
    height: SIZE - 8,
    borderRadius: (SIZE - 8) / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bgUnlocked: { backgroundColor: '#EFF6FF' },
  bgLocked: { backgroundColor: colors.surfaceMuted },
  label: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '700',
    fontSize: 11,
    textAlign: 'center',
  },
  labelLocked: { color: colors.textMuted, fontWeight: '500' },
});
