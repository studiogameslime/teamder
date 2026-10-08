import React from 'react';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

export function Donut({
  segments,
  size = 116,
  thickness = 18,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - thickness) / 2;
  const C = 2 * Math.PI * r;
  const cx = size / 2;
  let offset = 0;
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={cx}
        cy={cx}
        r={r}
        stroke={colors.surfaceAlt}
        strokeWidth={thickness}
        fill="none"
      />
      {segments.map((s, i) => {
        const len = (s.value / total) * C;
        const seg = (
          <Circle
            key={i}
            cx={cx}
            cy={cx}
            r={r}
            stroke={s.color}
            strokeWidth={thickness}
            fill="none"
            strokeDasharray={`${len} ${C - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cx})`}
          />
        );
        offset += len;
        return seg;
      })}
    </Svg>
  );
}
