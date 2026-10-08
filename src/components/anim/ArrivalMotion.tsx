import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Timestamp prevents virtualized rows replaying an old arrival on remount. */
export function ArrivalMotion({ at, children, style }: { at?: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 1;
    if (!reduced && at && Date.now() - at < 400) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
    }
    return () => cancelAnimation(progress);
  }, [at, reduced, progress]);
  const motion = useAnimatedStyle(() => ({
    opacity: 0.35 + progress.value * 0.65,
    transform: [{ translateX: reduced ? 0 : (1 - progress.value) * 22 }, { scale: 0.94 + progress.value * 0.06 }],
  }));
  return <Animated.View style={[style, motion]}>{children}</Animated.View>;
}
