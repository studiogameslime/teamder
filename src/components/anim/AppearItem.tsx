// AppearItem — wrap each row in a list with this and they slide-up +
// fade-in in a soft stagger as the list mounts. Use the `index` prop
// to space the items (delay = index * stepMs).
//
// One-shot: animates once when the component mounts, then stays put.
// Re-mount (via key change) replays the animation.

import React, { useEffect } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  /** Position in the list — controls the stagger delay. */
  index: number;
  /** Milliseconds between consecutive items. Default 55. */
  stepMs?: number;
  /** Maximum delay applied. Items past this are not staggered. Avoids
   *  long tails when the list is long. Default 480. */
  capMs?: number;
  /** Pixels the row travels up from. Default 18. */
  fromOffsetY?: number;
  /** Total animation duration per row. Default 360. */
  durationMs?: number;
  style?: ViewStyle;
}

export function AppearItem({
  children,
  index,
  stepMs = 55,
  capMs = 480,
  fromOffsetY = 18,
  durationMs = 360,
  style,
}: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    const delay = Math.min(index * stepMs, capMs);
    progress.value = withDelay(
      delay,
      withTiming(1, {
        duration: durationMs,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [progress, index, stepMs, capMs, durationMs]);

  const animStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * fromOffsetY }],
  }));

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
