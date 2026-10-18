import React from 'react';
import { Image, View } from 'react-native';

const original = require('../../assets/images/support-football-headphones-original.png');
// Display the large button from the original 1024×1536 sketch, unchanged.
// The circular viewport excludes the caption, shadow and smaller preview.
const crop = { y: 194, diameter: 564 };

export function SupportFootballIcon({ size = 50 }: { size?: number }) {
  const scale = size / crop.diameter;
  return <View pointerEvents="none" accessible={false} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }}>
    <Image source={original} accessible={false} resizeMode="stretch" style={{
      position: 'absolute', width: 1024 * scale, height: 1536 * scale,
      // Centering preserves the crop under forceRTL, which swaps left/right.
      alignSelf: 'center', top: -crop.y * scale,
    }} />
  </View>;
}
