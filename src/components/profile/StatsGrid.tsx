// StatsGrid — 2×2 layout of compact StatCards.
// Pure presentational; the screen passes the four pre-formatted stats.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StatCard } from './StatCard';
import { colors, spacing } from '@/theme';

interface Stat {
  label: string;
  value: string;
  tint?: string;
  icon?: React.ComponentProps<typeof StatCard>['icon'];
}

interface Props {
  /** Exactly 4 stats expected; rendered as 2 rows of 2. Extras are
   *  dropped, missing entries collapse the row. */
  stats: Stat[];
}

export function StatsGrid({ stats }: Props) {
  // Slice to 4 to enforce the 2x2 contract — extra stats belong in
  // their own card below the grid (e.g. ReferralCard).
  const items = stats.slice(0, 4);
  return (
    <View style={styles.grid}>
      {items.map((s, i) => (
        <View key={`${s.label}-${i}`} style={styles.cell}>
          <StatCard
            label={s.label}
            value={s.value}
            tint={s.tint}
            icon={s.icon}
          />
        </View>
      ))}
    </View>
  );
}

const GAP = spacing.sm;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Negative margin trick — gives even spacing between cells
    // without extra View wrappers per row.
    margin: -GAP / 2,
  },
  cell: {
    width: '50%',
    padding: GAP / 2,
  },
  // Background swatch reserved if we ever want a tinted backdrop.
  _bg: { backgroundColor: colors.surfaceMuted },
});
