import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card } from '../components/ui';
import { Dropdown } from '../components/Dropdown';
import { UserPicker } from '../components/UserPicker';
import { colors, radius } from '../theme';
import type { AppUser } from '../types';
import { fetchGroupMemberSet, fetchUsers, fetchUsersWithAuth } from '../services/firebase';
import { matchUser, segmentNeedsAuth, describeSegment, EMPTY_SEGMENT, type SegmentDef } from '../services/segments';
import { listSegments, type SavedSegment } from '../services/savedSegments';
import {
  createCampaign, sendTestCampaign, fetchCampaigns, fetchPushRate, ACTION_LABEL,
  campaignStats,
  type CampaignType, type ActionType, type PushRate, type CampaignInput,
} from '../services/campaigns';
import type { FsDoc } from '../services/firestoreRest';

const ACTIONS: ActionType[] = ['openCommunity', 'openGame', 'openProfile', 'openUrl', 'openScreen', 'dismiss'];

// One column in a campaign-results funnel: a big count, a label, and an
// optional rate (e.g. open-rate under "נפתחו").
function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <View style={s.statBox}>
      <Text style={s.statVal}>{value.toLocaleString()}</Text>
      <Text style={s.statLbl}>{label}</Text>
      {sub ? <Text style={s.statSub}>{sub}</Text> : null}
    </View>
  );
}
function Arrow() {
  // ‹ points right-to-left, the reading direction here.
  return <Text style={s.arrow}>‹</Text>;
}

export function CampaignsScreen() {
  const [tab, setTab] = useState<'create' | 'list'>('create');
  const [type, setType] = useState<CampaignType>('push');
  const [segments, setSegments] = useState<SavedSegment[]>([]);
  const [segId, setSegId] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [audTotal, setAudTotal] = useState<number | null>(null);
  const [calcBusy, setCalcBusy] = useState(false);

  const selectedSeg = segments.find((x) => x.id === segId) ?? null;
  const def: SegmentDef = selectedSeg?.def ?? EMPTY_SEGMENT;

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [btn, setBtn] = useState('');
  const [action, setAction] = useState<ActionType>('dismiss');
  const [actionValue, setActionValue] = useState('');

  const [scheduled, setScheduled] = useState(false);
  const [inHours, setInHours] = useState('1');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [rate, setRate] = useState<PushRate | null>(null);
  const [sending, setSending] = useState(false);
  const [list, setList] = useState<FsDoc[]>([]);

  const reload = async () => {
    setRate(await fetchPushRate().catch(() => null));
    setList(await fetchCampaigns().catch(() => []));
    setSegments(await listSegments().catch(() => []));
  };
  useEffect(() => { reload(); }, []);

  const pickSeg = (id: string | null) => { setSegId(id); setCount(null); setAudTotal(null); };

  const calc = async () => {
    setCalcBusy(true);
    try {
      const needGroup = def.rules.some((r) => r.field === 'inGroup');
      const [users, members] = await Promise.all([
        segmentNeedsAuth(def) ? fetchUsersWithAuth() : fetchUsers(),
        needGroup ? fetchGroupMemberSet() : Promise.resolve(new Set<string>()),
      ]);
      const now = Date.now();
      const real = users.filter((u) => !u.isTest && !u.deleted);
      setCount(real.filter((u) => matchUser(u, def, members, now)).length);
      setAudTotal(real.length);
    } finally { setCalcBusy(false); }
  };

  const content = (): CampaignInput => ({
    type, segment: def, title, body,
    popupTitle: title, popupBody: body, buttonText: btn,
    action: { type: action, value: actionValue || undefined },
  });

  const doSend = async () => {
    setSending(true);
    try {
      const res = await createCampaign({
        ...content(),
        sendAt: scheduled ? Date.now() + (Number(inHours) || 1) * 3600000 : Date.now(),
      });
      if (res.ok) {
        Alert.alert('נוצר', type === 'push' ? (scheduled ? 'הקמפיין תוזמן ✓' : 'הפוש נשלח ✓') : 'הפופ-אפ פעיל ✓');
        setTitle(''); setBody(''); setBtn(''); setActionValue('');
        await reload();
      } else Alert.alert('שגיאה', res.error ?? 'יצירת הקמפיין נכשלה');
    } finally { setSending(false); }
  };

  const onSend = () => {
    if (!title.trim()) { Alert.alert('חסר', 'כתוב כותרת'); return; }
    Alert.alert(
      type === 'push' ? 'לשלוח פוש?' : 'להפעיל פופ-אפ?',
      `"${title}"\nקהל: ${selectedSeg ? selectedSeg.name : 'כל המשתמשים'}${count !== null ? `\nמוערך: ${count}` : ''}`,
      [{ text: 'ביטול', style: 'cancel' }, { text: 'שלח', style: 'destructive', onPress: doSend }],
    );
  };

  const onTest = () => {
    if (!title.trim()) { Alert.alert('חסר', 'כתוב קודם כותרת ותוכן'); return; }
    setPickerOpen(true);
  };
  const doTest = async (u: AppUser) => {
    setTesting(true);
    try {
      const ok = await sendTestCampaign(content(), u.id, u.name);
      Alert.alert(ok ? 'נשלח טסט ✓' : 'שגיאה',
        ok ? (type === 'push' ? `פוש טסט נשלח ל${u.name}` : `פופ-אפ טסט יוצג ל${u.name} בפתיחה הבאה`) : 'נכשל');
      await reload();
    } finally { setTesting(false); }
  };

  function statusEmoji(st: string): string {
    return st === 'sent' ? '✅' : st === 'blocked' ? '🚫' : st === 'error' ? '⚠️' : st === 'active' ? '🟢' : '⏳';
  }

  return (
    <Screen
      title="קמפיינים"
      subtitle="שלח פוש או פופ-אפ לקהל לפי יעד"
      right={<Ionicons name="add" size={26} color={colors.primary} />}
    >
      {/* tabs */}
      <View style={s.tabs}>
        <Pressable style={s.tab} onPress={() => setTab('list')}>
          <Text style={[s.tabTxt, tab === 'list' && s.tabOn]}>הקמפיינים שלי</Text>
          {tab === 'list' ? <View style={s.tabBar} /> : null}
        </Pressable>
        <Pressable style={s.tab} onPress={() => setTab('create')}>
          <Text style={[s.tabTxt, tab === 'create' && s.tabOn]}>יצירת קמפיין</Text>
          {tab === 'create' ? <View style={s.tabBar} /> : null}
        </Pressable>
      </View>

      {tab === 'list' ? (
        list.length === 0 ? (
          <Card><Text style={s.empty}>אין עדיין</Text></Card>
        ) : (
          list.slice(0, 30).map((c) => {
            const st = campaignStats(c);
            const pct = (n: number) => `${Math.round(n * 100)}%`;
            return (
              <Card key={c.id} style={s.resCard}>
                <View style={s.resHead}>
                  <Text style={{ fontSize: 16 }}>{statusEmoji(st.status)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.histName} numberOfLines={1}>
                      {st.type === 'push' ? '📲 ' : '🪧 '}{String(c.title || c.popupTitle || '—')}
                      {st.isTest ? '  · טסט' : ''}
                    </Text>
                    <Text style={s.histSub} numberOfLines={1}>{describeSegment(c.segment)}</Text>
                  </View>
                </View>

                {/* funnel — push: קהל → נשלחו → נפתחו | popup: ראו → לחצו */}
                <View style={s.funnel}>
                  {st.type === 'push' ? (
                    <>
                      <Stat label="בקהל" value={st.matched} />
                      <Arrow />
                      <Stat label="נשלחו" value={st.delivered} />
                      <Arrow />
                      <Stat label="נפתחו" value={st.opens} sub={st.delivered > 0 ? pct(st.openRate) : undefined} />
                    </>
                  ) : (
                    <>
                      <Stat label="ראו" value={st.impressions} />
                      <Arrow />
                      <Stat label="לחצו" value={st.clicks} sub={st.impressions > 0 ? pct(st.ctr) : undefined} />
                      <Arrow />
                      <Stat label="סגרו" value={st.dismisses} />
                    </>
                  )}
                </View>
                {c.blockReason ? <Text style={s.blockTxt}>🚫 {String(c.blockReason)}</Text> : null}
              </Card>
            );
          })
        )
      ) : (
        <>
          {/* type */}
          <Text style={s.section}>סוג קמפיין</Text>
          <View style={s.typeRow}>
            <Pressable style={[s.typeCard, type === 'push' && s.typeOn]} onPress={() => setType('push')}>
              <Ionicons name="notifications" size={20} color={type === 'push' ? colors.primary : colors.textSoft} />
              <Text style={[s.typeTxt, type === 'push' && { color: colors.primary }]}>פוש (התראה)</Text>
            </Pressable>
            <Pressable style={[s.typeCard, type === 'popup' && s.typeOn]} onPress={() => setType('popup')}>
              <Ionicons name="albums" size={20} color={type === 'popup' ? colors.primary : colors.textSoft} />
              <Text style={[s.typeTxt, type === 'popup' && { color: colors.primary }]}>פופ-אפ</Text>
            </Pressable>
          </View>

          {/* audience */}
          <Text style={s.section}>קהל יעד</Text>
          <Dropdown
            title="בחר קהל"
            options={[{ value: '', label: 'כל המשתמשים' }, ...segments.map((seg) => ({ value: seg.id, label: `${seg.name}${seg.audience != null ? `  ·  ${seg.audience}` : ''}` }))]}
            value={segId ?? ''}
            onSelect={(v) => pickSeg(v || null)}
          />
          <Pressable style={s.calcLink} onPress={calc}>
            {calcBusy ? <ActivityIndicator color={colors.primary} size="small" /> : (
              <Text style={s.calcLinkTxt}>
                {count !== null
                  ? `${count.toLocaleString()} מקבלים${audTotal ? ` · ${Math.round((count / Math.max(audTotal, 1)) * 100)}% מ-${audTotal.toLocaleString()}` : ''}`
                  : 'חשב כמה יקבלו'}
              </Text>
            )}
          </Pressable>

          {/* content */}
          <Text style={s.section}>תוכן</Text>
          <Card style={{ gap: 8 }}>
            <TextInput style={s.input} placeholder="כותרת" placeholderTextColor={colors.textMuted} value={title} onChangeText={setTitle} />
            <TextInput style={[s.input, { minHeight: 64 }]} placeholder="טקסט" placeholderTextColor={colors.textMuted} value={body} onChangeText={setBody} multiline />
          </Card>

          {/* popup: settings + preview (two columns) */}
          {type === 'popup' ? (
            <>
              <Text style={s.section}>פופ-אפ — הגדרות</Text>
              <View style={s.twoCol}>
                <View style={s.colRight}>
                  <Text style={s.miniLbl}>טקסט כפתור</Text>
                  <TextInput style={s.input} placeholder="הצטרף עכשיו" placeholderTextColor={colors.textMuted} value={btn} onChangeText={setBtn} />
                  <Text style={s.miniLbl}>פעולת הכפתור</Text>
                  <Dropdown title="פעולה" options={ACTIONS.map((a) => ({ value: a, label: ACTION_LABEL[a] }))} value={action} onSelect={(v) => setAction(v as ActionType)} />
                  {action !== 'dismiss' ? (
                    <TextInput style={s.input} placeholder={action === 'openUrl' ? 'קישור' : action === 'openScreen' ? 'שם מסך' : 'מזהה'} placeholderTextColor={colors.textMuted} value={actionValue} onChangeText={setActionValue} />
                  ) : null}
                </View>
                <View style={s.colLeft}>
                  <View style={s.pv}>
                    <Text style={s.pvX}>✕</Text>
                    <Text style={s.pvIcon}>⚽</Text>
                    <Text style={s.pvTitle} numberOfLines={2}>{title || 'כותרת הפופ-אפ'}</Text>
                    <Text style={s.pvBody} numberOfLines={2}>{body || 'הטקסט יוצג כאן'}</Text>
                    <View style={s.pvBtn}><Text style={s.pvBtnTxt} numberOfLines={1}>{btn || 'הבנתי'}</Text></View>
                  </View>
                </View>
              </View>
            </>
          ) : null}

          {/* schedule */}
          <Text style={s.section}>תזמון</Text>
          <View style={s.typeRow}>
            <Pressable style={[s.schedCard, !scheduled && s.typeOn]} onPress={() => setScheduled(false)}>
              <Text style={[s.typeTxt, !scheduled && { color: colors.primary }]}>שליחה עכשיו</Text>
            </Pressable>
            <Pressable style={[s.schedCard, scheduled && s.typeOn]} onPress={() => setScheduled(true)}>
              <Ionicons name="calendar-outline" size={16} color={scheduled ? colors.primary : colors.textSoft} />
              <Text style={[s.typeTxt, scheduled && { color: colors.primary }]}>תזמון</Text>
            </Pressable>
          </View>
          {scheduled ? (
            <View style={s.hoursRow}>
              <Text style={s.miniLbl}>בעוד</Text>
              <TextInput style={s.num} keyboardType="number-pad" value={inHours} onChangeText={setInHours} />
              <Text style={s.miniLbl}>שעות</Text>
            </View>
          ) : null}

          {/* safety */}
          {type === 'push' ? (
            <View style={s.safety}>
              <Text style={s.safetyHead}>מגבלות בטיחות</Text>
              <View style={s.safetyRow}><Ionicons name="checkmark-circle" size={15} color={colors.green} /><Text style={s.safetyTxt}>כל משתמש מקבל מקסימום פוש אחד ביום</Text></View>
              <View style={s.safetyRow}><Ionicons name="checkmark-circle" size={15} color={colors.green} /><Text style={s.safetyTxt}>אי אפשר לתזמן שני פושים לאותו זמן</Text></View>
            </View>
          ) : null}

          <Pressable style={[s.send, sending && { opacity: 0.6 }]} onPress={onSend} disabled={sending}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={s.sendTxt}>{type === 'push' ? (scheduled ? 'תזמן קמפיין' : 'שלח קמפיין עכשיו') : 'הפעל פופ-אפ'}</Text>}
          </Pressable>
          <Pressable style={[s.testBtn, testing && { opacity: 0.6 }]} onPress={onTest} disabled={testing}>
            {testing ? <ActivityIndicator color={colors.primary} /> : (<><Ionicons name="flask" size={17} color={colors.primary} /><Text style={s.testTxt}>שלח טסט למשתמש</Text></>)}
          </Pressable>
          <UserPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={doTest} />
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row-reverse', borderBottomWidth: 1, borderBottomColor: colors.border, marginBottom: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  tabTxt: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  tabOn: { color: colors.primary },
  tabBar: { height: 2, backgroundColor: colors.primary, alignSelf: 'stretch', marginTop: 8, borderRadius: 2 },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'right', marginTop: 12, marginBottom: 6 },
  typeRow: { flexDirection: 'row-reverse', gap: 10 },
  typeCard: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 16 },
  schedCard: { flex: 1, flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 13 },
  typeOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft + '22' },
  typeTxt: { color: colors.textSoft, fontSize: 14, fontWeight: '700' },
  calcLink: { alignSelf: 'flex-start', paddingVertical: 6 },
  calcLinkTxt: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  input: { color: colors.text, fontSize: 14, textAlign: 'right', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10 },
  twoCol: { flexDirection: 'row-reverse', gap: 10 },
  colRight: { flex: 1, gap: 6 },
  colLeft: { flex: 1, justifyContent: 'center' },
  miniLbl: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  pv: { backgroundColor: '#fff', borderRadius: 16, padding: 12, gap: 4, alignItems: 'center' },
  pvX: { alignSelf: 'flex-start', color: '#9CA3AF', fontSize: 13 },
  pvIcon: { fontSize: 26 },
  pvTitle: { color: '#111827', fontSize: 14, fontWeight: '800', textAlign: 'center' },
  pvBody: { color: '#6B7280', fontSize: 11, textAlign: 'center' },
  pvBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 14, alignSelf: 'stretch', alignItems: 'center' },
  pvBtnTxt: { color: '#fff', fontSize: 12, fontWeight: '800' },
  hoursRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, marginTop: 8 },
  num: { width: 56, textAlign: 'center', color: colors.text, fontSize: 15, fontWeight: '700', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingVertical: 8 },
  safety: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 12, marginTop: 12, gap: 6 },
  safetyHead: { color: colors.textSoft, fontSize: 12, fontWeight: '800', textAlign: 'right' },
  safetyRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  safetyTxt: { color: colors.textMuted, fontSize: 12, flex: 1, textAlign: 'right' },
  send: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 15, alignItems: 'center', marginTop: 14 },
  sendTxt: { color: '#fff', fontSize: 16, fontWeight: '800' },
  testBtn: { flexDirection: 'row-reverse', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  testTxt: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  empty: { color: colors.textMuted, textAlign: 'center', paddingVertical: 14 },
  histRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  histName: { color: colors.text, fontSize: 14, fontWeight: '600', textAlign: 'right' },
  histSub: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 1 },
  // results cards
  resCard: { gap: 12, marginBottom: 10 },
  resHead: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  funnel: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  statBox: { flex: 1, alignItems: 'center', gap: 1 },
  statVal: { color: colors.text, fontSize: 20, fontWeight: '700' },
  statLbl: { color: colors.textMuted, fontSize: 11 },
  statSub: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  arrow: { color: colors.textMuted, fontSize: 18, paddingHorizontal: 2 },
  blockTxt: { color: colors.textMuted, fontSize: 12, textAlign: 'right' },
});
