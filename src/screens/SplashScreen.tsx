// SplashScreen — kickoff moment (~1.15s).
//
// Animation flow:
//   ① 0–420ms  — ball rolls in from off-screen right with rotation
//   ② 420–600ms — brief settle at centre (slight scale-overshoot)
//   ③ 600–950ms — KICK: scale shoots toward the camera, ball fades
//   ④ 700–1050ms — white flash overlay (peak then fade)
//   ⑤ 950–1150ms — root fades, calls onFinish
//
// All motion runs on the UI thread via Reanimated 3. Layout uses
// flex-centring (no `top:'50%'`/percent offsets) so the centred
// position is robust across devices.

import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { SoccerBall } from '@/components/SoccerBall';

const { width: SCREEN_W } = Dimensions.get('window');
// 2× the previous size — the ball is the entire visual identity here.
const BALL_SIZE = 280;
// Start the ball just past the right edge of the device.
const BALL_START_X = SCREEN_W / 2 + BALL_SIZE / 2 + 40;

interface Props {
  onFinish: () => void;
}

export function SplashScreen({ onFinish }: Props) {
  const ballX = useSharedValue(BALL_START_X);
  const ballRotation = useSharedValue(0);
  const ballScale = useSharedValue(0.9);
  const ballOpacity = useSharedValue(0);

  const flashOpacity = useSharedValue(0);
  const rootOpacity = useSharedValue(1);

  useEffect(() => {
    // ① Ball rolls in from the right (0–420ms).
    ballOpacity.value = withTiming(1, { duration: 120 });
    ballX.value = withTiming(0, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
    // 540° of rotation while crossing the screen reads as a real roll.
    ballRotation.value = withTiming(540, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });

    // ② Settle — slight scale overshoot then back to 1 (no spring
    // physics, just two timings — keeps the curve predictable).
    ballScale.value = withSequence(
      withTiming(1.05, { duration: 420, easing: Easing.out(Easing.cubic) }),
      withTiming(1.0, { duration: 160, easing: Easing.out(Easing.quad) }),
    );

    // ③ KICK — ball rushes the camera. Sharp ease-in so it accelerates.
    ballScale.value = withDelay(
      600,
      withTiming(7, { duration: 350, easing: Easing.in(Easing.cubic) }),
    );
    ballOpacity.value = withDelay(
      820,
      withTiming(0, { duration: 160, easing: Easing.in(Easing.cubic) }),
    );

    // ④ White flash overlay.
    flashOpacity.value = withDelay(
      700,
      withSequence(
        withTiming(0.9, { duration: 120 }),
        withTiming(0, { duration: 280 }),
      ),
    );

    // ⑤ Hand-off.
    rootOpacity.value = withDelay(
      950,
      withTiming(0, { duration: 200 }, (finished) => {
        if (finished) runOnJS(onFinish)();
      }),
    );

    return () => {
      [
        ballX,
        ballRotation,
        ballScale,
        ballOpacity,
        flashOpacity,
        rootOpacity,
      ].forEach((sv) => cancelAnimation(sv));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));
  const ballStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ballX.value },
      { rotate: `${ballRotation.value}deg` },
      { scale: ballScale.value },
    ],
    opacity: ballOpacity.value,
  }));
  const flashStyle = useAnimatedStyle(() => ({ opacity: flashOpacity.value }));

  return (
    <Animated.View style={[styles.root, rootStyle]} pointerEvents="none">
      {/* Background — vertical gradient from a brighter pitch green at
          the top to near-black at the bottom. */}
      <LinearGradient
        colors={['#0F3D24', '#06180D', '#020604']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Ball — single centred element. White against the dark green
          gradient gives the strongest read. */}
      <View style={styles.center}>
        <Animated.View
          style={[
            { width: BALL_SIZE, height: BALL_SIZE },
            ballStyle,
          ]}
        >
          <SoccerBall size={BALL_SIZE} color="#FFFFFF" />
        </Animated.View>
      </View>

      {/* Final white flash → blends into the app behind. */}
      <Animated.View style={[styles.flash, flashStyle]} pointerEvents="none" />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FFFFFF',
  },
});
