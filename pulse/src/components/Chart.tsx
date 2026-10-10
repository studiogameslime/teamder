import React from 'react';
import { View } from 'react-native';
import Svg, { Rect, Polyline } from 'react-native-svg';
import { colors } from '../theme';
import type { DailyPoint } from '../types';

// Compact bar chart for daily series (earnings, etc.).
export function Bars({
  data,
  height = 90,
  color = colors.primary,
}: {
  data: DailyPoint[];
  height?: number;
  color?: string;
}) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const gap = 2;
  const W = 320;
  const bw = (W - gap * (n - 1)) / n;
  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 4);
          return (
            <Rect
              key={i}
              x={i * (bw + gap)}
              y={height - h}
              width={bw}
              height={h}
              rx={1.5}
              fill={color}
              opacity={0.4 + 0.6 * (i / n)}
            />
          );
        })}
      </Svg>
    </View>
  );
}

// Line sparkline for daily series (active users, etc.).
export function Sparkline({
  data,
  height = 90,
  color = colors.green,
}: {
  data: DailyPoint[];
  height?: number;
  color?: string;
}) {
  if (data.length < 2) return null;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const W = 320;
  const span = max - min || 1;
  const pts = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = height - 4 - ((d.value - min) / span) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${W} ${height}`}>
      <Polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
