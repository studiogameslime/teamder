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
// Shortened from 1600 → 1000: still long enough to register the brand,
// but snappier into the app. (Production cold-start hydration usually
// finishes within this window, so the splash rarely exceeds it.)
const MIN_HOLD_MS = 1000;
const FADE_MS = 320;

// ─── Pure visual ─────────────────────────────────────────────────────────
// Blue background, big white ball, "Teamder" wordmark + tagline + three
// pulsing dots. The ball does a soft drop-in then continuous spin+pulse
// so it reads as "alive" no matter how long the parent keeps it up.
export function SplashVisual() {
  const ballScale = useSharedValue(0.7);
  const ballSpin = useSharedValue(0);
  const ballOpacity = useSharedValue(0);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkY = useSharedValue(12);
  const dot0 = useSharedValue(0.3);
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);

  useEffect(() => {
    // Ball entrance — fade + slight overshoot, then settle into the
    // forever pulse + spin. The overshoot gives the brand a "kick"
    // feel right from frame one.
    ballOpacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.quad) });
    ballScale.value = withSequence(
      withTiming(1.06, { duration: 360, easing: Easing.out(Easing.back(1.4)) }),
      withTiming(1.0, { duration: 200, easing: Easing.out(Easing.quad) }),
      withRepeat(
        withSequence(
          withTiming(1.06, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.0, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );
    // Spin — one full turn / 3.2 s, linear. Reads as a rolling football.
    ballSpin.value = withRepeat(
      withTiming(360, { duration: 3200, easing: Easing.linear }),
      -1,
      false,
    );
    // Wordmark + tagline rise-up after the ball lands.
    wordmarkOpacity.value = withTiming(1, {
      duration: 380,
      easing: Easing.out(Easing.quad),
    });
    wordmarkY.value = withTiming(0, {
      duration: 460,
      easing: Easing.out(Easing.cubic),
    });
    // Three loading dots — staggered pulse so the row reads as
    // "thinking", not three independent blinks.
    const dotSeq = (delay: number) =>
      withSequence(
        withTiming(0.3, { duration: delay }),
        withRepeat(
          withSequence(
            withTiming(1.0, { duration: 420, easing: Easing.inOut(Easing.quad) }),
            withTiming(0.3, { duration: 420, easing: Easing.inOut(Easing.quad) }),
          ),
          -1,
          false,
        ),
      );
    dot0.value = dotSeq(0);
    dot1.value = dotSeq(140);
    dot2.value = dotSeq(280);
    return () => {
      cancelAnimation(ballScale);
      cancelAnimation(ballSpin);
      cancelAnimation(ballOpacity);
      cancelAnimation(wordmarkOpacity);
      cancelAnimation(wordmarkY);
      cancelAnimation(dot0);
      cancelAnimation(dot1);
      cancelAnimation(dot2);
    };
  }, [ballScale, ballSpin, ballOpacity, wordmarkOpacity, wordmarkY, dot0, dot1, dot2]);

  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballOpacity.value,
    transform: [
      { scale: ballScale.value },
      { rotate: `${ballSpin.value}deg` },
    ],
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkY.value }],
  }));
  const dot0Style = useAnimatedStyle(() => ({ opacity: dot0.value, transform: [{ scale: dot0.value }] }));
  const dot1Style = useAnimatedStyle(() => ({ opacity: dot1.value, transform: [{ scale: dot1.value }] }));
  const dot2Style = useAnimatedStyle(() => ({ opacity: dot2.value, transform: [{ scale: dot2.value }] }));

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
        <Animated.View style={[styles.wordmarkWrap, wordmarkStyle]}>
          <Text style={styles.wordmark} allowFontScaling={false}>
            Teamder
          </Text>
          <Text style={styles.tagline} allowFontScaling={false}>
            המשחק הבא שלך מתחיל כאן
          </Text>
          <View style={styles.dotsRow}>
            <Animated.View style={[styles.dot, dot0Style]} />
            <Animated.View style={[styles.dot, dot1Style]} />
            <Animated.View style={[styles.dot, dot2Style]} />
          </View>
        </Animated.View>
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
  const rootScale = useSharedValue(1);
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
      // Exit "kick" — a quick zoom-in as the splash fades, so the app
      // feels like it's being launched into rather than cross-fading.
      rootScale.value = withTiming(1.12, {
        duration: FADE_MS,
        easing: Easing.out(Easing.quad),
      });
      rootOpacity.value = withTiming(
        0,
        { duration: FADE_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onFinish)();
        },
      );
    }, remaining);
    return () => clearTimeout(timer);
  }, [ready, rootOpacity, rootScale, onFinish]);

  useEffect(() => {
    return () => {
      cancelAnimation(rootOpacity);
    };
  }, [rootOpacity]);

  const rootStyle = useAnimatedStyle(() => ({
    opacity: rootOpacity.value,
    transform: [{ scale: rootScale.value }],
  }));

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
    bottom: '20%',
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
  // Tagline under the wordmark — softer, lighter weight, sells the
  // product promise in one line. Hebrew so it reads naturally.
  tagline: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginTop: 10,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
});
