// MatchDetailsGrid — single-line info rows, RTL.
//
// Each row reads as one horizontal line:
//   [icon] label                                  value
//   ─────  ─────                                  ─────
//   right                                         left
//   (trailing — visually right under forceRTL)    (leading — left)
//
// This matches the reference design's "info row" treatment: clean,
// plain icons in a consistent blue, label hugging the icon on the
// right, value floating on the left of the same line. Subtle hairline
// dividers separate rows but never compete with the content.
//
// Optional row-level action — when present, the WHOLE row is
// pressable AND a small inline icon shows up next to the value to
// hint at the affordance.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/Card';
import { spacing, typography, RTL_LABEL_ALIGN } from '@/theme';

interface Item {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string | null | undefined;
  action?: {
    /** Optional small icon shown next to the value to hint that
     *  the row is tappable (e.g. navigate icon for Waze). */
    icon?: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    accessibilityLabel?: string;
  };
}

interface Props {
  title?: string;
  items: Item[];
}

export function MatchDetailsGrid({ title, items }: Props) {
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Card style={styles.card}>
        {items.map((it, i) => (
          <Row key={`${it.label}-${i}`} item={it} showDivider={i > 0} />
        ))}
      </Card>
    </View>
  );
}

function Row({
  item,
  showDivider,
}: {
  item: Item;
  showDivider: boolean;
}) {
  const valueText =
    typeof item.value === 'string' && item.value.trim().length > 0
      ? item.value
      : '—';
  const inner = (
    <>
      <View style={styles.labelGroup}>
        {/* Order swapped: icon first → renders on the trailing
            (right) edge under our flex flow; label second → sits
            to its leading side. */}
        <Ionicons name={item.icon} size={20} color={ACCENT} />
        <Text style={styles.label} numberOfLines={1}>
          {item.label}
        </Text>
      </View>
      <View style={styles.valueGroup}>
        {item.action?.icon ? (
          <Ionicons name={item.action.icon} size={16} color={ACCENT} />
        ) : null}
        <Text style={styles.value} numberOfLines={2}>
          {valueText}
        </Text>
      </View>
    </>
  );

  if (item.action) {
    return (
      <Pressable
        onPress={item.action.onPress}
        accessibilityRole="button"
        accessibilityLabel={item.action.accessibilityLabel}
        style={({ pressed }) => [
          styles.row,
          showDivider && styles.rowDivider,
          pressed && { backgroundColor: 'rgba(15,23,42,0.03)' },
        ]}
      >
        {inner}
      </Pressable>
    );
  }
  return (
    <View style={[styles.row, showDivider && styles.rowDivider]}>{inner}</View>
  );
}

const ACCENT = '#3B82F6';

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  title: {
    ...typography.body,
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 15,
    textAlign: RTL_LABEL_ALIGN,
    marginHorizontal: spacing.xs,
  },
  card: {
    padding: 0,
    overflow: 'hidden',
    borderRadius: 18,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  // Each row is one horizontal line. `space-between` pushes the
  // label group to the trailing (right, RTL) edge and the value
  // group to the leading (left) edge — same template every row.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(15,23,42,0.06)',
  },
  // Label group — icon at the far right, label to its leading
  // (left) side, snug. Trailing edge of the row.
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  label: {
    ...typography.caption,
    color: '#64748B',
    fontWeight: '600',
    fontSize: 14,
  },
  // Value group — value on the leading edge, optional small action
  // icon to its trailing side (so it doesn't crowd the value text).
  valueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  value: {
    color: '#0F172A',
    fontWeight: '700',
    fontSize: 15,
    textAlign: RTL_LABEL_ALIGN,
  },
});
