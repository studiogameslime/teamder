// Breathing — wraps any element in a gentle, never-ending "alive"
// motion so the screen is never fully static. Two modes:
//   • 'pulse' (default): scale 1 ↔ `amount` (a soft heartbeat)
//   • 'bob': translateY 0 ↔ -`amount` px (a slow float)
//
// Tuned to be subtle by default — the goal is "the app is breathing",
// not "this thing is shaking". Runs on the UI thread via Reanimated.
// Respects an optional `active` flag so callers can pause it.

import React, { useEffect } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  /** 'pulse' = scale, 'bob' = vertical float. Default 'pulse'. */
  mode?: 'pulse' | 'bob';
  /** Pulse: extra scale (0.05 = ±5%). Bob: px of travel. Defaults: 0.05 / 6. */
  amount?: number;
  /** One full cycle duration, ms. Default 1600. */
  periodMs?: number;
  /** Stagger so multiple breathers don't move in lockstep. Default 0. */
  delayMs?: number;
  active?: boolean;
  style?: ViewStyle;
}

export function Breathing({
  children,
  mode = 'pulse',
  amount,
  periodMs = 1600,
  delayMs = 0,
  active = true,
  style,
}: Props) {
  const amt = amount ?? (mode === 'pulse' ? 0.05 : 6);
  const t = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 200 });
      return;
    }
    const half = periodMs / 2;
    const run = () => {
      t.value = withRepeat(
        withSequence(
          withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: half, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      );
    };
    const id = setTimeout(run, delayMs);
    return () => {
      clearTimeout(id);
      cancelAnimation(t);
    };
  }, [active, periodMs, delayMs, t]);

  const animStyle = useAnimatedStyle(() => {
    if (mode === 'bob') {
      return { transform: [{ translateY: -t.value * amt }] };
    }
    return { transform: [{ scale: 1 + t.value * amt }] };
  });

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
