import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { RTL_LABEL_ALIGN } from '@/theme';
import { teamColor, teamTextColor, teamName, TEAM_PALETTE, makeResolver, type PlayerLite } from './rotationView';
import type { DraftTeamsResult, GameGuest } from '@/types';
import { LiveScoreboardCard } from './LiveScoreboardCard';
import { he } from '@/i18n/he';
import { changeOpeningColor, chooseOpeningTeam, moveOpeningWaiting, shuffleOpening, type OpeningPlan } from '@/utils/openingTeams';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

export function OpeningTeamsPanel({ gameId, draft, plan, playersMap, guests, capacity, totalMinutes, needsFill, busy, onChange, onConfirm }: {
  gameId: string;
  draft: DraftTeamsResult; plan: OpeningPlan; playersMap: Record<string, PlayerLite>;
  guests?: GameGuest[]; capacity: number; totalMinutes?: number; needsFill: boolean; busy: boolean;
  onChange: (plan: OpeningPlan) => void; onConfirm: () => void;
}) {
  const { height } = useWindowDimensions();
  const [colorTeam, setColorTeam] = useState<number | null>(null);
  const [exchange, setExchange] = useState<{ key: string; other: number } | null>(null);
  const [hint, setHint] = useState('');
  const teams = draft.teams.map(t => ({ ...t, colorKey: plan.colors[t.index] }));
  const order = plan.selected.length === 2 ? [...plan.selected, ...plan.waiting] : teams.map(t => t.index);
  const orderedTeams = order.map(i => teams.find(t => t.index === i)).filter((t): t is typeof teams[number] => !!t);
  const resolve = makeResolver(playersMap, guests);
  const left = new Set((draft.leftHome ?? []).map(p => p.playerId));
  const roster = (i: number) => teams.find(t => t.index === i)?.playerIds.filter(id => !left.has(id)) ?? [];
  const valid = plan.selected.length === 2 && plan.selected.every(i => roster(i).length > 0);
  const missing = needsFill && plan.selected.some(i => roster(i).length < capacity);
  const toggleTeam = (index: number) => {
    if (!plan.selected.includes(index) && plan.selected.length === 2) setHint('לשינוי, בטלו סימון ובחרו קבוצה אחרת');
    else { onChange(chooseOpeningTeam(plan, index)); setHint(''); }
  };
  const closeColor = () => { setColorTeam(null); setExchange(null); };
  const names = (i: number) => <View style={s.members}>{roster(i).map(id => {
    const p = resolve(id), name = p.displayName ?? 'שחקן';
    return <View key={id} style={s.member}><UserAvatar user={{ id, name, ...p }} size={38}/><Text style={s.memberName} numberOfLines={2}>{name}</Text></View>;
  })}{needsFill && Array.from({ length: Math.max(0, capacity - roster(i).length) }).map((_, n) => <View key={`empty-${n}`} style={s.member}><View style={s.emptyAvatar}><Ionicons name="person-outline" size={24} color="#94A3B8"/></View><Text style={s.small}>חסר שחקן</Text></View>)}</View>;
  const context = (i: number, next?: string) => <View key={i} style={[s.card, { borderColor: teamColor(i, teams) + '60' }]}><Text style={[s.teamName, { color: teamTextColor(i, teams) }]}>{teamName(i, teams)}</Text>{names(i)}{next && <Text style={[s.newColor, { color: teamTextColor(i, teams.map(t => t.index === i ? {...t, colorKey:next} : t)) }]}>{`יהפכו ל${TEAM_PALETTE.find(c => c.key === next)?.plural.slice(1)}`}</Text>}</View>;
  return <View style={s.root}>
    <LiveScoreboardCard gameId={gameId} draftTeams={{...draft,teams}} playersMap={playersMap} guests={guests}
      rotation={{playing:[plan.selected[0] ?? teams[0].index,plan.selected[1] ?? teams[1].index],waiting:plan.waiting,loans:[],wins:{},round:1,updatedAt:0}}
      live={{phase:'roundReady',assignments:{},benchOrder:[],scoreA:0,scoreB:0}} minute={1} roundNumber={1}
      canEdit={false} hideGoalButtons timerText="00:00" totalMinutes={totalMinutes} statusLabel={valid ? 'מוכן' : 'בחירת קבוצות'} running={false} danger={false}
      stoppagesText={he.rotationStoppagesInline(0,'00:00')}
      sideLabels={[0,1].map(slot => plan.selected[slot] === undefined ? 'בחרו קבוצה' : teamName(plan.selected[slot],teams)) as [string,string]}
      sideTints={[0,1].map(slot => plan.selected[slot] === undefined ? '#AFC2D8' : teamColor(plan.selected[slot],teams)) as [string,string]}/>
    <View style={s.heading}><View style={s.flex}><Text style={s.title}>מי פותחים?</Text><Text style={s.small}>{teams.length === 2 ? 'מאשרים את הקבוצות לפני המשחק' : 'בחרו שתי קבוצות'}</Text></View>{teams.length > 2 && <Pressable disabled={busy} style={s.linkButton} onPress={() => { onChange(shuffleOpening(plan)); setHint(''); logEvent(AnalyticsEvent.PlayersShuffled, {gameId, teams:teams.length}); }} accessibilityRole="button"><Text style={s.link}>הגרלת פתיחה</Text><Ionicons name="shuffle" size={17} color="#2563EB"/></Pressable>}</View>
    <ScrollView style={s.list} contentContainerStyle={s.listContent}>
      {orderedTeams.map(t => { const selected = plan.selected.includes(t.index), position = plan.waiting.indexOf(t.index); return <View key={t.index} style={[s.card, { borderColor: teamColor(t.index, teams) + '60' }, selected && s.selected]}>
        <View style={s.heading}><Pressable disabled={busy || roster(t.index).length === 0} style={s.teamSelect} onPress={() => toggleTeam(t.index)} accessible={false}><View style={[s.dot, { backgroundColor: teamColor(t.index, teams) }]}/><Text style={[s.teamName, { flex: 1 }]}>{teamName(t.index, teams)}</Text></Pressable><Pressable disabled={busy} style={s.linkButton} onPress={() => { setColorTeam(t.index); setExchange(null); }} accessibilityRole="button" accessibilityLabel={`שינוי צבע של ${teamName(t.index, teams)}`}><Text style={s.link}>שינוי צבע</Text><Ionicons name="pencil-outline" size={15} color="#2563EB"/></Pressable><Pressable disabled={busy || roster(t.index).length === 0} style={s.arrow} onPress={() => toggleTeam(t.index)} accessibilityRole="checkbox" accessibilityLabel={teamName(t.index, teams)} accessibilityState={{ checked: selected, disabled: busy || roster(t.index).length === 0 }}><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={27} color={selected ? '#2563EB' : '#94A3B8'}/></Pressable></View>
        {names(t.index)}
        {roster(t.index).length === 0 && <Text style={s.error}>אין שחקנים בקבוצה הזאת</Text>}
        {plan.selected.length === 2 && !selected && <View style={s.heading}><Text style={s.small}>{plan.waiting.length === 1 ? 'ממתינים' : `תור ${position + 1}`}</Text>{plan.waiting.length > 1 && <View style={s.arrows}>{([-1, 1] as const).map(delta => { const disabled = busy || (delta === -1 ? position === 0 : position === plan.waiting.length - 1); return <Pressable key={delta} disabled={disabled} style={s.arrow} onPress={() => onChange(moveOpeningWaiting(plan, t.index, delta))} accessibilityRole="button" accessibilityLabel={`${teamName(t.index, teams)}, ${delta === -1 ? 'הקדמה' : 'דחייה'} בתור`} accessibilityState={{ disabled }}><Ionicons name={delta === -1 ? 'chevron-up' : 'chevron-down'} size={20} color={disabled ? '#CBD5E1' : '#2563EB'}/></Pressable>; })}</View>}</View>}
      </View>; })}
    </ScrollView>
    <View style={s.footer}>{!!hint && <Text accessibilityRole="alert" style={s.small}>{hint}</Text>}<Pressable disabled={!valid || busy} onPress={onConfirm} style={[s.primary, (!valid || busy) && s.disabled]} accessibilityRole="button" accessibilityState={{ disabled: !valid || busy }}>{busy ? <ActivityIndicator color="#FFF"/> : <Text style={s.primaryText}>{!valid ? 'בחרו שתי קבוצות' : missing ? 'המשך להשלמת שחקנים' : 'אישור הקבוצות'}</Text>}</Pressable><Text style={s.footerHint}>השעון יופעל בנפרד</Text></View>
    <SafeModal visible={colorTeam !== null} transparent animationType="fade" onRequestClose={closeColor}><View style={s.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={closeColor}/><View style={[s.sheet, { maxHeight: height * 0.88 }]}><View style={s.heading}><Text style={[s.title, s.flex]}>{exchange ? 'להחליף צבעים?' : 'צבע לקבוצה'}</Text><Pressable onPress={closeColor} style={s.arrow} accessibilityRole="button" accessibilityLabel="סגירה"><Ionicons name="close" size={24} color="#172554"/></Pressable></View><ScrollView contentContainerStyle={s.listContent}>
      {colorTeam !== null && (exchange ? <>{context(colorTeam, exchange.key)}{context(exchange.other, plan.colors[colorTeam])}<Text style={s.small}>ההרכבים וסדר המשחק נשארים כפי שבחרתם</Text><Pressable style={s.primary} onPress={() => { onChange(changeOpeningColor(plan, colorTeam, exchange.key)); closeColor(); }}><Text style={s.primaryText}>אישור החלפה</Text></Pressable><Pressable style={s.linkButton} onPress={() => setExchange(null)}><Text style={s.link}>ביטול</Text></Pressable></> : <>{context(colorTeam)}<View style={s.palette}>{TEAM_PALETTE.map(c => { const other = teams.find(t => t.index !== colorTeam && plan.colors[t.index] === c.key), current = plan.colors[colorTeam] === c.key; return <Pressable key={c.key} style={[s.swatch, current && s.swatchSelected]} accessibilityRole="radio" accessibilityState={{ checked: current }} accessibilityLabel={`${c.plural}${other ? `, החלפה עם ${teamName(other.index, teams)}` : ''}`} onPress={() => { if (other) setExchange({ key: c.key, other: other.index }); else { onChange(changeOpeningColor(plan, colorTeam, c.key)); closeColor(); } }}><Ionicons name={c.light ? 'shirt-outline' : 'shirt'} size={34} color={c.light ? '#475569' : c.hex}/><Text style={s.small}>{c.plural}</Text>{current ? <Text style={s.link}>נוכחי ✓</Text> : other ? <Text style={s.colorTaken}>{`של ${teamName(other.index, teams)}`}</Text> : null}</Pressable>; })}</View><Text style={s.small}>צבע בשימוש? אפשר להחליף בין הקבוצות</Text></>)}
    </ScrollView></View></View></SafeModal>
  </View>;
}

const s = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, gap: 10 }, flex: { flex: 1 }, match: { backgroundColor: '#101E30', borderRadius: 18, padding: 13, gap: 8 }, matchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', gap: 6 }, matchCaption: { color: '#CBD5E1', textAlign: 'center', fontSize: 12 }, matchTeam: { flex: 1, color: '#FFF', fontSize: 20, fontWeight: '800', textAlign: 'center' }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, title: { fontSize: 21, fontWeight: '800', color: '#12234D', textAlign: RTL_LABEL_ALIGN }, small: { fontSize: 12, color: '#61728D', textAlign: RTL_LABEL_ALIGN, lineHeight: 19 }, teamName: { fontSize: 17, fontWeight: '800', color: '#12234D', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 }, teamSelect: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: 7 }, dot: { width: 12, height: 12, borderRadius: 6 }, list: { flex: 1 }, listContent: { gap: 10, paddingBottom: 8 }, card: { backgroundColor: '#FFF', borderWidth: 1, borderRadius: 16, padding: 11, gap: 8 }, selected: { backgroundColor: '#EFF6FF' }, members: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 9 }, member: { width: '20%', alignItems: 'center', gap: 4 }, memberName: { fontSize: 11, color: '#172554', textAlign: 'center', paddingHorizontal: 2 }, emptyAvatar: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', justifyContent: 'center', alignItems: 'center' }, linkButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 44, paddingHorizontal: 8 }, link: { color: '#2563EB', fontSize: 12, fontWeight: '700' }, arrows: { flexDirection: 'row' }, arrow: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, footer: { gap: 6, paddingVertical: 7 }, primary: { backgroundColor: '#2563EB', borderRadius: 14, minHeight: 54, alignItems: 'center', justifyContent: 'center', padding: 10 }, primaryText: { color: '#FFF', fontSize: 17, fontWeight: '800', textAlign: 'center' }, disabled: { backgroundColor: '#CBD5E1' }, footerHint: { color: '#61728D', textAlign: 'center', fontSize: 11 }, error: { color: '#B91C1C', fontSize: 13, textAlign: RTL_LABEL_ALIGN }, backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0B122080' }, sheet: { backgroundColor: '#FFF', padding: 16, borderTopStartRadius: 24, borderTopEndRadius: 24, gap: 10 }, palette: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }, swatch: { width: '25%', alignItems: 'center', padding: 7, gap: 4, minHeight: 96, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12 }, swatchSelected: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' }, colorTaken: { color: '#2563EB', fontSize: 10, textAlign: 'center' }, newColor: { backgroundColor: '#EFF6FF', padding: 8, textAlign: 'center', fontSize: 15, fontWeight: '700' },
});
