// SummaryGrid — 2×2 grid of SummaryCards. Pure presentational; the
// caller passes the four pre-formatted entries.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SummaryCard } from './SummaryCard';
import type { Ionicons } from '@expo/vector-icons';
import { spacing } from '@/theme';

interface Item {
  label: string;
  value: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface Props {
  /** Exactly 4 items expected; rendered as 2 rows of 2. Extras drop. */
  items: Item[];
}

export function SummaryGrid({ items }: Props) {
  const cells = items.slice(0, 4);
  return (
    <View style={styles.grid}>
      {cells.map((it, i) => (
        <View key={`${it.label}-${i}`} style={styles.cell}>
          <SummaryCard label={it.label} value={it.value} icon={it.icon} />
        </View>
      ))}
    </View>
  );
}

// Gap between the 4 cells. spacing.md (12) gives the cards a tiny
// bit of air — sm (8) made the grid look like one tight block.
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
});
