// ChatPitch — small football-themed visual helpers for the chat surface:
//   • GrassBackdrop — faint vertical mowing stripes behind the messages
//   • EmptyPitch    — a little pitch + ball illustration for empty chats
//   • RedCardGlyph  — a tilted red card (used as the "delete" menu icon)
//
// All intentionally subtle — a hint of football, never a distraction.

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Line, Rect } from 'react-native-svg';
import { SoccerBall } from '../SoccerBall';

const LINE = 'rgba(255,255,255,0.85)';

/** Very faint vertical grass stripes — fills its parent. */
export function GrassBackdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={styles.stripes}>
        {Array.from({ length: 8 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.stripe,
              { backgroundColor: i % 2 === 0 ? '#16A34A' : 'transparent' },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

/** A small stylised pitch with a ball — empty-state hero. */
export function EmptyPitch({ width = 200, style }: { width?: number; style?: ViewStyle }) {
  const height = Math.round(width * 0.62);
  const W = 200;
  const H = 124;
  return (
    <View style={[{ width, height }, styles.pitchWrap, style]}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${H}`}>
        <Rect x={4} y={4} width={W - 8} height={H - 8} rx={14} fill="#1B8A43" />
        <Rect x={14} y={14} width={W - 28} height={H - 28} rx={6} stroke={LINE} strokeWidth={2} fill="none" />
        <Line x1={W / 2} y1={14} x2={W / 2} y2={H - 14} stroke={LINE} strokeWidth={2} />
        <Circle cx={W / 2} cy={H / 2} r={20} stroke={LINE} strokeWidth={2} fill="none" />
        <Circle cx={W / 2} cy={H / 2} r={2.5} fill={LINE} />
        <Rect x={14} y={H / 2 - 22} width={22} height={44} stroke={LINE} strokeWidth={2} fill="none" />
        <Rect x={W - 36} y={H / 2 - 22} width={22} height={44} stroke={LINE} strokeWidth={2} fill="none" />
      </Svg>
      <View style={styles.pitchBall} pointerEvents="none">
        <SoccerBall size={Math.round(width * 0.2)} />
      </View>
    </View>
  );
}

/** A tilted filled red card (referee "send off") — the delete glyph. */
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
  stripes: { flex: 1, flexDirection: 'row', opacity: 0.04 },
  stripe: { flex: 1 },
  pitchWrap: { alignItems: 'center', justifyContent: 'center' },
  pitchBall: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
