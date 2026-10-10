import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
/** Small code-native illustrations, matching the club statistics outline artwork. */
export function StatisticsIllustration({kind,size=54}:{kind:'trophy'|'boot'|'glove'|'ball';size?:number}) {
 const ink='#142653';
 return <Svg width={size} height={size} viewBox="0 0 64 64" accessible={false}>
  {kind==='trophy'?<><Circle cx={32} cy={31} r={27} fill="#FFF7DF"/><Path d="M19 10H45V29Q45 42 32 45Q19 42 19 29Z M19 16H11V26Q11 36 23 37 M45 16H53V26Q53 36 41 37 M32 45V53 M24 53H40V58H24Z" fill="#FFD46B" stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/><Path d="M24 15V29Q24 35 28 38" stroke="#FFF1B5" strokeWidth={3} strokeLinecap="round"/></>:
  kind==='boot'?<><Circle cx={32} cy={32} r={27} fill="#EDF5FF"/><Path d="M9 38L27 29L37 16Q43 31 53 26L57 42Q37 48 10 47Z" fill="#8EC5FF" stroke={ink} strokeWidth={2.5} strokeLinejoin="round"/><Path d="M11 47H56 M16 48V53 M28 48V53 M44 47V52 M53 45V50 M28 29L36 34 M33 24L40 29 M38 21L44 25" stroke={ink} strokeWidth={2.5} strokeLinecap="round"/><Path d="M13 40L24 35" stroke="#FFF" strokeWidth={3} strokeLinecap="round"/></>:
  kind==='glove'?<><Circle cx={32} cy={32} r={27} fill="#EDF5FF"/><Path d="M21 53L18 37L10 28Q8 22 13 22L20 29V13Q20 7 24 10V26V8Q28 4 30 9V26V8Q34 5 36 10V27V14Q41 9 42 16V32L47 24Q51 20 54 24L45 43L42 53Z" fill="#D5E9FF" stroke={ink} strokeWidth={2.4} strokeLinejoin="round"/><Path d="M22 52H41V59H22Z" fill="#72B5FF" stroke={ink} strokeWidth={2.4}/></>:
  <><Circle cx={32} cy={32} r={27} fill="#F5F9FF" stroke={ink} strokeWidth={2.5}/><Path d="M32 21L43 29L39 42H25L21 29Z M10 17L21 13L24 4 M43 13L54 17L59 28 M51 42L48 55L36 59 M16 42L18 55L28 59 M5 28L10 38L16 42" fill={ink}/><Path d="M21 13L27 23 M43 13L38 24 M43 30L55 29 M38 42L42 52 M25 42L21 52 M21 30L10 29" fill="none" stroke={ink} strokeWidth={2}/></>}
 </Svg>;
}
