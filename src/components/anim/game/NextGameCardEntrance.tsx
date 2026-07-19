import React, { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/animations';
import { ANIM } from './animConfig';

interface NextGameCardEntranceProps {
  /**
   * Changes ONLY when a genuinely different game is shown (pass the game id).
   * A realtime update of the same game keeps the same key → no replay. A
   * null/undefined key holds the content hidden until a real game arrives.
   */
  triggerKey: string | number | null | undefined;
  /** Stagger slot: later children begin later (0 = first). */
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Anim 5 — a quiet, quality entrance for the home "next game" card: a short
 * fade with a small upward rise, played ONCE per new game. Because it is keyed
 * on `triggerKey`, it never re-fires on a realtime timer/player-count update of
 * the same game or on returning to the home tab (the screen stays mounted).
 *
 * Reduce Motion → a plain fade only (no vertical travel, no stagger delay).
 * Purely presentational: it never gates data, navigation, or a server call.
 */
export function NextGameCardEntrance({
  triggerKey,
  index = 0,
  style,
  children,
}: NextGameCardEntranceProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduced ? 0 : 12);
  const lastKey = useRef<string | number | null>(null);

  useEffect(() => {
    if (triggerKey == null) return;
    if (lastKey.current === triggerKey) return; // same game → don't replay
    lastKey.current = triggerKey;

    const delay = reduced ? 0 : index * 80; // 70–100ms stagger per spec
    opacity.value = 0;
    translateY.value = reduced ? 0 : 12;
    opacity.value = withDelay(
      delay,
      withTiming(1, {
        duration: reduced ? ANIM.duration.reducedFade : ANIM.duration.action,
        easing: ANIM.easing.out,
      }),
    );
    if (!reduced) {
      translateY.value = withDelay(
        delay,
        withTiming(0, {
          duration: ANIM.duration.action,
          easing: ANIM.easing.out,
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerKey, reduced, index]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
