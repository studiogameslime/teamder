import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReducedMotion } from '@/hooks/animations/useReducedMotion';
import { RTL_LABEL_ALIGN } from '@/theme';

/** One announcement per region. No invented percentage or minimum wait. */
export function LoadingNotice({ label, compact = false, hidden = false }: { label: string; compact?: boolean; hidden?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, [label]);
  const message = slow ? 'זה לוקח קצת יותר זמן. הנתונים עדיין נטענים.' : label;
  return <View style={[s.notice, compact && s.compactNotice, hidden && s.accessibleNotice]} accessible accessibilityRole="progressbar"
    accessibilityLabel={message} accessibilityState={{ busy: true }} accessibilityLiveRegion="polite">
    <Ionicons name="football-outline" size={compact ? 14 : 17} color="#8298B8" accessible={false} />
    <Text style={s.noticeText}>{message}</Text>
  </View>;
}

/** One UI-thread pulse for all blocks in a region. Decorative blocks never receive focus. */
function SkeletonRegion({ label, children, style, gap = 12 }: { label: string; children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(opacity);
    opacity.value = 1;
    if (!reduced) opacity.value = withRepeat(withTiming(0.55, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <View style={[{ position: 'relative' }, style]} pointerEvents="none">
    <Animated.View style={[s.stack, { gap }, pulse]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </Animated.View>
    <LoadingNotice label={label} hidden />
  </View>;
}

function Block({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[s.block, style]} />;
}

export { SkeletonRegion, Block as SkeletonBlock };

export function HomeRoundSkeleton() {
  return <SkeletonRegion label="טוענים את המחזורים שלך" style={s.roundCard} gap={8}>
    <View style={s.roundTop}>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <View style={s.row}><Block style={{ flex: 1, height: 23 }} /><Block style={{ width: 28, height: 28, borderRadius: 9 }} /></View>
        <Block style={{ width: '78%', height: 19 }} />
        <Block style={{ width: '91%', height: 17 }} />
        <Block style={{ width: '84%', height: 17 }} />
        <Block style={{ height: 5, marginTop: 5 }} />
      </View>
      <Block style={s.roundPhoto} />
    </View>
    <Block style={{ height: 48, borderRadius: 14 }} />
    <Block style={{ height: 50, borderRadius: 14 }} />
  </SkeletonRegion>;
}

/** Body of the first personal-statistics card; its real card owns the frame. */
export function PersonalStatsSkeleton() {
  return <SkeletonRegion label="טוענים את הנתונים שלך" gap={0}>
    <View style={[s.row, { gap: 8 }]}><Block style={{ width: 23, height: 23 }} /><Block style={{ flex: 1, height: 23 }} /><Block style={{ width: 68, height: 25, borderRadius: 10 }} /></View>
    <View style={[s.row, { gap: 0, paddingVertical: 15 }]}>
      {[0, 1, 2].map(i => <View key={i} style={s.personalMetric}>
        <Block style={{ width: 30, height: 30, borderRadius: 15 }} />
        <Block style={{ width: 40, height: 35 }} />
        <Block style={{ width: 48, height: 15 }} />
      </View>)}
    </View>
    <View style={{ padding: 12, borderRadius: 15, backgroundColor: '#EFF7FF', gap: 7 }}><Block style={{ width: '75%', height: 20 }} /><Block style={{ width: '94%', height: 19 }} /></View>
    <View style={[s.row, { gap: 8, marginTop: 13 }]}><Block style={s.action} /><Block style={s.action} /></View>
  </SkeletonRegion>;
}

export function PlayersSkeleton() {
  return <SkeletonRegion label="טוענים את שחקני המועדון" style={{ marginTop: 8 }} gap={4}>
    <Block style={{ height: 46, borderRadius: 14 }} />
    <View style={s.row}>{[74, 84, 82].map((width, i) => <Block key={i} style={{ width, height: 32, borderRadius: 18 }} />)}</View>
    <View style={{ gap: 8, marginTop: 16 }}>
      {[0, 1, 2, 3, 4, 5].map(i => <View key={i} style={[s.playerRow, i > 0 && s.divider]}>
        <Block style={{ width: 48, height: 48, borderRadius: 24 }} />
        <View style={{ flex: 1, gap: 9 }}><Block style={{ width: i % 2 ? '65%' : '82%', height: 15 }} /><Block style={{ width: '42%', height: 11 }} /></View>
        <Block style={{ width: 36, height: 22 }} />
      </View>)}
    </View>
  </SkeletonRegion>;
}

export function ClubStatsSkeleton() {
  return <SkeletonRegion label="טוענים את נתוני המועדון">
    <View style={[s.row, { minHeight: 40 }]}><Block style={{ flex: 1, height: 23 }} /><Block style={{ width: 110, height: 32, borderRadius: 16 }} /></View>
    <View style={s.summary}>
      <View style={[s.row, { padding: 13, justifyContent: 'space-around' }]}><Block style={{ width: '34%', height: 20 }} /><Block style={{ width: '34%', height: 20 }} /></View>
      <View style={s.pitch}>
        {[0, 1].map(i => <View key={i} style={s.personalMetric}><Block style={{ width: 48, height: 40 }} /><Block style={{ width: 58, height: 16 }} /></View>)}
      </View>
    </View>
    <Block style={{ width: '42%', height: 23, marginTop: 4 }} />
    <View style={s.list}>
      {[0, 1, 2, 3].map(i => <View key={i} style={[s.awardRow, i > 0 && s.divider]}>
        <Block style={{ width: 36, height: 36, borderRadius: 18 }} /><Block style={{ width: 24, height: 24 }} />
        <View style={{ flex: 1, gap: 6 }}><Block style={{ width: '75%', height: 15 }} /><Block style={{ width: '92%', height: 17 }} /></View>
        <Block style={{ width: 30, height: 35 }} />
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
  accessibleNotice: { position: 'absolute', width: 1, height: 1, paddingTop: 0, paddingHorizontal: 0, minHeight: 0, overflow: 'hidden' },
  roundCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 12, overflow: 'hidden' },
  roundTop: { flexDirection: 'row', gap: 12, minHeight: 136, alignItems: 'stretch' },
  roundPhoto: { width: '34%', minWidth: 96, maxWidth: 140, height: 'auto', borderRadius: 16 },
  cover: { height: 114, borderRadius: 0, backgroundColor: '#E7EEF8' },
  roundBody: { paddingHorizontal: 16, gap: 14 },
  personalMetric: { flex: 1, alignItems: 'center', gap: 3 },
  action: { flex: 1, height: 46, borderRadius: 11 },
  list: { backgroundColor: '#FFFFFF', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#E7EEF7' },
  playerRow: { minHeight: 72, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  summary: { borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7EEF7', overflow: 'hidden' },
  pitch: { height: 118, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginHorizontal: 5, marginBottom: 4, backgroundColor: '#F1F8F5' },
  awardRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#ECF1F8' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: { width: '47%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, minHeight: 92, backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7EEF7' },
  tableHeader: { minHeight: 40, backgroundColor: '#F0F5FC' },
  tableRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 },
});
