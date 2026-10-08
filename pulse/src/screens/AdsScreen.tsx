// "מודעות" — master switch for the app-open ad. Sits at the top, before any
// finer Remote Config ad settings: off here = no app-open ad for anyone.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card } from '../components/ui';
import { colors, radius } from '../theme';
import {
  fetchAppOpenEnabled,
  setAppOpenEnabled,
  fetchBannerEnabled,
  setBannerEnabled,
} from '../services/adsConfig';

export function AdsScreen() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<boolean | null>(null);
  const [bannerBusy, setBannerBusy] = useState(false);

  const load = useCallback(async () => {
    setEnabled(await fetchAppOpenEnabled().catch(() => true));
    setBanner(await fetchBannerEnabled().catch(() => true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const onToggle = async (next: boolean) => {
    const prev = enabled;
    setEnabled(next); // optimistic
    setBusy(true);
    const ok = await setAppOpenEnabled(next).catch(() => false);
    setBusy(false);
    if (!ok) setEnabled(prev ?? true); // revert on failure
  };

  const onToggleBanner = async (next: boolean) => {
    const prev = banner;
    setBanner(next); // optimistic
    setBannerBusy(true);
    const ok = await setBannerEnabled(next).catch(() => false);
    setBannerBusy(false);
    if (!ok) setBanner(prev ?? true); // revert on failure
  };

  return (
    <Screen title="מודעות" subtitle="שליטה על מודעות האפליקציה">
      {/* App-open master switch. */}
      <Card style={s.card}>
        <View style={s.row}>
          <View style={[s.icon, { backgroundColor: (enabled ? colors.green : colors.red) + '22' }]}>
            <Ionicons name="megaphone" size={22} color={enabled ? colors.green : colors.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>מודעת פתיחה</Text>
            <Text style={s.state}>
              {enabled === null ? '…' : enabled ? 'מוצגת למשתמשים' : 'כבויה — לא מוצגת לאף אחד'}
            </Text>
          </View>
          {enabled === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Switch
              value={enabled}
              onValueChange={onToggle}
              disabled={busy}
              trackColor={{ false: colors.border, true: colors.green }}
              thumbColor="#fff"
            />
          )}
        </View>
        <Text style={s.help}>
          כשכבוי — מודעת הפתיחה לא תוצג לאף משתמש. כשדולק — היא תוצג לפי כל
          הכללים הקיימים (זמן המתנה בין הצגות, מקסימום ליום, וחסד למשתמשים חדשים).
        </Text>
      </Card>

      {/* Banner master switch. */}
      <Card style={s.card}>
        <View style={s.row}>
          <View style={[s.icon, { backgroundColor: (banner ? colors.green : colors.red) + '22' }]}>
            <Ionicons name="tablet-landscape" size={22} color={banner ? colors.green : colors.red} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>באנר</Text>
            <Text style={s.state}>
              {banner === null ? '…' : banner ? 'מוצג למשתמשים' : 'כבוי — לא מוצג לאף אחד'}
            </Text>
          </View>
          {banner === null ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Switch
              value={banner}
              onValueChange={onToggleBanner}
              disabled={bannerBusy}
              trackColor={{ false: colors.border, true: colors.green }}
              thumbColor="#fff"
            />
          )}
        </View>
        <Text style={s.help}>
          כשכבוי — באנר המודעות לא יוצג בשום מסך. כשדולק — הבאנרים מוצגים כרגיל.
        </Text>
      </Card>

      <Text style={s.note}>
        * המתגים נשמרים מיד ונכנסים לתוקף באפליקציה מהגרסה שמאזינה אליהם ואילך.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { gap: 14 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 16, fontWeight: '800', textAlign: 'right' },
  state: { color: colors.textSoft, fontSize: 13, textAlign: 'right', marginTop: 2 },
  help: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'right',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
  note: { color: colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: 14, paddingHorizontal: 4 },
});
