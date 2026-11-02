import React, { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

/** Content is usable immediately. Only a first loading-to-ready transition fades. */
export function ContentReveal({ ready, scopeKey, children, style }: {
  ready: boolean; scopeKey: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  const state = useRef({ scope: scopeKey, waited: !ready, revealed: false });
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = 1;
    if (state.current.scope !== scopeKey) state.current = { scope: scopeKey, waited: !ready, revealed: false };
    if (!ready) { state.current.waited = true; return; }
    if (state.current.waited && !state.current.revealed) {
      state.current.revealed = true;
      if (!reduced) {
        opacity.value = 0.78;
        opacity.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    }
    return () => cancelAnimation(opacity);
  }, [ready, scopeKey, reduced, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: ready ? opacity.value : 1 }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
