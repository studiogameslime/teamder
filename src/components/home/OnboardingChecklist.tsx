// OnboardingChecklist — the "בוא נתחיל" activation card on the home screen.
//
// A small green progress ring (done / total) next to the title, then one row
// per setup step: an icon disc, the step label, and a checkbox that fills in
// green when done. Tapping a row jumps to where that step is completed.
//
// The card is purely presentational — the parent computes each step's `done`
// state from live data (photo, availability, communities, games) and decides
// whether to render the card at all (it's hidden once everything is done).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface ChecklistItem {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  done: boolean;
  onPress: () => void;
}

const GREEN = '#16A34A';

function ProgressRing({
  done,
  total,
  size = 40,
  stroke = 5,
}: {
  done: number;
  total: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? done / total : 0;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={cx} cy={cy} r={r} stroke="#E2E8F0" strokeWidth={stroke} fill="none" />
        {done > 0 ? (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={GREEN}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${c * frac} ${c}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ) : null}
      </Svg>
      <Text style={styles.ringText}>{`${done}/${total}`}</Text>
    </View>
  );
}

export function OnboardingChecklist({ items }: { items: ChecklistItem[] }) {
  const done = items.filter((i) => i.done).length;
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <ProgressRing done={done} total={items.length} />
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>
            {he.homeChecklistTitle} ⚡
          </Text>
          <Text style={styles.subtitle}>{he.homeChecklistSubtitle}</Text>
        </View>
      </View>

      {items.map((item, idx) => (
        <Pressable
          key={item.key}
          onPress={item.onPress}
          disabled={item.done}
          style={({ pressed }) => [
            styles.row,
            idx > 0 && styles.rowBorder,
            pressed && !item.done && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <View style={[styles.iconDisc, item.done && styles.iconDiscDone]}>
            <Ionicons
              name={item.icon}
              size={18}
              color={item.done ? GREEN : '#64748B'}
            />
          </View>
          <Text
            style={[styles.rowLabel, item.done && styles.rowLabelDone]}
            numberOfLines={1}
          >
            {item.label}
          </Text>
          {item.done ? (
            <Ionicons name="checkmark-circle" size={22} color={GREEN} />
          ) : (
            <View style={styles.checkbox} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerTextWrap: { flex: 1 },
  ringText: { fontSize: 11, fontWeight: '800', color: colors.text },
  title: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  iconDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDiscDone: { backgroundColor: '#DCFCE7' },
  rowLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  rowLabelDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
});
