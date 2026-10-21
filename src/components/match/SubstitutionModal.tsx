import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { UserAvatar } from '@/components/UserAvatar';
import { RTL_LABEL_ALIGN } from '@/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { canMoveOut } from '@/utils/teamSlots';
import type { RosterMember } from './rotationView';

export interface SubstitutionTeam { index: number; label: string; color: string; textColor?: string; roster: RosterMember[]; playing: boolean; position?: number }
export function SubstitutionModal({ visible, teams, initialSource, running, capacity, temporary = true, onSwap, onMove, onClose }: {
  visible: boolean; teams: SubstitutionTeam[]; initialSource?: string | null; running: boolean; capacity?: number;
  temporary?: boolean;
  onSwap?: (a: string, b: string) => Promise<void> | void;
  onMove?: (player: string, team: number) => Promise<void> | void; onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<string | null>(initialSource ?? null);
  const [target, setTarget] = useState<string | null>(null);
  const [slot, setSlot] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  useEffect(() => { if (visible) { setSource(initialSource ?? null); setTarget(null); setSlot(null); setError(''); } }, [visible, initialSource]);
  const sourceTeam = teams.find(t => t.roster.some(m => m.id === source));
  const targetTeam = teams.find(t => t.roster.some(m => m.id === target)) ?? teams.find(t => t.index === slot);
  const a = sourceTeam?.roster.find(m => m.id === source), b = targetTeam?.roster.find(m => m.id === target);
  const close = () => { if (!writing.current) onClose(); };
  const confirm = async () => {
    if (writing.current || !a || !targetTeam || sourceTeam?.index === targetTeam.index || (!b && slot === null)) return;
    writing.current = true; setBusy(true); setError('');
    try { if (b && onSwap) await onSwap(a.id, b.id); else if (!b && onMove) await onMove(a.id, targetTeam.index); else throw new Error('missing substitution action'); onClose(); }
    catch (caughtError17ed5121ae) {
    observeCaughtError(caughtError17ed5121ae, {"source":"src/components/match/SubstitutionModal.tsx","handler":"confirm","site":"SubstitutionModal:17ed5121ae"}); setError('החילוף לא נשמר. בדקו שההרכבים לא השתנו ונסו שוב.'); }
    finally { writing.current = false; setBusy(false); }
  };
  return <SafeModal visible={visible} transparent animationType="slide" onRequestClose={close}><View style={s.backdrop}><Pressable style={StyleSheet.absoluteFill} onPress={close}/><View style={[s.sheet, { maxHeight: height * 0.92, paddingBottom: 14 + insets.bottom }]}>
    <View style={s.heading}><View style={s.flex}><Text style={s.title}>חילוף שחקנים</Text><Text style={s.small}>{running ? 'השעון ממשיך לרוץ' : 'השעון עצור'}</Text></View><Pressable disabled={busy} onPress={close} style={s.icon} accessibilityRole="button" accessibilityLabel="סגירה"><Ionicons name="close" size={24} color="#172554"/></Pressable></View>
    {!a && <Text style={s.question}>בחרו שחקן להחלפה</Text>}
    <ScrollView style={s.list} contentContainerStyle={s.listContent}>{teams.map(team => <View key={team.index} style={s.team}>
      <View style={[s.teamHeading, { backgroundColor: team.color + '12' }]}><Text style={[s.teamName, { color: team.textColor ?? team.color }]}>{team.label}</Text><Text style={s.small}>{team.playing ? 'משחקים' : team.position === 0 ? 'בחוץ · הבאים בתור' : `בחוץ · תור ${(team.position ?? 0) + 1}`}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={s.roster}>
        {team.roster.map(m => { const picked = source === m.id || target === m.id, disabled = busy || (!!a && sourceTeam?.index === team.index && source !== m.id); return <Pressable key={m.id} disabled={disabled} style={[s.player, disabled && s.dim]} accessibilityRole="button" accessibilityLabel={`${m.name}, ${team.label}`} accessibilityState={{ selected: picked, disabled }} onPress={() => { setError(''); if (!a) { setSource(m.id); setTarget(null); setSlot(null); } else if (source === m.id) { setSource(null); setTarget(null); setSlot(null); } else { setTarget(m.id); setSlot(null); } }}><View style={[s.portrait, picked && s.picked]}><UserAvatar user={m} size={36}/>{target === m.id && <View style={s.check}><Ionicons name="checkmark" size={12} color="#FFF"/></View>}</View><Text numberOfLines={2} style={s.playerName}>{m.name}</Text>{m.isFiller && <Text style={s.filler}>משלים</Text>}</Pressable>; })}
        {a && !a.isFiller && onMove && sourceTeam?.index !== team.index && canMoveOut(sourceTeam?.roster.length ?? 0) && capacity && team.roster.length < capacity ? <Pressable disabled={busy} style={s.player} onPress={() => { setTarget(null); setSlot(team.index); }} accessibilityRole="button" accessibilityLabel={`מקום פנוי אצל ${team.label}`}><View style={[s.empty, slot === team.index && s.picked]}><Ionicons name="person-add-outline" size={22} color="#64748B"/></View><Text style={s.playerName}>מקום פנוי</Text></Pressable> : null}
      </ScrollView>
    </View>)}</ScrollView>
    {a && targetTeam && <View style={s.summary}><View style={s.summaryHalf}><UserAvatar user={a} size={30}/><Text style={s.summaryText}>{`${a.name} עובר ל${targetTeam.label.slice(1)}`}</Text></View>{b && sourceTeam && <View style={s.summaryHalf}><UserAvatar user={b} size={30}/><Text style={s.summaryText}>{`${b.name} נכנס ל${sourceTeam.label.slice(1)}`}</Text></View>}</View>}
    {a && targetTeam && <Text style={s.small}>{temporary ? 'חילוף זמני · קבוצות המקור נשמרות' : 'חילוף קבוע · נשארים בקבוצות החדשות'}</Text>}
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    <Pressable disabled={busy || !a || !targetTeam} style={[s.primary, (!a || !targetTeam || busy) && s.disabled]} onPress={() => void confirm()} accessibilityRole="button" accessibilityState={{ disabled: busy || !a || !targetTeam }}>{busy ? <ActivityIndicator color="#FFF"/> : <Text style={s.primaryText}>{a && targetTeam ? slot !== null ? 'אישור העברה' : 'בצע חילוף' : a ? 'בחרו שחקן נכנס' : 'בחרו שחקן להחלפה'}</Text>}</Pressable>
  </View></View></SafeModal>;
}
const s = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: '#0B122080', justifyContent: 'flex-end' }, sheet: { backgroundColor: '#FFF', borderTopStartRadius: 24, borderTopEndRadius: 24, padding: 14, gap: 10, flexShrink: 1 }, flex: { flex: 1 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { color: '#12234D', fontSize: 21, fontWeight: '800', textAlign: RTL_LABEL_ALIGN }, small: { color: '#64748B', fontSize: 11, textAlign: RTL_LABEL_ALIGN }, icon: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, question: { color: '#12234D', fontSize: 17, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, list: { flexShrink: 1 }, listContent: { gap: 7 }, team: { gap: 3 }, teamHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 }, teamName: { fontSize: 14, fontWeight: '800' }, roster: { paddingVertical: 5, gap: 2 }, player: { width: 58, alignItems: 'center', gap: 3, minHeight: 70 }, portrait: { borderWidth: 2, borderColor: 'transparent', borderRadius: 24, padding: 2 }, picked: { borderColor: '#2563EB' }, playerName: { color: '#12234D', fontSize: 11, textAlign: 'center', paddingHorizontal: 2 }, dim: { opacity: 0.38 }, filler: { color: '#64748B', fontSize: 9 }, check: { position: 'absolute', top: -3, end: -3, borderRadius: 9, width: 18, height: 18, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' }, empty: { width: 42, height: 42, borderWidth: 1, borderStyle: 'dashed', borderColor: '#CBD5E1', borderRadius: 21, alignItems: 'center', justifyContent: 'center' }, summary: { flexDirection: 'row', gap: 8 }, summaryHalf: { flex: 1, flexDirection: 'row', gap: 5, alignItems: 'center', backgroundColor: '#EFF6FF', borderRadius: 10, padding: 7 }, summaryText: { flex: 1, fontSize: 11, color: '#12234D', textAlign: RTL_LABEL_ALIGN }, primary: { minHeight: 52, backgroundColor: '#2563EB', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#FFF', fontSize: 17, fontWeight: '800' }, disabled: { backgroundColor: '#CBD5E1' }, error: { color: '#B91C1C', fontSize: 12, textAlign: RTL_LABEL_ALIGN } });
