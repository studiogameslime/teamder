import React, { useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import type { ScorePoint } from '@/utils/managerDashboard';

/** Compact public-profile chart; chronological order begins on the right. */
export function SocialScoreChart({ points }: { points: ScorePoint[] }) {
  const [width, setWidth] = useState(300);
  const { fontScale } = useWindowDimensions();
  const scale = Math.max(1, fontScale), baseline = 57, height = baseline + 25 * scale;
  const coords = points.map((p, i) => ({
    x: points.length === 1 ? width / 2 : width - 22 * scale - i * (width - 44 * scale) / (points.length - 1),
    y: baseline - p.score * 4,
  }));
  const line = coords.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ');
  return <View onLayout={e => { if (e.nativeEvent.layout.width > 0) setWidth(e.nativeEvent.layout.width); }}
    style={{marginTop:8}} accessible accessibilityLabel={`ציוני המחזורים מהישן לחדש: ${points.map(p => p.score.toFixed(1)).join(', ')}`}>
    <Svg width={width} height={height} accessible={false}>
      {coords.length > 1 ? <><Path d={`${line} L${coords[coords.length-1].x},${baseline} L${coords[0].x},${baseline} Z`} fill="#2563EB" opacity={0.08}/><Path d={line} stroke="#2563EB" strokeWidth={2} fill="none"/></> : null}
      {coords.map((p,i) => <React.Fragment key={points[i].gameId}><Circle cx={p.x} cy={p.y} r={3.7} fill="#2563EB" stroke="white" strokeWidth={1}/><SvgText x={p.x} y={baseline+18*scale} fontSize={11*scale} textAnchor="middle" fill="#526C93">{points[i].score.toFixed(1)}</SvgText></React.Fragment>)}
    </Svg>
  </View>;
}
