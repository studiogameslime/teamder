// MatchCardSkeleton — placeholder rectangle that visually previews the
// shape of a MatchListCard while the real data is loading. Three of
// these stacked reads as "loading list" much better than a spinner —
// users see the layout settle into the same vertical rhythm the cards
// will land in.
//
// MatchListCard has a split 126-point top, occupancy track and action footer.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonRegion, SkeletonBlock } from '@/components/loading/ScreenSkeletons';
import { spacing } from '@/theme';

interface Props {
  /** How many skeleton cards to render. Default 3. */
  count?: number;
}

export function MatchCardSkeleton({ count = 3 }: Props) {
  return (
    <SkeletonRegion label="טוענים את המחזורים">
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={styles.card}>
          <View style={styles.top}>
            <View style={styles.details}>
              <SkeletonBlock style={{ width: '82%', height: 19 }} />
              <SkeletonBlock style={{ width: '92%', height: 19 }} />
              <SkeletonBlock style={{ width: '84%', height: 15 }} />
              <SkeletonBlock style={{ width: '69%', height: 15, marginTop: 2 }} />
            </View>
            <SkeletonBlock style={styles.photo} />
          </View>
          <SkeletonBlock style={styles.progress} />
          <View style={styles.bottom}>
            <View style={styles.tags}><SkeletonBlock style={styles.tag} /><SkeletonBlock style={styles.tag} /></View>
            <SkeletonBlock style={styles.action} />
          </View>
        </View>
      ))}
    </View>
    </SkeletonRegion>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E8EDF5',
    overflow: 'hidden',
  },
  top: { flexDirection: 'row', alignItems: 'stretch', minHeight: 126 },
  details: { flex: 1, padding: 12, gap: 4 },
  photo: { width: '35%', height: 'auto', borderRadius: 18, marginBottom: 8, backgroundColor: '#DCE6F5' },
  progress: { height: 5, marginHorizontal: 12, marginTop: 2, borderRadius: 3 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  tags: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  tag: { width: 48, maxWidth: '42%', height: 20, borderRadius: 10 },
  action: { width: '39%', maxWidth: '49%', height: 36, borderRadius: 10 },
});
