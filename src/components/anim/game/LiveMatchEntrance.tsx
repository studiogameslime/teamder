import React, { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/hooks/animations';
import { ANIM } from './animConfig';

interface LiveMatchEntranceProps {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * Anim 7 — the "the match started" entrance for the live screen. Plays ONCE on
 * mount (a fresh navigation = a fresh mount), so it works identically whether
 * the user came from MatchDetails, a push, or a deep link — it depends only on
 * this screen mounting, never on a source screen or a shared element.
 *
 * Navigation is NOT gated by this: the caller navigates immediately and this
 * surface simply fades + settles in on the destination. Reduce Motion → a plain
 * fade, no travel.
 */
export function LiveMatchEntrance({ style, children }: LiveMatchEntranceProps) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(reduced ? 0 : 8);

  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: reduced ? ANIM.duration.reducedFade : ANIM.duration.action,
      easing: ANIM.easing.out,
    });
    if (!reduced) {
      translateY.value = withTiming(0, {
        duration: ANIM.duration.action + 80,
        easing: ANIM.easing.out,
      });
    }
    // One-shot on mount — deliberately no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View style={[{ flex: 1 }, style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
