// DraftScalePop — tiny, robust scale transitions for the draft board, built
// on plain shared values (NOT Reanimated layout animations like ZoomIn/
// exiting, which throw "Unable to find viewState" when views unmount mid-
// transition inside the Breathing-wrapped cards).
//
//   <GrowIn>   — scales a freshly-mounted child up from 0 → 1.
//   <ShrinkOut>— scales a child down 1 → 0, then calls onDone so the parent
//                can drop it from state (an in-place "ghost" of a removed item).

import React, { useEffect } from 'react';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const DURATION = 300;

export function GrowIn({ children }: { children: React.ReactNode }) {
  const s = useSharedValue(0);
  useEffect(() => {
    s.value = withTiming(1, { duration: DURATION, easing: Easing.out(Easing.back(1.4)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: s.value,
    transform: [{ scale: s.value }],
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
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withTiming(
      0,
      { duration: DURATION, easing: Easing.in(Easing.quad) },
      (finished) => {
        if (finished) runOnJS(onDone)();
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    opacity: s.value,
    transform: [{ scale: s.value }],
  }));
  return <Animated.View style={style}>{children}</Animated.View>;
}
