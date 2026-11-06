import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SkeletonRegion, SkeletonBlock as Block } from './ScreenSkeletons';

/** Matches ClubCard: details on the visual right and a cover on the left. */
function Card() {
  return <View style={s.card}>
    <View style={s.top}>
    <View style={s.body}>
      <Block style={{ width: '82%', height: 19 }} />
      <Block style={{ width: '55%', height: 16 }} />
      <Block style={{ width: '68%', height: 16 }} />
    </View>
    <Block style={s.cover} />
    </View>
    <View style={s.footer}><Block style={{ width: 88, height: 25, borderRadius: 12 }} /><Block style={{ width: 92, height: 24, borderRadius: 8 }} /></View>
  </View>;
}

export function ClubFeedSkeleton() {
  return <SkeletonRegion label="טוענים את המועדונים" gap={20}>
    <View style={s.section}><View style={s.title}><Block style={s.heading} /><Block style={s.underline} /></View><Card /></View>
    <View style={s.section}><View style={s.title}><Block style={[s.heading, { width: '54%' }]} /><Block style={s.underline} /><Block style={{ width: '72%', height: 15 }} /></View><Card /><Card /></View>
  </SkeletonRegion>;
}

const s = StyleSheet.create({
  section: { gap: 12 },
  title: { paddingHorizontal: 4, gap: 4 },
  heading: { width: '43%', height: 20 },
  underline: { width: 36, height: 3, borderRadius: 2 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, overflow: 'hidden', marginBottom: 12 },
  top: { flexDirection: 'row', minHeight: 104, alignItems: 'stretch' },
  body: { flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8, gap: 4, justifyContent: 'center' },
  footer: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12 },
  cover: { width: '41.5%', height: 'auto', alignSelf: 'stretch', borderRadius: 0, backgroundColor: '#E7EEF8' },
});
