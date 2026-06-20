// WinLossRing — a small donut showing a win/loss split: a green arc for wins
// and a red arc for losses over a light track. Used in the player card's
// head-to-head rows.

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '@/theme';

export function WinLossRing({
  wins,
  losses,
  size = 54,
  stroke = 6,
}: {
  wins: number;
  losses: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = wins + losses;
  const winFrac = total > 0 ? wins / total : 0;
  const lossFrac = total > 0 ? losses / total : 0;
  // Tiny gap between the two arcs so the colour boundary reads cleanly.
  const gap = total > 0 && wins > 0 && losses > 0 ? c * 0.02 : 0;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        {/* Track */}
        <Circle cx={cx} cy={cy} r={r} stroke="#EEF2F7" strokeWidth={stroke} fill="none" />
        {/* Losses — red, starts at the top, clockwise (matches the sketch). */}
        {losses > 0 ? (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={colors.danger}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${Math.max(0, c * lossFrac - gap)} ${c}`}
            strokeLinecap="butt"
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        ) : null}
        {/* Wins — green, fills the rest. */}
        {wins > 0 ? (
          <Circle
            cx={cx}
            cy={cy}
            r={r}
            stroke={colors.success}
            strokeWidth={stroke}
            fill="none"
            strokeDasharray={`${Math.max(0, c * winFrac - gap)} ${c}`}
            strokeLinecap="butt"
            transform={`rotate(${-90 + lossFrac * 360} ${cx} ${cy})`}
          />
        ) : null}
      </Svg>
    </View>
  );
}
