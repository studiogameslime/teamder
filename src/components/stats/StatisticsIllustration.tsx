import React from 'react';
import { Image } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
/** Small code-native illustrations, matching the club statistics outline artwork. */
export function StatisticsIllustration({kind,size=54}:{kind:'trophy'|'boot'|'glove'|'ball';size?:number}) {
 if (kind === 'ball' || kind === 'glove') return <Image source={kind === 'ball' ? require('@/assets/images/match-football.png') : require('../../../assets/season-summary/goalkeeper-glove.png')} style={{width:size,height:size}} resizeMode="contain" accessible={false}/>;
 const ink='#142653';
 return <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
  {kind==='trophy'?<><Circle cx={32} cy={31} r={27} fill="#FFF7DF"/><Path d="M19 10H45V29Q45 42 32 45Q19 42 19 29Z M19 16H11V26Q11 36 23 37 M45 16H53V26Q53 36 41 37 M32 45V53 M24 53H40V58H24Z" fill="#FFD46B" stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/><Path d="M24 15V29Q24 35 28 38" stroke="#FFF1B5" strokeWidth={3} strokeLinecap="round"/></>:
  <><Circle cx={32} cy={32} r={27} fill="#EDF5FF"/><Path d="M9 38L27 29L37 16Q43 31 53 26L57 42Q37 48 10 47Z" fill="#8EC5FF" stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/><Path d="M11 47H56 M16 48V53 M28 48V53 M44 47V52 M53 45V50 M28 29L36 34 M33 24L40 29 M38 21L44 25" stroke={ink} strokeWidth={2.5} strokeLinecap="round"/><Path d="M13 40L24 35" stroke="#FFF" strokeWidth={3} strokeLinecap="round"/></>}
 </Svg>;
}
