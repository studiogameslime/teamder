import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, font, radius } from '../theme';
import { Card, Screen, SectionHeader } from '../components/ui';
import { config } from '../config';
import { has } from '../secrets';
import { useDashboard } from '../state/DashboardContext';
import { ensureNotificationSetup, notify } from '../services/notify';
import {
  NOTIF_TYPES,
  fetchNotifPrefs,
  setNotifPref,
  type NotifPrefs,
} from '../services/notifPrefs';

function StatusRow({ label, live }: { label: string; live: boolean }) {
  return (
    <View style={styles.statusRow}>
      <View
        style={[
          styles.dot,
          { backgroundColor: live ? colors.green : colors.amber },
        ]}
      />
      <Text style={styles.statusLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={[styles.statusTag, { color: live ? colors.green : colors.amber }]}>
        {live ? 'מחובר' : 'דמו'}
      </Text>
    </View>
  );
}

function Btn({
  label,
  onPress,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  tone?: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        tone === 'ghost' && styles.btnGhost,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[styles.btnText, tone === 'ghost' && { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SettingsScreen() {
  const { refresh } = useDashboard();
  const nav = useNavigation<any>();
  const [msg, setMsg] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);

  useEffect(() => {
    fetchNotifPrefs().then(setPrefs).catch(() => setPrefs(null));
  }, []);

  const togglePref = async (key: string, value: boolean) => {
    setPrefs((p) => ({ ...(p ?? {}), [key]: value })); // optimistic
    const ok = await setNotifPref(key, value);
    if (!ok) setPrefs((p) => ({ ...(p ?? {}), [key]: !value })); // revert on fail
  };

  const sources = [
    { label: 'App Store — ביקורות ודירוגים', live: has.appStore() },
    { label: 'Google Play — ביקורות ודירוגים', live: has.play() },
    { label: 'AdMob — הכנסות', live: has.admob() },
    { label: 'Google Analytics — שימוש', live: has.analytics() },
    { label: 'Firebase — משתמשים ונתוני אפליקציה', live: has.firebase() },
    { label: 'הורדות App Store', live: has.appleDownloads() },
    { label: 'הורדות Google Play', live: has.playDownloads() },
  ];

  return (
    <Screen title="הגדרות" subtitle={config.appName}>
      <SectionHeader>מקורות נתונים</SectionHeader>
      <Card style={{ gap: 4 }}>
        {sources.map((s) => (
          <StatusRow key={s.label} label={s.label} live={s.live} />
        ))}
      </Card>
      <Text style={styles.help}>
        מקור ב״דמו״ מציג נתוני דוגמה. ברגע שמזינים את המפתחות שלו בקובץ
        secrets.ts הוא עובר אוטומטית לנתונים אמיתיים.
      </Text>

      <SectionHeader>התראות בזמן אמת</SectionHeader>
      <Card style={{ gap: 2 }}>
        {NOTIF_TYPES.map((t) => (
          <View key={t.key} style={styles.notifRow}>
            <Switch
              value={prefs ? prefs[t.key] !== false : true}
              onValueChange={(v) => togglePref(t.key, v)}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.notifLabel}>
                {t.emoji} {t.label}
              </Text>
              {t.hint ? <Text style={styles.notifHint}>{t.hint}</Text> : null}
            </View>
          </View>
        ))}
      </Card>
      <Text style={styles.help}>
        בורר מה יישלח אליך כפוש בזמן אמת. הסינון בצד השרת — כיבוי עובד גם
        כשהאפליקציה סגורה, וחל על כל המכשירים הרשומים.
      </Text>

      <SectionHeader>תשתית</SectionHeader>
      <Pressable
        onPress={() => nav.navigate('Quota')}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Card style={styles.navCard}>
          <View style={styles.navIcon}>
            <Ionicons name="speedometer" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.navTitle}>מכסות וחינמי</Text>
            <Text style={styles.navSub}>שימוש מול הגבול החינמי — Firestore, Functions, Scheduler</Text>
          </View>
          <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
        </Card>
      </Pressable>

      <SectionHeader>פעולות</SectionHeader>
      <Btn
        label="רענן עכשיו"
        onPress={async () => {
          setMsg('מרענן…');
          await refresh();
          setMsg('עודכן ✓');
        }}
      />
      <Btn
        label="שלח התראת בדיקה"
        tone="ghost"
        onPress={async () => {
          const ok = await ensureNotificationSetup();
          if (!ok) {
            setMsg('אין הרשאת התראות');
            return;
          }
          await notify('Pulse', 'התראות עובדות ✓ — תקבל פוש על ביקורות חדשות.');
          setMsg('נשלחה התראה');
        }}
      />
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}

      <SectionHeader>איך זה עובד</SectionHeader>
      <Card>
        <Text style={styles.body}>
          התראות משתמש/שגיאה/דיווח נשלחות בזמן אמת (~2ש׳) דרך Cloud Function
          ברגע שהאירוע קורה. ביקורות נבדקות בשרת כל ~15 דקות (החנויות לא דוחפות
          אותן). הכל רץ בשרת — מגיע אליך גם כשהאפליקציה סגורה.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statusLabel: { ...font.body, color: colors.text },
  statusTag: { ...font.small, fontWeight: '700' },
  help: { ...font.small, color: colors.textMuted, lineHeight: 18 },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  msg: { ...font.small, color: colors.green, textAlign: 'center' },
  body: { ...font.body, color: colors.text, lineHeight: 21 },
  navCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: { ...font.title, color: colors.text, textAlign: 'right' },
  navSub: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 2 },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  notifLabel: { ...font.body, color: colors.text, textAlign: 'right' },
  notifHint: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 1 },
});
