// ChatPitch — small football-themed visual helpers for the chat surface:
//   • GrassBackdrop — faint vertical mowing stripes behind the messages
//   • EmptyPitch    — a little pitch + ball illustration for empty chats
//   • RedCardGlyph  — a tilted red card (used as the "delete" menu icon)
//
// All intentionally subtle — a hint of football, never a distraction.

import React from 'react';
import { Dimensions, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { SoccerBall } from '../SoccerBall';
import { Breathing } from '../anim/Breathing';

const LINE = 'rgba(255,255,255,0.85)';

const { width: SW, height: SH } = Dimensions.get('window');

// EmptyPitch moved to components/EmptyPitch — every empty state in the app
// wants it, not only this one. Re-exported so chat imports keep working.
export { EmptyPitch } from '@/components/EmptyPitch';

/**
 * Faint football-pitch markings (top-down, vertical orientation) used as a
 * subtle chat-background watermark: outer boundary, halfway line, centre
 * circle + spot, and a penalty box at each end. Very low-contrast green so
 * it reads as "pitch" without fighting the messages.
 */
export function PitchLinesBackdrop() {
  // Draw in the real screen box; the header/composer paint over the rest.
  const W = SW;
  const H = SH;
  const stroke = 'rgba(21,128,61,0.10)';
  const sw = 2;
  const boxW = Math.min(W * 0.6, 320);
  const boxH = H * 0.11;
  const circleR = Math.min(W * 0.24, 150);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={W} height={H}>
        {/* Outer boundary */}
        <Rect x={18} y={18} width={W - 36} height={H - 36} rx={10} stroke={stroke} strokeWidth={sw} fill="none" />
        {/* Halfway line + centre circle + spot */}
        <Line x1={18} y1={H / 2} x2={W - 18} y2={H / 2} stroke={stroke} strokeWidth={sw} />
        <Circle cx={W / 2} cy={H / 2} r={circleR} stroke={stroke} strokeWidth={sw} fill="none" />
        <Circle cx={W / 2} cy={H / 2} r={4} fill={stroke} />
        {/* Penalty box at each end */}
        <Rect x={(W - boxW) / 2} y={18} width={boxW} height={boxH} stroke={stroke} strokeWidth={sw} fill="none" />
        <Rect x={(W - boxW) / 2} y={H - 18 - boxH} width={boxW} height={boxH} stroke={stroke} strokeWidth={sw} fill="none" />
      </Svg>
    </View>
  );
}

export function RedCardGlyph({ size = 18, color = '#EF4444' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={7}
        y={3}
        width={10}
        height={18}
        rx={2}
        fill={color}
        transform="rotate(12 12 12)"
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  pitchWrap: { alignItems: 'center', justifyContent: 'center' },
  pitchBall: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
