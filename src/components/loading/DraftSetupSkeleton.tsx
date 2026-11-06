import React from 'react';
import { View } from 'react-native';
import { SkeletonRegion, SkeletonBlock as Block } from './ScreenSkeletons';

/** The method chooser's four rows, without suggesting a method is selected. */
export function DraftSetupSkeleton() {
  return <SkeletonRegion label="טוענים את נתוני הכוחות">
    <View style={{ padding: 16, gap: 12 }}>
      <Block style={{ height: 31, width: '62%', alignSelf: 'center', marginBottom: 6 }} />
      <Block style={{ height: 17, width: '88%', marginBottom: 10 }} />
      {Array.from({ length: 4 }, (_, index) => <View key={index} style={{
        minHeight: 104, padding: 18, borderRadius: 24, backgroundColor: '#FFFFFF',
        flexDirection: 'row', alignItems: 'center', gap: 12,
      }}>
        <Block style={{ width: 44, height: 44, borderRadius: 22 }} />
        <View style={{ flex: 1, gap: 9 }}>
          <Block style={{ width: '65%', height: 20 }} />
          <Block style={{ width: '94%', height: 15 }} />
        </View>
        <Block style={{ width: 20, height: 20, borderRadius: 10 }} />
      </View>)}
      <Block style={{ height: 50, width: '100%', borderRadius: 14, marginTop: 10 }} />
    </View>
  </SkeletonRegion>;
}
