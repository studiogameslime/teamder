// StatDonut — a small animated percentage ring (the "graph" used across the
// community-stats fun facts). The arc SWEEPS from empty to `pct` on mount and
// the centre number COUNTS UP in sync, so each stat feels alive. Pure visual.

import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { CountUp } from '@/components/anim/CountUp';
import { colors, typography } from '@/theme';

const ACircle = Animated.createAnimatedComponent(Circle);

interface Props {
  /** 0..100 percentage. */
  pct: number;
  tint: string;
  size?: number;
  strokeWidth?: number;
  /** Stagger the sweep so a column of donuts cascades. */
  delayMs?: number;
}

export function StatDonut({ pct, tint, size = 56, strokeWidth = 6, delayMs = 0 }: Props) {
  const clamped = Math.max(0, Math.min(100, pct)) / 100;
  const r = (size - strokeWidth) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  // Animate strokeDashoffset: circumference (empty) → circumference*(1-pct).
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withTiming(clamped, { duration: 950, easing: Easing.out(Easing.cubic) }),
    );
  }, [clamped, delayMs, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: circumference * (1 - progress.value),
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={c}
          cy={c}
          r={r}
          stroke={tint + '22'}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <ACircle
          cx={c}
          cy={c}
          r={r}
          stroke={tint}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          animatedProps={animatedProps}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      <View style={StyleSheet.absoluteFill}>
        <View style={styles.center}>
          <CountUp
            from={0}
            to={Math.round(pct)}
            durationMs={950}
            suffix="%"
            style={[styles.text, { fontSize: size * 0.26 }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { ...typography.caption, color: colors.text, fontWeight: '900', fontVariant: ['tabular-nums'] },
});
