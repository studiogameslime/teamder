// ProfileCollectionCard — a compact, tappable list section for the
// user's OWN profile. Used to surface three small collections the user
// asked to see alongside the rest of the player card:
//   • games they created          ("משחקים שיצרתי")
//   • communities they opened      ("מועדונים שפתחתי")
//   • communities they joined      ("מועדונים שהצטרפתי")
//
// Visual language deliberately mirrors ProfileNextGameCard /
// ProfileActivityCard: a section header (icon + bold Hebrew title)
// above a white rounded card whose rows are hair-line divided. Each row
// is a leading round icon → label (+ optional subtitle) → chevron-back,
// so it reads as "tap to open" under forceRTL.
//
// Generic on purpose — both games and communities map onto the same
// row shape (id + label + subtitle + icon), so the screen builds the
// item arrays and this component just renders + routes the taps. When a
// collection is empty the whole section is hidden by the caller (no
// empty-state noise on a card the user may simply not have).

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { PressableScale } from '@/components/PressableScale';

export interface ProfileCollectionItem {
  id: string;
  label: string;
  /** Optional second line (e.g. city, member count, kickoff day). */
  subtitle?: string;
  /** Leading glyph inside the tinted round chip. */
  icon: keyof typeof Ionicons.glyphMap;
}

interface Props {
  title: string;
  /** Section-header glyph (next to the title). */
  headerIcon: keyof typeof Ionicons.glyphMap;
  /** Tint for the leading row chips + header icon. */
  accent: string;
  items: ProfileCollectionItem[];
  onPressItem: (id: string) => void;
}

export function ProfileCollectionCard({
  title,
  headerIcon,
  accent,
  items,
  onPressItem,
}: Props) {
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {/* `headerRow` flips under forceRTL so the icon (first JSX child)
          lands on the visual RIGHT, the title to its left — matching the
          other profile section headers. */}
      <View style={styles.headerRow}>
        <Ionicons name={headerIcon} size={18} color={colors.text} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <View style={styles.card}>
        {items.map((it, i) => (
          <PressableScale
            key={it.id}
            onPress={() => onPressItem(it.id)}
            style={[styles.row, i > 0 && styles.rowDivider]}
            // No press-in haptic: these rows sit in a scroll view, so a
            // press-in that's really the start of a scroll fired a stray
            // buzz while flicking through the player card (QA report).
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel={it.label}
          >
            <View style={[styles.iconWrap, { backgroundColor: tint(accent) }]}>
              <Ionicons name={it.icon} size={16} color={accent} />
            </View>
            <View style={styles.textWrap}>
              <Text style={styles.rowLabel} numberOfLines={1}>
                {it.label}
              </Text>
              {it.subtitle ? (
                <Text style={styles.rowSubtitle} numberOfLines={1}>
                  {it.subtitle}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-back" size={18} color="#94A3B8" />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

// Soft 12%-alpha background behind the glyph, derived from the accent.
function tint(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#EFF6FF';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  // `row` flips under forceRTL → leading icon on the visual RIGHT,
  // text in the middle, chevron on the visual LEFT.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    gap: 1,
  },
  rowLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
});
