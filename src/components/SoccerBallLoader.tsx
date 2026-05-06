// SoccerBallLoader — drop-in replacement for <ActivityIndicator/> with
// the app's football identity. Continuously rotates the SoccerBall and
// adds a very subtle scale pulse for life. All animation runs on the UI
// thread via Reanimated, so it stays smooth even while the JS thread
// hydrates stores.

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
import { SoccerBall } from './SoccerBall';

interface Props {
  /** Diameter of the ball, in dp. Defaults to 56. */
  size?: number;
  style?: ViewStyle;
}

export function SoccerBallLoader({ size = 56, style }: Props) {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    // Continuous, even rotation. Linear easing reads as a steady spin —
    // anything else makes the ball look like it's wobbling.
    rotation.value = withRepeat(
      withTiming(360, { duration: 1800, easing: Easing.linear }),
      -1,
      false,
    );
    // Very subtle pulse (3%). Just enough to feel alive without
    // distracting from whatever the user is waiting on.
    scale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(rotation);
      cancelAnimation(scale);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${rotation.value}deg` },
      { scale: scale.value },
    ],
  }));

  return (
    <View style={[styles.wrap, style]}>
      <Animated.View style={animatedStyle}>
        <SoccerBall size={size} color="#3B82F6" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
