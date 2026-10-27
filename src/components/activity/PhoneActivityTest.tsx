import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Line } from 'react-native-svg';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ScrollSurface } from '@/components/ScrollSurface';
import { RTL_LABEL_ALIGN } from '@/theme/rtl';
import { observeCaughtError } from '@/utils/errorObservation';
import { phoneMeasurementError, readPhoneMeasurement, startPhoneMeasurement, stopPhoneMeasurement, type PhoneMeasurement } from '@/services/phoneActivity';

const duration = (ms: number) => `${Math.floor(ms / 60000).toString().padStart(2, '0')}:${Math.floor(ms / 1000 % 60).toString().padStart(2, '0')}`;
const isolate = (value: string) => `\u2066${value}\u2069`;
export function PhoneActivityTest({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<PhoneMeasurement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const value = await readPhoneMeasurement(); if (live) setData(value); }
      catch (caught) {
        if (live) setError('החיבור למדידה נותק. אפשר לבדוק את מצבה בהתראה של הטלפון.');
        observeCaughtError(caught, { source: 'src/components/activity/PhoneActivityTest.tsx', handler: 'poll', site: 'readPhoneMeasurement' });
      }
      if (live) timer = setTimeout(() => { void poll(); }, 1000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, []);
  const act = async () => {
    setBusy(true); setError(null);
    try { setData(await (data?.running ? stopPhoneMeasurement() : startPhoneMeasurement())); }
    catch (caught) {
      setError(phoneMeasurementError(caught instanceof Error ? caught.message : 'unknown'));
      observeCaughtError(caught, { source: 'src/components/activity/PhoneActivityTest.tsx', handler: 'act', site: 'startOrStop' });
    } finally { setBusy(false); }
  };
  const running = data?.running ?? false;
  const ended = !!data && !running && data.elapsedMs > 0;
  const message = error ?? phoneMeasurementError(data?.error ?? null);
  const quality = !running ? 'בדיקה בטלפון' : data?.quality === 'good' ? 'קליטה טובה' : data?.quality === 'waiting' ? 'מחפש קליטה' : 'קליטה חלשה';
  const graph = data?.graph ?? [];
  let path = '';
  let gap = true;
  const scale = Math.max(25, ...graph.filter((v): v is number => v !== null));
  graph.forEach((value, index) => {
    if (value === null) { gap = true; return; }
    path += `${gap ? 'M' : 'L'}${(index / Math.max(1, graph.length - 1) * 300).toFixed(1)},${(62 - value / scale * 55).toFixed(1)} `;
    gap = false;
  });
  const metric = (label: string, value: string | null, unit: string, icon: keyof typeof Ionicons.glyphMap) => <View style={s.metric}>
    <Ionicons name={icon} color="#207D6A" size={23} /><Text style={s.label}>{label}</Text>
    <Text style={[s.value, value === null && s.missing]}>{value === null ? 'טרם נמדד' : isolate(value)}</Text><Text style={s.unit}>{unit}</Text>
  </View>;
  return <SafeAreaView style={s.screen}>
    <ScreenHeader title="בדיקת מדידה" onBack={onClose} />
    <ScrollSurface contentContainerStyle={s.content}>
      <View style={s.source}><Ionicons name="phone-portrait-outline" size={25} color="#17384A" /><Text style={s.sourceTitle}>מדידה מהטלפון</Text><Text style={s.badge}>{quality}</Text></View>
      <View style={s.hero}>
        <Text style={s.heroLabel}>{running ? 'המדידה פעילה' : ended ? 'סיכום הבדיקה' : 'מוכנים לבדיקה?'}</Text>
        <Text style={s.heroSub}>{ended ? 'מהירות שיא מאומתת' : 'מהירות עכשיו'}</Text>
        <Text style={s.speed}>{(ended ? data?.peak : data?.current) == null ? '...' : isolate((ended ? data!.peak! : data!.current!).toFixed(1))}</Text>
        <Text style={s.heroSub}>קמ״ש</Text>
        {data?.sprinting ? <Text style={s.sprint}>ספרינט מזוהה</Text> : <Text style={s.heroHint}>{running && data?.quality !== 'good' ? 'צא למקום פתוח. המדידה ממתינה לקליטה טובה.' : running ? 'הספרינטים מזוהים בזמן המדידה' : 'בדיקה קצרה בחוץ, כשהטלפון איתך'}</Text>}
        <Text style={s.clock}>{isolate(duration(data?.elapsedMs ?? 0))}</Text><Text style={s.heroSub}>זמן מדידה</Text>
      </View>
      <View style={s.row}>
        {metric('מהירות שיא', data?.peak == null ? null : data.peak.toFixed(1), 'קמ״ש', 'speedometer-outline')}
        {metric('מרחק משוער', data?.distance == null ? null : (data.distance / 1000).toFixed(2), 'קילומטרים', 'navigate-outline')}
      </View>
      <View style={s.row}>
        {metric('ספרינטים', data?.sprints == null ? null : String(data.sprints), 'רצפים שזוהו', 'flash-outline')}
        {metric('זמן בספרינט', data?.sprintMs == null ? null : duration(data.sprintMs), 'דקות ושניות', 'timer-outline')}
      </View>
      {graph.length > 1 ? <View style={s.chart}><Text style={s.label}>המהירות שלך</Text><Svg width="100%" height={70} viewBox="0 0 300 70"><Line x1={0} x2={300} y1={63} y2={63} stroke="#E0EBE8" /><Path d={path} stroke="#32B69A" strokeWidth={3} fill="none" /></Svg></View> : null}
      <Text style={s.footer}>הבדיקה זמנית ונשארת בטלפון. היא אינה מתווספת לפעילות היומית.</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: details }} onPress={() => setDetails(value => !value)}><Text style={s.link}>איך המדידה עובדת?</Text></Pressable>
      {details ? <Text style={s.footer}>ספרינט הוא רצף של שתי שניות לפחות במהירות של תשעה עשר קילומטרים לשעה ומעלה. מהירות השיא דורשת שתי דגימות סמוכות. דגימות חלשות ופערי קליטה אינם נספרים. המרחק מחושב מהמהירות בזמן שנמדד בלבד. תוצאות הבדיקה אינן נשמרות לאחר סגירת האפליקציה או מעבר לחשבון אחר. הבדיקה נעצרת לאחר שעתיים לכל היותר.{data ? ` זמן עם נתונים תקינים: ${isolate(duration(data.measuredMs))}.` : ''}</Text> : null}
    </ScrollSurface>
    <View style={s.dock}>
      {message ? <View><Text accessibilityRole="alert" style={s.error}>{message}</Text><Pressable accessibilityRole="button" onPress={() => { void Linking.openSettings(); }}><Text style={s.link}>פתיחת הגדרות הטלפון</Text></Pressable></View> : null}
      <Text style={s.footer}>{running ? 'המדידה ממשיכה כשהמסך כבוי. אפשר לסיים גם בהתראה.' : 'בלחיצה מאשרים שימוש במיקום מדויק למדידה, גם כשהמסך כבוי, עד לסיום הבדיקה. הנתונים נשארים בטלפון בלבד.'}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || !data, busy }} disabled={busy || !data} onPress={() => { void act(); }} style={[s.button, (busy || !data) && s.disabled]}>
        {busy ? <ActivityIndicator color="white" /> : <><Ionicons name={running ? 'stop' : 'play'} size={19} color="white" /><Text style={s.buttonText}>{running ? 'סיום מדידה' : ended ? 'בדיקה חדשה' : 'התחלת מדידה'}</Text></>}
      </Pressable>
    </View>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F8FA' }, content: { padding: 20, gap: 14, paddingBottom: 30 },
  dock: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#E4EBEF', backgroundColor: '#F5F8FA' },
  source: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: 'white', padding: 15, borderRadius: 19 },
  sourceTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: '#17384A', textAlign: RTL_LABEL_ALIGN },
  badge: { color: '#207D6A', backgroundColor: '#E6F5EF', padding: 7, borderRadius: 12, fontSize: 12 },
  hero: { backgroundColor: '#102F42', borderRadius: 27, padding: 18, alignItems: 'center' },
  heroLabel: { color: '#B6EFDC', fontSize: 17, fontWeight: '600', marginBottom: 8 }, heroSub: { color: '#C2D6DF', fontSize: 14 },
  speed: { color: 'white', fontSize: 52, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroHint: { color: '#BDD6DF', fontSize: 13, textAlign: 'center', marginTop: 8 },
  sprint: { color: '#A3EFD5', fontWeight: '700', marginTop: 8 }, clock: { color: 'white', fontSize: 20, marginTop: 8, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', gap: 12 }, metric: { flex: 1, backgroundColor: 'white', borderRadius: 20, padding: 12, alignItems: 'center', gap: 5 },
  label: { color: '#627785', fontSize: 14, textAlign: RTL_LABEL_ALIGN }, value: { fontSize: 30, fontWeight: '700', color: '#16364A', fontVariant: ['tabular-nums'] },
  missing: { fontSize: 18, color: '#8A9BA6' }, unit: { color: '#82949E', fontSize: 12 }, chart: { backgroundColor: 'white', borderRadius: 20, padding: 16 },
  button: { flexDirection: 'row', gap: 10, justifyContent: 'center', alignItems: 'center', padding: 18, borderRadius: 18, backgroundColor: '#2457F5' },
  buttonText: { color: 'white', fontSize: 18, fontWeight: '700' }, disabled: { opacity: 0.5 },
  footer: { color: '#728591', fontSize: 13, lineHeight: 21, textAlign: 'center' }, error: { color: '#A53838', textAlign: RTL_LABEL_ALIGN, lineHeight: 23 }, link: { color: '#2457F5', textAlign: 'center', padding: 8 },
});
