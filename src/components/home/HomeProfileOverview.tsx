import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatisticsIllustration } from '@/components/stats/StatisticsIllustration';
import { homeProfileInsight } from '@/utils/homePersonalStats';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { PlayerStatsSummary } from '@/services/playerStatsService';

/** The first carousel page owns its two actions; no enclosing statistics press target. */
export function HomeProfileOverview({ stats, onStatistics, onProfile, playerId }: {
  stats: PlayerStatsSummary;
  onStatistics: () => void;
  onProfile: () => void;
  playerId?: string;
}) {
  const insight = homeProfileInsight(stats, playerId ? { playerId } : undefined);
  const icon = { streak: 'flame', attendance: 'checkmark-circle', community: 'people', welcome: 'sparkles',
    form: 'trending-up', impact: 'football', playstyle: 'sparkles', connection: 'git-network', results: 'trophy', journey: 'flag' } as const;
  const progress = insight.progress;
  return <View>
    <View style={s.header}>
      <Ionicons name="id-card-outline" size={23} color="#2467F4" accessible={false}/>
      <Text style={s.heading}>הכדורגל שלי</Text>
      <View style={s.scope}><Text style={s.scopeText}>כל הזמנים</Text></View>
    </View>
    <View style={s.numbers}>
      {[
        { value: stats.attendedGames, label: 'מחזורים', art: 'trophy' },
        { value: stats.goals, label: 'שערים', art: 'ball' },
        { value: stats.assists, label: 'בישולים', art: 'boot' },
      ].map((metric, index) => <View key={metric.label} style={[s.metric, index > 0 && s.metricDivider]}>
        <StatisticsIllustration kind={metric.art as 'trophy' | 'ball' | 'boot'} size={30}/>
        <Text style={s.value}>{metric.value}</Text><Text style={s.label}>{metric.label}</Text>
      </View>)}
    </View>
    <View style={s.insight}>
      <View style={s.insightHeading}>
        <Ionicons name={icon[insight.kind]} size={22} color={insight.kind === 'streak' ? '#E99821' : '#2467F4'} accessible={false}/>
        <Text style={s.insightTitle}>{insight.title}</Text>
      </View>
      <Text style={s.detail}>{insight.detail}</Text>
      {progress ? <View style={s.track} accessibilityRole="progressbar" accessibilityLabel="התקדמות לשיא ההגעה"
        accessibilityValue={{ min: 0, max: progress.target, now: progress.current }}>
        <View style={[s.fill, { width: `${Math.min(100, progress.current / progress.target * 100)}%` }]}/>
      </View> : null}
    </View>
    <View style={s.actions}>
      <Pressable accessibilityRole="button" accessibilityLabel="הסטטיסטיקה שלי" onPress={onStatistics}
        style={({ pressed }) => [s.action, s.primary, pressed && s.pressed]}>
        <Text style={s.actionText}>הסטטיסטיקה שלי</Text><Ionicons name="stats-chart" size={18} color="#2467F4" accessible={false}/>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="כרטיס השחקן שלי" onPress={onProfile}
        style={({ pressed }) => [s.action, s.secondary, pressed && s.pressed]}>
        <Text style={s.actionText}>כרטיס השחקן שלי</Text><Ionicons name="id-card-outline" size={18} color="#2467F4" accessible={false}/>
      </Pressable>
    </View>
  </View>;
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { flex: 1, flexShrink: 1, fontSize: 19, fontWeight: '800', color: '#15244F', textAlign: RTL_LABEL_ALIGN },
  scope: { backgroundColor: '#F0F6FF', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  scopeText: { fontSize: 11, fontWeight: '600', color: '#637695' },
  numbers: { flexDirection: 'row', paddingVertical: 15 },
  metric: { flex: 1, alignItems: 'center', gap: 3 },
  metricDivider: { borderStartWidth: 1, borderStartColor: '#E5ECF8' },
  value: { fontSize: 29, fontWeight: '800', color: '#2467F4' },
  label: { fontSize: 12, color: '#637695' },
  insight: { padding: 12, backgroundColor: '#EFF7FF', borderRadius: 15 },
  insightHeading: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  insightTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#15244F', textAlign: RTL_LABEL_ALIGN },
  detail: { fontSize: 12, lineHeight: 19, color: '#637695', textAlign: RTL_LABEL_ALIGN, marginTop: 4 },
  track: { flexDirection: 'row', height: 5, borderRadius: 4, backgroundColor: '#D6E5F7', overflow: 'hidden', marginTop: 10 },
  fill: { height: 5, borderRadius: 4, backgroundColor: '#2467F4' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 13 },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 46, paddingVertical: 9, paddingHorizontal: 7, borderRadius: 11 },
  primary: { backgroundColor: '#E6EFFF', borderWidth: 1, borderColor: '#E6EFFF' },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#C7D9FD' },
  actionText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: '#2467F4', textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
