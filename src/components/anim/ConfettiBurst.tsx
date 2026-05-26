// ConfettiBurst — short-lived particle explosion. Mount it (e.g. when
// a goal is scored) and it self-destructs after ~1.4s. Each piece
// starts at the centre, shoots out in a random direction, falls a bit
// under gravity, and fades out at the end.
//
// Pure Reanimated + RN <View/> — no SVG dependency, no third-party
// confetti lib (those typically pull in their own renderer and are
// 50–100KB). All animation runs on the UI thread so this stays smooth
// even when the bundle is busy.

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  /** Number of particles. Default 28 — dense enough to read as a
   *  celebration without overrunning the frame budget. */
  count?: number;
  /** Override the pixel spread radius. Default 220 — tuned for a
   *  full-width scoreboard burst on a typical phone. */
  spread?: number;
  /** Palette to pick from. Defaults to brand colours + white. */
  colors?: string[];
  /** Lifetime in ms before pieces fade out. Default 1300. */
  durationMs?: number;
  style?: ViewStyle;
}

const DEFAULT_COLORS = ['#1E40AF', '#3B82F6', '#FBBF24', '#F87171', '#FFFFFF'];

export function ConfettiBurst({
  count = 28,
  spread = 220,
  colors = DEFAULT_COLORS,
  durationMs = 1300,
  style,
}: Props) {
  // Pre-compute each particle's target trajectory + visual once, so
  // re-renders don't re-randomise mid-flight.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = Math.random() * Math.PI * 2;
        const distance = spread * (0.6 + Math.random() * 0.4);
        return {
          key: i,
          tx: Math.cos(angle) * distance,
          ty: Math.sin(angle) * distance - spread * 0.15, // bias upward
          size: 6 + Math.random() * 6,
          rot: (Math.random() - 0.5) * 720,
          color: colors[Math.floor(Math.random() * colors.length)],
          delay: Math.random() * 80,
        };
      }),
    [count, spread, colors],
  );

  return (
    <View pointerEvents="none" style={[styles.host, style]}>
      {pieces.map((p) => (
        <Piece
          key={p.key}
          tx={p.tx}
          ty={p.ty}
          size={p.size}
          rot={p.rot}
          color={p.color}
          delay={p.delay}
          duration={durationMs}
        />
      ))}
    </View>
  );
}

interface PieceProps {
  tx: number;
  ty: number;
  size: number;
  rot: number;
  color: string;
  delay: number;
  duration: number;
}

function Piece({ tx, ty, size, rot, color, delay, duration }: PieceProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, duration]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    // Gravity arc: y travels to `ty` but with a downward bias as p→1.
    const yArc = ty * p + Math.pow(p, 2) * spread(p) * 0.4;
    return {
      transform: [
        { translateX: tx * p },
        { translateY: yArc },
        { rotate: `${rot * p}deg` },
        { scale: 1 - p * 0.2 },
      ],
      // Hold full opacity for the first ~70% of the flight, then fade.
      opacity: p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3,
    };
  });

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          width: size,
          height: size * 0.4,
          borderRadius: 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

// Helper to express gravity offset as a worklet-safe expression.
function spread(_p: number) {
  'worklet';
  return 120;
}

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
