// SoccerBall — clean SVG soccer ball.
//
// Renders the recognisable "football" silhouette without trying to be
// a photorealistic truncated icosahedron:
//   • shaded white sphere (radial gradient for 3D feel)
//   • central black pentagon (point UP)
//   • 5 small black caps near the rim, each sitting on a pentagon
//     edge's outward normal — that's the visual cue that says "panels"
//   • specular highlight in the upper-left for a glossy finish
//
// Earlier revisions overlaid extra connector wedges to "suggest" the
// hexagon edges, which read as visual noise. Removing them and
// keeping the geometry symmetric is what makes the ball read clean
// at any size.

import React, { useMemo } from 'react';
import {
  Circle,
  Defs,
  Polygon,
  RadialGradient,
  Stop,
  Svg,
} from 'react-native-svg';

interface Props {
  size?: number;
  /** Kept for API compatibility — the SVG palette is fixed. */
  color?: string;
}

/** Regular pentagon centred at (cx, cy), radius r, top vertex up. */
function pentagonPoints(cx: number, cy: number, r: number, rotDeg = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = ((rotDeg - 90 + i * 72) * Math.PI) / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

/** Regular hexagon centred at (cx, cy), radius r (centre→vertex). */
function hexagonPoints(cx: number, cy: number, r: number, rotDeg = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((rotDeg + i * 60) * Math.PI) / 180;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  return pts.join(' ');
}

export function SoccerBall({ size = 64 }: Props) {
  // The 5 satellite PENTAGONS sit on the angle bisectors of the
  // central pentagon (36° offset from each vertex). Real soccer
  // balls show PENTAGONS as the black panels — the hexagons in
  // between are white and don't get drawn. Smaller-radius satellites
  // with a bit of breathing room read as the classic icon look.
  const caps = useMemo(() => {
    const out: { cx: number; cy: number; rot: number }[] = [];
    const ringR = 55;      // closer in than before → fits inside ball cleanly
    for (let i = 0; i < 5; i++) {
      const a = ((-90 + i * 72 + 36) * Math.PI) / 180;
      out.push({
        cx: Math.cos(a) * ringR,
        cy: Math.sin(a) * ringR,
        // Rotate so a vertex points OUTWARD (away from the ball
        // centre) — that's the natural rosette pose. The previous
        // +180 inverted this and made satellites point inward,
        // which looked off.
        rot: i * 72 + 36,
      });
    }
    return out;
  }, []);

  return (
    <Svg width={size} height={size} viewBox="-100 -100 200 200">
      <Defs>
        <RadialGradient
          id="ballShade"
          cx="35%"
          cy="28%"
          rx="78%"
          ry="78%"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset="55%" stopColor="#F1F5F9" stopOpacity={1} />
          <Stop offset="100%" stopColor="#94A3B8" stopOpacity={1} />
        </RadialGradient>
      </Defs>

      {/* Ball body */}
      <Circle
        cx={0}
        cy={0}
        r={95}
        fill="url(#ballShade)"
        stroke="#0F172A"
        strokeWidth={3}
      />

      {/* 5 satellite pentagons — keep them smaller so they breathe */}
      {caps.map((c, i) => (
        <Polygon
          key={`cap-${i}`}
          points={pentagonPoints(c.cx, c.cy, 15, c.rot)}
          fill="#0F172A"
        />
      ))}

      {/* Central pentagon */}
      <Polygon points={pentagonPoints(0, 0, 22)} fill="#0F172A" />

      {/* Specular highlight — placed at the very TOP of the ball, in
          the gap between the upper-left and upper-right satellites
          (which sit at -54° / -126°). Earlier the highlight was at
          (-38, -44) which overlapped satellite #4 and made it look
          chewed. */}
      <Circle cx={0} cy={-70} r={14} fill="#FFFFFF" opacity={0.55} />
      <Circle cx={-3} cy={-72} r={6} fill="#FFFFFF" opacity={0.85} />
    </Svg>
  );
}
