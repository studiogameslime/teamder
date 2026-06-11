// RollInView — wraps a child (typically an avatar) and rolls it in like
// a ball entering the pitch: it translates in from the leading edge while
// spinning the matching arc, then settles with a small spring bounce.
//
// Used for participant rows so the squad reads as "taking the field" when
// the list appears. Stagger successive rows via `delayMs = index * step`.

import React, { useEffect } from 'react';
import { type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';

interface Props {
  children: React.ReactNode;
  /** Stagger delay before this item rolls in. Default 0. */
  delayMs?: number;
  /** Travel distance of the roll-in, in dp. Default 40. */
  distance?: number;
  style?: ViewStyle;
}

export function RollInView({
  children,
  delayMs = 0,
  distance = 40,
  style,
}: Props) {
  // 0 = off-pitch (translated + spun + faded), 1 = settled.
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withDelay(
      delayMs,
      withSpring(1, { damping: 13, stiffness: 150, mass: 0.7 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fade resolves a touch faster than the spring so the bounce lands on
  // a fully-opaque avatar.
  const opacity = useSharedValue(0);
  useEffect(() => {
    opacity.value = withDelay(
      delayMs,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animStyle = useAnimatedStyle(() => {
    // Roll in from the RIGHT (RTL leading edge): start +distance, end 0.
    const tx = (1 - p.value) * distance;
    // One ball-roll worth of spin across the travel (rightward entry →
    // clockwise as it moves left into place).
    const deg = (1 - p.value) * 200;
    return {
      opacity: opacity.value,
      transform: [{ translateX: tx }, { rotateZ: `${deg}deg` }],
    };
  });

  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}
