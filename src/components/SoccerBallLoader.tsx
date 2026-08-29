// SoccerBallLoader — drop-in replacement for <ActivityIndicator/> with
// the app's football identity. All animation runs on the UI thread via
// Reanimated, so it stays smooth even while the JS thread hydrates stores.
//
// IT ROLLS. It used to spin on the spot, which is the one thing a ball never
// does — a ball on the ground turns BECAUSE it travels, and the eye knows the
// difference even when it can't name it. So the rotation is derived from the
// horizontal position rather than run alongside it:
//
//     angle = distance / radius          (in radians, the rolling condition)
//
// which is why there is no separate rotation timing below. Get that coupling
// wrong — spin faster than you travel — and it reads as a ball skidding on
// ice, which is worse than spinning in place because it looks broken rather
// than merely still.
//
// StepIndicator already had this right for the wizard's ball. This is the same
// idea in the loader that 29 screens use.

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
  // How far it rolls either side of centre. Proportional to the ball so the
  // motion looks identical at size 16 in a button and size 56 on a full
  // screen — the only thing that changes is the scale of the whole thing.
  const travel = size * 0.75;
  const x = useSharedValue(-travel);

  useEffect(() => {
    // Ease in and out at the turns: a ball that reverses at constant speed
    // has been yanked by something. Slowing into the turn and away from it is
    // what rolling back and forth actually looks like.
    x.value = withRepeat(
      withSequence(
        withTiming(travel, { duration: 900, easing: Easing.inOut(Easing.quad) }),
        withTiming(-travel, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(x);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travel]);

  const animatedStyle = useAnimatedStyle(() => {
    // The rolling condition, in degrees. radius = size / 2.
    const deg = (x.value / (size / 2)) * (180 / Math.PI);
    return { transform: [{ translateX: x.value }, { rotate: `${deg}deg` }] };
  });

  return (
    // The box is as wide as the roll so the ball never lands on its
    // neighbours, and exactly as tall as the ball so nothing below it moves.
    <View style={[styles.wrap, { width: size + travel * 2, height: size }, style]}>
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
