// CommunityStatsGrid — 2×2 grid of premium stat cards for the
// redesigned CommunityDetailsScreen. Each card: small grey label, big
// bold value, and a soft-tinted icon disc on the trailing edge of the
// card (icon visually right under forceRTL).
//
// The four cards always render in this order:
//   row 1 → תאריך הקמה · חברים בקהילה
//   row 2 → מגרש קבוע   · מפגשים שנערכו
//
// All cards have identical height/padding/shadow so the grid reads as
// a single rhythmic block.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';

export interface CommunityStat {
  icon: keyof typeof Ionicons.glyphMap;
  /** Short caption, e.g. "תאריך הקמה". */
  label: string;
  /** Pre-formatted value, e.g. "12.05.2024" or "23". */
  value: string;
  /** Optional accent color for the icon disc + glyph. */
  tint?: string;
}

interface Props {
  /** Exactly 4 items expected. Extras dropped, missing slots blank. */
  items: CommunityStat[];
}

const ACCENT = '#3B82F6';

export function CommunityStatsGrid({ items }: Props) {
  const cells = items.slice(0, 4);
  return (
    <View style={styles.grid}>
      {cells.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.cell}>
          <StatCard stat={it} />
        </View>
      ))}
    </View>
  );
}

function StatCard({ stat }: { stat: CommunityStat }) {
  const tint = stat.tint ?? ACCENT;
  return (
    <View style={styles.card}>
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={1}>
          {stat.label}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {stat.value}
        </Text>
      </View>
      <View
        style={[
          styles.iconDisc,
          { backgroundColor: hexWithAlpha(tint, 0.12) },
        ]}
      >
        <Ionicons name={stat.icon} size={20} color={tint} />
      </View>
    </View>
  );
}

// Convert a 6-char hex to rgba with the given alpha. Used to derive a
// soft tint of the icon's accent color for the disc background.
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const GAP = spacing.md;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    margin: -GAP / 2,
  },
  cell: {
    width: '50%',
    padding: GAP / 2,
  },
  // Card chrome — white, generously rounded, soft shadow so the card
  // reads as "lifted" without competing with the dark hero above.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 76,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  value: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  iconDisc: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
