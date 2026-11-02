import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { RTL_LABEL_ALIGN } from '@/theme';

/** One announcement per region. No invented percentage or minimum wait. */
export function LoadingNotice({ label, compact = false }: { label: string; compact?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [label]);
  const message = slow ? 'זה לוקח קצת יותר זמן. הנתונים עדיין נטענים.' : label;
  return <View style={[s.notice, compact && s.compactNotice]} accessible accessibilityRole="progressbar"
    accessibilityLabel={message} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <Ionicons name="football-outline" size={compact ? 14 : 17} color="#8298B8" accessible={false} />
    <Text style={s.noticeText}>{message}</Text>
  </View>;
}

/** One UI-thread pulse for all blocks in a region. Decorative blocks never receive focus. */
function SkeletonRegion({ label, children, style }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = 1;
    if (!reduced) opacity.value = withRepeat(withTiming(0.55, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <View style={style} pointerEvents="none">
    <Animated.View style={[s.stack, pulse]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
    <LoadingNotice label={label} />
  </View>;
}

function Block({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[s.block, style]} />;
}

export { SkeletonRegion, Block as SkeletonBlock };

export function HomeRoundSkeleton() {
  return <SkeletonRegion label="טוענים את המחזורים שלך" style={s.roundCard}>
    <Block style={s.cover} />
    <View style={s.roundBody}>
      <View style={s.row}><Block style={{ width: '58%', height: 21 }} /><Block style={s.pill} /></View>
      <Block style={{ width: '72%', height: 13 }} />
      <View style={s.row}><Block style={{ width: '36%' }} /><Block style={{ width: '29%' }} /></View>
      <Block style={{ height: 42, borderRadius: 12, marginTop: 4 }} />
    </View>
  </SkeletonRegion>;
}

/** Body of the first personal-statistics card; its real card owns the frame. */
export function PersonalStatsSkeleton() {
  return <SkeletonRegion label="טוענים את הנתונים שלך">
    <View style={s.row}><Block style={{ width: 24, height: 24, borderRadius: 12 }} /><Block style={{ flex: 1, height: 19 }} /><Block style={s.pill} /></View>
    <View style={s.row}>
      {[0, 1, 2].map(i => <View key={i} style={s.personalMetric}>
        <Block style={{ width: 28, height: 28, borderRadius: 14 }} />
        <Block style={{ width: 40, height: 28 }} />
        <Block style={{ width: 48, height: 11 }} />
      </View>)}
    </View>
    <Block style={{ height: 60, borderRadius: 14 }} />
    <View style={s.row}><Block style={s.action} /><Block style={s.action} /></View>
  </SkeletonRegion>;
}

export function PlayersSkeleton() {
  return <SkeletonRegion label="טוענים את שחקני המועדון" style={{ marginTop: 8 }}>
    <Block style={{ height: 46, borderRadius: 14 }} />
    <View style={s.row}>{[74, 84, 82].map((width, i) => <Block key={i} style={{ width, height: 32, borderRadius: 18 }} />)}</View>
    <View style={s.list}>
      {[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={[s.playerRow, i > 0 && s.divider]}>
        <Block style={{ width: 42, height: 42, borderRadius: 21 }} />
        <View style={{ flex: 1, gap: 9 }}><Block style={{ width: i % 2 ? '65%' : '82%', height: 15 }} /><Block style={{ width: '42%', height: 11 }} /></View>
        <Block style={{ width: 36, height: 22 }} />
      </View>)}
    </View>
  </SkeletonRegion>;
}

export function ClubStatsSkeleton() {
  return <SkeletonRegion label="טוענים את נתוני המועדון">
    <View style={s.row}><Block style={{ width: '52%', height: 22 }} /><Block style={s.pill} /></View>
    <View style={s.metrics}>
      {[0, 1, 2, 3].map(i => <View key={i} style={s.metricCard}>
        <Block style={{ width: 26, height: 26, borderRadius: 13 }} />
        <View style={{ flex: 1, gap: 9 }}><Block style={{ width: '70%', height: 24 }} /><Block style={{ width: '88%', height: 12 }} /></View>
      </View>)}
    </View>
    <Block style={{ width: '42%', height: 20, marginTop: 8 }} />
    <View style={s.list}>
      <View style={[s.tableRow, s.tableHeader]}><Block style={{ flex: 1, height: 12 }} />{[0, 1, 2].map(i => <Block key={i} style={{ width: 34, height: 12 }} />)}</View>
      {[0, 1, 2, 3].map(i => <View key={i} style={[s.tableRow, s.divider]}>
        <Block style={{ width: 28, height: 28, borderRadius: 14 }} /><Block style={{ flex: 1, height: 14 }} />
        {[0, 1, 2].map(j => <Block key={j} style={{ width: 28, height: 18 }} />)}
      </View>)}
    </View>
  </SkeletonRegion>;
}

const s = StyleSheet.create({
  stack: { gap: 12 },
  block: { height: 14, borderRadius: 6, backgroundColor: '#DFE8F4' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  pill: { width: 64, height: 24, borderRadius: 12 },
  notice: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingTop: 10, paddingHorizontal: 8 },
  compactNotice: { minHeight: 24, paddingTop: 0 },
  noticeText: { flexShrink: 1, fontSize: 12, lineHeight: 18, color: '#7185A2', textAlign: RTL_LABEL_ALIGN },
  roundCard: { backgroundColor: '#FFFFFF', borderRadius: 21, borderWidth: 1, borderColor: '#E4ECF9', overflow: 'hidden', paddingBottom: 10 },
  cover: { height: 114, borderRadius: 0, backgroundColor: '#E7EEF8' },
  roundBody: { paddingHorizontal: 16, gap: 14 },
  personalMetric: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 5 },
  action: { flex: 1, height: 40, borderRadius: 11 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E7EEF7' },
  playerRow: { minHeight: 74, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECF1F8' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 92, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7EEF7' },
  tableHeader: { minHeight: 40, backgroundColor: '#F0F5FC' },
  tableRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
});
