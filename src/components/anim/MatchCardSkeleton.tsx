// MatchCardSkeleton — placeholder rectangle that visually previews the
// shape of a MatchListCard while the real data is loading. Three of
// these stacked reads as "loading list" much better than a spinner —
// users see the layout settle into the same vertical rhythm the cards
// will land in.
//
// Dimensions match MatchListCard roughly (~140 px tall, full-width
// rounded card). Tune sparingly: a skeleton that's the wrong height
// shoves layout when the real data arrives.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Shimmer } from './Shimmer';
import { radius, spacing } from '@/theme';

interface Props {
  /** How many skeleton cards to render. Default 3. */
  count?: number;
}

export function MatchCardSkeleton({ count = 3 }: Props) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.headerRow}>
            <Shimmer style={styles.titleBlock} />
            <Shimmer style={styles.statusPill} />
          </View>
          <View style={styles.metaRow}>
            <Shimmer style={styles.metaBlock} />
            <Shimmer style={styles.metaBlock} />
          </View>
          <Shimmer style={styles.ctaBlock} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleBlock: {
    height: 18,
    width: '55%',
    borderRadius: 6,
  },
  statusPill: {
    height: 22,
    width: 70,
    borderRadius: 999,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metaBlock: {
    height: 14,
    flex: 1,
    borderRadius: 6,
  },
  ctaBlock: {
    height: 38,
    width: '100%',
    borderRadius: 999,
    marginTop: spacing.xs,
  },
});
