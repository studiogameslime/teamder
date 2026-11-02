import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../components/ui';
import { HomeActionPanel } from '../components/HomeActionPanel';
import { colors, font, isolateText, radius, RTL_LABEL_ALIGN } from '../theme';
import { fetchHomeDashboard, homeDayStart, setClubContact, setClubFollowUp, type HomeClub, type HomeDashboard } from '../services/homeDashboard';
import { fetchHomeActions, type HomeActions } from '../services/homeActions';
import { getDoc } from '../services/firestoreRest';
import { observeCaughtError, observeSettledErrors } from '../services/errorObservation';

const DATE_OPTIONS = { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' } as const;
const clock = (at: number) => new Date(at).toLocaleTimeString('he-IL', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit' });

function Metric({ label, value, detail, icon, onPress }: {
  label: string; value: number | null; detail: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value === null ? 'לא זמין' : value}`} onPress={onPress} style={s.metric}>
    <View style={s.row}><Text style={[s.small, { flex: 1 }]}>{label}</Text><Ionicons name={icon} size={18} color={colors.textMuted}/></View>
    <Text style={s.value}>{value === null ? 'לא זמין' : value.toLocaleString('he-IL')}</Text><Text style={s.hint}>{detail}</Text>
  </Pressable>;
}

export function HomeScreen() {
  const nav = useNavigation<any>();
  const [data, setData] = useState<HomeDashboard | null>(null);
  const [actions, setActions] = useState<HomeActions | null>(null);
  const [actionPeople, setActionPeople] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showContacted, setShowContacted] = useState(false);
  const [limit, setLimit] = useState(20);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const savingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const load = useCallback(async (force = false) => {
    if (savingRef.current) return;
    const request = ++generation.current;
    setLoading(true); setFailed(false);
    try {
      const results = await Promise.allSettled([
        fetchHomeDashboard(force).then(result => { if (mounted.current && request === generation.current) { setData(result); if (result.clubs) setSaveError(null); } }),
        fetchHomeActions(force).then(result => { if (mounted.current && request === generation.current) setActions(result); }),
      ]).then(results => observeSettledErrors(results, { source: 'pulse/src/screens/HomeScreen.tsx', handler: 'load', site: 'HomeScreen:sections' }));
      if (mounted.current && request === generation.current) {
        if (results[0].status === 'rejected') setData(null);
        if (results[1].status === 'rejected') setActions(null);
        if (results.some(result => result.status === 'rejected')) setFailed(true);
      }
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/screens/HomeScreen.tsx', handler: 'load', site: 'HomeScreen:load' });
      if (mounted.current && request === generation.current) { setFailed(true); setData(null); }
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => void load(true), 60_000);
    return () => { clearInterval(timer); generation.current++; };
  }, [load]));

  const clubs = data?.clubs?.rows ?? [];
  const pending = clubs.filter(c => !c.contactedAt).length;
  const filtered = clubs.filter(c => !!c.contactedAt === showContacted);
  const visible = filtered.slice(0, limit);
  const organizers = useMemo(() => [...new Set([...visible.flatMap(c => c.organizerId ? [c.organizerId] : []), ...actionPeople])], [data?.clubs, showContacted, limit, actionPeople]);
  const organizerKey = organizers.join('|');
  useEffect(() => {
    let alive = true;
    const missing = organizers.filter(id => !names[id]);
    void Promise.allSettled(missing.map(id => getDoc(`users/${id}`, ['name']))).then(results => observeSettledErrors(results, {
      source: 'pulse/src/screens/HomeScreen.tsx', handler: 'names', site: 'HomeScreen:names',
    })).then(results => {
      if (!alive) return;
      const found: Record<string, string> = {};
      results.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) found[missing[index]] = typeof result.value.name === 'string' ? result.value.name : 'שם לא תועד';
      });
      setNames(prev => ({ ...prev, ...found }));
    });
    return () => { alive = false; };
  }, [organizerKey, data?.clubs?.at]);

  const save = async (club: HomeClub, followUp = false) => {
    if (savingRef.current || loading || !club.organizerId) return;
    savingRef.current = true; setSaving(club.id); setSaveError(null); setNotice(null);
    // A refresh started earlier must not overwrite a verified acknowledgement.
    generation.current++;
    try {
      const contact = followUp ? await setClubFollowUp(club) : await setClubContact(club, !club.contactedAt);
      if (!mounted.current) return;
      setData(prev => prev?.clubs ? { ...prev, clubs: { ...prev.clubs, rows: prev.clubs.rows.map(row => row.id === club.id ? { ...row, contactedAt: contact.contactedAt, lastFollowUpAt: contact.lastFollowUpAt ?? null } : row) } } : prev);
      setNotice(followUp ? 'נשמר שבדקת שוב היום. לא נשלחה הודעה מתוך המסך.' : contact.contactedAt ? 'הפנייה סומנה ונשמרה. לא נשלחה הודעה מתוך המסך.' : 'הסימון בוטל והמועדון חזר לרשימת הממתינים.');
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/screens/HomeScreen.tsx', handler: 'save', site: 'HomeScreen:save' });
      if (mounted.current) setSaveError('שמירת הסימון לא אומתה. רעננו לפני ניסיון נוסף. ייתכן שהמארגן השתנה או שהחיבור נכשל.');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(null);
    }
  };

  const today = homeDayStart(Date.now());
  const dailyValue = (section: HomeDashboard['people']) => section && homeDayStart(section.at) === today ? section.count : null;
  const changeFilter = (contacted: boolean) => { setShowContacted(contacted); setLimit(20); };
  const hasError = failed || !!data?.failed.length || !!actions?.failed.length;
  return <Screen title="תמונת מצב" subtitle="הפעילות עכשיו והאנשים שכדאי ללוות" right={loading ? <ActivityIndicator color={colors.primary}/> : undefined}
    refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load(true)} tintColor={colors.primary}/>}>
    <Text style={s.hint}>{new Date().toLocaleDateString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'long' })}{data ? ` · נבדק ב־${clock(data.at)}` : ''}</Text>
    {hasError ? <View style={s.errorBox}><Text style={s.error}>חלק מהנתונים לא נטענו. נתון חסר אינו אפס.</Text><Pressable accessibilityRole="button" onPress={() => void load(true)} style={s.linkButton}><Text style={s.link}>ניסיון נוסף</Text></Pressable></View> : null}
    <View style={s.grid}>
      <Metric label="מחזורים עם רשומים" value={data?.rounds?.withRegistrations ?? null} detail="קרובים או מתנהלים, עם שחקן אחד לפחות" icon="calendar-outline" onPress={() => nav.navigate('Games', { screen: 'GamesList' })}/>
      <Metric label="רשומים למחזורים" value={data?.rounds?.registered ?? null} detail="סך ההרשמות לכל המחזורים האלה" icon="people-outline" onPress={() => nav.navigate('Games', { screen: 'GamesList' })}/>
      <Metric label="נרשמו היום" value={dailyValue(data?.signups ?? null)} detail="אנשים חדשים מאז חצות בישראל" icon="person-add-outline" onPress={() => nav.navigate('Users', { screen: 'NewPeople' })}/>
      <Metric label="התחברו היום" value={dailyValue(data?.people ?? null)} detail="אנשים עם פעילות מתועדת היום" icon="log-in-outline" onPress={() => nav.navigate('Users', { screen: 'UsersList' })}/>
    </View>
    {saveError ? <Text accessibilityRole="alert" style={s.error}>{saveError}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={s.link}>{notice}</Text> : null}
    <HomeActionPanel actions={actions} clubs={data?.clubs?.rows ?? null} names={names} onPeopleChange={setActionPeople} onFollowUp={club => void save(club, true)} saving={saving} blocked={loading || !!saveError}/>
    <View style={s.row}><Text style={[font.h2, { flex: 1 }]}>מועדונים שממתינים לפנייה</Text><View style={s.badge}><Text style={s.badgeText}>{data?.clubs ? `${pending} ממתינים` : 'לא זמין'}</Text></View></View>
    <Text style={s.small}>מועדונים שנוצרו מ־1.11.2026 וטרם סומנה פנייה למארגן שלהם. המעקב נשמר גם בימים הבאים.</Text>
    <View style={s.row}>{[{ label: 'ממתינים', value: false }, { label: 'כבר פניתי', value: true }].map(tab => <Pressable key={tab.label} accessibilityRole="button" accessibilityState={{ selected: showContacted === tab.value }} onPress={() => changeFilter(tab.value)} style={[s.filter, showContacted === tab.value && s.selected]}><Text style={[s.small, showContacted === tab.value && { color: colors.primary }]}>{tab.label}</Text></Pressable>)}</View>
    {!data?.clubs ? <Text style={s.small}>{loading ? 'טוען את המועדונים ואת סימוני הפנייה.' : 'המועדונים או סימוני הפנייה לא נטענו. אין אפשרות לסמן עד לטעינה מוצלחת.'}</Text> : null}
    {data?.clubs && !filtered.length ? <View style={s.club}><Text style={s.small}>{showContacted ? 'עדיין לא סומנו פניות למועדונים.' : 'אין מועדונים שממתינים לסימון פנייה.'}</Text></View> : null}
    {visible.map(club => <View key={club.id} style={s.club}>
      <View style={s.row}><View style={s.clubIcon}><Ionicons name="flag-outline" size={20} color={colors.textSoft}/></View><View style={{ flex: 1, gap: 3 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`פרטי המועדון ${club.name}`} onPress={() => nav.navigate('Clubs', { screen: 'ClubDetail', params: { groupId: club.id } })}><Text style={s.clubName}>{isolateText(club.name)}</Text></Pressable>
        {club.organizerId ? <Pressable accessibilityRole="button" accessibilityLabel={`פרטי המארגן של ${club.name}`} onPress={() => nav.navigate('Users', { screen: 'UserDetail', params: { userId: club.organizerId } })}><Text style={s.small}>מארגן: {isolateText(names[club.organizerId] ?? 'שם לא נטען')} ←</Text></Pressable> : <Text style={s.small}>מארגן לא תועד</Text>}
      </View></View>
      <View style={s.row}><Text style={[s.hint, { flex: 1 }]}>נוצר ב־{new Date(club.createdAt).toLocaleDateString('he-IL', DATE_OPTIONS)} · {club.members} חברים{club.city ? ` · ${isolateText(club.city)}` : ''}</Text><Text style={[s.status, club.contactedAt ? { color: colors.primary } : null]}>{club.contactedAt ? `פניתי ב־${new Date(club.contactedAt).toLocaleDateString('he-IL', DATE_OPTIONS)}` : 'טרם סומנה פנייה'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${club.contactedAt ? 'ביטול סימון פנייה' : 'סימון ששלחתי הודעה'}: ${club.name}`} disabled={!!saving || loading || !club.organizerId || !!saveError} onPress={() => void save(club)} style={[s.contact, (!!saving || loading || !club.organizerId || !!saveError) && { opacity: .5 }]}><Text style={s.contactText}>{saving === club.id ? 'שומר ומאמת' : club.contactedAt ? 'ביטול סימון הפנייה' : 'סימון ששלחתי הודעה'}</Text></Pressable>
    </View>)}
    {filtered.length > limit ? <Pressable accessibilityRole="button" onPress={() => setLimit(v => v + 20)} style={s.linkButton}><Text style={s.link}>הצגת מועדונים נוספים</Text></Pressable> : null}
    <Text style={s.hint}>הסימון מתעד פנייה שביצעת בעצמך ואינו שולח הודעה. פניות קודמות אינן מזוהות אוטומטית. פעילות היום מבוססת על דיווח הנוכחות באפליקציה, שמתעדכן לכל היותר פעם ב־6 שעות; אין כאן מדידה מלאה של כל כניסה.</Text>
  </Screen>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  grid: { flexDirection: 'row', direction: 'rtl', flexWrap: 'wrap', gap: 10 },
  metric: { flexBasis: '47%', flexGrow: 1, minWidth: 0, borderRadius: radius.md, padding: 14, gap: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  value: { fontSize: 30, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  small: { ...font.small, fontSize: 12 },
  hint: { ...font.small, fontSize: 11 },
  club: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  clubIcon: { width: 36, height: 36, backgroundColor: colors.surfaceAlt, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  clubName: { ...font.title },
  status: { ...font.small, fontSize: 11, color: colors.amber },
  badge: { backgroundColor: colors.surfaceAlt, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { ...font.small, fontSize: 12, color: colors.amber },
  filter: { borderRadius: 9, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', backgroundColor: colors.surface },
  selected: { backgroundColor: colors.primarySoft },
  contact: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, backgroundColor: colors.primarySoft, alignSelf: 'flex-start' },
  contactText: { ...font.small, color: colors.primary, fontSize: 12, fontWeight: '700' },
  link: { ...font.small, color: colors.primary },
  linkButton: { minHeight: 44, justifyContent: 'center' },
  error: { ...font.small, color: colors.red },
  errorBox: { gap: 4 },
});
