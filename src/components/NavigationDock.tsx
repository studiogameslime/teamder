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
    {tab === 'ProfileTab' ? <Path d="M3 10 12 3l9 7v10h-6v-6H9v6H3Z" /> : null}
    {tab === 'CommunitiesTab' ? <>
      <Path d="M12 2 21 6v6c0 5-5 9-9 10-4-1-9-5-9-10V6Z" />
      <Circle cx={12} cy={9} r={2} /><Path d="M8 16v-1a4 4 0 0 1 8 0v1M6.5 10.5a1.5 1.5 0 0 0 0 3M17.5 10.5a1.5 1.5 0 0 1 0 3" />
    </> : null}
    {tab === 'GameTab' ? <>
      <Rect x={3} y={4} width={18} height={18} rx={2} /><Path d="M7 2v4M17 2v4M3 9h18" />
      <Circle cx={12} cy={15.5} r={4} /><Path d="m12 13-2.2 1.6.8 2.5h2.8l.8-2.5ZM12 11.5V13M8.2 14.3l1.6.3M9.7 18.8l.9-1.7M14.3 18.8l-.9-1.7M15.8 14.3l-1.6.3" />
    </> : null}
    {tab === 'ChatTab' ? <>
      <Path d="M10 15H7l-4 3v-5a6 6 0 0 1-1-3 7 7 0 0 1 13-3" />
      <Path d="M22 14a6 6 0 0 1-1 3v4l-4-2h-2a6 6 0 1 1 7-5Z" />
    </> : null}
  </Svg></View>;
}

const styles = StyleSheet.create({
  background: { ...StyleSheet.absoluteFillObject, direction: 'ltr' },
  highlight: { position: 'absolute', left: 0, top: 6, width: 42, height: 42, borderRadius: 11, backgroundColor: '#2463EB' },
  icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
});
