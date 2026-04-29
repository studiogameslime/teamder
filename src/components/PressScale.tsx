// PressScale — wrap any tappable surface to get a subtle scale-on-press
// micro-interaction. Used by Cards, list rows, big tiles. Keeps the
// content snappy without being cartoonish.
//
// Implementation: Reanimated 3 shared value drives `transform: scale`,
// timing curve eases out (decel) on press-in and back to 1 on release.
// All on the UI thread, no JS-bridge cost.

import React from 'react';
import {
  Pressable,
  type PressableProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface Props extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  /** How much to scale on press. Default 0.97 (subtle). */
  pressedScale?: number;
  style?: ViewStyle | ViewStyle[];
}

export function PressScale({
  children,
  pressedScale = 0.97,
  style,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animatedStyle}>
      <Pressable
        {...rest}
        onPressIn={(e) => {
          scale.value = withTiming(pressedScale, {
            duration: 90,
            easing: Easing.out(Easing.quad),
          });
          rest.onPressIn?.(e);
        }}
        onPressOut={(e) => {
          scale.value = withTiming(1, {
            duration: 140,
            easing: Easing.out(Easing.quad),
          });
          rest.onPressOut?.(e);
        }}
        style={style}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
