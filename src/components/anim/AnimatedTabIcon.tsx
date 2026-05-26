// AnimatedTabIcon — the active tab icon does a soft scale+bounce when
// it becomes focused, and the colour also fades smoothly. Reads as
// "you arrived here" without being noisy. Used by MainTabs.

import React, { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  name: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  color: string;
  size: number;
}

export function AnimatedTabIcon({ name, focused, color, size }: Props) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (focused) {
      // Punchy "land" on focus — overshoot to 1.18 then settle to 1.0.
      scale.value = withSequence(
        withTiming(1.18, { duration: 180, easing: Easing.out(Easing.cubic) }),
        withTiming(1.0, { duration: 220, easing: Easing.inOut(Easing.quad) }),
      );
    } else {
      // Quietly return to baseline when unfocused.
      scale.value = withTiming(1.0, { duration: 160 });
    }
  }, [focused, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      <Ionicons name={name} size={size} color={color} />
    </Animated.View>
  );
}
