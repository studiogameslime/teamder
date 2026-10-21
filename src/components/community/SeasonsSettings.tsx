import { observeCaughtError } from '../../utils/errorObservation';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { BallSwitch } from '@/components/anim/BallSwitch';
import { appAlert } from '@/components/AppDialog';
import { toast } from '@/components/Toast';
import { SeasonConfirmSheet } from './SeasonConfirmSheet';
import { Chip, Stepper } from './SeasonTargetControls';
export { Chip, Stepper } from './SeasonTargetControls';
import { seasonService, seasonExpected, SeasonRefusedError, seasonRefusalText, type SeasonPreview } from '@/services/seasonService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { makeSeasonTarget, validateSeasonTarget, maxSeasonTarget, MIN_SEASON_ROUNDS, type SeasonHistoryChoice } from '@/utils/seasonPolicy';
import { planActivation } from '@/utils/seasonActivation';
import { formatCalendarDate, todayIn } from '@/utils/seasonDates';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { GroupSeasons } from '@/types';

const histories: { key: SeasonHistoryChoice; title: string; body: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fresh', title: 'להתחיל עונה חדשה מהיום', body: 'הפעילות הקודמת נשארת בכל הזמנים, בלי עונה ובלי תארים.', icon: 'sparkles-outline' },
  { key: 'sealNow', title: 'לסכם את התקופה הקודמת כעונה', body: 'מעניקים עליה תארים ופותחים עונה חדשה מהיום. נדרשים לפחות חמישה מחזורים תקינים.', icon: 'trophy-outline' },
  { key: 'continue', title: 'להמשיך עם הפעילות הקודמת', body: 'המחזורים והנתונים הקודמים נכנסים לעונה הפעילה. היעד נמדד מתחילת התקופה שנכללת.', icon: 'layers-outline' },
];

export function SeasonsSettings({ groupId, seasons, onChanged }: { groupId: string; seasons?: GroupSeasons; onChanged?: () => void }) {
  const live = seasons?.enabled === true;
  const [open, setOpen] = useState(live);
  const [scope, setScope] = useState<'current' | 'next'>('current');
  const stored = scope === 'next' ? seasons?.nextCadence ?? seasons?.cadence : seasons?.cadence;
  const [cadence, setCadence] = useState<'date' | 'rounds'>(stored?.type ?? 'rounds');
  const [months, setMonths] = useState(stored?.months ?? 3);
  const [rounds, setRounds] = useState(stored?.targetRounds ?? 24);
  const [choice, setChoice] = useState<SeasonHistoryChoice>('fresh');
  const [history, setHistory] = useState<SeasonPreview | null>(null);
  const [readError, setReadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [confirm, setConfirm] = useState<'enable' | 'close' | 'disable' | null>(null);
  const [operationClock, setOperationClock] = useState(Date.now());
  useEffect(() => {
    if (!seasons?.operation) return;
    const timer = setInterval(() => setOperationClock(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [seasons?.operation?.until]);
  const canResume = !!seasons?.operation && (seasons.operation.failed || seasons.operation.until <= operationClock);

  useEffect(() => {
    setCadence(stored?.type ?? 'rounds'); setMonths(stored?.months ?? 3); setRounds(stored?.targetRounds ?? 24);
  }, [groupId, seasons?.currentId, stored?.type, stored?.months, stored?.targetRounds, scope]);
  useEffect(() => { setOpen(live); }, [live]);
  useEffect(() => {
    if (!open || live) return;
    let alive = true; setHistory(null); setReadError(false);
    void seasonService.preview(groupId).then(result => { if (alive) setHistory(result); }).catch((caughtError4abd01379a: unknown) => {
    observeCaughtError(caughtError4abd01379a, {"source":"src/components/community/SeasonsSettings.tsx","handler":"SeasonsSettings","site":"SeasonsSettings:4abd01379a"}); if (alive) setReadError(true); });
    return () => { alive = false; };
  }, [groupId, open, live, attempt]);

  const included = !live && choice === 'continue' ? history?.played ?? 0 : live && scope === 'current' ? seasons?.includedHistory ?? 0 : 0;
  const played = live && scope === 'current' ? seasons?.playedRounds ?? 0 : !live && choice === 'continue' ? history?.played ?? 0 : 0;
  const start = !live && choice === 'continue' && (history?.played ?? 0) > 0 ? history!.startsAt : live && scope === 'current' ? seasons?.startedAt || Date.now() : Date.now();
  const target = makeSeasonTarget(cadence, cadence === 'date' ? months : rounds, todayIn(undefined, start));
  const validation = validateSeasonTarget({ target, played, includedHistory: included, now: Date.now(),
    previousType: live && scope === 'current' ? seasons?.cadence.type : undefined, activation: !live });
  const changed = !live || cadence !== stored?.type || (cadence === 'rounds' ? rounds !== stored?.targetRounds : months !== stored?.months);
  const plan = planActivation({ cadence, months, targetRounds: rounds, choice, playedHistory: history?.played ?? 0,
    today: todayIn(), historyStartsOn: todayIn(undefined, history?.startsAt || Date.now()) });
  const pending = seasons?.pendingClose;
  const no = live ? seasons?.currentNo ?? 1 : (seasons?.count ?? 0) + 1;
  const disabled = !!busy || !!seasons?.manualClose || !!seasons?.operation;
  const error = !validation.ok ? validation.error === 'roundsInvalid' ? `יש לבחור בין חמישה ל־${maxSeasonTarget(included)} מחזורים.`
    : validation.error === 'monthsInvalid' ? 'יש לבחור בין חודש אחד ל־24 חודשים.'
    : validation.error === 'targetBehind' ? `כבר הושלמו ${played} מחזורים. היעד לא יכול להיות קטן מכך.`
    : 'בהפעלה או בהחלפת סוג יעד, היעד החדש צריך להיות בעתיד. אפשר לבחור יעד רחוק יותר.' : null;

  async function run(label: string, action: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label);
    try {
      await action(); setConfirm(null); toast.success('השינוי בהגדרות העונה נשמר'); onChanged?.();
    } catch (err) {
    observeCaughtError(err, {"source":"src/components/community/SeasonsSettings.tsx","handler":"run","site":"SeasonsSettings:14f3b4380c"});
      const stale = err instanceof SeasonRefusedError && err.reason === 'operationStale';
      appAlert('השינוי לא נשמר', err instanceof SeasonRefusedError ? seasonRefusalText(err.reason, { seasonNo: no, played, target: rounds }) : 'לא ניתן להשלים כעת. הבחירה נשמרה במסך ואפשר לנסות שוב.');
      if (stale) { setConfirm(null); onChanged?.(); setAttempt(n => n + 1); }
    } finally { busyRef.current = false; setBusy(null); }
  }
  const submit = () => {
    if (confirm === 'enable') void run('מפעילים עונות ושומרים את ההיסטוריה…', async () => {
      await seasonService.enable({ groupId, cadenceType: cadence, months, targetRounds: rounds, historyChoice: choice, expected: history?.expected, ...(history ? { historySnapshot: { played: history.played, startsAt: history.startsAt, unverified: history.unverified } } : {}) });
      logEvent(AnalyticsEvent.SeasonsEnabled, { groupId });
    });
    if (confirm === 'close') void run('מסיימים את העונה…', async () => {
      await seasonService.endNow(groupId, seasonExpected(seasons)); logEvent(AnalyticsEvent.SeasonEndedEarly, { groupId });
    });
    if (confirm === 'disable') void run('מסיימים את העונה ומכבים עונות…', async () => {
      await seasonService.disable(groupId, seasonExpected(seasons)); logEvent(AnalyticsEvent.SeasonsDisabled, { groupId });
    });
  };
  const short = (seasons?.playedRounds ?? 0) < MIN_SEASON_ROUNDS;
  const closeBody = [
    `בעונה הושלמו ${he.seasonsRoundsUnit(seasons?.playedRounds ?? 0)}.`,
    short
      ? 'העונה תבוטל ללא תארים וללא קידום מספר העונה, והמועדון יחזור לפעילות ללא עונות. המחזורים והנתונים יישמרו בכל הזמנים, ללא שיוך לעונה, ויהיו זמינים לבחירה בהפעלה הבאה.'
      : `העונה תיסגר והתארים יפורסמו. ${confirm === 'disable' ? 'לאחר מכן העונות יכובו.' : 'לאחר מכן תיפתח העונה הבאה.'}`,
    'אם יש מחזור פעיל או מחזור שממתין לאימות, הסיום ימתין להם וייקבע לפי מספר המחזורים המעודכן.',
    short ? 'אין חלון תיקונים של 24 שעות.' : 'הסגירה סופית: אין חלון תיקונים של 24 שעות ואין פתיחה מחדש.',
  ].join('\n\n');

  return <View style={styles.section}>
    <View style={styles.header}>
      <View style={styles.heading}><Text style={styles.title}>עונות במועדון</Text><Text style={styles.hint}>תחרות לאורך זמן, עם יעד ברור ותארים בסיום</Text></View>
      <BallSwitch value={open} accessibilityLabel="הגדרות עונות" disabled={disabled} onValueChange={value => live && !value ? setConfirm('disable') : setOpen(value)} />
    </View>
    {live ? <View style={styles.status}><Ionicons name="trophy-outline" size={20} color={colors.primary} /><Text style={styles.statusText}>{`עונה ${no} · הושלמו ${he.seasonsRoundsUnit(seasons?.playedRounds ?? 0)}`}</Text></View> : null}
    {seasons?.manualClose ? <Notice title="בקשת הסיום נשמרה" text="ממתינים לסיום מחזור פעיל ולאימות הערבים שנותרו. לאחר מכן הסגירה תתבצע בלי חלון תיקונים נוסף." /> : null}
    {pending?.pausedAt != null ? <Notice title="חלון התיקונים מושהה" text={`הטיימר נעצר: ${pending.awaitingVerification ?? 1} מחזורים ממתינים לאימות בפרטי המועדון. לאחר האימות הספירה תמשיך מהזמן שנותר.`} /> : null}
    {seasons?.operation ? <Notice title={seasons.operation.failed ? 'הפעולה נקטעה ונשמרה להמשך' : 'מתבצע שינוי בעונה'} text="הנתונים מוגנים מפני פעולה כפולה. אפשר לרענן כדי לבדוק את ההתקדמות." /> : null}
    {canResume ? <Button title="המשך את הפעולה שנקטעה" variant="outline" loading={!!busy} onPress={() => void run('ממשיכים את הפעולה שנשמרה…', () => seasonService.resume(groupId))} fullWidth /> : null}
    {open ? <View style={styles.body}>
      {!live ? <>
        <Text style={styles.subtitle}>איך להתחיל?</Text>
        <Text style={styles.hint}>הבחירה כוללת את כל המחזורים שלא שויכו לעונה תחרותית, גם מניסיונות שבוטלו לפני חמישה מחזורים. עונות שכבר נסגרו נשארות סגורות.</Text>
        {!history && !readError ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.hint}>בודקים את הפעילות הקודמת…</Text></View> : null}
        {readError ? <><Notice title="לא הצלחנו לטעון את ההיסטוריה" text="אין אפשרות להפעיל עונות עד שהנתונים נטענים. שום נתון לא השתנה." /><Button title="נסה שוב" variant="outline" onPress={() => setAttempt(n => n + 1)} /></> : null}
        {histories.map(h => {
          const unavailable = h.key === 'sealNow' && (history?.played ?? 0) < MIN_SEASON_ROUNDS;
          return <Pressable key={h.key} accessibilityRole="radio" accessibilityLabel={h.title} accessibilityState={{ checked: choice === h.key, disabled: unavailable || disabled }} disabled={unavailable || disabled} onPress={() => { setChoice(h.key); if (h.key === 'continue' && rounds <= (history?.played ?? 0)) setRounds((history?.played ?? 0) + 24); else if (h.key !== 'continue' && rounds > 200) setRounds(24); }} style={[styles.option, choice === h.key && styles.optionChosen, unavailable && styles.unavailable]}>
            <Ionicons name={h.icon} size={23} color={choice === h.key ? colors.primary : colors.textMuted} />
            <View style={styles.optionBody}><Text style={styles.optionTitle}>{h.title}</Text><Text style={styles.hint}>{h.body}</Text></View>
            <Ionicons name={choice === h.key ? 'radio-button-on' : 'radio-button-off'} size={22} color={choice === h.key ? colors.primary : colors.textMuted} />
          </Pressable>;
        })}
        {history ? <Text style={styles.hint}>{`${history.played} מחזורים תקינים ללא עונה${history.unverified ? ` · ${history.unverified} ממתינים לאימות` : ''}`}</Text> : null}
      </> : <>
        <Text style={styles.subtitle}>איזו עונה מעדכנים?</Text>
        <View style={styles.row}><Chip label="העונה הנוכחית" active={scope === 'current'} disabled={disabled} onPress={() => setScope('current')} /><Chip label="העונות הבאות" active={scope === 'next'} disabled={disabled} onPress={() => setScope('next')} /></View>
        <Text style={styles.hint}>{scope === 'current' ? 'השינוי חל על העונה הפעילה בלבד. הגדרות העונות הבאות נשארות כפי שהן.' : 'ברירת המחדל שתשמש החל מהעונה הבאה. העונה הפעילה לא משתנה.'}</Text>
      </>}
      <Text style={styles.subtitle}>מהו יעד העונה?</Text>
      <View style={styles.row}><Chip label="לפי מחזורים" active={cadence === 'rounds'} disabled={disabled} onPress={() => setCadence('rounds')} /><Chip label="לפי חודשים" active={cadence === 'date'} disabled={disabled} onPress={() => setCadence('date')} /></View>
      <View style={styles.row}>{(cadence === 'rounds' ? [12, 24, 48] : [3, 6, 12]).map(n => <Chip key={n} label={cadence === 'rounds' ? he.seasonsRoundsUnit(n) : he.seasonsMonthsUnit(n)} active={(cadence === 'rounds' ? rounds : months) === n} disabled={disabled} onPress={() => cadence === 'rounds' ? setRounds(n) : setMonths(n)} />)}</View>
      <Stepper label={cadence === 'rounds' ? `בחירה מדויקת · 5 עד ${maxSeasonTarget(included)} מחזורים` : 'בחירה מדויקת · חודש אחד עד 24 חודשים'} value={cadence === 'rounds' ? rounds : months} unit={cadence === 'rounds' ? he.seasonsRoundsUnit(rounds) : he.seasonsMonthsUnit(months)} min={cadence === 'rounds' ? MIN_SEASON_ROUNDS : 1} max={cadence === 'rounds' ? maxSeasonTarget(included) : 24} disabled={disabled} onChange={cadence === 'rounds' ? setRounds : setMonths} />
      <View style={styles.preview}>
        <Text style={styles.optionTitle}>{scope === 'next' && live ? 'כך תיראה העונה הבאה' : `כך תיראה עונה ${no + (!live && choice === 'sealNow' ? 1 : 0)}`}</Text>
        {cadence === 'rounds' ? <Text style={styles.previewValue}>{`${played} מתוך ${rounds} מחזורים · נותרו ${Math.max(0, rounds - played)}`}</Text> : <><Text style={styles.hint}>{`תחילת התקופה: ${formatCalendarDate(todayIn(undefined, start))}`}</Text><Text style={styles.previewValue}>{scope === 'next' && live ? `${months} חודשים ממועד תחילת העונה הבאה` : `יום הפעילות האחרון: ${formatCalendarDate(target.endsOn!)}`}</Text></>}
        <Text style={styles.hint}>בהשגת היעד נפתח חלון תיקונים של 24 שעות. התארים מתפרסמים רק בסגירת העונה. נדרשים לפחות חמישה מחזורים תקינים.</Text>
      </View>
      {changed && validation.due && validation.ok ? <Notice title="היעד שנבחר כבר הושג" text="זהו שינוי שטרם נשמר. השמירה תפתח חלון תיקונים של 24 שעות; אם יש מחזור פעיל, נמתין לסיומו. הארכה ליעד שטרם הושג תבטל חלון סגירה ממתין." /> : null}
      {!live && choice === 'continue' && rounds > 200 && cadence === 'rounds' ? <Text style={styles.hint}>היעד הזה כולל פעילות קודמת. ברירת המחדל לעונות הבאות תהיה 200 מחזורים, וניתן לערוך אותה בנפרד לאחר ההפעלה.</Text> : null}
      {changed && error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {busy ? <View accessibilityLiveRegion="polite" style={styles.loading}><ActivityIndicator color={colors.primary} /><Text style={styles.statusText}>{busy}</Text></View> : null}
      <Button title={live ? 'שמור הגדרות עונה' : 'הפעל עונות'} loading={!!busy} disabled={disabled || !changed || !!error || (!live && (!history || !!history.unverified))} style={styles.primaryAction} iconLeft="checkmark-outline" onPress={() => live ? void run('שומרים הגדרות עונה…', async () => { await seasonService.updateTarget({ groupId, cadenceType: cadence, months, targetRounds: rounds, scope, expected: seasonExpected(seasons) }); logEvent(AnalyticsEvent.SeasonTargetChanged, { groupId }); }) : setConfirm('enable')} fullWidth />
      <Text style={styles.hint}>הפעולה הזו נפרדת משמירת פרטי המועדון. שינוי יעד בזמן מחזור פעיל נבחן רק בסיום המחזור.</Text>
      {live ? <View style={styles.actions}><Button title="סיים את העונה" variant="secondary" style={styles.secondaryAction} disabled={disabled} onPress={() => setConfirm('close')} fullWidth /></View> : null}
    </View> : null}
    <SeasonConfirmSheet visible={confirm != null} plan={plan} cadence={cadence} months={months} rounds={rounds} seasonNo={no} busy={!!busy} title={confirm === 'close' ? 'סיום העונה' : confirm === 'disable' ? 'כיבוי העונות' : undefined} message={confirm && confirm !== 'enable' ? closeBody : undefined} onCancel={() => { if (!busyRef.current) setConfirm(null); }} onConfirm={submit} />
  </View>;
}
function Notice({ title, text }: { title: string; text: string }) {
  return <View style={styles.notice}><Text style={styles.noticeTitle}>{title}</Text><Text style={styles.hint}>{text}</Text></View>;
}
const styles = StyleSheet.create({
  section: { borderRadius: 20, padding: spacing.md, gap: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, heading: { flex: 1, gap: 4 },
  title: { ...typography.h3, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  subtitle: { ...typography.body, fontWeight: '800', color: colors.text, textAlign: RTL_LABEL_ALIGN, marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.textMuted, lineHeight: 20, textAlign: RTL_LABEL_ALIGN },
  body: { gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceMuted, padding: spacing.md, borderRadius: radius.md },
  statusText: { ...typography.caption, color: colors.primary, fontWeight: '700', textAlign: RTL_LABEL_ALIGN, flexShrink: 1 },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, borderRadius: radius.lg },
  optionChosen: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted }, optionBody: { flex: 1, gap: spacing.xs },
  optionTitle: { ...typography.body, fontWeight: '700', color: colors.text, textAlign: RTL_LABEL_ALIGN }, unavailable: { opacity: 0.45 },
  preview: { borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, padding: spacing.md, gap: spacing.sm },
  previewValue: { ...typography.body, fontWeight: '800', color: colors.primary, textAlign: RTL_LABEL_ALIGN },
  notice: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.md, gap: spacing.xs },
  noticeTitle: { ...typography.body, color: colors.warning, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  loading: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, actions: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  primaryAction: { minHeight: 48, borderRadius: 12, paddingVertical: 12, backgroundColor: '#1479FF', borderColor: '#1479FF' },
  secondaryAction: { minHeight: 48, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 8, backgroundColor: '#EDF5FF', borderColor: '#DDEAFB' },
  error: { ...typography.caption, color: colors.danger, textAlign: RTL_LABEL_ALIGN, lineHeight: 20 },
});
