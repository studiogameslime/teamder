import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeModal } from '@/components/SafeModal';
import { ScreenHeader } from '@/components/ScreenHeader';
import { UserAvatar } from '@/components/UserAvatar';
import { comparisonActivityService } from '@/services/comparisonActivityService';
import { useUserStore } from '@/store/userStore';
import { observeCaughtError } from '@/utils/errorObservation';
import { isStaleSession } from '@/services/staleSession';
import { RTL_LABEL_ALIGN } from '@/theme';
import type { ComparisonActivityPage, ComparisonActivityRow, ComparisonRange } from '@/types/comparisonActivity';

function ComparisonRow({ row }: { row: ComparisonActivityRow }) {
  return <View style={s.row}>
    <UserAvatar user={row} size={44}/>
    <View style={s.identity}><Text style={s.name}>{row.name}</Text><Text style={s.detail}>{row.groupName || 'מועדון קודם'} · {row.scopeLabel}</Text>
      <View style={s.time}><Ionicons name="time-outline" color="#667796" size={12}/><Text style={s.detail}>{new Date(row.lastAt).toLocaleDateString('he-IL')} · {new Date(row.lastAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</Text></View>
    </View>
    <View style={s.countChip}><Text style={s.count}>{row.count === 1 ? 'השוואה אחת' : `${row.count} השוואות`}</Text></View>
  </View>;
}

export function ComparisonActivitySection({ ownerId }: { ownerId: string }) {
  const me = useUserStore(state => state.currentUser);
  const [range, setRange] = useState<ComparisonRange>('month');
  const [response, setResponse] = useState<{ key: string; page: ComparisonActivityPage } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const moreRef = useRef(false);
  const authorised = me?.id === ownerId && !me?.isGuest;
  const key = `${ownerId}:${range}`;
  const activeKey = useRef(key);
  activeKey.current = key;
  const result = response?.key === key ? response.page : null;

  useFocusEffect(useCallback(() => {
    if (!authorised) return;
    const turn = ++generation.current;
    let alive = true;
    const active = () => alive && generation.current === turn && activeKey.current === key && useUserStore.getState().currentUser?.id === ownerId;
    setResponse(null); setLoading(true); setFailed(false); setMoreFailed(false); setMoreBusy(false); moreRef.current = false;
    void comparisonActivityService.list(ownerId, range).then(page => { if (active()) setResponse({ key, page }); }).catch(error => {
      if (!isStaleSession(error)) observeCaughtError(error, { source: 'src/components/profile/ComparisonActivitySection.tsx', handler: 'load', site: 'ComparisonActivitySection:load' });
      if (active()) setFailed(true);
    }).finally(() => { if (active()) setLoading(false); });
    return () => { alive = false; generation.current++; };
  }, [ownerId, authorised, range, retry]));

  const more = async () => {
    if (!result?.cursor || moreRef.current || !authorised) return;
    const turn = generation.current;
    moreRef.current = true; setMoreBusy(true); setMoreFailed(false);
    try {
      const page = await comparisonActivityService.list(ownerId, range, result.cursor);
      if (generation.current !== turn || activeKey.current !== key || useUserStore.getState().currentUser?.id !== ownerId) return;
      setResponse(previous => previous?.key === key ? { key, page: { ...page, rows: Array.from(new Map([...previous.page.rows, ...page.rows].map(row => [row.id, row])).values()) } } : { key, page });
    } catch (error) {
      if (!isStaleSession(error)) observeCaughtError(error, { source: 'src/components/profile/ComparisonActivitySection.tsx', handler: 'more', site: 'ComparisonActivitySection:more' });
      if (generation.current === turn && activeKey.current === key && useUserStore.getState().currentUser?.id === ownerId) setMoreFailed(true);
    } finally {
      if (generation.current === turn && activeKey.current === key) { moreRef.current = false; setMoreBusy(false); }
    }
  };
  const filters = <View style={s.filters}>{([['month', '30 ימים'], ['all', 'כל הזמנים']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: value === range }} onPress={() => setRange(value)} style={[s.filter, value === range && s.filterSelected]}><Text style={[s.filterText, value === range && s.blue]}>{label}</Text></Pressable>)}</View>;
  const state = loading ? <ActivityIndicator style={s.state} color="#2563EB" accessibilityLabel="טוען היסטוריית השוואות"/> : failed ? <View style={s.state}><Text style={s.body}>לא ניתן לטעון את ההשוואות כרגע.</Text><Pressable accessibilityRole="button" onPress={() => setRetry(value => value + 1)} style={s.link}><Text style={s.linkText}>נסה שוב</Text></Pressable></View> : null;
  const numbers = result ? <View style={s.numbers}>{[{ value: result.players, label: 'שחקנים שונים' }, { value: result.comparisons, label: 'השוואות' }].map(item => <View key={item.label} style={s.metric}><Text style={s.value}>{item.value}</Text><Text style={s.body}>{item.label}</Text></View>)}</View> : null;
  const empty = result && result.players === 0 ? <Text style={s.body}>עדיין אין השוואות מתועדות{range === 'month' ? ' בתקופה הזו' : ''}. השוואות חדשות שיושלמו יופיעו כאן; היסטוריה מלפני הפעלת הפיצ׳ר אינה זמינה.</Text> : null;
  if (!authorised) return null;
  return <>
    <View style={s.card}><View style={s.heading}><Ionicons name="stats-chart-outline" size={22} color="#2563EB"/><Text style={s.title}>השוו את עצמם אליי</Text></View>
      <View style={s.time}><Ionicons name="lock-closed-outline" size={12} color="#667796"/><Text style={s.body}>המידע הזה גלוי רק לך</Text></View>
      {filters}{state}{numbers}{empty}
      {result?.rows.slice(0, 3).map(row => <ComparisonRow key={row.id} row={row}/>)}
      {!!result?.players && <Pressable accessibilityRole="button" accessibilityLabel="לכל ההשוואות" style={s.link} onPress={() => setExpanded(true)}><Text style={s.linkText}>לכל ההשוואות</Text><Ionicons name="chevron-back" color="#2563EB" size={18}/></Pressable>}
    </View>
    <SafeModal visible={expanded} animationType="slide" onRequestClose={() => setExpanded(false)}><SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <ScreenHeader title="מי השווה אליי" onBack={() => setExpanded(false)}/>
      <ScrollView contentContainerStyle={s.content}><Text style={s.body}>המידע הזה גלוי רק לך. כל שורה מרכזת שחקן אחד ומציגה את פרטי ההשוואה האחרונה שלו.</Text>{filters}{state}{numbers}{empty}
        {result?.rows.map(row => <ComparisonRow key={row.id} row={row}/>)}
        {result?.cursor ? <Pressable accessibilityRole="button" disabled={moreBusy} onPress={() => void more()} style={s.link}>{moreBusy ? <ActivityIndicator color="#2563EB"/> : <Text style={s.linkText}>{moreFailed ? 'הטעינה נכשלה — נסה שוב' : 'טען עוד'}</Text>}</Pressable> : null}
      </ScrollView>
    </SafeAreaView></SafeModal>
  </>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F4F7FB' }, content: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { padding: 14, gap: 12, borderRadius: 18, backgroundColor: 'white', borderWidth: 1, borderColor: '#E5ECF7' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 8 }, title: { flex: 1, fontSize: 19, color: '#0C1744', fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  body: { fontSize: 13, lineHeight: 20, color: '#667796', textAlign: RTL_LABEL_ALIGN }, time: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  filters: { flexDirection: 'row', gap: 8 }, filter: { flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#D9E4F6', borderRadius: 10, padding: 8 }, filterSelected: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' }, filterText: { color: '#667796', fontSize: 14, fontWeight: '600' }, blue: { color: '#2563EB' },
  numbers: { backgroundColor: '#EFF6FF', borderRadius: 13, flexDirection: 'row', paddingVertical: 14 }, metric: { flex: 1, alignItems: 'center', gap: 3 }, value: { color: '#2563EB', fontSize: 28, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: '#EBF0F8' }, identity: { flex: 1, minWidth: 120, gap: 4 }, name: { color: '#0C1744', fontSize: 16, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, detail: { color: '#667796', fontSize: 11, lineHeight: 17, textAlign: RTL_LABEL_ALIGN, flexShrink: 1 }, countChip: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#EFF6FF' }, count: { color: '#2563EB', fontSize: 11, fontWeight: '700' },
  link: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, linkText: { color: '#2563EB', fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN }, state: { paddingVertical: 12 },
});
