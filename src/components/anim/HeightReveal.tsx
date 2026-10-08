import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Intrinsic height follows text size; only the reveal animates, not the data. */
export function HeightReveal({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const [height, setHeight] = useState(0);
  const shown = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(shown);
    shown.value = withTiming(visible ? height : 0, { duration: reduced ? 0 : 260, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(shown);
  }, [visible, height, reduced, shown]);
  const motion = useAnimatedStyle(() => ({ height: shown.value, opacity: height ? Math.min(1, shown.value / height) : 0 }));
  return <Animated.View style={[{ overflow: 'hidden' }, motion]} pointerEvents={visible ? 'auto' : 'none'} accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}>
    <View style={{ position: 'absolute', top: 0, width: '100%' }} onLayout={e => setHeight(e.nativeEvent.layout.height)}>{children}</View>
  </Animated.View>;
}
