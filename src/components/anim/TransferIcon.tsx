import React, { useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

export interface IconFlight { key: number; icon: 'football' | 'shirt'; from: { x: number; y: number }; to: { x: number; y: number } }

/** Measured physical coordinates: independent of forceRTL and font size. */
export function TransferIcon({ flight }: { flight: IconFlight | null }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 1;
    if (flight && !reduced) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: 340, easing: Easing.inOut(Easing.cubic) });
    }
    return () => cancelAnimation(progress);
  }, [flight, reduced, progress]);
  const motion = useAnimatedStyle(() => ({
    opacity: !flight || reduced ? 0 : Math.sin(progress.value * Math.PI),
    transform: [
      { translateX: flight ? flight.from.x + (flight.to.x - flight.from.x) * progress.value - 14 : 0 },
      { translateY: flight ? flight.from.y + (flight.to.y - flight.from.y) * progress.value - 14 - Math.sin(progress.value * Math.PI) * 12 : 0 },
      { scale: 0.8 + Math.sin(progress.value * Math.PI) * 0.25 },
    ],
  }));
  return <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[{ position: 'absolute', left: 0, top: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', zIndex: 2 }, motion]}>
    <Ionicons name={flight?.icon ?? 'football'} size={20} color="#1D4ED8" />
  </Animated.View>;
}
