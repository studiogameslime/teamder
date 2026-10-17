import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useAmbientMotion } from '@/hooks/animations/useAmbientMotion';
import { RTL_LABEL_ALIGN } from '@/theme';
import { UserAvatar } from '@/components/UserAvatar';
import type { ClubStatusLeader } from './ClubStatusCard';

export const clubStatsPalette = { ink: '#13213F', muted: '#687797', teal: '#2463F5', border: '#E0E8F0', ground: '#F7FAFC' };
export type ClubStatsSection = 'overview' | 'table' | 'records';
const SECTIONS: { key: ClubStatsSection; title: string }[] = [
  { key: 'overview', title: 'סקירה' }, { key: 'table', title: 'הטבלה' }, { key: 'records', title: 'צמדים ושיאים' },
];

/** Local vector decoration: stable across captures, no photo/network load. */
export function ClubStatsGrass() {
  return <View pointerEvents="none" accessible={false} style={s.grass}>
    <Svg width="100%" height={10} viewBox="0 0 400 10" preserveAspectRatio="none">
      <Rect x={0} y={8} width={400} height={2} fill="#398D35" />
      {Array.from({ length: 160 }, (_, i) => {
        const x = i * 2.5;
        const height = 3 + (i * 7 % 5) + (i % 3);
        return <Path key={i} d={`M${x} 10 L${x - 1.2} ${10 - height} L${x + 1} 7 L${x + 2} ${8 - i % 5} L${x + 2.7} 10Z`} fill={['#3A913A', '#66AA49', '#25863D'][i % 3]} />;
      })}
    </Svg>
  </View>;
}

/** Only for the legacy route; the actual club tab supplies its own shell. */
export function ClubStatsHero({ name, onBack }: { name: string; onBack: () => void }) {
  return <View style={s.legacyHeader}><Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="חזרה" hitSlop={12}><Ionicons name="arrow-forward" size={24} color={clubStatsPalette.ink} /></Pressable><Text style={s.legacyTitle}>{name}</Text></View>;
}

export function ClubStatsSections({ value, onChange }: { value: ClubStatsSection; onChange: (value: ClubStatsSection) => void }) {
  return <View style={s.sections}>{SECTIONS.map(section => <Pressable key={section.key} onPress={() => onChange(section.key)} accessibilityRole="tab" accessibilityLabel={section.title} accessibilityState={{ selected: value === section.key }} style={[s.section, value === section.key && s.sectionActive]}><Text style={[s.sectionText, value === section.key && s.sectionTextActive]}>{section.title}</Text></Pressable>)}</View>;
}

function PitchBall({ animate }: { animate: boolean }) {
  const allowed = useAmbientMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(turn);
    turn.value = 0;
    if (animate && allowed) turn.value = withDelay(300, withTiming(90, { duration: 1800, easing: Easing.inOut(Easing.cubic) }));
    return () => cancelAnimation(turn);
  }, [animate, allowed, turn]);
  const motion = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return <Animated.View style={[s.pitchBall, motion]} pointerEvents="none" accessible={false}><Ionicons name="football" size={22} color="#263951" /></Animated.View>;
}

function GoalMark() {
  return <Svg width={27} height={25} viewBox="0 0 27 25" accessible={false}><Rect x={2} y={3} width={23} height={19} rx={1} fill="none" stroke="#32974A" strokeWidth={2} /><Path d="M7 4V21M12 4V21M17 4V21M22 4V21M3 8H24M3 13H24M3 18H24" stroke="#32974A" strokeWidth={0.8} /></Svg>;
}

type SummaryCount = number | '—';
type SummaryProps = { scope?: string; goals: SummaryCount; assists: SummaryCount; games: SummaryCount; animate?: boolean } & (
  { evenings: number; shootouts?: never } | { evenings?: never; shootouts: SummaryCount }
);

export function ClubStatsSummary({ scope, goals, assists, games, evenings, shootouts, animate = false }: SummaryProps) {
  return <View style={s.summary}>
    {scope ? <Text style={s.scope}>{scope}</Text> : null}
    <View style={s.summaryTop}>
      <View style={s.caption}><Ionicons name={shootouts !== undefined ? 'disc-outline' : 'calendar-outline'} size={17} color={clubStatsPalette.ink} /><Text style={s.captionText}>{shootouts !== undefined ? `${shootouts} הכרעות בפנדלים` : `${evenings} מחזורים`}</Text></View>
      <View style={s.topDivider} />
      <View style={s.caption}><MaterialCommunityIcons name="whistle-outline" size={20} color={clubStatsPalette.ink} /><Text style={s.captionText}>{games} משחקים</Text></View>
    </View>
    <View style={s.pitch}>
      <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
        <Svg width="100%" height="100%" viewBox="0 0 360 112" preserveAspectRatio="none">
          <Rect x={8} y={5} width={344} height={102} rx={2} fill="none" stroke="#C5E5D8" strokeWidth={1.3} />
          <Line x1={180} y1={5} x2={180} y2={107} stroke="#C5E5D8" />
          <Circle cx={180} cy={56} r={23} fill="none" stroke="#C5E5D8" />
          <Rect x={8} y={28} width={30} height={56} fill="none" stroke="#C5E5D8" />
          <Rect x={322} y={28} width={30} height={56} fill="none" stroke="#C5E5D8" />
          <Rect x={2} y={40} width={6} height={32} fill="none" stroke="#C5E5D8" />
          <Rect x={352} y={40} width={6} height={32} fill="none" stroke="#C5E5D8" />
        </Svg>
      </View>
      <View style={s.pitchMetric}><GoalMark /><View style={s.pitchCopy}><Text style={[s.metricValue, String(goals).length > 4 && { fontSize: 25 }]}>{goals}</Text><Text style={s.metricLabel}>שערים</Text></View></View>
      <View style={s.centerSpot}><PitchBall animate={animate} /></View>
      <View style={s.pitchMetric}><MaterialCommunityIcons name="soccer" size={24} color={clubStatsPalette.teal} /><View style={s.pitchCopy}><Text style={[s.metricValue, String(assists).length > 4 && { fontSize: 25 }]}>{assists}</Text><Text style={s.metricLabel}>בישולים</Text></View></View>
    </View>
    <ClubStatsGrass />
  </View>;
}

export function ClubStatsTableHeading({ children }: { children: React.ReactNode }) {
  return <View style={s.tableHeading}><View style={s.tableHeadingBody}><MaterialCommunityIcons name="soccer-field" size={30} color="#C5E5D8" />{children}<MaterialCommunityIcons name="soccer-field" size={30} color="#C5E5D8" /></View><ClubStatsGrass /></View>;
}

function roleOf(title: string): { name: React.ComponentProps<typeof MaterialCommunityIcons>['name']; color: string } {
  if (title.includes('עצמ')) return { name: 'soccer', color: clubStatsPalette.ink };
  if (title.includes('עצירות')) return { name: 'hand-back-right-outline', color: clubStatsPalette.ink };
  if (title.includes('פנדל')) return { name: 'target', color: clubStatsPalette.ink };
  if (title.includes('נקי')) return { name: 'shield-outline', color: clubStatsPalette.ink };
  if (title.includes('מתמיד') || title.includes('התמד')) return { name: 'calendar-month-outline', color: clubStatsPalette.ink };
  if (title.includes('מעורב')) return { name: 'lightning-bolt', color: clubStatsPalette.teal };
  if (title.includes('בישול')) return { name: 'soccer', color: clubStatsPalette.teal };
  if (title.includes('ניצח') || title.includes('נצח')) return { name: 'trophy', color: '#C69C28' };
  return { name: 'shoe-cleat', color: '#C69C28' };
}

export type ClubStatsAward = Omit<ClubStatusLeader, 'user' | 'value'> & {
  user?: ClubStatusLeader['user'];
  /** Equal leaders share one metric; keep every identity, including guests. */
  tiedUsers?: ClubStatusLeader['user'][];
  value: number | '—';
};

export function ClubStatsAwards({ leaders, onPlayerPress, onTablePress }: { leaders: ClubStatsAward[]; onPlayerPress?: (uid: string) => void; onTablePress?: () => void }) {
  if (!leaders.length) return null;
  return <View style={s.awards}>
    {leaders.map((leader, index) => {
      const role = roleOf(leader.title);
      const users = leader.user ? [leader.user, ...(leader.tiedUsers ?? [])] : [];
      const names = users.length ? users.map(user => `\u2068${user.name.trim()}\u2069`).join(' · ') : 'יופיע בסיום המחזור';
      const canOpen = !!onPlayerPress && users.length === 1;
      return <Pressable key={leader.title} disabled={!canOpen} onPress={() => leader.user && onPlayerPress?.(leader.user.id)} accessibilityRole={canOpen ? 'button' : undefined} accessibilityLabel={`${leader.title}: ${names}, ${leader.value}${leader.suffix ?? ''} ${leader.unit}`} style={({ pressed }) => [s.award, index > 0 && s.awardDivider, pressed && { opacity: 0.7 }]}>
        <View style={s.awardFaces}>{users.length ? users.slice(0, 3).map(user => <UserAvatar key={user.id} user={user} size={36} />) : <Ionicons name="person-circle-outline" size={36} color="#C5CEDB" />}</View>
        <MaterialCommunityIcons name={role.name} size={24} color={role.color} />
        <View style={s.awardCopy}><Text style={s.awardCategory} numberOfLines={2}>{leader.title}</Text><Text style={s.awardName} numberOfLines={users.length === 1 ? 1 : undefined}>{names}</Text></View>
        <View style={s.awardMetric}><Text style={s.awardValue}>{`\u2066${leader.value}${leader.suffix ?? ''}\u2069`}</Text><Text style={s.awardUnit}>{`\u2068${leader.unit}\u2069`}</Text></View>
      </Pressable>;
    })}
    {onTablePress ? <Pressable onPress={onTablePress} accessibilityRole="button" style={s.tableLink}><Text style={s.tableLinkText}>הטבלה המלאה</Text><Ionicons name="chevron-back" size={18} color={clubStatsPalette.teal} /></Pressable> : null}
  </View>;
}

const s = StyleSheet.create({
  legacyHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }, legacyTitle: { flex: 1, fontSize: 20, fontWeight: '800', color: clubStatsPalette.ink, textAlign: RTL_LABEL_ALIGN },
  sections: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: clubStatsPalette.border, marginHorizontal: -16 },
  section: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' }, sectionActive: { borderBottomColor: clubStatsPalette.teal }, sectionText: { color: '#536581', fontWeight: '600', fontSize: 13 }, sectionTextActive: { color: clubStatsPalette.teal, fontWeight: '800' },
  summary: { borderRadius: 12, borderWidth: 1, borderColor: clubStatsPalette.border, overflow: 'hidden', backgroundColor: '#FFFFFF' }, scope: { color: clubStatsPalette.muted, fontSize: 11, textAlign: 'center', paddingTop: 8 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12 }, caption: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' }, captionText: { flexShrink: 1, textAlign: 'center', color: clubStatsPalette.ink, fontSize: 13, fontWeight: '600' }, topDivider: { height: 20, width: 1, backgroundColor: clubStatsPalette.border },
  pitch: { height: 118, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, marginHorizontal: 5, marginBottom: 4 }, pitchMetric: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, pitchCopy: { alignItems: 'center' }, centerSpot: { width: 30, alignItems: 'center' }, pitchBall: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderRadius: 12 },
  metricValue: { color: clubStatsPalette.ink, fontSize: 33, fontWeight: '900', fontVariant: ['tabular-nums'] }, metricLabel: { color: clubStatsPalette.ink, fontSize: 13, fontWeight: '700' }, grass: { height: 10, width: '100%', overflow: 'hidden' },
  tableHeading: { borderRadius: 12, borderWidth: 1, borderColor: clubStatsPalette.border, overflow: 'hidden', backgroundColor: '#FFFFFF' }, tableHeadingBody: { minHeight: 58, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  awardFaces: { width: 36, alignItems: 'center', gap: 3 },
  awards: { backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: clubStatsPalette.border, paddingHorizontal: 12 }, award: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 68, paddingVertical: 9 }, awardDivider: { borderTopWidth: 1, borderTopColor: '#EAF0F5' }, awardCopy: { flex: 1, gap: 3, minWidth: 0 }, awardCategory: { fontSize: 12, color: '#687797', textAlign: RTL_LABEL_ALIGN }, awardName: { fontSize: 15, fontWeight: '800', color: clubStatsPalette.ink, textAlign: RTL_LABEL_ALIGN }, awardMetric: { alignItems: 'center', minWidth: 54 }, awardValue: { fontSize: 24, fontWeight: '900', color: clubStatsPalette.ink, fontVariant: ['tabular-nums'] }, awardUnit: { fontSize: 10, color: '#687797', textAlign: 'center' },
  tableLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, borderTopWidth: 1, borderTopColor: '#EAF0F5' }, tableLinkText: { fontSize: 13, fontWeight: '700', color: clubStatsPalette.teal },
});

