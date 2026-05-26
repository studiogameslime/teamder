// Shimmer — placeholder block that sweeps a light highlight from one
// edge to the other. Use as the building block of skeleton screens
// (cards, list rows, etc.).
//
// Layout is whatever you pass via `style` — the shimmer fills its
// host, so wrap a sized View around it. Background colour is the
// "dim" base; a lighter band sweeps across.

import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  /** Outer style — width + height + borderRadius. */
  style?: ViewStyle;
  /** Base (dim) colour. Default near-grey light. */
  baseColor?: string;
  /** Highlight band colour. Default a notch lighter. */
  highlightColor?: string;
  /** Full sweep duration. Default 1400. */
  durationMs?: number;
}

export function Shimmer({
  style,
  baseColor = '#E5E7EB',
  highlightColor = '#F3F4F6',
  durationMs = 1400,
}: Props) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: durationMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress, durationMs]);

  // Sweep a 60% wide band from -50% → 150% across the host. The host
  // clips to its bounds via overflow:hidden so the band only shows
  // inside the placeholder rectangle.
  const bandStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: `${-50 + progress.value * 200}%` as unknown as number,
      },
    ],
  }));

  return (
    <View
      style={[
        styles.host,
        { backgroundColor: baseColor },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.band,
          { backgroundColor: highlightColor },
          bandStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '60%',
    opacity: 0.65,
  },
});
