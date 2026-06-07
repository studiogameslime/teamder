// SplashScreen — Teamder kickoff.
//
// Sequence (~1.3s before the parent's `ready` gate releases the fade):
//   1. (0–80ms)    fade-in dark-blue stage
//   2. (80–900ms)  white pitch lines DRAW ON via strokeDashoffset
//                  (centre circle + halfway line + centre spot)
//   3. (700–1200ms) ball drops from above with a 2× squash-stretch
//                  bounce, settling on the centre spot.
//   4. (1100ms+)   wordmark "Teamder" + tagline + 3 pulsing dots
//                  rise into view under the pitch.
//   5. (forever)   ball slowly rotates + breathes (subtle pulse) so
//                  it reads as "alive" if the parent keeps us up.
//   6. (on ready)  full root fades + scales out (existing logic).
//
// We also export `SplashVisual` for callers that need the same look
// WITHOUT the kickoff/exit logic — e.g. RootNavigator's "still
// hydrating" state. Keeping both behind the same component guarantees
// the user never sees two different loaders.

import React, { useEffect, useRef } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import * as ExpoSplash from 'expo-splash-screen';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Line } from 'react-native-svg';
import { SoccerBall } from '@/components/SoccerBall';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);

const BALL_SIZE = 200;
const MIN_HOLD_MS = 1400;     // give the new sequence time to read
const FADE_MS = 320;

// Pitch geometry — the "centre circle" + the halfway line. Sized as a
// fraction of the screen so it scales on small/large devices.
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
const PITCH_CIRCLE_R = Math.min(SCREEN_W * 0.36, 170);
const PITCH_CIRCLE_C = 2 * Math.PI * PITCH_CIRCLE_R;
const HALFWAY_LEN = Math.min(SCREEN_W * 0.9, 380);
const PITCH_STROKE = 2;
const PITCH_COLOR = 'rgba(255,255,255,0.55)';
const PITCH_BRIGHT = '#FFFFFF';

// ─── Pure visual ─────────────────────────────────────────────────────────

export function SplashVisual() {
  // PITCH — circle + halfway line draw on by interpolating
  // strokeDashoffset from full → 0. The dash array equals the path
  // length, so offset=length means "fully hidden", offset=0 means
  // "fully drawn".
  const circleOffset = useSharedValue(PITCH_CIRCLE_C);
  const lineOffset = useSharedValue(HALFWAY_LEN);
  const spotOpacity = useSharedValue(0);

  // BALL — gets KICKED at the camera: starts tiny + low (far away),
  // rushes in growing past full size with a fast spin, then settles on
  // the centre spot and keeps a slow rotation + breathing.
  const ballY = useSharedValue(SCREEN_H * 0.16);
  const ballScaleY = useSharedValue(0.12);
  const ballScaleX = useSharedValue(0.12);
  const ballRotate = useSharedValue(0);
  const ballOpacity = useSharedValue(0);
  const ballBreath = useSharedValue(1);

  // WORDMARK + TAGLINE + DOTS — rise in after the bounce settles.
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkY = useSharedValue(14);
  const dot0 = useSharedValue(0.3);
  const dot1 = useSharedValue(0.3);
  const dot2 = useSharedValue(0.3);

  useEffect(() => {
    // 1. Pitch draws on (halfway line first, then centre circle, then
    //    the centre spot pops). Quick + decisive — feels like a coach
    //    laying chalk lines on the field.
    lineOffset.value = withTiming(0, {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
    circleOffset.value = withDelay(
      120,
      withTiming(0, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );
    spotOpacity.value = withDelay(
      700,
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
    );

    // 2. KICK toward the viewer. The ball appears small + low (far on
    //    the pitch), then rushes the camera: it grows PAST full size
    //    (overshoot = it's coming "at" you) and pops up slightly before
    //    settling on the centre spot. A fast spin during the flight
    //    sells the kick.
    const KICK_AT = 440;
    ballOpacity.value = withDelay(
      KICK_AT,
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
    );
    // Depth: tiny → overshoot 1.18 (rushing in) → settle 1.0.
    ballScaleX.value = withDelay(
      KICK_AT,
      withSequence(
        withTiming(1.18, { duration: 300, easing: Easing.out(Easing.cubic) }),
        withTiming(1.0, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      ),
    );
    ballScaleY.value = withDelay(
      KICK_AT,
      withSequence(
        withTiming(1.18, { duration: 300, easing: Easing.out(Easing.cubic) }),
        withTiming(1.0, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      ),
    );
    // Arc: kicked up from low → overshoot above the spot → drop onto it.
    ballY.value = withDelay(
      KICK_AT,
      withSequence(
        withTiming(-22, { duration: 300, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 260, easing: Easing.inOut(Easing.quad) }),
      ),
    );

    // 3. Spin: one fast turn during the kick, then ease into the slow
    //    idle rotation. The repeat target is +360 from the settle value
    //    so the wrap-around (720→360) is visually seamless.
    ballRotate.value = withDelay(
      KICK_AT,
      withSequence(
        withTiming(360, { duration: 560, easing: Easing.out(Easing.cubic) }),
        withDelay(
          200,
          withRepeat(
            withTiming(720, { duration: 4000, easing: Easing.linear }),
            -1,
            false,
          ),
        ),
      ),
    );
    ballBreath.value = withDelay(
      1400,
      withRepeat(
        withSequence(
          withTiming(1.04, { duration: 700, easing: Easing.inOut(Easing.quad) }),
          withTiming(1.0, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        ),
        -1,
        false,
      ),
    );

    // 4. Wordmark rises into view after the ball lands.
    wordmarkOpacity.value = withDelay(
      1100,
      withTiming(1, { duration: 380, easing: Easing.out(Easing.quad) }),
    );
    wordmarkY.value = withDelay(
      1100,
      withTiming(0, { duration: 460, easing: Easing.out(Easing.cubic) }),
    );

    // 5. Three loading dots — staggered pulse.
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
    dot0.value = withDelay(1200, dotSeq(0));
    dot1.value = withDelay(1200, dotSeq(140));
    dot2.value = withDelay(1200, dotSeq(280));

    return () => {
      [circleOffset, lineOffset, spotOpacity, ballY, ballScaleY, ballScaleX,
       ballRotate, ballOpacity, ballBreath,
       wordmarkOpacity, wordmarkY, dot0, dot1, dot2]
        .forEach(cancelAnimation);
    };
  }, [circleOffset, lineOffset, spotOpacity, ballY, ballScaleY, ballScaleX,
      ballRotate, ballOpacity, ballBreath,
      wordmarkOpacity, wordmarkY, dot0, dot1, dot2]);

  // SVG animated props — strokeDashoffset can't go through a normal
  // animated style, so we feed them via animatedProps on the SVG node.
  const circleAnim = useAnimatedStyle(() => ({}));
  const lineAnim = useAnimatedStyle(() => ({}));
  void circleAnim;
  void lineAnim;
  const circleProps = useAnimatedStyle(() => ({
    // unused — we feed via inline props below
  }));
  void circleProps;

  // For react-native-svg, animated props work via the `useAnimatedProps`
  // hook, but to keep imports lean we inline-set via a re-render on
  // shared value change using a tiny adapter component.
  const ballStyle = useAnimatedStyle(() => ({
    opacity: ballOpacity.value,
    transform: [
      { translateY: ballY.value },
      { scaleX: ballScaleX.value * ballBreath.value },
      { scaleY: ballScaleY.value * ballBreath.value },
      { rotate: `${ballRotate.value}deg` },
    ],
  }));
  const spotStyle = useAnimatedStyle(() => ({
    opacity: spotOpacity.value,
  }));
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkY.value }],
  }));
  const dot0Style = useAnimatedStyle(() => ({
    opacity: dot0.value, transform: [{ scale: dot0.value }],
  }));
  const dot1Style = useAnimatedStyle(() => ({
    opacity: dot1.value, transform: [{ scale: dot1.value }],
  }));
  const dot2Style = useAnimatedStyle(() => ({
    opacity: dot2.value, transform: [{ scale: dot2.value }],
  }));

  return (
    <View style={styles.root} pointerEvents="none">
      {/* Pitch SVG — anchored behind the ball, centered on the screen.
          The center circle has its dash array = its full circumference,
          and we animate strokeDashoffset from full→0 to "draw it on". */}
      <View style={styles.pitchWrap}>
        <Svg width={SCREEN_W} height={SCREEN_H}>
          {/* Halfway line — horizontal stroke through the centre. */}
          <PitchLine
            x1={(SCREEN_W - HALFWAY_LEN) / 2}
            y1={SCREEN_H / 2}
            x2={(SCREEN_W + HALFWAY_LEN) / 2}
            y2={SCREEN_H / 2}
            offset={lineOffset}
            length={HALFWAY_LEN}
          />
          {/* Center circle */}
          <PitchCircle
            cx={SCREEN_W / 2}
            cy={SCREEN_H / 2}
            r={PITCH_CIRCLE_R}
            offset={circleOffset}
            circumference={PITCH_CIRCLE_C}
          />
        </Svg>
        {/* Center spot — a tiny dot at the exact centre, fades in last. */}
        <Animated.View style={[styles.spot, spotStyle]} />
      </View>

      {/* Ball — drops in and settles on the centre spot. */}
      <View style={styles.ballArea} pointerEvents="none">
        <Animated.View
          style={[
            { width: BALL_SIZE, height: BALL_SIZE },
            styles.ballWrap,
            ballStyle,
          ]}
        >
          <SoccerBall size={BALL_SIZE} />
        </Animated.View>
      </View>

      {/* Wordmark + tagline + dots */}
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
  );
}

/** Tiny wrapper that animates strokeDashoffset on a Line via
 *  useAnimatedProps. Keeps the giant SplashVisual file readable. */
function PitchLine({
  x1, y1, x2, y2, offset, length,
}: {
  x1: number; y1: number; x2: number; y2: number;
  offset: Animated.SharedValue<number>;
  length: number;
}) {
  // We can't use useAnimatedProps cleanly with the typed Line, so we
  // mount a fresh Line whose strokeDashoffset binds to the shared
  // value via the AnimatedLine wrapper.
  const animatedProps = useAnimatedDashProps(offset);
  return (
    <AnimatedLine
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={PITCH_COLOR}
      strokeWidth={PITCH_STROKE}
      strokeLinecap="round"
      strokeDasharray={`${length}, ${length}`}
      animatedProps={animatedProps}
    />
  );
}

function PitchCircle({
  cx, cy, r, offset, circumference,
}: {
  cx: number; cy: number; r: number;
  offset: Animated.SharedValue<number>;
  circumference: number;
}) {
  const animatedProps = useAnimatedDashProps(offset);
  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={r}
      stroke={PITCH_COLOR}
      strokeWidth={PITCH_STROKE}
      fill="none"
      strokeDasharray={`${circumference}, ${circumference}`}
      animatedProps={animatedProps}
    />
  );
}

/** Bind a shared value to an SVG element's `strokeDashoffset` prop. */
function useAnimatedDashProps(offset: Animated.SharedValue<number>) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { useAnimatedProps } = require('react-native-reanimated');
  return useAnimatedProps(() => ({
    strokeDashoffset: offset.value,
  }));
}

// ─── Kickoff / hold / fade-out wrapper ───────────────────────────────────

interface Props {
  ready: boolean;
  onFinish: () => void;
}

export function SplashScreen({ ready, onFinish }: Props) {
  const rootOpacity = useSharedValue(1);
  const rootScale = useSharedValue(1);
  const heldEnoughRef = useRef(false);
  const mountTsRef = useRef(Date.now());

  useEffect(() => {
    ExpoSplash.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    const elapsed = Date.now() - mountTsRef.current;
    const remaining = Math.max(0, MIN_HOLD_MS - elapsed);
    if (!ready) {
      if (remaining === 0) heldEnoughRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      heldEnoughRef.current = true;
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
    backgroundColor: '#0E2B6E',  // deep brand blue — feels like a night-game pitch
  },
  pitchWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Centre spot — tiny white dot at the exact centre of the pitch.
  spot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: PITCH_BRIGHT,
    top: SCREEN_H / 2 - 4,
    left: SCREEN_W / 2 - 4,
  },
  ballArea: {
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
    bottom: '15%',
    alignSelf: 'center',
    alignItems: 'center',
  },
  wordmark: {
    color: '#FFFFFF',
    fontSize: 38,
    fontWeight: '900',
    letterSpacing: 2.2,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
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
