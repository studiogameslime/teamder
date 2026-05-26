// PulseOnChange — wraps any view and triggers a one-shot scale pulse
// whenever its `triggerKey` prop changes. Use for "this number just
// changed" feedback (e.g. score after a goal, RSVP count after a
// join). Cheap, transform-only — runs on UI thread.

import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  /** Anything that changes triggers a pulse. Often the value
   *  itself: e.g. `triggerKey={scoreA}`. */
  triggerKey: string | number | boolean;
  /** Peak scale during the pulse. Default 1.25. */
  peakScale?: number;
  /** Total pulse duration. Default 360 ms. */
  durationMs?: number;
  /** Skip the initial pulse on mount — only pulse on subsequent
   *  changes. Default true (mount = no pulse). */
  skipInitial?: boolean;
  style?: ViewStyle;
}

export function PulseOnChange({
  children,
  triggerKey,
  peakScale = 1.25,
  durationMs = 360,
  skipInitial = true,
  style,
}: Props) {
  const scale = useSharedValue(1);
  const mounted = React.useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      if (skipInitial) return;
    }
    const half = durationMs / 2;
    scale.value = withSequence(
      withTiming(peakScale, { duration: half, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: half, easing: Easing.inOut(Easing.quad) }),
    );
  }, [triggerKey, scale, peakScale, durationMs, skipInitial]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.host, style, animStyle]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
