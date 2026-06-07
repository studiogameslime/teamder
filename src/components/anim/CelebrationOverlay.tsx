// CelebrationOverlay — the app's "you did a great thing" moment.
// Combines the confetti burst with a handful of real soccer balls that
// fly out from the centre, arc under gravity, spin, and fade. Mount it
// when a milestone happens (joined a game, created your first game,
// created a group) and pass `onDone` to unmount after the burst.
//
// Pure Reanimated + the existing <SoccerBall/> + <ConfettiBurst/> — no
// new deps, all on the UI thread.

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SoccerBall } from '../SoccerBall';
import { ConfettiBurst } from './ConfettiBurst';

interface Props {
  /** Number of flying soccer balls. Default 7. */
  ballCount?: number;
  /** How far the balls travel, in px. Default 200. */
  spread?: number;
  /** Lifetime before everything fades, in ms. Default 1500. */
  durationMs?: number;
  /** Called once the burst has fully faded so the parent can unmount. */
  onDone?: () => void;
  style?: ViewStyle;
}

export function CelebrationOverlay({
  ballCount = 7,
  spread = 200,
  durationMs = 1500,
  onDone,
  style,
}: Props) {
  const balls = useMemo(
    () =>
      Array.from({ length: ballCount }, (_, i) => {
        // Fan the balls UP and out (a kicked-up spray), biased upward so
        // they read as "launched" rather than falling sideways.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
        const distance = spread * (0.55 + Math.random() * 0.45);
        return {
          key: i,
          tx: Math.cos(angle) * distance,
          ty: Math.sin(angle) * distance,
          size: 22 + Math.random() * 18,
          rot: (Math.random() - 0.5) * 900,
          delay: Math.random() * 90,
        };
      }),
    [ballCount, spread],
  );

  useEffect(() => {
    if (!onDone) return;
    const t = setTimeout(onDone, durationMs + 120);
    return () => clearTimeout(t);
  }, [onDone, durationMs]);

  return (
    <View pointerEvents="none" style={[styles.host, style]}>
      <ConfettiBurst count={32} spread={spread + 40} durationMs={durationMs} />
      {balls.map(({ key, ...b }) => (
        <FlyingBall key={key} {...b} duration={durationMs} />
      ))}
    </View>
  );
}

interface BallProps {
  tx: number;
  ty: number;
  size: number;
  rot: number;
  delay: number;
  duration: number;
}

function FlyingBall({ tx, ty, size, rot, delay, duration }: BallProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, duration]);

  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Gravity arc: travel to (tx,ty) then sag downward as p→1.
    const yArc = ty * p + Math.pow(p, 2) * 260 * 0.6;
    return {
      transform: [
        { translateX: tx * p },
        { translateY: yArc },
        { rotate: `${rot * p}deg` },
        { scale: 0.5 + p * 0.6 },
      ],
      opacity: p < 0.65 ? 1 : 1 - (p - 0.65) / 0.35,
    };
  });

  // Per-ball start delay via a parallel opacity gate would add a hook;
  // cheaper to fold the delay into the initial transform offset feel by
  // just letting all balls start together — the random rot/dir already
  // de-syncs them visually. (delay kept for API symmetry.)
  void delay;

  return (
    <Animated.View style={[styles.ball, animStyle]}>
      <SoccerBall size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  ball: {
    position: 'absolute',
  },
});
