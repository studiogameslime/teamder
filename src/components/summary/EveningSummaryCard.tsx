import React, { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Path, Rect, Line } from 'react-native-svg';
import { UserAvatar } from '@/components/UserAvatar';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { progressLines } from '@/utils/eveningProgress';
import { eveningCount } from '@/utils/eveningHighlights';
import type { EveningSummaryModel } from '@/services/eveningSummaryService';
import type { User } from '@/types';

const C = { ink: '#111C48', muted: '#69738B', blue: '#2469F4', green: '#178447',
  red: '#E14850', gold: '#A56B00', purple: '#7D29CF', line: '#E7EBF2' };
type IconName = React.ComponentProps<typeof Ionicons>['name'];
const metricNames = { goals: 'שערים', assists: 'בישולים', wins: 'ניצחונות' };
const metricSingular = { goals: 'שער', assists: 'בישול', wins: 'ניצחון' };
const movement = (n: number) => `${n > 0 ? 'עלית' : 'ירדת'} ${eveningCount(Math.abs(n), 'מקום', 'מקומות')}`;

function Boot({ color }: { color: string }) {
  return <Svg width={27} height={27} viewBox="0 0 32 32"><Path
    d="M24 5l-5 7-6 3-8 3c-3 1-3 6 1 7h22V13l-4-8zM11 16l3 3m2-5l3 3M5 25v3m7-3v3m7-3v3m7-3v3"
    stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" /></Svg>;
}
function Pitch() {
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}><Svg width="100%" height="100%" viewBox="0 0 360 185" preserveAspectRatio="none">
    <Rect x="17" y="17" width="326" height="151" rx="2" stroke="#FFFFFF" opacity={0.13} fill="none" />
    <Line x1="180" y1="17" x2="180" y2="168" stroke="#FFFFFF" opacity={0.08} />
    <Circle cx="180" cy="92" r="28" stroke="#FFFFFF" opacity={0.08} fill="none" />
    <Path d="M17 46h37v93H17m0-68h15v44H17M343 46h-37v93h37m0-68h-15v44h15" stroke="#FFFFFF" strokeWidth={1.5} opacity={0.18} fill="none" />
  </Svg></View>;
}
function Fact({ icon, title, detail, tone = 'blue' }: {
  icon: IconName; title: string; detail?: string; tone?: 'blue' | 'gold' | 'purple' | 'green' | 'red';
}) {
  const colors = { blue: [C.ink, '#EDF5FF', '#D9E8FC'], gold: [C.gold, '#FFF9E8', '#F5E7BF'],
    purple: [C.purple, '#F7F0FF', '#E9D9FA'], green: [C.green, '#EDF9F2', '#D8F0E2'], red: [C.red, '#FFF2F3', '#F8DBDF'] }[tone];
  return <View style={[s.fact, { backgroundColor: colors[1], borderColor: colors[2] }]}>
    <Ionicons name={icon} size={29} color={colors[0]} /><View style={s.flex}>
      <Text style={[s.factTitle, { color: colors[0] }]}>{title}</Text>
      {detail ? <Text style={s.factDetail}>{detail}</Text> : null}
    </View></View>;
}
interface Props {
  model: EveningSummaryModel;
  user?: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'> | null;
  onScoreInfo?: () => void;
  captureMode?: boolean;
}
export const EveningSummaryCard = forwardRef<View, Props>(function EveningSummaryCard({ model: m, user, onScoreInfo, captureMode = false }, ref) {
  const [expanded, setExpanded] = useState(false);
  const highlights = m.highlights ?? [];
  const records = m.personalRecords ?? [];
  const progress = progressLines(m.metrics, m.score, `${m.gameId}:${m.uid}`);
  const outcomes = m.outcomes?.length === m.rounds ? m.outcomes : undefined;
  const draws = outcomes?.filter((o) => o === 'draw').length ?? 0;
  const pen = m.penalties;
  const hasPen = !!pen && pen.scored + pen.saved + pen.missed + pen.conceded > 0;
  const stats: Array<{ value: number; label: string; color: string; icon?: IconName }> = [
    { value: m.rounds, label: 'משחקים', color: C.ink, icon: 'football-outline' },
    { value: m.wins, label: 'ניצחונות', color: C.green, icon: 'trophy-outline' },
    { value: m.goals, label: 'שערים', color: C.gold, icon: 'football-outline' },
    { value: m.assists, label: 'בישולים', color: C.purple },
  ];
  return <View ref={ref} collapsable={false} style={s.root}>
    <View style={s.identity}>
      <UserAvatar user={user ?? { id: m.uid, name: m.playerName }} size={62} />
      <View style={s.flex}><Text style={s.name}>{m.playerName}</Text>
        <Text style={s.identityMeta}>{m.communityName}</Text><Text style={s.date}>{m.dateLabel}</Text></View>
    </View>
    <LinearGradient colors={['#2877FF', '#1459DE']} style={s.hero}>
      <Pitch /><Text style={s.heroLabel}>ציון המחזור</Text><Text style={s.score}>{m.score.toFixed(1)}</Text>
      <Text style={s.heroRank}>{m.scoreRank != null && m.scoreTotal != null && m.scoreTotal > 1
        ? `מקום ${m.scoreRank} מתוך ${m.scoreTotal} שחקנים במחזור` : 'הביצועים שלך במחזור'}</Text>
      {onScoreInfo && !captureMode ? <Pressable onPress={onScoreInfo} accessibilityRole="button" accessibilityLabel="איך מחושב ציון המחזור?" hitSlop={10} style={s.info}>
        <Ionicons name="information-circle-outline" size={25} color="#FFFFFF" /></Pressable> : null}
    </LinearGradient>
    <View style={s.panel}><Text style={s.sectionTitle}>הערב שלך</Text><View style={s.stats}>
      {stats.map((stat, i) => <View key={stat.label} style={[s.stat, i < 3 && s.statBorder]}>
        <Text style={[s.statNumber, { color: stat.color }]}>{stat.value}</Text>
        {stat.icon ? <Ionicons name={stat.icon} size={26} color={stat.color} /> : <Boot color={stat.color} />}
        <Text style={[s.statLabel, { color: stat.color }]}>{stat.label}</Text></View>)}
    </View><Text style={s.participation}>{m.totalKnown ? `שיחקת ב־${m.rounds} מתוך ${m.totalRounds} משחקים` : `שיחקת ב־${m.rounds} משחקים`}</Text></View>
    <View style={s.panel}><Text style={s.sectionTitle}>תוצאות המשחקים שלך</Text>
      <Text style={s.balance}><Text style={{ color: C.green }}>{eveningCount(m.wins, 'ניצחון', 'ניצחונות')}</Text>{' · '}
        <Text style={{ color: C.red }}>{eveningCount(m.losses, 'הפסד', 'הפסדים')}</Text>{draws > 0 ? ` · ${draws} תיקו` : ''}</Text>
      <View style={s.resultRow}><View style={s.rate}>
        <Text style={s.rateNumber}>{m.wins + m.losses > 0 ? `${m.winRate}%` : '—'}</Text><Text style={s.rateLabel}>ניצחונות</Text>
      </View><View style={s.flex}>
        {outcomes ? <View style={s.outcomes}>{outcomes.map((o, i) => <View key={i} accessible
          accessibilityLabel={`משחק ${i + 1}: ${o === 'win' ? 'ניצחון' : o === 'loss' ? 'הפסד' : 'תיקו'}`}
          style={[s.outcome, { backgroundColor: o === 'win' ? '#DEF6E8' : o === 'loss' ? '#FFE3E6' : '#EEF0F5' }]}>
          <Text style={[s.outcomeText, { color: o === 'win' ? C.green : o === 'loss' ? C.red : C.muted }]}>{o === 'win' ? 'נ' : o === 'loss' ? 'ה' : 'ת'}</Text>
        </View>)}</View> : <View style={s.distribution} accessibilityLabel="חלוקת ניצחונות והפסדים, ללא סדר משחקים">
          {m.wins > 0 ? <View style={{ flex: m.wins, backgroundColor: '#71CCA0' }} /> : null}
          {m.losses > 0 ? <View style={{ flex: m.losses, backgroundColor: '#F4A9B0' }} /> : null}
        </View>}
        <Text style={s.resultNote}>{outcomes ? 'לפי סדר המשחקים ששיחקת' : 'מאזן המשחקים שהוכרעו'}</Text>
      </View></View>
      {draws > 0 ? <Text style={s.note}>אחוז הניצחונות מחושב מהמשחקים שהוכרעו, ללא תיקו.</Text> : null}
      {m.teamGoalsKnown ? <Text style={s.teamGoals}>הקבוצות שלך: {m.teamGoalsFor} שערי זכות · {m.teamGoalsAgainst} שערי חובה</Text> : null}
    </View>
    {highlights.length > 0 || records.length > 0 || hasPen ? <View style={s.section}>
      <Text style={s.sectionTitle}>רגעי הערב</Text>
      {(expanded || captureMode ? highlights : highlights.slice(0, 2)).map((h) => <Fact key={h.id} {...h} />)}
      {highlights.length > 2 && !captureMode ? <Pressable onPress={() => setExpanded(!expanded)} accessibilityRole="button" accessibilityLabel={expanded ? 'הצג פחות רגעי ערב' : 'הצג את כל רגעי הערב'}>
        <Text style={s.more}>{expanded ? 'הצג פחות' : `הצג עוד ${highlights.length - 2}`}</Text></Pressable> : null}
      {records.map((r) => <Fact key={r.metric} icon="medal-outline" tone="gold" title={r.kind === 'new' ? 'שיא אישי חדש' : 'השווית את השיא האישי'}
        detail={`${eveningCount(r.value, metricSingular[r.metric], metricNames[r.metric])} במחזור אחד\n${r.kind === 'new' ? 'השיא הקודם' : 'השיא'} שלך במועדון: ${r.previous}`} />)}
      {hasPen && pen ? <Fact icon="football-outline" title="הפנדלים שלך" tone="blue" detail={`${pen.scored} הבקעות · ${pen.saved} עצירות\n${pen.missed} החמצות · ${pen.conceded} ספיגות`} /> : null}
    </View> : null}
    {m.rank != null || progress.length > 0 ? <View style={s.panel}>
      <Text style={s.sectionTitle}>המיקום שלך במועדון</Text>
      {m.rank != null ? <View style={s.standing}><Ionicons name="trophy-outline" size={34} color={C.ink} /><View style={s.flex}>
        <Text style={s.standingRank}>מקום {m.rank}{m.rankTotal ? ` מתוך ${m.rankTotal}` : ''}</Text>
        <Text style={s.factDetail}>בטבלת העונה · נקודות משערים ובישולים</Text></View></View> : null}
      {m.rankDelta != null && m.rankDelta !== 0 ? <Fact icon={m.rankDelta > 0 ? 'trending-up-outline' : 'trending-down-outline'}
        tone={m.rankDelta > 0 ? 'green' : 'red'} title={`${movement(m.rankDelta)} בטבלה`} /> : null}
      {progress.map((p) => <Fact key={p.id} icon={p.tone === 'crown' ? 'ribbon-outline' : p.tone === 'bad' ? 'trending-down-outline' : 'trending-up-outline'}
        title={p.text} tone={p.tone === 'crown' ? 'gold' : p.tone === 'bad' ? 'red' : 'green'} />)}
      {m.metrics.map((metric) => <View key={metric.key} style={s.metricLine}>
        <Text style={s.metricTitle}>{metricNames[metric.key]} · מקום {metric.rank} · {metric.value} בעונה</Text>
        {metric.delta !== 0 && metric.tonight != null && metric.value - metric.tonight > 0 ? <Text style={[s.note, { color: metric.delta > 0 ? C.green : C.red }]}>
          {movement(metric.delta)}</Text> : null}
        {metric.aheadName && metric.aheadGap != null && metric.aheadGap > 0 ? <Text style={s.note}>
          עוד {eveningCount(metric.aheadGap, metricSingular[metric.key], metricNames[metric.key])} כדי להשתוות ל־{'\u2068'}{metric.aheadName}{'\u2069'}</Text> : null}
      </View>)}
    </View> : null}
  </View>;
});
const s = StyleSheet.create({
  root: { gap: 14, backgroundColor: '#F7F9FD', paddingBottom: 4 }, flex: { flex: 1 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 6, paddingVertical: 6 },
  name: { fontSize: 23, fontWeight: '800', color: C.ink, textAlign: RTL_LABEL_ALIGN },
  identityMeta: { fontSize: 14, color: C.muted, textAlign: RTL_LABEL_ALIGN, marginTop: 3 },
  date: { fontSize: 12, color: C.muted, textAlign: RTL_LABEL_ALIGN, marginTop: 2 },
  hero: { borderRadius: 23, paddingVertical: 20, paddingHorizontal: 24, alignItems: 'center', overflow: 'hidden' },
  heroLabel: { fontSize: 20, fontWeight: '700', color: '#FFFFFF', textAlign: 'center' },
  score: { fontSize: 72, lineHeight: 88, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  heroRank: { fontSize: 14, color: '#FFFFFF', textAlign: 'center' }, info: { position: 'absolute', bottom: 14, end: 14 },
  panel: { backgroundColor: '#FFFFFF', borderRadius: 21, padding: 16, gap: 10, shadowColor: '#102348', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  section: { gap: 9 }, sectionTitle: { fontSize: 19, fontWeight: '800', color: C.ink, textAlign: RTL_LABEL_ALIGN },
  stats: { flexDirection: 'row', paddingVertical: 6 }, stat: { flex: 1, alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  statBorder: { borderEndWidth: 1, borderColor: C.line }, statNumber: { fontSize: 31, fontWeight: '800' },
  statLabel: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  participation: { borderTopWidth: 1, borderColor: C.line, paddingTop: 11, fontSize: 13, color: C.muted, textAlign: 'center' },
  balance: { fontSize: 15, fontWeight: '700', color: C.muted, textAlign: RTL_LABEL_ALIGN },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 13 },
  rate: { minWidth: 68, alignItems: 'center', borderEndWidth: 1, borderColor: C.line, paddingEnd: 12 },
  rateNumber: { fontSize: 29, fontWeight: '800', color: C.green }, rateLabel: { fontSize: 11, color: C.ink },
  outcomes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  outcome: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, outcomeText: { fontSize: 12, fontWeight: '800' },
  distribution: { height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: '#EEF0F5', flexDirection: 'row' },
  resultNote: { fontSize: 10, color: C.muted, textAlign: RTL_LABEL_ALIGN, marginTop: 5 },
  note: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: RTL_LABEL_ALIGN },
  teamGoals: { borderTopWidth: 1, borderColor: C.line, paddingTop: 9, fontSize: 12, color: C.muted, textAlign: RTL_LABEL_ALIGN },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderWidth: 1, borderRadius: 16 },
  factTitle: { fontSize: 14, lineHeight: 21, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  factDetail: { fontSize: 12, lineHeight: 19, marginTop: 2, color: C.muted, textAlign: RTL_LABEL_ALIGN },
  more: { fontSize: 13, fontWeight: '700', color: C.blue, textAlign: 'center', padding: 7 },
  standing: { flexDirection: 'row', alignItems: 'center', gap: 12 }, standingRank: { fontSize: 19, fontWeight: '800', color: C.ink, textAlign: RTL_LABEL_ALIGN },
  metricLine: { borderTopWidth: 1, borderColor: C.line, paddingTop: 9, gap: 3 }, metricTitle: { fontSize: 13, fontWeight: '600', color: C.ink, textAlign: RTL_LABEL_ALIGN },
});
