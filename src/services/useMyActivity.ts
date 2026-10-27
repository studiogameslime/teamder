import { SPORTS_ACTIVITY_ENABLED } from '@/config/sportsActivity';
import { activityProvider, matchesActivityProvider } from '@/utils/activityProviders';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, NativeModules, Platform } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { randomUUID } from 'expo-crypto';
import type { MyActivityMetrics, MyActivityStatus } from '@/components/activity/MyActivityDashboard';
import { useUserStore } from '@/store/userStore';
import { caughtErrorOrigin, observeCaughtError } from '@/utils/errorObservation';
import { isStaleSession } from './staleSession';
import { getMyActivityState, setMyActivitySource, saveMyActivityRecords, flushMyActivity,
  type MyActivityState, type MyActivitySource, type MyActivityKind } from './myActivityService';
import { ActivityHealthError, discoverActivityHealthOrigins, readActivityHealthWindow, requestActivityHealthPermissions } from './myActivityHealthConnect';

interface ActivityDevice { deviceId: string; sourceId: string; label: string; connected: boolean }
interface SourceOption { id: string; label: string; detail: string; kind: MyActivityKind; sourceId: string }
interface ActivityBridge {
  getActivityReaderInstallationId?(): Promise<string>;
  getActivityDevices?(): Promise<ActivityDevice[]>;
}
interface ViewState { uid: string; state: MyActivityState | null; sources: SourceOption[]; error: string | null; updatedAt: number | null; dayFrom: number | null }
const keyFor = (kind: MyActivityKind, sourceId: string) => `${kind}:${sourceId}`;
const bridge = () => Platform.OS === 'android' ? NativeModules.WatchBridge as ActivityBridge | undefined : undefined;
const empty = (uid: string): ViewState => ({ uid, state: null, sources: [], error: null, updatedAt: null, dayFrom: null });
function sourceOption(source: MyActivitySource): SourceOption {
  return { id: keyFor(source.kind, source.sourceId), sourceId: source.sourceId, kind: source.kind,
    label: activityProvider(source.sourceId, source.kind).label,
    detail: source.kind === 'wear-health-services' ? 'מדידה שמתחילים ומסיימים בשעון' : 'ייבוא מהמקור שנבחר במאגר הבריאות בטלפון' };
}
export function myActivityDayKey(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function moveDay(day: string, offset: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return myActivityDayKey(new Date(year, month - 1, date + offset, 12).getTime());
}
/** Local midnight-to-midnight handles 23/25-hour days, never a fixed UTC day. */
export function myActivityDayRange(now = Date.now(), selectedDay = myActivityDayKey(now)): { from: number; to: number } {
  const [year, month, date] = selectedDay.split('-').map(Number);
  const from = new Date(year, month - 1, date).getTime(), next = new Date(year, month - 1, date + 1).getTime();
  return { from, to: Math.max(from + 1, Math.min(now, next)) };
}
function disclosure(): Promise<boolean> {
  return new Promise(resolve => Alert.alert('חיבור נתוני הפעילות שלי',
    'אפשר לקרוא נתוני פעילות מאפליקציה אחת שתבחר במאגר הבריאות בטלפון, כולל מרחק, צעדים, מהירות וקלוריות פעילות כשיש הרשאה. נקרא את כל היום שנבחר, גם לפני החיבור וללא סינון לפי אימון או משחק. אפשר לעבור עד שלושים ימים לאחור בכפוף לזמינות. הנתונים יוצגו רק לך ויישמרו בחשבון הפרטי שלך בשרת. אפשר לנתק כאן ולבטל הרשאות בהגדרות הטלפון.',
    [{ text: 'לא עכשיו', style: 'cancel', onPress: () => resolve(false) }, { text: 'המשך', onPress: () => resolve(true) }],
    { cancelable: true, onDismiss: () => resolve(false) }));
}
function errorCopy(error: unknown): string {
  if (error instanceof ActivityHealthError || (error as Error)?.name === 'ActivityHealthError') {
    switch ((error as ActivityHealthError).reason) {
      case 'unavailable': return 'מאגר הבריאות אינו זמין בגרסה או במכשיר הזה. אפשר לבחור שעון מחובר, או לנסות שוב אחרי עדכון.';
      case 'permission': return 'אין הרשאה לקריאת נתוני פעילות. אפשר לחבר מחדש ולבחור אילו נתונים לשתף.';
      case 'incomplete': return 'קריאת נתוני הבריאות לא הושלמה. המקור הקודם נשאר כפי שהיה. אפשר לנסות שוב.';
      default: return 'לא ניתן להשלים את הקריאה מהמקור שנבחר. אפשר לנסות שוב.';
    }
  }
  return 'הסנכרון לא הושלם כרגע. אפשר לרענן ולנסות שוב. נתונים שכבר נשמרו לא נמחקו.';
}

/** Private screen controller. No health payload or provider exception is logged. */
export function useMyActivity() {
  const user = useUserStore(s => s.currentUser);
  const uid = user && !user.isGuest ? user.id : '';
  const [selectedDay, setSelectedDay] = useState(() => myActivityDayKey());
  const selectedDayRef = useRef(selectedDay); selectedDayRef.current = selectedDay;
  const [view, setView] = useState<ViewState>(() => empty(uid));
  const [refreshing, setRefreshing] = useState(false);
  const viewRef = useRef(view), operation = useRef(0), mounted = useRef(true), busy = useRef(false);
  const readerId = useRef<string | null>(null), lastAutoRefresh = useRef(0);
  viewRef.current = view;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; }; }, []);
  useEffect(() => { operation.current++; busy.current = false; setRefreshing(false); setView(empty(uid)); }, [uid, selectedDay]);
  const current = useCallback((request: number) => mounted.current && operation.current === request && !!uid &&
    useUserStore.getState().currentUser?.id === uid && !useUserStore.getState().currentUser?.isGuest && selectedDayRef.current === selectedDay, [uid, selectedDay]);
  const installation = useCallback(async () => {
    const getId = bridge()?.getActivityReaderInstallationId;
    if (!getId) throw new ActivityHealthError('unavailable');
    const id = await getId();
    if (!id) throw new ActivityHealthError('unavailable');
    readerId.current = id; return id;
  }, []);
  const execute = useCallback(async (work: (request: number) => Promise<void>) => {
    if (!SPORTS_ACTIVITY_ENABLED || busy.current || !uid) return;
    busy.current = true; const request = ++operation.current; setRefreshing(true);
    try { await work(request); }
    catch (error) {
      if (!current(request) || isStaleSession(error)) return;
      const expectedHealth = ((error as Error)?.name === 'ActivityHealthError') &&
        ['unavailable', 'permission'].includes((error as ActivityHealthError).reason);
      if (!expectedHealth && !caughtErrorOrigin(error)) observeCaughtError(new Error('My activity operation failed'), {
        source: 'src/services/useMyActivity.ts', handler: 'execute', site: 'myActivity:operation',
      });
      setView(previous => ({ ...(previous.uid === uid ? previous : empty(uid)), error: errorCopy(error) }));
    } finally { if (current(request)) { busy.current = false; setRefreshing(false); } }
  }, [uid, current]);

  const load = useCallback(async (request: number, sync: boolean): Promise<void> => {
    const day = myActivityDayRange(Date.now(), selectedDay);
    let { from, to } = day;
    let state = await getMyActivityState(uid, { from, to });
    if (!current(request)) return;
    if (myActivityDayRange(Date.now(), selectedDay).from !== day.from) { await load(request, sync); return; }
    // Clear another connection's metrics before awaiting provider reads.
    setView(previous => ({ ...(previous.uid === uid ? previous : empty(uid)), state, dayFrom: day.from, error: null }));
    const source = state.source;
    if (sync && source) {
      const reader = await installation();
      if (!current(request)) return;
      if (source.readerInstallationId !== reader) {
        setView(previous => ({ ...previous, error: 'הסנכרון מתבצע בטלפון אחר. כדי להעביר אותו לכאן, חפש מקורות ובחר מקור פעילות.' }));
      } else if (source.kind === 'health-connect' && AppState.currentState === 'active') {
        // Full selected day, including before connection. No game/session eligibility filter.
        to = myActivityDayRange(Date.now(), selectedDay).to;
        if (to > from) {
          const result = await readActivityHealthWindow(source.sourceId, from, to);
          if (!current(request)) return;
          const modifiedAtMs = state.records.reduce((latest, record) => Math.max(latest, record.modifiedAtMs + 1), Date.now());
          const snapshots = [...result.metrics, ...result.missingPermissions.map(recordType => ({ recordType, value: null }))].map(metric => ({
            id: `hc:${metric.recordType}:${from}`, recordType: metric.recordType, startAtMs: from, endAtMs: to,
            modifiedAtMs, value: metric.value,
          }));
          const ids = new Set(snapshots.map(row => row.id));
          const replaced = state.records.filter(row => !row.deleted && row.id.startsWith('hc:') && !ids.has(row.id) &&
            row.startAtMs !== undefined && row.startAtMs >= from && row.endAtMs! <= to)
            .map(row => ({ id: row.id, recordType: row.recordType, modifiedAtMs, deleted: true }));
          const saved = await saveMyActivityRecords(uid, source, `hc-${randomUUID()}`, [...snapshots, ...replaced]);
          if (saved.status === 'stale') {
            if (current(request)) await load(request, false);
            return;
          }
          if (!current(request)) return;
          state = await getMyActivityState(uid, { from: day.from, to: myActivityDayRange(Date.now(), selectedDay).to });
          if (!current(request)) return;
          if (result.missingPermissions.some(metric => metric !== 'total-calories')) setView(previous => ({ ...previous, error: 'חלק מסוגי הנתונים לא אושרו לקריאה. לא משלימים אותם ממקור אחר.' }));
        }
      } else if (source.kind === 'wear-health-services') {
        await flushMyActivity(uid);
        if (!current(request)) return;
        state = await getMyActivityState(uid, { from, to: myActivityDayRange(Date.now(), selectedDay).to });
      }
    }
    if (!current(request)) return;
    if (myActivityDayRange(Date.now(), selectedDay).from !== day.from) { await load(request, sync); return; }
    setView(previous => {
      const sources = previous.uid === uid ? previous.sources : [];
      return { ...previous, uid, state, dayFrom: day.from, updatedAt: Date.now(),
        sources: state.source && !sources.some(s => s.id === keyFor(state.source!.kind, state.source!.sourceId))
          ? [sourceOption(state.source), ...sources] : sources };
    });
  }, [uid, selectedDay, current, installation]);
  const refresh = useCallback(() => { lastAutoRefresh.current = Date.now(); return execute(request => load(request, true)); }, [execute, load]);

  const connect = useCallback((providerId?: string, disclosureAccepted = false) => execute(async request => {
    const id = await installation(); if (!current(request)) return;
    const devices = await bridge()?.getActivityDevices?.() ?? [];
    if (!current(request)) return;
    let options: SourceOption[] = devices.filter(d => d.connected && d.deviceId).map(d => ({
      id: keyFor('wear-health-services', d.deviceId), sourceId: d.deviceId, kind: 'wear-health-services',
      label: 'אפליקציית השעון שלי', detail: d.label || 'שעון מחובר',
    }));
    setView(previous => {
      const kept = previous.uid === uid ? previous : empty(uid), active = kept.state?.source;
      return { ...kept, sources: active && !options.some(option => option.id === keyFor(active.kind, active.sourceId))
        ? [sourceOption(active), ...options] : options, error: null };
    });
    if (disclosureAccepted || await disclosure()) {
      if (!current(request)) return;
      await requestActivityHealthPermissions();
      if (!current(request)) return;
      const now = Date.now(), origins = await discoverActivityHealthOrigins(now - 7 * 86400000, now);
      if (!current(request) || readerId.current !== id) return;
      options = [...options, ...origins.map(origin => ({ ...origin, sourceId: origin.id, id: keyFor(origin.kind, origin.id) }))];
    } else if (providerId) return;
    if (!current(request)) return;
    const active = viewRef.current.uid === uid ? viewRef.current.state?.source : null;
    if (active && !options.some(option => option.id === keyFor(active.kind, active.sourceId))) options.unshift(sourceOption(active));
    setView(previous => ({ ...previous, uid, sources: options, error: options.length ? null : 'לא נמצאו מקורות נתונים. יש לפתוח את אפליקציית השעון, או לאפשר לאפליקציית הפעילות לשתף נתונים למאגר הבריאות בטלפון, ולנסות שוב.' }));
    if (providerId) {
      const matches = options.filter(option => option.kind === 'health-connect' && matchesActivityProvider(option.sourceId, providerId));
      if (matches.length !== 1) {
        setView(previous => ({ ...previous, error: matches.length > 1
          ? 'נמצאו כמה מכשירים. בחר את המכשיר הרצוי מהרשימה.'
          : 'עדיין לא התקבלו נתונים מהאפליקציה הזו. פתח אותה, הפעל שיתוף עם מאגר הבריאות ונסה שוב.' }));
        return;
      }
      const chosen = matches[0], before = await getMyActivityState(uid);
      if (!current(request)) return;
      if (before.source?.kind === chosen.kind && before.source.sourceId === chosen.sourceId && before.source.readerInstallationId === id) {
        await load(request, true);
        return;
      }
      const state = await setMyActivitySource(uid, before.generation, { kind: chosen.kind, sourceId: chosen.sourceId, readerInstallationId: id });
      if (!current(request)) return;
      setView(previous => ({ ...previous, uid, state, error: null, updatedAt: null }));
      await load(request, true);
    }
  }), [execute, installation, current, uid, load]);

  const selectSource = useCallback((id: string) => execute(async request => {
    const before = await getMyActivityState(uid); if (!current(request)) return;
    const selected = viewRef.current.uid === uid ? viewRef.current.sources.find(s => s.id === id) : undefined;
    if (!selected) return;
    const reader = await installation(); if (!current(request)) return;
    if (selected.kind === 'health-connect') {
      // Availability is checked before replacing the existing source.
      await readActivityHealthWindow(selected.sourceId, Date.now() - 60000, Date.now());
    } else {
      const devices = await bridge()?.getActivityDevices?.() ?? [];
      if (!devices.some(d => d.connected && d.deviceId === selected.sourceId)) throw new ActivityHealthError('unavailable');
    }
    if (!current(request)) return;
    const state = await setMyActivitySource(uid, before.generation, { kind: selected.kind, sourceId: selected.sourceId, readerInstallationId: reader });
    if (!current(request)) return;
    setView(previous => ({ ...previous, uid, state, error: null, updatedAt: null }));
    await load(request, true);
  }), [execute, uid, current, installation, load]);
  const disconnect = useCallback(() => execute(async request => {
    const before = await getMyActivityState(uid); if (!current(request)) return;
    const state = await setMyActivitySource(uid, before.generation, null); if (!current(request)) return;
    setView(previous => ({ ...previous, uid, state, error: null, updatedAt: null }));
  }), [execute, uid, current]);
  useFocusEffect(useCallback(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (viewRef.current.state?.source?.kind === 'health-connect' && Date.now() - lastAutoRefresh.current < 300000) return;
      void refresh();
    }, 30000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [refresh]));
  const activeView = view.uid === uid && (view.dayFrom === null || view.dayFrom === myActivityDayRange(Date.now(), selectedDay).from) ? view : empty(uid), summary = activeView.state?.summary;
  const metrics: MyActivityMetrics | null = summary ? { recordingMs: summary.activityMs, distanceM: summary.distanceM,
    movement: summary.movement, steps: summary.steps, calories: activeView.state?.source?.kind === 'wear-health-services' ? summary.totalCalories : summary.activeCalories,
    caloriesKind: activeView.state?.source?.kind === 'wear-health-services' ? 'total' : 'active', totalCalories: summary.totalCalories, avgHeartRateBpm: summary.avgHeartRateBpm, maxHeartRateBpm: summary.maxHeartRateBpm } : null;
  const hasData = metrics && [metrics.distanceM, metrics.steps, metrics.recordingMs, ...Object.values(metrics.movement ?? {})]
    .some(value => typeof value === 'number' && Number.isFinite(value));
  const status: MyActivityStatus = !uid ? 'disconnected' : !activeView.state ? activeView.error ? 'error' : 'loading'
    : !activeView.state.source ? 'disconnected' : hasData ? 'available' : activeView.error ? 'error' : 'empty';
  const dataNote = summary ? [
    summary.excludedBoundaryRecords > 0 ? 'חלק ממקטעי המדדים חצו את גבול היום ולא נכללו בסכומים.' : null,
    summary.conflictingMetrics?.length ? 'בחלק מהמדדים נמצאו חלונות חופפים, ולכן לא מוצג להם סכום.' : null,
    'activityBoundaryUncertain' in summary && summary.activityBoundaryUncertain === true
      ? 'בחלק מההקלטה חסר גבול זמן מאושר. משך לא ודאי אינו מוצג כמדידה מלאה.' : null,
  ].filter(Boolean).join(' ') || null : null;
  const source = activeView.state?.source;
  const today = myActivityDayKey(), earliest = moveDay(today, -30);
  const previousDay = useCallback(() => setSelectedDay(day => day > moveDay(myActivityDayKey(), -30) ? moveDay(day, -1) : day), []);
  const nextDay = useCallback(() => setSelectedDay(day => day < myActivityDayKey() ? moveDay(day, 1) : day), []);
  const canNextDay = selectedDay < today, canPreviousDay = selectedDay > earliest;
  const [year, month, date] = selectedDay.split('-').map(Number);
  const period = new Date(year, month - 1, date).toLocaleDateString('he-IL');
  return { status, metrics, sourceLabel: source ? sourceOption(source).label : null,
    periodLabel: `${selectedDay === today ? 'היום' : 'פעילות ביום'}: ${period}`, refreshing, selectedDay, previousDay, nextDay, canNextDay, canPreviousDay,
    lastUpdatedLabel: activeView.updatedAt ? `העדכון האחרון התקבל בשעה ${new Date(activeView.updatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : null,
    error: activeView.error, dataNote, sources: activeView.sources,
    selectedSourceId: source && (!readerId.current || source.readerInstallationId === readerId.current) ? keyFor(source.kind, source.sourceId) : null,
    refresh, connect, selectSource, disconnect };
}
