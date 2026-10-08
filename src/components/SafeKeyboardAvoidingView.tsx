import React from 'react';
import { KeyboardAvoidingView, Platform, type KeyboardAvoidingViewProps } from 'react-native';
import { useSafeAreaFrame } from 'react-native-safe-area-context';

/** Keyboard events use window coordinates, whereas the protected viewport's
 * child layout is local. Preserve caller-specific offsets and behaviours.
 */
export function SafeKeyboardAvoidingView({ keyboardVerticalOffset = 0, behavior, ...props }: KeyboardAvoidingViewProps) {
  const frame = useSafeAreaFrame();
  // Older Android windows resize themselves. Edge-to-edge API 35+ needs an
  // explicit IME behaviour even in forms whose old Android prop was undefined.
  const effectiveBehavior = behavior ?? (
    Platform.OS === 'android' && Number(Platform.Version) >= 35 ? 'padding' : undefined
  );
  return <KeyboardAvoidingView {...props} behavior={effectiveBehavior} keyboardVerticalOffset={keyboardVerticalOffset + frame.y} />;
}
