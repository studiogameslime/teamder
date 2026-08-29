// EmptyPitch — the app's empty state: a small pitch with a ball resting on it,
// floating just enough to say "nothing here yet, but this thing is alive".
//
// It lived in components/chat and was used by exactly one screen, which is why
// every other empty state in the app is a grey outline icon in a circle. It is
// the same football the rest of the product is made of; there was no reason for
// it to belong to the chat.

import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Circle, Line, Rect, Svg } from 'react-native-svg';
import { SoccerBall } from '@/components/SoccerBall';
import { Breathing } from '@/components/anim/Breathing';

const LINE = 'rgba(255,255,255,0.55)';

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
        {/* Gentle idle float so the empty chat feels alive, not frozen. */}
        <Breathing mode="bob" amount={5} periodMs={2200}>
          <SoccerBall size={Math.round(width * 0.2)} />
        </Breathing>
      </View>
    </View>
  );
}

/** A tilted filled red card (referee "send off") — the delete glyph. */

const styles = StyleSheet.create({
  pitchWrap: { alignItems: 'center', justifyContent: 'center' },
  pitchBall: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
