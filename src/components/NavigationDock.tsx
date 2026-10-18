import React, { createContext, useContext, useEffect, useState } from 'react';
import { I18nManager, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';

export const DockIndexContext = createContext({ index: 0, count: 4 });

export function DockHighlight() {
  const { index, count } = useContext(DockIndexContext);
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const ready = useSharedValue(false);
  useEffect(() => {
    if (!width || !count) return;
    const cell = width / count;
    const position = I18nManager.isRTL ? count - 1 - index : index;
    const target = position * cell + (cell - 42) / 2;
    x.value = reduced || !ready.value ? target : withTiming(target, {
      duration: 280, easing: Easing.inOut(Easing.cubic),
    });
    ready.value = true;
  }, [width, count, index, reduced, ready, x]);
  const motion = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return <View pointerEvents="none" style={styles.background} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
    {width > 0 ? <Animated.View style={[styles.highlight, motion]} /> : null}
  </View>;
}

export function DockIcon({ tab, color }: { tab: string; color: string }) {
  return <View style={styles.icon}><Svg width={27} height={27} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    {tab === 'ProfileTab' ? <Path d="M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3Z" /> : null}
    {tab === 'CommunitiesTab' ? <>
      <Path d="M8 4 3 6l-2 5 4 2 1-3v11h12V10l1 3 4-2-2-5-5-2M8 4c0 4 8 4 8 0" />
    </> : null}
    {tab === 'GameTab' ? <>
      <Rect x={2} y={4} width={20} height={16} rx={1.7} />
      <Path d="M12 4v16M2 8h3v8H2M22 8h-3v8h3" /><Circle cx={12} cy={12} r={3.2} />
    </> : null}
    {tab === 'ChatTab' ? <>
      <Circle cx={9} cy={7} r={3.2} /><Path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3.2 3.2 0 0 1 0 6M18 13a6 6 0 0 1 4 5v3" />
    </> : null}
  </Svg></View>;
}

const styles = StyleSheet.create({
  background: { ...StyleSheet.absoluteFillObject, direction: 'ltr' },
  highlight: { position: 'absolute', left: 0, top: 6, width: 42, height: 42, borderRadius: 11, backgroundColor: '#2463EB' },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
});
