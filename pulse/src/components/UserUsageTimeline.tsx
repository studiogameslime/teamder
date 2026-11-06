import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Text, View } from 'react-native';
import { Dropdown } from './Dropdown';
import { colors, font, RTL_LABEL_ALIGN } from '../theme';
import { fetchUsageVisits, fetchUsageEvents, fetchUsageCoverage, UsageVisit, UsageRow, UsagePage, UsageCursor, usageCutoff, usageTime } from '../services/usageActivity';
import { usageLabel } from '../services/usageActivityCatalog';
import { observeCaughtError } from '../services/errorObservation';

type EventPage = UsagePage<UsageRow> & { loading?: boolean; failed?: boolean };
type State = { uid: string; period: string; page?: UsagePage<UsageVisit>; coverage?: Awaited<ReturnType<typeof fetchUsageCoverage>>; failed?: boolean; loading?: boolean; pending?: UsagePage<UsageVisit>; loadingMore?: boolean };
const body = { ...font.body, textAlign: RTL_LABEL_ALIGN };
const small = { ...font.small, textAlign: RTL_LABEL_ALIGN };
const fingerprint = (p: UsagePage<UsageVisit>) => JSON.stringify(p.rows.slice(0, 20).map(v => [v.id, v.updatedAt, v.eventCount, v.partial]));
const empty = (): EventPage => ({ rows: [], cursor: null, fetchedAt: 0 });

/** Usage loads independently from the heavy business card; inactive panels do no polling. */
export function UserUsageTimeline({ userId, active, onTarget }: { userId: string; active: boolean; onTarget: (row: UsageRow) => void }) {
  const [period, setPeriod] = useState('today'), [filter, setFilter] = useState('all');
  const [state, setState] = useState<State>({ uid: userId, period, loading: true });
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [events, setEvents] = useState<Record<string, EventPage>>({});
  const [detail, setDetail] = useState<string | null>(null);
  const generation = useRef(0), request = useRef(0);
  const load = useCallback(async (manual = false) => {
    const version = manual ? ++generation.current : generation.current, number = ++request.current;
    try {
      const [page, coverage] = await Promise.all([fetchUsageVisits(userId, usageCutoff(period)), fetchUsageCoverage(userId)]);
      if (version !== generation.current || number !== request.current) return;
      setState(old => {
        if (old.uid !== userId || old.period !== period || !old.page || manual) return { uid: userId, period, page, coverage };
        return { ...old, coverage, failed: false, loading: false, pending: fingerprint(old.page) !== fingerprint(page) ? page : old.pending, page: { ...old.page, fetchedAt: page.fetchedAt } };
      });
      if (manual) { setEvents({}); setOpened({}); }
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/components/UserUsageTimeline.tsx', handler: 'load', site: 'usage:visits' });
      if (version === generation.current && number === request.current) setState(old => ({ ...old, failed: true, loading: false }));
    }
  }, [userId, period]);
  useEffect(() => {
    generation.current++; request.current++;
    setState({ uid: userId, period, loading: true }); setEvents({}); setOpened({}); setDetail(null);
    return () => { generation.current++; request.current++; };
  }, [userId, period]);
  useEffect(() => {
    if (!active) return;
    void load();
    const timer = setInterval(() => { if (AppState.currentState === 'active') void load(); }, 15_000);
    return () => { clearInterval(timer); request.current++; };
  }, [active, load]);
  const current = state.uid === userId && state.period === period ? state : { uid: userId, period, loading: true } as State;
  const loadEvents = async (visit: UsageVisit, cursor?: UsageCursor | null) => {
    const version = generation.current;
    setEvents(old => ({ ...old, [visit.id]: { ...(old[visit.id] ?? empty()), loading: true, failed: false } }));
    try {
      const next = await fetchUsageEvents(userId, visit.visitId, cursor);
      if (version !== generation.current) return;
      setEvents(old => ({ ...old, [visit.id]: { ...next, rows: cursor ? [...old[visit.id].rows, ...next.rows] : next.rows } }));
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/components/UserUsageTimeline.tsx', handler: 'loadEvents', site: 'usage:events' });
      if (version === generation.current) setEvents(old => ({ ...old, [visit.id]: { ...old[visit.id], failed: true, loading: false } }));
    }
  };
  const more = async () => {
    const page = current.page; if (!page?.cursor || current.loadingMore) return;
    const version = generation.current;
    setState(old => ({ ...old, loadingMore: true }));
    try {
      const next = await fetchUsageVisits(userId, usageCutoff(period), page.cursor);
      if (version !== generation.current) return;
      setState(old => ({ ...old, loadingMore: false, failed: false, page: { ...next, rows: [...page.rows, ...next.rows] } }));
    } catch (error) {
      observeCaughtError(error, { source: 'pulse/src/components/UserUsageTimeline.tsx', handler: 'more', site: 'usage:more' });
      if (version === generation.current) setState(old => ({ ...old, loadingMore: false, failed: true }));
    }
  };
  return <View style={{ gap: 14 }}>
    <Text style={{ ...font.h2, textAlign: RTL_LABEL_ALIGN }}>ביקורים באפליקציה</Text>
    <Text style={small}>פתיחת מסך היא דיווח מהאפליקציה. היא אינה הוכחה לקריאת התוכן.</Text>
    <View style={{ flexDirection: 'row', direction: 'rtl', gap: 10 }}>
      <Dropdown outlined flex={1} title="תקופה" value={period} onSelect={setPeriod} options={[{ value: 'today', label: 'היום' }, { value: 'week', label: 'שבוע' }, { value: 'month', label: 'שלושים יום' }, { value: 'quarter', label: 'תשעים יום, עם סיכומים' }]}/>
      <Dropdown outlined flex={1} title="סוג פעילות" value={filter} onSelect={setFilter} options={[{ value: 'all', label: 'כל הפעילות' }, { value: 'screens', label: 'כניסות ומסכים' }, { value: 'actions', label: 'פעולות באפליקציה' }]}/>
    </View>
    {current.loading ? <ActivityIndicator color={colors.primary}/> : null}
    {current.page ? <Text style={small}>פעילות אחרונה שתועדה: {current.page.rows[0] ? usageTime(current.page.rows[0].lastActivityAt, true) : 'לא תועדה בטווח'}. הנתונים עודכנו: {usageTime(current.page.fetchedAt)}. השעות לפי ירושלים.</Text> : null}
    <Text style={small}>{current.coverage?.enabled === false ? 'האיסוף כבוי עבור המשתמש לפי הדיווח האחרון.' : current.coverage?.enabled === true ? `האיסוף נתמך בגרסה שדיווחה לאחרונה. אין מכך הוכחה לכל המכשירים.` : 'מצב כיסוי האיסוף אינו ידוע. ייתכן שהגרסה אינה תומכת או שהאיסוף טרם הופעל.'}</Text>
    <Pressable accessibilityRole="button" onPress={() => void load(true)}><Text style={{ ...body, color: colors.primary }}>רענון הפעילות</Text></Pressable>
    {current.failed ? <Text style={{ ...body, color: colors.red }}>קריאת הפעילות נכשלה. המידע הקודם נשמר. אפשר לנסות לרענן.</Text> : null}
    {current.pending ? <Pressable accessibilityRole="button" onPress={() => { generation.current++; setState(old => ({ ...old, page: old.pending, pending: undefined })); setEvents({}); setOpened({}); }}><Text style={{ ...body, color: colors.primary }}>יש עדכוני פעילות. לחצו להצגה.</Text></Pressable> : null}
    {current.page && !current.page.rows.length ? <Text style={body}>לא תועדה פעילות בטווח שנבחר. היעדר תיעוד אינו הוכחה שלא היה שימוש.</Text> : null}
    {current.page?.rows.map(visit => {
      const entry = events[visit.id];
      const summaryOnly = Date.now() - visit.lastActivityAt > 30 * 86400000;
      const rows = (entry?.rows ?? []).filter(e => e.receivedAt >= Date.now() - 30 * 86400000 && e.sortAt >= usageCutoff(period) && (filter === 'all' || (filter === 'screens' ? ['screen_view', 'app_opened', 'app_returned'].includes(e.action) : e.action.startsWith('registration_'))));
      return <View key={visit.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 10 }}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: !!opened[visit.id] }} onPress={() => { setOpened(old => ({ ...old, [visit.id]: !old[visit.id] })); if (!entry && !summaryOnly) void loadEvents(visit); }}>
          <Text style={{ ...font.title, textAlign: RTL_LABEL_ALIGN }}>{usageTime(visit.startedAt, true)}. {visit.screenEntries === 1 ? 'כניסה אחת למסך' : `${visit.screenEntries ?? 0} כניסות למסכים`}, {visit.distinctGames === 1 ? 'מחזור שונה אחד' : `${visit.distinctGames ?? 0} מחזורים שונים`}</Text>
          <Text style={small}>{visit.confirmedRegistrations === 1 ? 'הרשמה אחת אושרה' : visit.confirmedRegistrations ? `${visit.confirmedRegistrations} הרשמות שאושרו` : 'לא תועדה הרשמה מאומתת בביקור'}{visit.waitlistRegistrations ? visit.waitlistRegistrations === 1 ? ', הרשמה אחת לרשימת המתנה' : `, ${visit.waitlistRegistrations} לרשימת המתנה` : ''}</Text>
          <Text style={small}>{visit.partial ? 'התיעוד בביקור חלקי. ' : ''}פעילות אחרונה: {usageTime(visit.lastActivityAt)}. {opened[visit.id] ? 'סגירת הביקור' : 'פתיחת הביקור'}</Text>
        </Pressable>
        {opened[visit.id] ? <View style={{ gap: 14 }}>
          <Text style={small}>הסיכום מתייחס לכל הביקור. האירועים מוצגים לפי הסינון ובדפים של עד חמישים.</Text>
          <Text style={small}>מסכים שונים: {visit.distinctScreens ?? 0}. מועדונים שונים: {visit.distinctGroups ?? 0}.</Text>
          {summaryOnly ? <Text style={small}>הפירוט פג. נשמר סיכום הביקור בלבד.</Text> : null}
          {entry?.loading ? <ActivityIndicator color={colors.primary}/> : null}
          {entry?.failed ? <Pressable onPress={() => void loadEvents(visit, entry.cursor)}><Text style={{ ...body, color: colors.red }}>טעינת האירועים נכשלה. ניסיון חוזר.</Text></Pressable> : null}
          {entry && !entry.loading && !entry.failed && !rows.length ? <Text style={small}>{Date.now() - visit.lastActivityAt > 30 * 86400000 ? 'הפירוט פג. נשמר סיכום הביקור בלבד.' : 'אין אירועים שהתקבלו בסינון ובדף שנטען.'}</Text> : null}
          {rows.map(row => <View key={row.id} style={{ gap: 5 }}>
            <Pressable accessibilityRole="button" onPress={() => setDetail(detail === row.id ? null : row.id)}><Text style={body}>{usageTime(row.sortAt)}. {usageLabel(row)}</Text></Pressable>
            {detail === row.id ? <View style={{ gap: 5 }}>
              <Text style={small}>מקור: {row.source === 'server' ? 'פעולה מאומתת בשרת' : 'דיווח אפליקציה'}. התרחשות: {usageTime(row.occurredAt, true)}. קליטה: {usageTime(row.receivedAt, true)}.</Text>
              {row.timeQuality === 'unreliable' ? <Text style={small}>שעון המכשיר אינו אמין. סדר האירועים בביקור נקבע לפי המספר הסידורי.</Text> : null}
              {row.registrationState === 'unknown' ? <Text style={small}>השרת אישר את המצב, אך אין הוכחה שנוצרה הרשמה חדשה בניסיון הזה. היא אינה מוסיפה למונה ההרשמות.</Text> : null}
              {row.receivedAt - row.occurredAt > 30_000 ? <Text style={small}>האירוע נמסר בעיכוב.</Text> : null}
              {row.labelStatus !== 'resolved' && (row.gameId || row.groupId) ? <Text style={small}>שם היעד חסר או שאינו זמין בהרשאה המתאימה.</Text> : null}
              {row.gameId || row.groupId || row.playerId ? <Pressable onPress={() => onTarget(row)}><Text style={{ ...body, color: colors.primary }}>בדיקת היעד הקשור</Text></Pressable> : null}
            </View> : null}
          </View>)}
          {entry?.cursor ? <Pressable disabled={entry.loading} onPress={() => void loadEvents(visit, entry.cursor)}><Text style={{ ...body, color: colors.primary }}>נטענו {entry.rows.length} אירועים. טעינת אירועים נוספים.</Text></Pressable> : null}
        </View> : null}
      </View>;
    })}
    {current.page?.cursor ? <Pressable disabled={current.loadingMore} onPress={() => void more()}><Text style={{ ...body, color: colors.primary }}>מוצגים {current.page.rows.length} ביקורים. טעינת ביקורים נוספים.</Text></Pressable> : null}
  </View>;
}
