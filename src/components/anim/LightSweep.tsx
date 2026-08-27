// LightSweep — one pass of a soft highlight across a primary CTA, shortly
// after the screen settles. Once. Never a loop.
//
// The existing Shimmer loops forever by design — it is the skeleton-screen
// building block, where the repetition IS the "still loading" signal. On a
// real button that same repetition is a blinking advert. So this is a separate
// primitive rather than a flag on that one: they mean opposite things.
//
// Non-negotiables, since this is the effect most likely to cheapen a screen:
//   • at most ONE per viewport — a screen with two sweeping buttons has no
//     primary action;
//   • the button's own colour is untouched; the band is white at low alpha,
//     laid OVER it and clipped to its bounds;
//   • pointerEvents 'none' — the sweep must never eat the tap it is
//     advertising.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { motion } from '@/theme/motion';

interface Props {
  children: React.ReactNode;
  /** Let a caller suppress it when this isn't the screen's primary action
   *  (e.g. the CTA is disabled, or another card already owns the sweep). */
  active?: boolean;
  delayMs?: number;
  style?: ViewStyle;
}

export function LightSweep({
  children,
  active = true,
  delayMs = motion.sweep.delayMs,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const { width: screenW } = useWindowDimensions();
  // Travel is measured against the widest the button could be. Overshooting
  // costs nothing (the band is clipped) and avoids an onLayout round-trip that
  // would delay the sweep past the moment it is meant to land.
  const travel = screenW;
  const x = useSharedValue(-travel);
  const played = useRef(false);

  useEffect(() => {
    // Reduce Motion: no sweep. It is decoration, and decoration is the first
    // thing that setting is asking us to drop.
    if (!active || reduced || played.current) return;
    played.current = true;
    x.value = withDelay(
      delayMs,
      withTiming(travel, {
        duration: motion.sweep.durationMs,
        easing: motion.easing.inOut,
      }),
    );
  }, [active, delayMs, reduced, travel, x]);

  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: '18deg' }],
  }));

  return (
    <View style={[styles.host, style]}>
      {children}
      {active && !reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.band, { width: travel * 0.28 }, bandStyle]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // overflow hidden clips the band to the button's own rounded shape, so the
  // highlight can't leak past the corners onto the screen behind it.
  //
  // NOTHING else. No alignSelf, no flex, no size: the wrapper has to be
  // layout-neutral or it changes the very button it is decorating — which is
  // the one thing this whole layer is not allowed to do. Callers pass the
  // matching borderRadius; a wrapper that guessed 999 would square off the
  // corners of a 14-radius button.
  host: { overflow: 'hidden' },
  band: {
    position: 'absolute',
    top: -40,
    bottom: -40,
    backgroundColor: '#FFFFFF',
    opacity: motion.sweep.opacity,
  },
});
