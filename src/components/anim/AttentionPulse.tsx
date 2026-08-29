// AttentionPulse — a very weak breath on a status that has a reason to be
// looked at. "מחזור בדרך", "3 מקומות אחרונים". NOT every badge: a screen where
// several things pulse has told the user nothing about which one matters.
//
// Two decisions worth stating, because both are the difference between polish
// and irritation:
//
//   It stops BY DEFAULT, and the caller can say otherwise. The original
//   argument — a badge still pulsing on minute two is a badge nobody sees —
//   holds for a status that goes stale, like "3 מקומות אחרונים". It does not
//   hold for "פעיל מאוד", which is a standing fact about a club and is met in
//   a scrolling feed: a finite pulse there fires while the card is still below
//   the fold and is over before anyone looks at it. Pass cycles={INFINITE} for
//   that case; keep a small number for anything urgent.
//
//   It never changes colour and never blinks. Scale and opacity only, and the
//   opacity floor is high enough that the text stays fully readable at every
//   point in the cycle.

import React, { useEffect, useRef } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { motion } from '@/theme/motion';

/** Reanimated reads a negative repeat count as "forever". Named, because
 *  `cycles={-1}` at a call site reads like a bug. */
export const INFINITE = -1;

interface Props {
  children: React.ReactNode;
  /** Off switch, so a caller can pulse only while the status is actually
   *  urgent (e.g. only while spots are nearly gone). Default true. */
  active?: boolean;
  /** Breaths before it settles. Default 3. One is often enough.
   *  Pass {@link INFINITE} to breathe for as long as the card is mounted. */
  cycles?: number;
  /** Wait for the screen's entrance to finish first. */
  delayMs?: number;
  style?: ViewStyle;
}

export function AttentionPulse({
  children,
  active = true,
  cycles = motion.pulse.maxCycles,
  delayMs = motion.duration.normal,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const played = useRef(false);

  useEffect(() => {
    // Reduce Motion gets no pulse at all — a repeating animation is exactly
    // what the setting asks us not to do. The badge simply sits there.
    // The latch stops a routine re-render from restarting a FINITE pulse
    // mid-breath. An infinite one has nothing to restart — it simply keeps
    // going — so it must not be latched, or the cleanup below would cancel it
    // on the first re-render and never start it again.
    const forever = cycles < 0;
    if (!active || reduced || (played.current && !forever)) return;
    played.current = true;

    const half = motion.pulse.periodMs / 2;
    const ease = { duration: half, easing: motion.easing.inOut };
    const breathe = <T,>(to: T, back: T) =>
      withDelay(
        delayMs,
        withRepeat(withSequence(withTiming(to as number, ease), withTiming(back as number, ease)), cycles, false),
      );
    scale.value = breathe(motion.pulse.scaleTo, 1);
    opacity.value = breathe(motion.pulse.opacityTo, 1);

    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [active, cycles, delayMs, opacity, reduced, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
