import React, { useId } from 'react';
import Svg, { Defs, Ellipse, LinearGradient, Path, Stop } from 'react-native-svg';

/** The shaded shirt used in allocation previews and the live scoreboard. */
export function TeamShirtIllustration({ color, width = 76 }: { color: string; width?: number }) {
  const gradientId = `team-shirt-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <Svg width={width} height={width * 82 / 76} viewBox="0 0 100 110" accessible={false}>
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#000" stopOpacity={0.28}/><Stop offset="0.25" stopColor={color}/>
          <Stop offset="0.52" stopColor={color}/><Stop offset="0.75" stopColor="#FFF" stopOpacity={0.18}/><Stop offset="1" stopColor="#000" stopOpacity={0.3}/>
        </LinearGradient>
      </Defs>
      <Ellipse cx={50} cy={104} rx={29} ry={3} fill="#0C1942" opacity={0.08}/>
      <Path d="M33 9 L18 17 L2 42 L18 52 L26 41 L23 96 Q50 104 77 96 L74 41 L82 52 L98 42 L82 17 L67 9 Q50 22 33 9Z" fill={color}/>
      <Path d="M33 9 L18 17 L2 42 L18 52 L26 41 L23 96 Q50 104 77 96 L74 41 L82 52 L98 42 L82 17 L67 9 Q50 22 33 9Z" fill={`url(#${gradientId})`}/>
      <Path d="M33 9 Q50 29 67 9 M5 42 L18 49 M82 49 L95 42" fill="none" stroke="#FFF" strokeOpacity={0.8} strokeWidth={2}/>
      <Path d="M27 39 Q32 63 28 92 M73 39 Q68 63 72 92 M25 94 Q50 100 75 94" fill="none" stroke="#000" strokeOpacity={0.12}/>
    </Svg>
  );
}

/** Shared bib shape for the live score and the next-match preview. */
export function TeamShirt({ color, size = 32, outline = true, strokeColor }: {
  color: string; size?: number; outline?: boolean; strokeColor?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" accessible={false}>
      <Path
        d="M14 5 7 8 2 17l7 4 3-5-1 19h18l-1-19 3 5 7-4-5-9-7-3c-1 4-11 4-12 0Z"
        fill={outline ? 'none' : color}
        stroke={strokeColor ?? (outline ? color : '#334155')}
        strokeWidth={outline ? 1.8 : 1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {!outline && <Path d="M14 5c1 4 11 4 12 0" fill="none" stroke={strokeColor ?? '#334155'} strokeWidth={1.4}/>}
    </Svg>
  );
}
