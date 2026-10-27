import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import type { ActivityMovement } from '@/utils/activityMovement';

export type MyActivityStatus = 'loading' | 'empty' | 'processing' | 'available' | 'error' | 'disconnected';

/** Independent recording metrics. Missing measurements must remain null. */
export interface MyActivityMetrics {
  movement?: ActivityMovement;
  recordingMs: number | null;
  distanceM: number | null;
  steps: number | null;
  calories: number | null;
  caloriesKind?: 'active' | 'total';
  totalCalories?: number | null;
  avgHeartRateBpm: number | null;
  maxHeartRateBpm: number | null;
}

export interface MyActivityDashboardProps {
  status: MyActivityStatus;
  scope: 'recording' | 'day';
  periodLabel: string;
  sourceLabel: string | null;
  metrics: MyActivityMetrics | null;
  isRecording?: boolean;
  refreshing?: boolean;
  lastUpdatedLabel?: string | null;
  onRefresh?: () => void;
  onConnect?: () => void;
  onOpenRecordings?: () => void;
}

const C = { ink: '#10283F', muted: '#677B8D', mint: '#9DE8CF', green: '#17775F', line: '#E3EBEF' };
const valid = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export const activityNumber = (n: number | null | undefined): string => valid(n) ? Math.round(n).toLocaleString('he-IL') : 'לא נמדד';
export const activityDistance = (n: number | null | undefined): string => valid(n) ? (n / 1000).toFixed(2) : 'לא נמדד';
const speedCopy = (n: number | null | undefined): string => valid(n) ? n.toFixed(1) : 'לא נמדד';
function movementCopy(ms: number | null | undefined, total: number | null | undefined): string {
  return valid(ms) && valid(total) && total > 0 ? `${Math.round(ms / total * 100)}%` : 'לא נמדד';
}
export function activityDuration(ms: number | null | undefined): string {
  if (!valid(ms)) return 'לא נמדד';
  const seconds = Math.floor(ms / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
export const activityIsolate = (text: string): string => `\u2068${text}\u2069`;

export const activityStatusCopy: Record<Exclude<MyActivityStatus, 'available' | 'loading'>, string> = {
  empty: 'עדיין אין פעילות לתקופה הזו במקור שבחרת. הנתונים יופיעו לאחר מדידה וסנכרון.',
  processing: 'המדידה נשמרה וממתינה לסנכרון. הנתונים יופיעו כשההעברה תושלם.',
  error: 'הפעילות לא נטענה כרגע. אפשר לרענן ולנסות שוב.',
  disconnected: 'חבר מקור פעילות כדי לראות כאן את המדידות שלך.',
};

function PitchDecoration() {
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" viewBox="0 0 360 220" preserveAspectRatio="none">
      <Rect x="175" y="-20" width="220" height="260" rx="8" fill="none" stroke="#B2EEDC" opacity={0.1} />
      <Line x1="282" y1="-10" x2="282" y2="230" stroke="#B2EEDC" opacity={0.08} />
      <Circle cx="282" cy="110" r="42" fill="none" stroke="#B2EEDC" opacity={0.1} />
      <Path d="M175 65h37v90h-37M395 65h-37v90h37" fill="none" stroke="#B2EEDC" opacity={0.1} />
    </Svg>
  </View>;
}

function SmallMetric({ icon, title, metric, unit, mint = false }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; title: string; metric: string; unit: string; mint?: boolean;
}) {
  return <View style={[s.metricTile, mint && s.mintTile]}>
    <View style={s.tileHeading}><View style={[s.tileIcon, mint && s.mintIcon]}><Ionicons name={icon} size={21} color={mint ? C.green : C.ink} /></View>
      <Text style={s.metricLabel}>{title}</Text></View>
    <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[s.metricValue, metric === 'לא נמדד' && { fontSize: 18, color: C.muted }]}>{activityIsolate(metric)}</Text>
    <Text style={s.unit}>{unit}</Text>
  </View>;
}

/** Presentation only: values, source, period and actions are supplied by the screen. */
export function MyActivityDashboard({ status, scope, periodLabel, sourceLabel, metrics, isRecording = false,
  refreshing = false, lastUpdatedLabel, onRefresh, onConnect, onOpenRecordings }: MyActivityDashboardProps) {
  const durationLabel = scope === 'day' ? 'זמן ההקלטות ביום הנבחר' : 'משך ההקלטה';
  const showMetrics = metrics !== null && status !== 'loading' && status !== 'empty' && status !== 'disconnected';
  return <View style={s.root}>
    {scope !== 'day' ? <View style={s.heading}>
      <View style={s.grow}><View style={s.eyebrow}><Ionicons name="lock-closed-outline" size={13} color={C.green} /><Text style={s.private}>הנתונים שלך, רק שלך</Text></View>
        <Text accessibilityRole="header" style={s.title}>הפעילות שלי</Text>
        <Text style={s.period}>{activityIsolate(periodLabel)}</Text></View>
      {onRefresh ? <Pressable onPress={onRefresh} disabled={refreshing} accessibilityRole="button" accessibilityLabel="רענן את הפעילות שלי"
        accessibilityState={{ busy: refreshing, disabled: refreshing }} style={s.refresh}>
        {refreshing ? <ActivityIndicator size="small" color={C.ink} /> : <Ionicons name="refresh-outline" size={22} color={C.ink} />}
      </Pressable> : null}
    </View> : onRefresh ? <Pressable accessibilityRole="button" accessibilityLabel="רענן את הפעילות שלי" disabled={refreshing} onPress={onRefresh} style={s.dailyRefresh}><Text style={s.private}>{refreshing ? 'מעדכן...' : 'רענון הפעילות'}</Text><Ionicons name="refresh-outline" size={18} color={C.green} /></Pressable> : null}

    <LinearGradient colors={['#183B50', '#0C253B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
      <PitchDecoration />
      <View style={s.heroHeader}><View style={s.sourcePill}><Ionicons name={scope === 'day' ? 'sync-outline' : 'watch-outline'} size={15} color={C.mint} />
        <Text style={s.sourceText}>{activityIsolate(sourceLabel ?? 'מקור המדידה לא זמין')}</Text></View>
        {isRecording ? <View accessibilityLabel="מדידה פעילה" style={s.recording}><View style={s.dot} /><Text style={s.recordingText}>מקליט</Text></View> : null}
      </View>
      <View style={s.heroMain}>
        <View style={s.heroNumbers}><Text style={s.heroLabel}>{scope === 'day' ? valid(metrics?.distanceM) ? 'המרחק שלך' : 'הצעדים שלך' : durationLabel}</Text>
          {status === 'loading' ? <ActivityIndicator color={C.mint} accessibilityLabel="טוען את משך ההקלטה" /> :
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55} style={[s.duration, !showMetrics && s.missingDuration]}>
              {activityIsolate(showMetrics ? scope === 'day' ? valid(metrics.distanceM) ? activityDistance(metrics.distanceM) : valid(metrics.steps) ? activityNumber(metrics.steps) : 'אין נתונים' : activityDuration(metrics.recordingMs) : 'ממתינים לפעילות')}
            </Text>}
          <Text style={s.heroNote}>{scope === 'day' ? valid(metrics?.distanceM) ? 'קילומטרים ביום הנבחר' : valid(metrics?.steps) ? 'צעדים ביום הנבחר' : 'הנתונים יופיעו לאחר הסנכרון' : 'מההתחלה ועד העצירה שלך'}</Text>
        </View>
        <View accessible={false} style={s.emblem}>
          <Svg width={80} height={80} viewBox="0 0 80 80" style={StyleSheet.absoluteFill}>
            <Circle cx="40" cy="40" r="36" fill="none" stroke="#9DE8CF" strokeWidth="2" opacity={0.65} />
            <Circle cx="40" cy="40" r="29" fill="none" stroke="#9DE8CF" strokeWidth="1" opacity={0.16} />
          </Svg><Ionicons name="football-outline" size={35} color={C.mint} />
        </View>
      </View>
    </LinearGradient>

    {status !== 'available' && status !== 'loading' ? <View accessibilityRole={status === 'error' ? 'alert' : undefined} style={s.notice}>
      <Ionicons name={status === 'processing' ? 'sync-outline' : status === 'error' ? 'alert-circle-outline' : 'watch-outline'} size={21} color={C.green} />
      <Text style={s.noticeText}>{activityStatusCopy[status]}</Text>
    </View> : null}

    {showMetrics ? <>
      {scope !== 'day' ? <View style={s.tileRow}>
        <SmallMetric icon="navigate-outline" title="מרחק" metric={activityDistance(metrics.distanceM)} unit="קילומטרים" mint />
        <SmallMetric icon="footsteps-outline" title="צעדים" metric={activityNumber(metrics.steps)} unit="בהקלטה שנמדדה" />
      </View> : <View style={s.tileRow}>
        <SmallMetric icon="footsteps-outline" title="צעדים" metric={activityNumber(metrics.steps)} unit="ביום הנבחר" />
        <SmallMetric icon="speedometer-outline" title="מהירות מרבית" metric={speedCopy(metrics.movement?.maxSpeedKmh)} unit="קילומטרים לשעה" mint />
      </View>}
      {scope !== 'day' ? <View style={s.tileRow}>
        <SmallMetric icon="speedometer-outline" title="מהירות מרבית" metric={speedCopy(metrics.movement?.maxSpeedKmh)} unit="קילומטרים לשעה" mint />
        <SmallMetric icon="trending-up-outline" title="מהירות ממוצעת" metric={speedCopy(metrics.movement?.avgSpeedKmh)} unit="ממוצע דגימות, קילומטרים לשעה" />
      </View> : <View style={s.tileRow}>
        <SmallMetric icon="trending-up-outline" title="מהירות ממוצעת" metric={speedCopy(metrics.movement?.avgSpeedKmh)} unit="קילומטרים לשעה" />
        <SmallMetric icon="flash-outline" title="ספרינטים" metric={activityNumber(metrics.movement?.sprints)} unit="לפי דגימות מהירות" />
      </View>}
      {scope !== 'day' ? <View style={s.tileRow}>
        <SmallMetric icon="flash-outline" title="ספרינטים" metric={activityNumber(metrics.movement?.sprints)} unit="רצפים שנצפו במשך שתי שניות לפחות" />
        <SmallMetric icon="timer-outline" title="זמן בספרינט" metric={activityDuration(metrics.movement?.sprintMs)} unit="כלול בזמן הריצה" />
      </View> : null}
      {valid(metrics.movement?.sampledMs) && metrics.movement.sampledMs > 0 ? <View style={s.heartCard}>
        <View style={s.heartHeading}><Ionicons name="walk-outline" size={22} color={C.green} /><Text style={s.sectionTitle}>התנועה שלך</Text></View>
        {([
          ['עמידה או כמעט ללא תנועה', metrics.movement?.stationaryMs],
          ['הליכה', metrics.movement?.walkingMs],
          ['ריצה, כולל ספרינטים', metrics.movement?.runningMs],
        ] as const).map(([label, ms]) => <View key={label} style={s.heartRow}>
          <View style={s.grow}><Text style={s.metricLabel}>{label}</Text><Text style={s.unit}>{activityIsolate(activityDuration(ms))}</Text></View>
          <Text style={s.heartValue}>{activityIsolate(movementCopy(ms, metrics.movement?.sampledMs))}</Text>
        </View>)}
        <Text style={s.heartNote}>מתוך {activityIsolate(activityDuration(metrics.movement?.sampledMs))} שנמדדו. פערים בנתונים אינם מנוחה.</Text>
        <Pressable accessibilityRole="button" onPress={() => Alert.alert('איך מחשבים תנועה?', 'הערכה לפי דגימות מהירות סמוכות: עמידה מתחת לקילומטר לשעה, הליכה עד שבעה, ריצה משבעה וספרינט מתשעה עשר. ספרינט נספר מרצף של שתי שניות לפחות. האחוזים מחושבים רק מהזמן שניתן להעריך. מהירות ממוצעת היא ממוצע הדגימות, ולא מרחק חלקי זמן.')}><Text style={s.private}>איך זה מחושב?</Text></Pressable>
      </View> : <Text style={s.heartNote}>לחלוקת הליכה וריצה נדרשות דגימות מהירות רציפות יותר מהמקור המחובר.</Text>}

    </> : null}

    {status === 'disconnected' && onConnect ? <Pressable onPress={onConnect} accessibilityRole="button" style={s.connect}>
      <Text style={s.connectText}>בחירת אפליקציה לסנכרון</Text><Ionicons name="watch-outline" size={21} color={C.ink} />
    </Pressable> : null}
    {onOpenRecordings ? <Pressable onPress={onOpenRecordings} accessibilityRole="button" style={s.history}>
      <Ionicons name="time-outline" size={20} color={C.ink} /><Text style={s.historyText}>ההקלטות שלי</Text><Ionicons name="chevron-back" size={18} color={C.ink} />
    </Pressable> : null}
    {lastUpdatedLabel ? <Text style={s.updated}>{activityIsolate(lastUpdatedLabel)}</Text> : null}
    <View style={s.privacyNote}><Ionicons name="shield-checkmark-outline" size={17} color={C.green} />
      <Text style={s.privacyText}>הפעילות שלך פרטית וגלויה רק לך.</Text></View>
  </View>;
}

const s = StyleSheet.create({
  dailyRefresh: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-end', padding: 6 },
  root: { gap: 14 }, grow: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6 },
  private: { fontSize: 12, fontWeight: '600', color: C.green, textAlign: RTL_LABEL_ALIGN },
  title: { fontSize: 31, fontWeight: '800', color: C.ink, textAlign: RTL_LABEL_ALIGN },
  period: { marginTop: 5, fontSize: 14, color: C.muted, textAlign: RTL_LABEL_ALIGN },
  refresh: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line },
  hero: { borderRadius: 25, padding: 21, overflow: 'hidden', gap: 24 },
  heroHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sourcePill: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  sourceText: { fontSize: 12, color: '#D4EAE8', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  recording: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.mint }, recordingText: { fontSize: 11, color: C.mint },
  heroMain: { flexDirection: 'row', alignItems: 'center', gap: 12 }, heroNumbers: { flex: 1, gap: 5 },
  heroLabel: { fontSize: 14, color: '#C1D8DD', textAlign: RTL_LABEL_ALIGN },
  duration: { fontSize: 49, fontWeight: '800', color: '#FFFFFF', textAlign: RTL_LABEL_ALIGN, fontVariant: ['tabular-nums'] },
  missingDuration: { fontSize: 29 }, heroNote: { fontSize: 11, color: '#BDD5D9', lineHeight: 17, textAlign: RTL_LABEL_ALIGN },
  emblem: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, padding: 15, backgroundColor: '#E9F5F0' },
  noticeText: { flex: 1, color: '#3D655B', fontSize: 13, lineHeight: 21, textAlign: RTL_LABEL_ALIGN },
  tileRow: { flexDirection: 'row', gap: 12 }, metricTile: { flex: 1, padding: 15, minHeight: 125, borderRadius: 21, borderWidth: 1, borderColor: C.line, backgroundColor: '#FFFFFF' },
  mintTile: { borderColor: '#D4EDE4', backgroundColor: '#E4F6EF' }, tileHeading: { gap: 11 },
  tileIcon: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#EEF2F7', alignItems: 'center', justifyContent: 'center' }, mintIcon: { backgroundColor: '#CBEBDD' },
  metricLabel: { fontSize: 12, color: C.muted, textAlign: RTL_LABEL_ALIGN }, metricValue: { fontSize: 30, fontWeight: '800', color: C.ink, marginTop: 8, textAlign: RTL_LABEL_ALIGN },
  unit: { color: C.muted, fontSize: 11, lineHeight: 17, textAlign: RTL_LABEL_ALIGN },
  energy: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 17, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.line },
  energyIcon: { width: 44, height: 44, backgroundColor: '#FFF0E5', borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  energyTitle: { fontSize: 15, color: C.ink, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, energyValue: { fontSize: 23, color: C.ink, fontWeight: '800', flexShrink: 1, textAlign: RTL_LABEL_ALIGN },
  heartCard: { padding: 18, borderWidth: 1, borderColor: C.line, borderRadius: 21, backgroundColor: '#FFFFFF', gap: 16 },
  heartHeading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, sectionTitle: { fontSize: 17, color: C.ink, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  heartRow: { flexDirection: 'row', alignItems: 'center', gap: 16 }, heartMetric: { flex: 1, gap: 4 }, heartValue: { fontSize: 31, color: C.ink, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  heartDivider: { width: 1, alignSelf: 'stretch', backgroundColor: C.line }, heartNote: { fontSize: 11, lineHeight: 18, color: C.muted, textAlign: RTL_LABEL_ALIGN },
  connect: { padding: 15, borderRadius: 15, backgroundColor: C.mint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  connectText: { color: C.ink, fontSize: 15, fontWeight: '700' },
  history: { paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, historyText: { flex: 1, color: C.ink, fontSize: 15, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  updated: { fontSize: 11, color: C.muted, textAlign: RTL_LABEL_ALIGN }, privacyNote: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  privacyText: { flex: 1, color: C.muted, fontSize: 11, lineHeight: 18, textAlign: RTL_LABEL_ALIGN },
});
