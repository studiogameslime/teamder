// LivingIcon — wraps any icon (Ionicon, emoji, child) in a subtle, endless
// motion so static glyphs feel alive, in the spirit of AnimatedWeatherIcon.
// Instead of hand-drawing every icon as SVG, this applies a tasteful looping
// reanimated transform to whatever child you give it:
//
//   spin   — slow continuous rotation (a football, a refresh, a globe)
//   pulse  — gentle scale heartbeat (people, friends, a trophy)
//   bounce — soft vertical bob (a notification bell, a location pin)
//   sway   — small left↔right tilt (a flag, a chat bubble)
//   shine  — opacity twinkle (a star, a badge)
//
// All loops are slow + low-amplitude on purpose — ambient life, not a
// distraction. Respects the platform; a host without reanimated still
// renders the static child (the Animated.View is a no-op transform).

import React, { useEffect } from 'react';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

export type LivingMotion = 'spin' | 'pulse' | 'bounce' | 'sway' | 'shine' | 'hop';

interface Props {
  motion: LivingMotion;
  children: React.ReactNode;
  /** Multiplier on the base period — >1 slower, <1 faster. Default 1. */
  speed?: number;
  /** Pause the animation (e.g. off-screen). Default false. */
  paused?: boolean;
  style?: ViewStyle;
}

export function LivingIcon({
  motion,
  children,
  speed = 1,
  paused = false,
  style,
}: Props) {
  const v = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(v);
      return;
    }
    switch (motion) {
      case 'spin':
        v.value = 0;
        v.value = withRepeat(
          withTiming(1, { duration: 4200 * speed, easing: Easing.linear }),
          -1,
          false,
        );
        break;
      case 'pulse':
        v.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 750 * speed, easing: Easing.inOut(Easing.quad) }),
            withTiming(0, { duration: 750 * speed, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          false,
        );
        break;
      case 'bounce':
        v.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 520 * speed, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 620 * speed, easing: Easing.in(Easing.quad) }),
          ),
          -1,
          false,
        );
        break;
      case 'sway':
        v.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 900 * speed, easing: Easing.inOut(Easing.quad) }),
            withTiming(-1, { duration: 900 * speed, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          true,
        );
        break;
      case 'shine':
        v.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 1100 * speed }),
            withTiming(0, { duration: 1100 * speed }),
          ),
          -1,
          false,
        );
        break;
      case 'hop':
        // A quick jump-and-land, then a long REST before the next — so it
        // catches the eye every few seconds instead of moving constantly.
        // `speed` scales the rest (default ≈ a hop every ~10s).
        v.value = withRepeat(
          withSequence(
            withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) }),
            withTiming(0, { duration: 340, easing: Easing.in(Easing.quad) }),
            withTiming(0, { duration: 9400 * speed }),
          ),
          -1,
          false,
        );
        break;
    }
    return () => cancelAnimation(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion, speed, paused]);

  const animatedStyle = useAnimatedStyle(() => {
    switch (motion) {
      case 'spin':
        return { transform: [{ rotateZ: `${v.value * 360}deg` }] };
      case 'pulse':
        return { transform: [{ scale: 1 + v.value * 0.14 }] };
      case 'bounce':
        return { transform: [{ translateY: -v.value * 4 }] };
      case 'sway':
        return { transform: [{ rotateZ: `${v.value * 9}deg` }] };
      case 'shine':
        return { opacity: 0.55 + v.value * 0.45 };
      case 'hop':
        return { transform: [{ translateY: -v.value * 9 }, { scale: 1 + v.value * 0.06 }] };
      default:
        return {};
    }
  });

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
