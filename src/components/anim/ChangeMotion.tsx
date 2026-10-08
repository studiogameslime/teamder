import React, { useEffect, useRef } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Visual feedback only. Never delays or completes a business action. */
export function ChangeMotion({ children, triggerKey, style, pulse = false, enter = false, duration = 240, delay = 0 }: {
  children: React.ReactNode;
  triggerKey: string | number | boolean;
  style?: StyleProp<ViewStyle>;
  pulse?: boolean;
  enter?: boolean;
  duration?: number;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  const previous = useRef(triggerKey);
  const mounted = useRef(false);
  useEffect(() => {
    const changed = previous.current !== triggerKey;
    previous.current = triggerKey;
    const initial = !mounted.current;
    mounted.current = true;
    cancelAnimation(progress);
    if (reduced || (!changed && !(initial && enter))) {
      progress.value = 1;
      return;
    }
    progress.value = 0;
    progress.value = withDelay(delay, withTiming(1, { duration, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(progress);
  }, [triggerKey, reduced, enter, duration, delay, progress]);
  const animated = useAnimatedStyle(() => ({
    opacity: pulse ? 1 : 0.78 + progress.value * 0.22,
    transform: pulse
      ? [{ scale: 1 + Math.sin(progress.value * Math.PI) * 0.06 }]
      : [{ translateY: reduced ? 0 : (1 - progress.value) * 5 }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** Both halves of a split stats row use the same index and row height. */
export function ReorderMotion({ children, index, rowHeight, style }: {
  children: React.ReactNode; index: number; rowHeight: number; style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const previous = useRef(index);
  const y = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(y);
    const delta = previous.current - index;
    previous.current = index;
    y.value = reduced ? 0 : Math.max(-6, Math.min(6, delta)) * rowHeight;
    y.value = withTiming(0, { duration: reduced ? 0 : 260, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(y);
  }, [index, reduced, rowHeight, y]);
  const animated = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
