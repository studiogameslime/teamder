// SplashScreen — Teamder kickoff.
//
// Single visible loading state across the entire boot. The big ball +
// wordmark show from the very first paint and stay up until BOTH:
//   1. a minimum 1.6s "hold" has elapsed (so the user always sees the
//      brand for a beat, not a flicker), AND
//   2. the parent says we're `ready` (auth + groups hydrated).
// Then a 350ms root-fade ends the splash and the app takes over.
//
// We also export `SplashVisual` for callers that need the same look
// WITHOUT the kickoff/exit logic — e.g. RootNavigator's "still hydrating"
// state. Keeping both behind the same component guarantees the user
// never sees two different loaders.

import React, { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as ExpoSplash from 'expo-splash-screen';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SoccerBall } from '@/components/SoccerBall';

// 2× the previous size — the ball is the entire visual identity here.
const BALL_SIZE = 280;
const MIN_HOLD_MS = 1600;
const FADE_MS = 350;

// ─── Pure visual ─────────────────────────────────────────────────────────
// Blue background, big white ball, "Teamder" wordmark. The ball
// gets a continuous subtle pulse so it reads as "loading" no matter
// how long the parent keeps the splash up.
export function SplashVisual() {
  const ballScale = useSharedValue(1);

  useEffect(() => {
    // Forever pulse — 500 ms up, 500 ms down, repeated. Cheap (one
    // shared value driving a transform) and reads as "alive" even
    // if hydration takes 10 s.
    ballScale.value = withRepeat(
      withSequence(
        withTiming(1.08, { duration: 500, easing: Easing.inOut(Easing.quad) }),
        withTiming(1.0, { duration: 500, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(ballScale);
  }, [ballScale]);

  const ballStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ballScale.value }],
  }));

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.center}>
        <Animated.View
          style={[
            { width: BALL_SIZE, height: BALL_SIZE },
            styles.ballWrap,
            ballStyle,
          ]}
        >
          <SoccerBall size={BALL_SIZE} color="#FFFFFF" />
        </Animated.View>
        <View style={styles.wordmarkWrap}>
          <Text style={styles.wordmark} allowFontScaling={false}>
            Teamder
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Kickoff / hold / fade-out wrapper ───────────────────────────────────

interface Props {
  /** Becomes true once the app is hydrated (auth + groups). The splash
   *  waits for this before fading out so the user never sees a second
   *  "loading" indicator after us. */
  ready: boolean;
  onFinish: () => void;
}

export function SplashScreen({ ready, onFinish }: Props) {
  const rootOpacity = useSharedValue(1);
  const heldEnoughRef = useRef(false);
  // Mount timestamp — the brand needs at least MIN_HOLD_MS of stage
  // time even when hydration finishes early (cold start with cached
  // session: hydration completes in <200 ms and the user would
  // otherwise see the splash for one frame).
  const mountTsRef = useRef(Date.now());

  // Hide the native OS splash the moment this React layer paints.
  useEffect(() => {
    ExpoSplash.hideAsync().catch(() => {});
  }, []);

  // Run the exit animation only after BOTH conditions are met:
  // (a) the minimum-hold timer has elapsed, (b) the parent says ready.
  useEffect(() => {
    const elapsed = Date.now() - mountTsRef.current;
    const remaining = Math.max(0, MIN_HOLD_MS - elapsed);
    if (!ready) {
      // Mark that we DID accumulate hold time, but don't exit yet.
      // When ready flips we'll re-enter this effect and run the fade.
      if (remaining === 0) heldEnoughRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      heldEnoughRef.current = true;
      rootOpacity.value = withTiming(
        0,
        { duration: FADE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onFinish)();
        },
      );
    }, remaining);
    return () => clearTimeout(timer);
  }, [ready, rootOpacity, onFinish]);

  useEffect(() => {
    return () => {
      cancelAnimation(rootOpacity);
    };
  }, [rootOpacity]);

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));

  return (
    <Animated.View style={[styles.absolute, rootStyle]} pointerEvents="none">
      <SplashVisual />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  absolute: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  root: {
    ...StyleSheet.absoluteFillObject,
    // Solid blue matches the native splash backgroundColor in
    // app.json — the handoff between native and React layers is
    // invisible because the colours align. (App brand is blue.)
    backgroundColor: '#1E40AF',
  },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ballWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmarkWrap: {
    position: 'absolute',
    bottom: '22%',
    alignItems: 'center',
  },
  wordmark: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
