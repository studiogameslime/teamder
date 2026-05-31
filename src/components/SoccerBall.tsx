// SoccerBall — based on the public-domain Wikimedia Commons SVG
// "Soccerball.svg" (https://commons.wikimedia.org/wiki/File:Soccerball.svg).
//
// We embed the SVG's actual paths verbatim (one path for the seams
// drawn as strokes, one path for the black pentagon panels filled).
// This gets us a real truncated-icosahedron projection without
// hand-rolling the geometry. A radial gradient + a single soft
// highlight on top sells the 3D finish.

import React from 'react';
import {
  Circle,
  Defs,
  G,
  Path,
  RadialGradient,
  Stop,
  Svg,
} from 'react-native-svg';

interface Props {
  size?: number;
  /** Kept for API compatibility — palette is fixed. */
  color?: string;
}

// Seam strokes (the curved lines tracing the hexagon edges around
// the pentagons). Verbatim from Wikimedia Commons.
const SEAM_PATH =
  'm-1643-1716 155 158m-550 2364c231 231 538 195 826 202m-524-2040c-491 351-610 1064-592 1060m1216-1008c-51 373 84 783 364 1220m-107-2289c157-157 466-267 873-329m-528 4112c-50 132-37 315-8 510m62-3883c282 32 792 74 1196 303m-404 2644c310 173 649 247 1060 180m-340-2008c-242 334-534 645-872 936m1109-2119c-111-207-296-375-499-534m1146 1281c100 3 197 44 290 141m-438 495c158 297 181 718 204 1140';

// Black pentagon panels filled. Each `M…z` sub-path is a single pentagon.
const PANELS_PATH =
  'm-1624-1700c243-153 498-303 856-424 141 117 253 307 372 492-288 275-562 544-724 756-274-25-410-2-740-60 3-244 84-499 236-764zm2904-40c271 248 537 498 724 788-55 262-105 553-180 704-234-35-536-125-820-200-138-357-231-625-340-924 210-156 417-296 616-368zm-3273 3033a2376 2376 0 0 1-378-1392l59-7c54 342 124 674 311 928-36 179-2 323 51 458zm1197-1125c365 60 717 120 1060 180 106 333 120 667 156 1000-263 218-625 287-944 420-372-240-523-508-736-768 122-281 257-561 464-832zm3013 678a2376 2376 0 0 1-925 1147l-116-5c84-127 114-297 118-488 232-111 464-463 696-772 86 30 159 72 227 118zm-2287 1527a2376 2376 0 0 1-993-251c199 74 367 143 542 83 53 75 176 134 451 168z';

export function SoccerBall({ size = 64 }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      // Verbatim Wikimedia viewBox so the embedded path coordinates land
      // at the right offsets without rescaling them by hand.
      viewBox="-2500 -2500 5000 5000"
    >
      <Defs>
        {/* Soft 3D shading — light hits the upper-left, falls off to a
            neutral mid-grey toward the bottom-right. Pure white at the
            specular point would blow out the panel pattern, so we keep
            the brightest stop slightly off-white. */}
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

      {/* Seam group — stroke=black at width 24 (matches Wikimedia source). */}
      <G stroke="#0F172A" strokeWidth={24}>
        {/* Ball body fills the gradient so we get 3D depth instead of
            a flat white circle. */}
        <Circle fill="url(#ballShade)" r={2376} />
        {/* Hexagon edge seams. */}
        <Path fill="none" d={SEAM_PATH} />
      </G>

      {/* Black pentagon panels. */}
      <Path fill="#0F172A" d={PANELS_PATH} />

      {/* Specular highlight — a single soft white circle in the upper
          area gives the ball a glossy finish without obliterating the
          panel pattern under it. Positioned in the "white space" near
          the top of the ball. */}
      <Circle
        cx={-400}
        cy={-1500}
        r={300}
        fill="#FFFFFF"
        opacity={0.45}
      />
      <Circle
        cx={-440}
        cy={-1560}
        r={130}
        fill="#FFFFFF"
        opacity={0.85}
      />
    </Svg>
  );
}
