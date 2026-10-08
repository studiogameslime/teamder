import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
// DraftScalePop — tiny, robust scale transitions for the draft board, built
// on plain shared values (NOT Reanimated layout animations like ZoomIn/
// exiting, which throw "Unable to find viewState" when views unmount mid-
// transition inside the Breathing-wrapped cards).
//
//   <GrowIn>   — brings a freshly-mounted child in with a short fade and slide.
//   <ShrinkOut>— scales a child down 1 → 0, then calls onDone so the parent
//                can drop it from state (an in-place "ghost" of a removed item).

import React, { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const DURATION = 240;

export function GrowIn({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = reduced ? 1 : 0;
    s.value = withTiming(1, { duration: reduced ? 0 : DURATION, easing: Easing.out(Easing.cubic) });
    return () => cancelAnimation(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, s]);
  const style = useAnimatedStyle(() => ({
    opacity: s.value,
    transform: [{ translateX: reduced ? 0 : (1 - s.value) * 16 }, { scale: reduced ? 1 : 0.85 + s.value * 0.15 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

export function ShrinkOut({
  children,
  onDone,
}: {
  children: React.ReactNode;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withTiming(
      0,
      { duration: reduced ? 0 : DURATION, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    return () => cancelAnimation(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, s]);
  const style = useAnimatedStyle(() => ({
    opacity: s.value,
    transform: [{ translateX: reduced ? 0 : (1 - s.value) * 16 }, { scale: reduced ? 1 : 0.85 + s.value * 0.15 }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
