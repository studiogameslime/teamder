// SoccerBall — SVG with a real panel pattern (centre black pentagon
// + 5 surrounding pentagons + connecting wedges + radial highlight),
// not the flat Ionicons glyph the splash used before. Reads as a 3D
// ball at any size from 16 → 280.
//
// We render plain SVG primitives so the existing `react-native-svg`
// dependency is enough — no extra native module, no asset to bundle.

import React, { useMemo } from 'react';
import {
  Circle,
  Defs,
  G,
  Polygon,
  RadialGradient,
  Stop,
  Svg,
} from 'react-native-svg';

interface Props {
  size?: number;
  /** Highlight tint. Kept for API compatibility — the SVG ball ignores
   *  it (its colour comes from the embedded gradient + pentagons) but
   *  the prop stays so callers can swap freely. */
  color?: string;
}

/** Build the 5 vertex points of a regular pentagon centred at (cx, cy),
 *  radius r, with rotation offset in degrees. SVG y-axis points DOWN,
 *  so a 0° rotation means the first vertex points UP visually (we use
 *  `-Math.sin` to flip y back to standard math convention). */
function pentagon(cx: number, cy: number, r: number, rotDeg = 0): string {
  const points: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((rotDeg - 90 + i * 72) * Math.PI) / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return points.join(' ');
}

export function SoccerBall({ size = 64 }: Props) {
  // Pre-compute the 5 satellite pentagons. Each one sits on the outer
  // ring at a multiple of 72°, oriented so one vertex points toward the
  // centre — that's what gives the ball its woven look.
  const satellites = useMemo(() => {
    const out: { cx: number; cy: number; rot: number }[] = [];
    const ringR = 56;          // distance from centre to satellite centre
    const localR = 20;         // satellite pentagon radius
    for (let i = 0; i < 5; i++) {
      const a = ((-90 + i * 72) * Math.PI) / 180;
      out.push({
        cx: Math.cos(a) * ringR,
        cy: Math.sin(a) * ringR,
        // Rotate the satellite so a vertex points back toward the centre.
        // (Adding 180° to "i*72" flips the orientation.)
        rot: 180 + i * 72,
        // localR kept above for clarity / future tweaks
      });
      // satisfy unused-var lint via underscore destructure
      void localR;
    }
    return out;
  }, []);

  return (
    <Svg width={size} height={size} viewBox="-100 -100 200 200">
      <Defs>
        {/* Soft 3D shading — light hits the upper-left, falls off to a
            neutral mid-grey toward the bottom-right. */}
        <RadialGradient
          id="ballShade"
          cx="35%"
          cy="28%"
          rx="75%"
          ry="75%"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="55%" stopColor="#F8FAFC" stopOpacity={1} />
          <Stop offset="100%" stopColor="#94A3B8" stopOpacity={1} />
        </RadialGradient>
      </Defs>

      {/* Ball body — radial-shaded white circle with a thin outline. */}
      <Circle
        cx={0}
        cy={0}
        r={95}
        fill="url(#ballShade)"
        stroke="#0F172A"
        strokeWidth={3}
      />

      {/* Connecting wedges — thin lines from each satellite pentagon
          edge inward to the centre pentagon, suggesting the woven
          hexagon edges without drawing them out fully. */}
      <G>
        {satellites.map((s, i) => {
          const a = ((-90 + i * 72) * Math.PI) / 180;
          const innerX = Math.cos(a) * 30;
          const innerY = Math.sin(a) * 30;
          return (
            <Polygon
              key={`wedge-${i}`}
              points={`${innerX.toFixed(2)},${innerY.toFixed(2)} ${(s.cx).toFixed(2)},${(s.cy).toFixed(2)} ${(s.cx + Math.cos(a + Math.PI / 2) * 6).toFixed(2)},${(s.cy + Math.sin(a + Math.PI / 2) * 6).toFixed(2)} ${(innerX + Math.cos(a + Math.PI / 2) * 4).toFixed(2)},${(innerY + Math.sin(a + Math.PI / 2) * 4).toFixed(2)}`}
              fill="#0F172A"
              opacity={0.85}
            />
          );
        })}
      </G>

      {/* Central pentagon — the heart of the panel pattern. */}
      <Polygon points={pentagon(0, 0, 28)} fill="#0F172A" />

      {/* Satellite pentagons — 5 around the centre. */}
      {satellites.map((s, i) => (
        <Polygon
          key={`sat-${i}`}
          points={pentagon(s.cx, s.cy, 20, s.rot)}
          fill="#0F172A"
        />
      ))}

      {/* Top-left specular highlight — sells the 3D illusion. */}
      <Circle cx={-38} cy={-44} r={18} fill="#FFFFFF" opacity={0.45} />
      <Circle cx={-44} cy={-50} r={9} fill="#FFFFFF" opacity={0.7} />
    </Svg>
  );
}
