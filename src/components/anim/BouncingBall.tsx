// BouncingBall — empty-state mascot. Renders the SoccerBall doing a
// slow, friendly bounce + tiny squash on contact. Reads as "nothing
// here yet, but the app is alive". Use in place of a static empty-
// state icon.

import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SoccerBall } from '../SoccerBall';

interface Props {
  size?: number;
  color?: string;
  /** Pixels of bounce travel. Default 14. */
  amplitude?: number;
  /** Time for one up-and-back cycle. Default 1300 ms. */
  cycleMs?: number;
  style?: ViewStyle;
}

export function BouncingBall({
  size = 72,
  color = '#3B82F6',
  amplitude = 14,
  cycleMs = 1300,
  style,
}: Props) {
  const y = useSharedValue(0);
  const squash = useSharedValue(1);

  useEffect(() => {
    const half = cycleMs / 2;
    const contact = 90; // ms spent in the squash on landing
    y.value = withRepeat(
      withSequence(
        withTiming(-amplitude, {
          duration: half,
          easing: Easing.out(Easing.quad),
        }),
        withTiming(0, {
          duration: half,
          easing: Easing.in(Easing.quad),
        }),
      ),
      -1,
      false,
    );
    // Squash slightly on contact: scaleY 0.92, scaleX 1.08. Then back.
    squash.value = withRepeat(
      withSequence(
        withTiming(1, { duration: half }),
        withTiming(0.92, { duration: contact }),
        withTiming(1, { duration: half - contact }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(y);
      cancelAnimation(squash);
    };
  }, [y, squash, amplitude, cycleMs]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: y.value },
      { scaleY: squash.value },
      { scaleX: 2 - squash.value },
    ],
  }));

  return (
    <View style={[styles.host, style]}>
      <Animated.View style={animStyle}>
        <SoccerBall size={size} color={color} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
