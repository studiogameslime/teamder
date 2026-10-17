import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useAmbientMotion } from '@/hooks/animations/useAmbientMotion';
import type { ChemistryKind } from '@/utils/clubChemistry';

type PairIconKind = Extract<ChemistryKind, 'winningDuo' | 'regulars' | 'bestRatio' | 'wall' | 'mostLosses'>;
const TEAL = '#2463F5';

/** Small category glyphs: actual vector geometry, no raster sketch assets. */
export function FootballStatGlyph({ kind, size = 32, color = TEAL }: { kind: PairIconKind | 'assist' | 'scoreless' | 'penalty'; size?: number; color?: string }) {
  return <Svg width={size} height={size} viewBox="0 0 32 32" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {kind === 'winningDuo' ? <>
      <Path d="M9 5H23V12C23 18 20 21 16 21C12 21 9 18 9 12Z" fill={color} stroke="none" />
      <Path d="M9 7H4V10C4 15 7 17 11 17M23 7H28V10C28 15 25 17 21 17" />
      <Path d="M16 20V26M11 28H21" strokeWidth={3} />
    </> : null}
    {kind === 'regulars' ? <><Rect x={3} y={6} width={26} height={20} rx={2} /><Line x1={16} y1={6} x2={16} y2={26} /><Circle cx={16} cy={16} r={4} /></> : null}
    {kind === 'bestRatio' ? <><Circle cx={16} cy={16} r={11} /><Circle cx={16} cy={16} r={6} /><Circle cx={16} cy={16} r={2} fill={color} stroke="none" /></> : null}
    {kind === 'wall' ? <><Path d="M4 27V7H28V27" strokeWidth={2.2} /><Path d="M10 8V27M16 8V27M22 8V27M5 14H27M5 21H27" strokeWidth={1.1} /></> : null}
    {kind === 'mostLosses' ? <><Rect x={5} y={5} width={22} height={22} rx={3} /><Path d="M11 11L21 21M21 11L11 21" strokeWidth={2} /></> : null}
    {kind === 'assist' ? <>
      <Path d="M3 10L7 6Q7 11 12 10L16 19Q17 22 14 22L3 15Q1 14 3 10ZM3 17L2 19M7 20L6 22M11 22L10 24M10 13L13 12M11 16L14 15" />
      <Path d="M17 13Q20 9 23 10" strokeDasharray="3 3" />
      <Circle cx={26} cy={18} r={5} /><Path d="M26 15.5L28.4 17.2L27.5 20H24.5L23.6 17.2Z" fill={color} stroke="none" />
      <Path d="M26 15.5V13M28.4 17.2L30.5 16M27.5 20L29 22M24.5 20L23 22M23.6 17.2L21.5 16" strokeWidth={1.1} />
    </> : null}
    {kind === 'scoreless' ? <>
      <Rect x={3} y={7} width={26} height={19} rx={4} /><Path d="M9 7V5M23 7V5M9 26V28M23 26V28" />
      <Rect x={8} y={12} width={5} height={9} rx={2.5} /><Rect x={19} y={12} width={5} height={9} rx={2.5} />
      <Circle cx={16} cy={14} r={1} fill={color} stroke="none" /><Circle cx={16} cy={19} r={1} fill={color} stroke="none" />
    </> : null}
    {kind === 'penalty' ? <>
      <Path d="M3 23V5H27V19M6 21V8H24V18" /><Path d="M12 8V17M18 8V17M7 13H23" strokeWidth={1} />
      <Circle cx={14} cy={23} r={6} /><Path d="M14 20L16.8 22L15.7 25.2H12.3L11.2 22Z" fill={color} stroke="none" />
      <Path d="M14 20V17M16.8 22L19.5 21M15.7 25.2L17.5 28M12.3 25.2L10.5 28M11.2 22L8.5 21" strokeWidth={1} />
      <Path d="M23 25L26 28L31 22" strokeWidth={2.2} />
    </> : null}
  </Svg>;
}

/** A finite, gentle emphasis. Losses remain still. Never a touch target. */
export function PairChemistryIcon({ kind, active = true, delay = 400 }: { kind: PairIconKind; active?: boolean; delay?: number }) {
  const allowed = useAmbientMotion();
  const progress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 1;
    if (active && allowed && kind !== 'mostLosses') {
      progress.value = 0;
      progress.value = withDelay(delay, withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.cubic) }));
    }
    return () => cancelAnimation(progress);
  }, [active, allowed, delay, kind, progress]);
  const motion = useAnimatedStyle(() => {
    const envelope = Math.sin(progress.value * Math.PI);
    return { transform: [{ scale: 1 + envelope * 0.06 }, { translateY: kind === 'winningDuo' ? -envelope : 0 }] };
  });
  return <Animated.View accessible={false} pointerEvents="none" style={[styles.badge, motion]}>
    <FootballStatGlyph kind={kind} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  badge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
