// PressableScale — Pressable that scales down 0.96 on press-in and
// springs back on release. Reusable foundation for buttons, cards,
// and any tappable surface that should feel responsive.
//
// Built on Reanimated (already a dep) so the animation runs on the UI
// thread — the JS thread can be busy without making taps feel laggy.
//
// Layout note (load-bearing): the Pressable is the OUTER element and
// owns the visual style (padding, background, border, alignSelf,
// etc.). The Animated.View lives INSIDE and only carries the scale
// transform. Earlier the order was reversed (Animated.View outside
// with the style, Pressable inside) — that made the Pressable
// content-sized, so taps on a button's padding fell through and only
// hits on the text triggered the action. Keeping Pressable outside
// guarantees the entire visual surface is the touch target.

import React from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface Props extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  /** Target scale on press-in. Default 0.96 (subtle). */
  pressedScale?: number;
  /** Outer wrapper style — applied to the Pressable so it sizes the
   *  touch surface to match the visual button. */
  style?: StyleProp<ViewStyle>;
}

export function PressableScale({
  children,
  pressedScale = 0.96,
  style,
  onPressIn,
  onPressOut,
  disabled,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={style}
      onPressIn={(e) => {
        // Suppress the scale animation entirely when disabled —
        // Pressable's native `disabled` already blocks `onPress`,
        // but `onPressIn`/`onPressOut` still fire, so without this
        // guard a disabled button would still bounce on tap and
        // feel interactive.
        if (disabled) return;
        // Faster ramp on press-in so the touch feels immediate;
        // spring back on release so the bounce is friendly.
        scale.value = withTiming(pressedScale, { duration: 80 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (disabled) return;
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
        onPressOut?.(e);
      }}
    >
      {/* Inner wrapper carries only the transform — keeps the
          Pressable's hit area at the full visual size. */}
      <Animated.View style={animStyle}>{children}</Animated.View>
    </Pressable>
  );
}
