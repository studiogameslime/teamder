import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { activityDistance, activityDuration, activityIsolate, activityNumber, activityStatusCopy,
  type MyActivityMetrics, type MyActivityStatus } from './MyActivityDashboard';

export interface MyActivityRoundCardProps {
  status: MyActivityStatus;
  metrics: MyActivityMetrics | null;
  sourceLabel: string | null;
  periodLabel?: string;
  durationLabel?: string;
  refreshing?: boolean;
  onPress?: () => void;
  onRefresh?: () => void;
}

/** Compact private summary. Never includes a game-clock denominator or coverage percentage. */
export function MyActivityRoundCard({ status, metrics, sourceLabel, periodLabel, durationLabel = 'משך ההקלטה',
  refreshing = false, onPress, onRefresh }: MyActivityRoundCardProps) {
  const showMetrics = metrics !== null && status !== 'loading' && status !== 'empty' && status !== 'disconnected';
  const rows = showMetrics ? [
    [durationLabel, activityDuration(metrics.recordingMs)],
    ['קילומטרים', activityDistance(metrics.distanceM)],
    ['צעדים', activityNumber(metrics.steps)],
    ['קלוריות', activityNumber(metrics.calories)],
    ['דופק ממוצע', activityNumber(metrics.avgHeartRateBpm)],
    ['דופק מרבי', activityNumber(metrics.maxHeartRateBpm)],
  ] : [];
  return <View style={s.card}>
    <View style={s.heading}>
      <View style={s.icon}><Ionicons name="watch-outline" size={23} color="#19765F" /></View>
      <View style={s.grow}><Text accessibilityRole="header" style={s.title}>הפעילות שלי במחזור</Text>
        <Text style={s.subtitle}>{activityIsolate(periodLabel ?? sourceLabel ?? 'המדידה האישית שלי')}</Text></View>
      {onPress ? <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="פתח את הפעילות האישית שלי" hitSlop={10} style={s.open}>
        <Ionicons name="chevron-back" size={20} color="#16374C" />
      </Pressable> : null}
    </View>
    {status === 'loading' ? <ActivityIndicator color="#19765F" accessibilityLabel="טוען מדידה אישית" /> : null}
    {status !== 'available' && status !== 'loading' ? <Text accessibilityRole={status === 'error' ? 'alert' : undefined} style={s.notice}>{activityStatusCopy[status]}</Text> : null}
    {showMetrics ? <View style={s.grid}>{rows.map(([label, metric], index) => <View key={label} style={s.metricCell}>
      <Text style={s.label}>{label}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[s.value, index > 2 && s.smallValue]}>{activityIsolate(metric)}</Text>
    </View>)}</View> : null}
    <View style={s.footer}><Ionicons name="lock-closed-outline" size={12} color="#6A7E8E" />
      <Text style={s.private}>{periodLabel && sourceLabel ? `${activityIsolate(sourceLabel)}. ` : ''}פרטי, לא נכלל בתמונת השיתוף</Text>
      {onRefresh ? <Pressable onPress={onRefresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="רענן מדידה אישית" accessibilityState={{ busy: refreshing, disabled: refreshing }} hitSlop={8}>
        {refreshing ? <ActivityIndicator size="small" color="#19765F" /> : <Ionicons name="refresh-outline" size={16} color="#19765F" />}
      </Pressable> : null}
    </View>
  </View>;
}

const s = StyleSheet.create({
  card: { padding: 17, gap: 14, borderWidth: 1, borderColor: '#DCEAE5', borderRadius: 21, backgroundColor: '#FFFFFF' },
  heading: { flexDirection: 'row', gap: 10, alignItems: 'center' }, grow: { flex: 1 },
  icon: { width: 41, height: 41, borderRadius: 14, backgroundColor: '#E0F4EB', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: '#10283F', textAlign: RTL_LABEL_ALIGN },
  subtitle: { marginTop: 4, color: '#6A7E8E', fontSize: 11, textAlign: RTL_LABEL_ALIGN }, open: { padding: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, justifyContent: 'space-between', paddingTop: 3 },
  metricCell: { width: '31%', gap: 5 }, label: { fontSize: 10, lineHeight: 15, color: '#6A7E8E', textAlign: RTL_LABEL_ALIGN },
  value: { fontSize: 23, fontWeight: '800', color: '#10283F', textAlign: RTL_LABEL_ALIGN }, smallValue: { fontSize: 18 },
  notice: { fontSize: 12, lineHeight: 20, color: '#607787', textAlign: RTL_LABEL_ALIGN },
  footer: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingTop: 11, borderTopWidth: 1, borderTopColor: '#EEF2F1' },
  private: { fontSize: 10, lineHeight: 16, color: '#6A7E8E', flex: 1, textAlign: RTL_LABEL_ALIGN },
});
