import { observeCaughtError } from '../services/errorObservation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';
import { Card, Empty, Screen, Disclosure } from '../components/ui';
import { TeamderChatSheet } from '../components/TeamderChatSheet';
import { NewSupportChatPicker } from '../components/NewSupportChatPicker';
import { listThreads, userNameOf, type ThreadSummary } from '../services/teamderChatService';
import { filterSupportThreads, type SupportFilter } from '../services/supportInbox';
import { timeAgo } from '../format';
import { SupportOutreachPanel } from '../components/SupportOutreachPanel';

const FILTERS: { key: SupportFilter; label: string }[] = [
  { key: 'waiting', label: 'ממתינים לנו' }, { key: 'sent', label: 'ממתינים למשתמש' }, { key: 'resolved', label: 'פתורות' }, { key: 'all', label: 'הכול' },
];

export function MessagesScreen() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true), [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false), [updatedAt, setUpdatedAt] = useState(0);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState<SupportFilter>('waiting');
  const [open, setOpen] = useState<{ userId: string; userName: string } | null>(null);
  const [pickingUser, setPickingUser] = useState(false);
  const mounted = useRef(true), inFlight = useRef(false);
  const route = useRoute();
  const params = route.params as { userId?: string; messageId?: string } | undefined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async (force = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const rows = await listThreads(force);
      if (mounted.current) { setThreads(rows); setFailed(false); setUpdatedAt(Date.now()); }
    } catch (caughtErrorddbeea1114) {
    observeCaughtError(caughtErrorddbeea1114, {"source":"pulse/src/screens/MessagesScreen.tsx","handler":"MessagesScreen","site":"MessagesScreen:ddbeea1114"}); if (mounted.current) setFailed(true); }
    finally { inFlight.current = false; if (mounted.current) setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => {
    const refresh = () => { if (AppState.currentState === 'active') void load(true); };
    void load(true);
    const timer = setInterval(refresh, 30_000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [load]));
  useEffect(() => {
    const userId = params?.userId;
    if (!userId || userId === 'teamder' || /[\/\s]/.test(userId) || userId.includes('__')) return;
    let alive = true;
    setOpen({ userId, userName: '' });
    void userNameOf(userId).then(userName => { if (alive) setOpen({ userId, userName }); }).catch((caughtError786129217a: unknown) => {
    observeCaughtError(caughtError786129217a, {"source":"pulse/src/screens/MessagesScreen.tsx","handler":"MessagesScreen","site":"MessagesScreen:786129217a"});});
    return () => { alive = false; };
  }, [params?.userId, params?.messageId]);
  const refresh = async () => { setRefreshing(true); await load(true); if (mounted.current) setRefreshing(false); };
  const rows = useMemo(() => filterSupportThreads(threads, search, filter), [threads, search, filter]);
  const waiting = threads.filter(t => t.awaitingReply).length;
  return (
    <Screen title="שיחות תמיכה" subtitle="כל השיחות עם השחקנים" right={<Pressable accessibilityRole="button" accessibilityLabel="שיחה חדשה" onPress={()=>setPickingUser(true)} style={{flexDirection:'row',direction:'rtl',gap:7,alignItems:'center',borderWidth:1,borderColor:colors.primary,borderRadius:10,padding:10}}><Ionicons name="create-outline" size={20} color={colors.primary}/><Text style={{...font.body,color:colors.primary}}>חדשה</Text></Pressable>}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <Text style={{ ...font.small,textAlign: RTL_LABEL_ALIGN}}>{loading && !threads.length?'—':waiting} ממתינים למענה · {threads.length} שיחות במעקב</Text>

      <View style={st.search}><Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="חיפוש לפי שם או הודעה אחרונה" placeholderTextColor={colors.textMuted} style={st.input} />
      </View>
      <View style={st.filters}>{FILTERS.filter(item=>item.key!=='all').map(item => <Pressable key={item.key} onPress={() => setFilter(item.key)}
        accessibilityRole="button" accessibilityState={{ selected: filter === item.key }} style={[st.filter, filter === item.key && {borderBottomColor:colors.primary}]}>
        <View style={{flexDirection:'row',direction:'rtl',gap:5,alignItems:'center'}}><Text style={[st.filterText,{fontSize:11,color:filter===item.key?colors.primary:colors.textSoft}]}>{item.label}</Text><Text style={{fontSize:10,color:filter===item.key?colors.onPrimary:colors.textSoft,backgroundColor:filter===item.key?colors.primary:colors.surfaceAlt,paddingHorizontal:4,borderRadius:5}}>{item.key==='waiting'?waiting:item.key==='resolved'?threads.filter(t=>t.resolved).length:threads.filter(t=>!t.awaitingReply && !t.resolved).length}</Text></View></Pressable>)}</View>

      {failed ? <Pressable onPress={refresh} style={st.error}><Text style={st.errorText}>לא הצלחנו לעדכן את השיחות. הנתונים הקודמים נשמרו — לחצו לניסיון חוזר.</Text></Pressable> : null}
      <Text style={st.note}>הממתינים הוותיקים תחילה</Text>
      {loading ? <ActivityIndicator color={colors.primary} /> : !failed && rows.length === 0 ? <Empty text={threads.length ? 'אין שיחות שמתאימות לחיפוש ולסינון' : 'עוד לא נפתחה שיחה. אפשר לשלוח הודעה מתוך כרטיס המשתמש.'} /> : rows.map(t => (
        <Pressable key={t.userId} onPress={() => setOpen(t)} accessibilityRole="button" accessibilityLabel={`שיחה עם ${t.userName || 'משתמש'}`}>
          <Card style={[st.row, t.awaitingReply && st.waiting]}>
            <View style={st.avatar}><Text style={{...font.title,color:colors.textSoft}}>{(t.userName || '?').split(/\s+/).slice(0,2).map(n=>n[0]).join('')}</Text></View>
            <View style={st.body}><View style={st.line}><Text style={st.name} numberOfLines={1}>{t.userName || 'משתמש'}</Text><Text style={st.when}>{timeAgo(t.lastMessageAt)}</Text></View>
              <Text style={st.preview} numberOfLines={2}>{t.awaitingReply || t.resolved ? t.lastText : `אנחנו: ${t.lastText}`} </Text>
              <Text style={[st.status, { color: t.awaitingReply ? colors.primary : colors.textMuted }]}>{t.resolved ? 'סומנה כפתורה' : t.awaitingReply ? '● ממתין למענה' : 'ההודעה האחרונה נשלחה מאיתנו'}</Text>
            </View><Ionicons name="chevron-back" size={18} color={colors.textMuted} />
          </Card>
        </Pressable>
      ))}
      <Pressable onPress={()=>setFilter('all')} style={{paddingVertical:12}}><Text style={{ ...font.small,color:colors.primary,textAlign: RTL_LABEL_ALIGN}}>לכל השיחות</Text></Pressable>
      <Disclosure title="פנייה יזומה למשתמשים"><SupportOutreachPanel onOpenThread={(userId, userName) => setOpen({ userId, userName })} /></Disclosure>
      <TeamderChatSheet onStatusChanged={() => { void load(true); }} visible={open !== null} userId={open?.userId ?? ''} userName={open?.userName ?? ''} onClose={() => { setOpen(null); void load(true); }} />
      <NewSupportChatPicker visible={pickingUser} onClose={()=>setPickingUser(false)} onSelect={(userId,userName)=>{setPickingUser(false);setOpen({userId,userName});}}/>
    </Screen>
  );
}
const st = StyleSheet.create({
  stats: { flexDirection: 'row', direction: 'rtl' as const, gap: 10 }, stat: { flex: 1, alignItems: 'center', gap: 5 }, number: { fontSize: 28, fontWeight: '800', color: colors.primary },
  search: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12 },
  input: { direction: 'rtl' as const, flex: 1, color: colors.text, textAlign: RTL_LABEL_ALIGN, paddingVertical: 14 },
  filters: { flexDirection: 'row', direction: 'rtl' as const, gap: 7, marginVertical: 12 }, filter: { flex: 1, minHeight: 48, justifyContent: 'center', paddingVertical: 10, alignItems: 'center', borderBottomWidth:2,borderBottomColor:'transparent' },
  selected: { backgroundColor: colors.primarySoft, borderColor: colors.primary, borderWidth: 1 }, filterText: { color: colors.text, fontSize: 12, fontWeight: '700' },
  note: { ...font.small, marginBottom: 12 }, row: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 10,backgroundColor:'transparent',borderWidth:0,borderBottomWidth:1,borderColor:colors.border,borderRadius:0,paddingHorizontal:0,paddingVertical:18 }, waiting: {},
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' }, body: { flex: 1, gap: 6 },
  line: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 8 }, name: { direction: 'rtl' as const, flex: 1, color: colors.text, fontSize: 15, fontWeight: '800', textAlign: RTL_LABEL_ALIGN },
  when: { color: colors.textMuted, fontSize: 11 }, preview: { ...font.body }, status: { direction: 'rtl' as const, fontSize: 11, textAlign: RTL_LABEL_ALIGN },
  error: { backgroundColor: colors.surfaceAlt, padding: 14, borderRadius: radius.sm, marginBottom: 12 }, errorText: { ...font.body, color: colors.amber },
});
