import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, font, radius } from '../theme';
import { Card } from './ui';
import { getOutreachJobs, getOutreachSettings, saveOutreachSettings, type OutreachSettings, type OutreachJob } from '../services/supportOutreachService';

const STATUS: Record<string, string> = { pending: 'ממתינה לשליחה', sent: 'נשלחה', replied: 'המשתמש ענה', skipped: 'דולגה', failed: 'נכשלה — דורשת בדיקה' };
const REASON: Record<string, string> = { club_deleted: 'המועדון נמחק', no_longer_admin: 'כבר אינו מנהל', not_new_user: 'מחוץ לחלון המשתמש החדש', user_unavailable: 'החשבון אינו זמין', human_support_exists: 'כבר קיבל מענה מהצוות', send_failed: 'שגיאת שליחה' };
export function SupportOutreachPanel({ onOpenThread }: { onOpenThread: (userId: string, userName: string) => void }) {
  const [expanded, setExpanded] = useState(false), [settings, setSettings] = useState<OutreachSettings | null>(null);
  const [jobs, setJobs] = useState<OutreachJob[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setError('');
    try { const [cfg, rows] = await Promise.all([getOutreachSettings(), getOutreachJobs()]); setSettings(cfg); setJobs(rows); }
    catch { setError('לא הצלחנו לטעון את הגדרות הליווי. נסו שוב.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { if (expanded) void load(); }, [expanded, load]);
  const save = async () => {
    if (!settings || busy) return;
    setBusy(true); setError(''); setSaved(false);
    try { await saveOutreachSettings(settings); setSaved(true); }
    catch (e) { setError(e instanceof Error ? e.message : 'השמירה נכשלה'); }
    finally { setBusy(false); }
  };
  const field = (key: keyof OutreachSettings, value: string) => { if (!settings) return; setSaved(false); setSettings({ ...settings, [key]: ['template', 'timeZone'].includes(key) ? value : value.trim() ? Number(value.replace(',', '.')) : NaN }); };
  return <Card>
    <Pressable onPress={() => setExpanded(value => !value)} accessibilityRole="button" accessibilityState={{ expanded }}><Text style={font.h2}>ליווי מנהלים חדשים {expanded ? '⌃' : '⌄'}</Text><Text style={s.hint}>הודעה אישית אחרי הקמת המועדון הראשון · הגדרות ומעקב</Text></Pressable>
    {expanded ? <View style={{ gap: 12, marginTop: 14 }}>
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Pressable onPress={load}><Text style={s.error}>{error}</Text></Pressable> : null}
      {settings ? <>
        <Pressable disabled={busy} onPress={() => { setSaved(false); setSettings({ ...settings, enabled: !settings.enabled }); }} style={[s.toggle, { borderColor: settings.enabled ? colors.green : colors.border }]}><Text style={font.body}>{settings.enabled ? '● הליווי האוטומטי פעיל' : '○ הליווי האוטומטי מושהה'}</Text></Pressable>
        <Text style={s.hint}>השינוי יופעל רק לאחר שמירה. הפעלה תחדש גם פניות שממתינות בתור. הודעה אחת לכל משתמש; אין שליחה חוזרת למי שכבר קיבל.</Text>
        {([['delayHours', 'כמה שעות אחרי יצירת המועדון?'], ['newUserDays', 'עד כמה ימים מההרשמה? 0 = כל משתמש'], ['startHour', 'שעת התחלת שליחה'], ['endHour', 'שעת סיום שליחה']] as const).map(([key, label]) => <View key={key}><Text style={font.body}>{label}</Text><TextInput editable={!busy} keyboardType="decimal-pad" accessibilityLabel={label} style={s.input} value={Number.isFinite(settings[key]) ? String(settings[key]) : ''} onChangeText={value => field(key, value)} /></View>)}
        <Text style={font.body}>אזור זמן כשאזור המשתמש אינו ידוע</Text><TextInput editable={!busy} autoCapitalize="none" style={s.input} value={settings.timeZone} onChangeText={value => field('timeZone', value)} />
        <Text style={font.body}>נוסח ההודעה</Text><Text style={s.hint}>אפשר לשלב שם עם {'{name}'}, מועדון עם {'{club}'} ושאלה מותאמת עם {'{focus}'}. ההשהיה ניתנת לשינוי, לכן הנוסח אינו מתחייב שעבר בדיוק יום.</Text>
        <TextInput editable={!busy} multiline maxLength={700} style={[s.input, { minHeight: 150, textAlignVertical: 'top' }]} value={settings.template} onChangeText={value => field('template', value)} />
        <Pressable disabled={busy} onPress={save} style={s.save}><Text style={s.saveText}>{saved ? 'ההגדרות נשמרו ✓' : 'שמירת הגדרות הליווי'}</Text></Pressable>
        <Text style={s.hint}>שינוי ההשהיה מעדכן גם הודעות שממתינות בתור. חלון השעות עשוי לדחות לבוקר; השליחה מתבצעת בבדיקות של חמש דקות.</Text>
      </> : null}
      <View style={s.line}><Text style={font.h2}>20 הפניות האחרונות</Text><Pressable disabled={busy} onPress={load}><Text style={{ color: colors.primary }}>רענון</Text></Pressable></View>
      {!busy && !error && jobs.length === 0 ? <Text style={s.hint}>אין עדיין פניות מתוזמנות. משתמשים מתווספים עם פתיחת מועדון ראשון שעומד בתנאים.</Text> : null}
      {jobs.map(job => <Pressable key={job.id} onPress={() => onOpenThread(job.userId, job.userName)} style={s.job}><Text style={font.title}>{job.userName || 'משתמש'} · {job.clubName}</Text><Text style={{ ...font.small, color: job.status === 'replied' ? colors.green : colors.amber }}>{STATUS[job.status] ?? job.status}</Text>{job.scheduledAt ? <Text style={s.hint}>מתוכננת: {new Date(job.scheduledAt).toLocaleString('he-IL')}</Text> : null}{job.reason ? <Text style={s.hint}>{REASON[job.reason] ?? 'דורשת בדיקה'}</Text> : null}</Pressable>)}
    </View> : null}
  </Card>;
}
const s = StyleSheet.create({
  hint: { ...font.small, lineHeight: 19 }, error: { ...font.body, color: colors.amber },
  input: { color: colors.text, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: 12, marginTop: 6, textAlign: 'right' },
  toggle: { borderWidth: 1, borderRadius: radius.sm, padding: 12 }, save: { backgroundColor: colors.primary, borderRadius: radius.sm, padding: 14 }, saveText: { color: '#fff', textAlign: 'center', fontWeight: '700' },
  line: { flexDirection: 'row', direction: 'rtl', alignItems: 'center', justifyContent: 'space-between' }, job: { borderTopWidth: 1, borderColor: colors.border, paddingVertical: 10, gap: 5 },
});
