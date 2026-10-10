import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font } from '../theme';
import type { RatingSummary } from '../types';
import { Card, StarRow } from './ui';

export function RatingHistogram({ r }: { r: RatingSummary }) {
  const max = Math.max(...r.histogram, 1);
  const label = r.source === 'appstore' ? 'App Store' : 'Google Play';
  const accent = r.source === 'appstore' ? colors.appstore : colors.googleplay;
  return (
    <Card style={{ gap: 10 }}>
      <View style={styles.head}>
        <Text style={font.h2}>{label}</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.avg, { color: accent }]}>{r.average.toFixed(2)}</Text>
        <StarRow rating={r.average} size={16} />
      </View>
      <Text style={font.small}>
        {r.total} ביקורות{r.approximate ? ' (מדגם אחרון)' : ''}
      </Text>
      {[5, 4, 3, 2, 1].map((star) => {
        const count = r.histogram[star - 1];
        const w = (count / max) * 100;
        return (
          <View key={star} style={styles.barRow}>
            <Text style={styles.starLabel}>{star}★</Text>
            <View style={styles.track}>
              <View
                style={[styles.fill, { width: `${w}%`, backgroundColor: accent }]}
              />
            </View>
            <Text style={styles.count}>{count}</Text>
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avg: { fontSize: 22, fontWeight: '800' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  starLabel: { ...font.small, width: 26, color: colors.textSoft },
  track: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: 10, borderRadius: 5 },
  count: { ...font.small, width: 34, textAlign: 'left' },
});
