import React, { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme';
import { scoreTrend } from '@/utils/personalStatistics';
import type { ScorePoint } from '@/utils/managerDashboard';
/** SVG labels need explicit scaling; changing only its viewport distorts shapes. */
export function personalScoreChartLayout(width: number, fontScale: number, count: number) {
  const scale = Math.max(0.75, fontScale);
  const baseline = 94 + Math.max(0, scale - 1) * 38;
  const plotHeight = 68 + Math.max(0, scale - 1) * 22;
  const left = 30 * scale, right = width - 48 * scale;
  const spacing = count > 1 ? (right - left) / (count - 1) : width;
  return { scale, baseline, plotHeight, left, right,
    height: baseline + 34 * scale, dateY: baseline + 22 * scale,
    textFallback: scale > 1.6 || (count > 1 && spacing < 48 * scale) };
}
export function PersonalScoreChart({points,recentCount,loading=false}:{points:ScorePoint[];recentCount:number;loading?:boolean}) {
  const [width,setWidth]=useState(330);
  const { fontScale } = useWindowDimensions();
  const layout = personalScoreChartLayout(width, fontScale, points.length);
  const trend=scoreTrend(points), color=trend==='up'?'#139A55':trend==='down'?'#B97813':'#2467F4';
  const title=trend==='up'?'במגמת עלייה':trend==='down'?'במגמת ירידה':trend==='mixed'?'מגמה מעורבת':'ללא שינוי';
  const average=points.reduce((n,p)=>n+p.score,0)/Math.max(1,points.length);
  const baseline=layout.baseline;
  const y=(n:number)=>baseline-n*layout.plotHeight/10;
  const coords=points.map((p,i)=>({x:points.length===1?width/2:layout.right-i*(layout.right-layout.left)/(points.length-1),y:y(p.score)}));
  const line=coords.map((p,i)=>`${i?'L':'M'}${p.x},${p.y}`).join(' ');
  return <View style={s.card}>
    <View style={s.header}><View style={{flex:1,minWidth:150}}><Text style={s.title}>הציונים שלך</Text><Text style={s.sub}>{recentCount} המחזורים האחרונים</Text></View>{points.length>1&&<View style={[s.badge,{backgroundColor:color+'16'}]}><Text style={[s.badgeText,{color}]}>{title}</Text><Ionicons name={trend==='up'?'trending-up':trend==='down'?'trending-down':'analytics-outline'} size={15} color={color}/></View>}</View>
    {points.length ? <><View style={s.summary}><Text style={s.summaryText}>{average.toFixed(1)} ממוצע</Text><Text style={s.summaryText}>{points[points.length-1].score.toFixed(1)} ציון אחרון</Text></View>
    <View onLayout={event=>{const measured=event.nativeEvent.layout.width;if(measured>0)setWidth(measured);}} accessible accessibilityLabel={`ציוני המחזור מהישן לחדש: ${points.map(p=>`${new Date(p.at).toLocaleDateString('he-IL')}: ${p.score.toFixed(1)} מתוך 10`).join(', ')}`}>{layout.textFallback ? <View style={s.scoreList}>{points.map(point => <View key={point.gameId} style={s.scoreRow}>
      <Text style={s.listDate}>{new Date(point.at).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit',year:'numeric'})}</Text>
      <Text style={s.listScore}>{point.score.toFixed(1)} מתוך 10</Text>
    </View>)}</View> : <Svg width={width} height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} accessible={false}>
      {[0,2,4,6,8,10].map(n=><React.Fragment key={n}><Line x1={15} x2={width-30*layout.scale} y1={y(n)} y2={y(n)} stroke="#D1DFF3" strokeDasharray="3 3"/><SvgText x={width-15*layout.scale} y={y(n)+4*layout.scale} fontSize={10*layout.scale} fill="#7585A0" textAnchor="middle">{n}</SvgText></React.Fragment>)}
      {coords.length>1&&<><Path d={`${line} L${coords[coords.length-1].x},${baseline} L${coords[0].x},${baseline} Z`} fill={color} opacity={0.14}/><Path d={line} stroke={color} strokeWidth={2.6} fill="none"/></>}
      {coords.map((p,i)=><React.Fragment key={points[i].gameId}><Circle cx={p.x} cy={p.y} r={4.5} fill={color} stroke="#FFF" strokeWidth={2}/><SvgText x={p.x} y={p.y-11*layout.scale} textAnchor="middle" fontSize={12*layout.scale} fontWeight="700" fill="#111B40">{points[i].score.toFixed(1)}</SvgText><SvgText x={p.x} y={layout.dateY} textAnchor="middle" fontSize={10*layout.scale} fill="#7585A0">{new Date(points[i].at).toLocaleDateString('he-IL',{day:'2-digit',month:'2-digit'})}</SvgText></React.Fragment>)}
    </Svg>}</View><Text style={s.foot}>ציון מחזור מתוך 10</Text>{points.length<recentCount&&<Text style={s.foot}>יש ציון מתועד ב־{points.length} מתוך {recentCount} המחזורים</Text>}</> : <Text style={[s.sub,{paddingVertical:18}]}>{loading?'טוען את ציוני המחזורים…':'ציוני המחזורים שלך יופיעו כאן לאחר סיום המחזור ושמירת הסיכום'}</Text>}
  </View>;
}
const s=StyleSheet.create({scoreList:{gap:10,paddingVertical:14},scoreRow:{flexDirection:'row',flexWrap:'wrap',justifyContent:'space-between',gap:8},listDate:{fontSize:14,color:'#526C93'},listScore:{fontSize:15,fontWeight:'700',color:'#111B40'},card:{backgroundColor:'#FFF',borderRadius:17,padding:12,borderWidth:1,borderColor:'#EEF3FB'},header:{flexDirection:'row',flexWrap:'wrap',gap:8,alignItems:'flex-start'},title:{fontSize:18,fontWeight:'800',color:'#111B40',textAlign:RTL_LABEL_ALIGN},sub:{fontSize:13,color:'#526C93',textAlign:RTL_LABEL_ALIGN,marginTop:3,lineHeight:18},badge:{flexDirection:'row',flexShrink:1,gap:4,alignItems:'center',paddingHorizontal:8,paddingVertical:5,borderRadius:14},badgeText:{fontSize:11,fontWeight:'700',flexShrink:1},summary:{flexDirection:'row',flexWrap:'wrap',gap:18,marginTop:8},summaryText:{fontSize:14,fontWeight:'700',flexShrink:1,color:'#111B40'},foot:{fontSize:11,color:'#526C93',textAlign:'center',marginTop:3}});
