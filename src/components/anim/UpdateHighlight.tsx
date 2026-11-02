import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

export function UpdateHighlight({ at, children, style }: { at?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(progress); progress.value = 1;
    if (!reduced && at && Date.now() - at < 1000) { progress.value = 0; progress.value = withTiming(1, { duration: 750 }); }
    return () => cancelAnimation(progress);
  }, [at, reduced, progress]);
  const animated = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(progress.value, [0, 1], ['#E1F0FF', 'rgba(225,240,255,0)']) }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
