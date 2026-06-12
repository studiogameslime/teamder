// TimerProgressRing — a circular progress arc drawn around the live-match
// stopwatch. Shows how much of the configured match duration has elapsed
// (elapsed / matchDurationMinutes). Purely visual; the timer itself stays a
// count-up stopwatch. Overtime (progress ≥ 1) pins the ring full + red.

import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  /** Outer diameter in px. */
  size: number;
  /** 0..1 — elapsed / total. Values ≥1 render a full ring. */
  progress: number;
  /** Stopwatch running → brighter arc. */
  running?: boolean;
  /** Final minute before the configured duration → red arc (a "redder"
   *  warning that the match is about to hit time, per user feedback). */
  warning?: boolean;
  strokeWidth?: number;
  children?: React.ReactNode;
}

export function TimerProgressRing({
  size,
  progress,
  running,
  warning,
  strokeWidth = 6,
  children,
}: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const overtime = progress >= 1;
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dashOffset = circumference * (1 - clamped);

  const arcColor = overtime
    ? '#DC2626'
    : warning
      ? '#EF4444'
      : running
        ? '#1D4ED8'
        : '#94A3B8';

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* Track */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="#E2E8F0"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress arc — starts at 12 o'clock (rotate -90° around center). */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
});
