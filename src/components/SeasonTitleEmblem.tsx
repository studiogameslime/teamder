import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path, Polygon, Rect } from 'react-native-svg';
import type { SeasonTitleKey } from '@/utils/seasonAwards';
import { seasonTitleTint } from '@/utils/seasonTitleIcon';

/** One vector identity per title, independent of screen, season or rank. */
function Football({ x, y, r, color }: { x: number; y: number; r: number; color: string }) {
  return <G transform={`translate(${x} ${y}) scale(${r / 20})`}>
    <Circle r={20} fill="#FFFFFF" stroke={color} strokeWidth={2.5} />
    <Polygon points="0,-7 7,-2 4,6 -4,6 -7,-2" fill={color} />
    <Path d="M0-7V-20M7-2L19-6M4 6L12 16M-4 6L-12 16M-7-2L-19-6" fill="none" stroke={color} strokeWidth={2.4} />
  </G>;
}

function TitleSymbol({ titleKey, color }: { titleKey: SeasonTitleKey; color: string }) {
  switch (titleKey) {
    case 'topScorer':
      return <>
        <Path d="M28 8H57V46M28 8V45M38 8V45M48 8V45M28 18H57M28 28H57M28 38H57" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <Football x={23} y={32} r={18} color={color} />
        <Path d="M2 26L8 23M2 37L7 34" stroke={color} strokeWidth={3} strokeLinecap="round" />
      </>;
    case 'topAssister':
      return <>
        <Path d="M6 28L14 18L26 28L37 31L49 34Q59 36 58 43L55 46H10Q4 46 4 40Z" fill={color} />
        <Path d="M17 27L23 23M23 31L29 27M29 34L35 30" stroke="#FFFFFF" strokeWidth={2.5} strokeLinecap="round" />
        <Path d="M12 45V51M25 45V51M40 45V51M52 44V49M20 14Q34 1 51 12M45 5L52 12L43 15" fill="none" stroke={color} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      </>;
    case 'mvp':
      return <>
        <Polygon points="32,0 40,19 61,21 45,35 50,55 32,45 14,55 19,35 3,21 24,19" fill={color} />
        <Football x={32} y={29} r={12} color={color} />
      </>;
    case 'topWinner':
      return <>
        <Path d="M8 19L32 3L56 19V31L32 15L8 31Z" fill={color} />
        <Path d="M13 36L32 24L51 36V47L32 58L13 47Z" fill={color} />
        <Path d="M23 40L30 46L42 33" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      </>;
    case 'mostLoyal':
      return <>
        <Rect x={8} y={10} width={46} height={42} rx={5} fill="#FFFFFF" stroke={color} strokeWidth={3} />
        <Path d="M8 23H54M20 5V16M42 5V16" stroke={color} strokeWidth={4} strokeLinecap="round" />
        <Rect x={17} y={30} width={6} height={6} rx={1} fill={color} />
        <Rect x={28} y={30} width={6} height={6} rx={1} fill={color} />
        <Rect x={17} y={41} width={6} height={6} rx={1} fill={color} />
        <Circle cx={46} cy={43} r={13} fill={color} stroke="#FFFFFF" strokeWidth={2} />
        <Path d="M40 43L44 47L52 38" fill="none" stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />
      </>;
    case 'cleanSheetKing':
      return <>
        <Path d="M9 47V9H55V47M10 21H54M10 33H54M21 10V47M33 10V47M45 10V47" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M25 40L34 49L54 26" fill="none" stroke="#FFFFFF" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M25 40L34 49L54 26" fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      </>;
    case 'penaltyKing':
      return <>
        <Circle cx={32} cy={28} r={21} fill="none" stroke={color} strokeWidth={3} />
        <Path d="M32 0V12M32 44V56M4 28H16M48 28H60" stroke="#FFFFFF" strokeWidth={8} />
        <Path d="M32 0V12M32 44V56M4 28H16M48 28H60" stroke={color} strokeWidth={4} strokeLinecap="round" />
        <Football x={32} y={28} r={12} color={color} />
      </>;
    case 'penaltyKeeper':
      return <>
        <Path d="M15 48L12 32L7 18Q6 14 10 13Q13 12 15 18L19 28L17 8Q17 3 21 3Q25 3 25 8L27 24L28 5Q28 1 32 1Q36 1 36 6V24L39 10Q40 5 44 6Q48 7 46 12L43 30L50 22Q53 19 56 22Q59 25 55 29L43 45L39 53Z" fill={color} />
        <Path d="M16 47L39 51L38 57L15 53Z" fill={color} stroke="#FFFFFF" strokeWidth={2} />
        <Path d="M24 33Q31 28 38 32" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" />
        <Football x={51} y={42} r={11} color={color} />
      </>;
    case 'deadlyDuo':
      return <>
        <Path d="M11 13L3 20L8 28L13 24V43H29V24L34 28L39 20L31 13L26 12Q21 23 16 12Z" transform="translate(-2 1) scale(.85)" fill={color} />
        <Path d="M11 13L3 20L8 28L13 24V43H29V24L34 28L39 20L31 13L26 12Q21 23 16 12Z" transform="translate(29 9) scale(.85)" fill={color} />
        <Path d="M18 8Q31-1 44 6M38 1L45 6L38 10M47 50Q34 59 21 52M27 48L20 52L27 57" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </>;
  }
}

export interface SeasonTitleEmblemProps {
  titleKey: SeasonTitleKey;
  /** Fixed vector size; does not grow with font size or award value. */
  size?: number;
  /** A missing title stays visibly unawarded, without changing its identity. */
  muted?: boolean;
  /** Omit next to a text label to avoid announcing the same title twice. */
  accessibilityLabel?: string;
}

export function SeasonTitleEmblem({ titleKey, size = 38, muted = false, accessibilityLabel }: SeasonTitleEmblemProps) {
  const color = muted ? '#8B99AE' : seasonTitleTint(titleKey);
  const outline = muted ? '#AAB5C5' : '#152A50';
  const gold = muted ? '#BAC3D0' : '#D5A647';
  return <View style={{ width: size, height: size, flexShrink: 0 }} accessible={!!accessibilityLabel}
    accessibilityRole="image" accessibilityLabel={accessibilityLabel}
    importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'} pointerEvents="none">
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false}>
      <Path d="M50 5L88 17Q93 19 92 27L89 56Q85 79 50 95Q15 79 11 56L8 27Q7 19 12 17Z" fill="#FFFFFF" stroke={outline} strokeWidth={2.8} />
      <Path d="M50 9L86 21Q88 22 88 28L85 55Q81 75 50 90Q19 75 15 55L12 28Q12 22 14 21Z" fill={color} fillOpacity={0.055} stroke={gold} strokeWidth={1.3} />
      <Polygon points="40,19 45,23 50,17 55,23 60,19 56,28 44,28" fill={gold} />
      <G transform="translate(25 32) scale(.78)"><TitleSymbol titleKey={titleKey} color={color} /></G>
    </Svg>
  </View>;
}
