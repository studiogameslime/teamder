import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import type { NameCount } from '../types';

// Ranked horizontal bars for any name→value breakdown.
export function BarList({
  data,
  color = colors.primary,
  format,
  max,
}: {
  data: NameCount[];
  color?: string;
  format?: (n: number) => string;
  max?: number;
}) {
  if (!data.length) {
    return <Text style={styles.empty}>אין נתונים</Text>;
  }
  const peak = max ?? Math.max(...data.map((d) => d.value), 1);
  const fmt = format ?? ((n: number) => String(n));
  return (
    <View style={{ gap: 9 }}>
      {data.map((d, i) => (
        <View key={d.name + i} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>
            {d.name}
          </Text>
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${(d.value / peak) * 100}%`, backgroundColor: color },
              ]}
            />
          </View>
          <Text style={styles.value}>{fmt(d.value)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { ...font.body, color: colors.text, width: 96 },
  track: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: 4 },
  value: { ...font.small, color: colors.textSoft, width: 52, textAlign: 'left' },
  empty: { ...font.small, color: colors.textMuted },
});
