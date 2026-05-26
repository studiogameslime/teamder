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
// Haptics are lazy-required so a missing native module on Expo Go /
// pre-rebuild dev clients can't break the press handler.
let _haptics: typeof import('expo-haptics') | null | undefined;
function tapHaptic() {
  if (_haptics === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _haptics = require('expo-haptics');
    } catch {
      _haptics = null;
    }
  }
  if (!_haptics) return;
  // Light selection-level impact — barely perceptible but the tap
  // feels "physical". Anything heavier here ends up feeling noisy
  // because it fires on every interactive surface in the app.
  _haptics.selectionAsync().catch(() => {});
}

interface Props extends Omit<PressableProps, 'style'> {
  children: React.ReactNode;
  /** Target scale on press-in. Default 0.96 (subtle). */
  pressedScale?: number;
  /** Outer wrapper style — applied to the Pressable so it sizes the
   *  touch surface to match the visual button. */
  style?: StyleProp<ViewStyle>;
  /** Fire a light haptic on press-in. Default true. Pass false on
   *  surfaces that fire repeatedly (e.g. tab bars while swiping) or
   *  where the haptic would be cumulatively noisy. */
  haptic?: boolean;
  /** When `onLongPress` is set, an expanding ring appears under the
   *  finger to telegraph that the long-press is being received. Pure
   *  visual feedback — onLongPress still controls the side effect.
   *  Defaults to true when onLongPress is provided. */
  showLongPressRing?: boolean;
}

export function PressableScale({
  children,
  pressedScale = 0.96,
  style,
  onPressIn,
  onPressOut,
  onLongPress,
  disabled,
  haptic = true,
  showLongPressRing,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  // Ring scale: 0 (hidden) → 1.4 (expanded). Driven only when an
  // onLongPress callback is registered AND the gesture isn't aborted.
  const ringScale = useSharedValue(0);
  const ringOpacity = useSharedValue(0);
  const ringEnabled = !!onLongPress && showLongPressRing !== false;

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  return (
    <Pressable
      {...rest}
      disabled={disabled}
      style={style}
      onLongPress={onLongPress}
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
        if (ringEnabled) {
          // Expanding ring tells the user "we see your hold" — fires
          // immediately on press-in. ~480 ms expand matches the
          // default native long-press threshold so the ring lands at
          // full size right when the long-press handler fires.
          ringScale.value = 0;
          ringOpacity.value = 0.3;
          ringScale.value = withTiming(1.4, { duration: 480 });
          ringOpacity.value = withTiming(0, { duration: 480 });
        }
        if (haptic) tapHaptic();
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (disabled) return;
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
        if (ringEnabled) {
          // Snap-fade the ring on release so a quick tap doesn't leave
          // a lingering glow.
          ringOpacity.value = withTiming(0, { duration: 120 });
        }
        onPressOut?.(e);
      }}
    >
      {/* Long-press ring sits BEHIND the content so it expands from the
          centre of the visible surface. Pointer-events disabled so it
          can never intercept touches. */}
      {ringEnabled ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              borderRadius: 9999,
              backgroundColor: 'rgba(30, 64, 175, 0.18)',
            },
            ringStyle,
          ]}
        />
      ) : null}
      {/* Inner wrapper carries only the transform — keeps the
          Pressable's hit area at the full visual size. */}
      <Animated.View style={animStyle}>{children}</Animated.View>
    </Pressable>
  );
}
