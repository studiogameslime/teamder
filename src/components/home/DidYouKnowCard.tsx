import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

export interface Tip {
  title: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  onPress?: () => void;
}
const ROTATE_MS = 6000;

export function DidYouKnowCard({ tips }: { tips: Tip[] }) {
  const [idx, setIdx] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [incoming, setIncoming] = useState<{ index: number; direction: number } | null>(null);
  const focused = useIsFocused();
  const progress = useRef(new Animated.Value(0)).current;
  const moving = useRef(false);
  const selectRef = useRef<(next: number) => void>(() => {});
  const idxRef = useRef(idx);
  idxRef.current = idx;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!incoming) return;
    // Both text layers have rendered before the native animation begins.
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1, duration: reduceMotion ? 0 : 380,
      easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (finished) { setIdx(incoming.index); setIncoming(null); }
      moving.current = false;
    });
    return () => animation.stop();
  }, [incoming, progress, reduceMotion]);
  selectRef.current = (next) => {
    if (!tips.length || moving.current) return;
    const target = (next + tips.length) % tips.length;
    if (target === idxRef.current) return;
    if (reduceMotion) { setIdx(target); return; }
    moving.current = true;
    setIncoming({ index: target, direction: next > idxRef.current ? 1 : -1 });
  };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) > 35) selectRef.current(idxRef.current + (gesture.dx > 0 ? 1 : -1));
    },
  })).current;
  useEffect(() => {
    // Manual selection gets a full reading interval; no motion off-screen or with reduced motion.
    if (tips.length <= 1 || !focused || reduceMotion) return;
    const timer = setTimeout(() => selectRef.current(idxRef.current + 1), ROTATE_MS);
    return () => clearTimeout(timer);
  }, [idx, tips.length, focused, reduceMotion]);
  if (!tips.length) return null;
  const current = Math.min(idx, tips.length - 1);
  const tip = tips[current];
  const nextTip = incoming ? tips[incoming.index] : undefined;
  const renderContent = (item: Tip) => <>
    <View style={styles.iconDisc}><Ionicons name={item.icon} size={25} color="#FFFFFF" /></View>
    <View style={styles.textWrap}>
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.text}</Text>
    </View>
    {item.onPress ? <Ionicons name="chevron-back" size={21} color="#FFFFFF" /> : null}
  </>;
  return (
    <View>
      <View style={styles.heading}>
        <Ionicons name="bulb-outline" size={20} color="#294EC3" />
        <Text style={styles.headingText}>{he.homeDidYouKnowTitle}</Text>
      </View>
      <View style={styles.viewport} {...pan.panHandlers}>
        <Pressable onPress={() => { if (!moving.current) tip.onPress?.(); }} style={styles.card}
          accessibilityRole={tip.onPress ? 'button' : 'summary'}
          accessibilityLabel={`${tip.title}. ${tip.text}`}>
          <LinearGradient colors={['#15317B', '#294EC3']} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={styles.contentHost}>
            <Animated.View style={[styles.content, incoming && {
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
              transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 18 * incoming.direction] }) }],
            }]}>{renderContent(tip)}</Animated.View>
            {nextTip && incoming ? <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
              style={[styles.content, StyleSheet.absoluteFillObject, {
                opacity: progress,
                transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-18 * incoming.direction, 0] }) }],
              }]}>{renderContent(nextTip)}</Animated.View> : null}
          </View>
        </Pressable>
      </View>
      {tips.length > 1 ? <View style={styles.dots}>
        {tips.map((item, i) => <Pressable key={item.title} onPress={() => selectRef.current(i)}
          style={styles.dotTarget} accessibilityRole="button" accessibilityLabel={item.title}
          accessibilityState={{ selected: i === current }}>
          <View style={[styles.dot, i === current && styles.dotActive]} />
        </Pressable>)}
      </View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  headingText: { ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  viewport: { overflow: 'hidden' },
  card: { minHeight: 112, borderRadius: 18, overflow: 'hidden', justifyContent: 'center', padding: spacing.md },
  contentHost: { minHeight: 80, justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconDisc: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' },
  textWrap: { flex: 1, minWidth: 0, gap: 5 },
  title: { ...typography.body, fontWeight: '800', color: '#FFFFFF', textAlign: RTL_LABEL_ALIGN },
  body: { ...typography.caption, color: '#E4ECFF', textAlign: RTL_LABEL_ALIGN, lineHeight: 21 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 2 },
  dotTarget: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 4, backgroundColor: '#CCD2E0' },
  dotActive: { width: 21, backgroundColor: '#294EC3' },
});
