// PushScreen — per-push-type analytics + delivery health. Real "sent" counts
// grouped by type, exact delivery breakdown (delivered / failed / no-token /
// muted) from each notification's stats block, and an honest note that true
// tap/open tracking lands in the next app build.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, RTL_VALUE_ALIGN, colors  } from '../theme';
import { Card, Empty, Screen, StatTile, Disclosure } from '../components/ui';
import { fetchPushStats, type PushStats } from '../services/pushStats';

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function HealthLine({
  label,
  value,
  total,
  tint,
}: {
  label: string;
  value: number;
  total: number;
  tint: string;
}) {
  if (value <= 0) return null;
  return (
    <View style={st.hRow}>
      <View style={[st.hDot, { backgroundColor: tint }]} />
      <Text style={st.hLabel}>{label}</Text>
      <Text style={st.hPct}>{pct(value, total)}%</Text>
      <Text style={st.hVal}>{value.toLocaleString()}</Text>
    </View>
  );
}

function TypeRow({
  label,
  sent,
  ok,
  failed,
  noToken,
  opened,
  max,
}: {
  label: string;
  sent: number;
  ok: number;
  failed: number;
  noToken: number;
  opened: number;
  max: number;
}) {
  const w = max > 0 ? Math.max(4, Math.round((sent / max) * 100)) : 0;
  const issues = failed + noToken;
  return (
    <View style={st.row}>
      <View style={st.rowHead}>
        <Text style={st.rowLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={st.rowSent}>{sent.toLocaleString()}</Text>
      </View>
      <View style={st.barTrack}>
        <View style={[st.barFill, { width: `${w}%` }]} />
      </View>
      <View style={st.rowMetaRow}>
        {ok > 0 ? <Text style={st.metaOk}>{ok} נמסרו</Text> : null}
        {issues > 0 ? <Text style={st.metaBad}>{issues} בעיות טוקן</Text> : null}
        {opened > 0 ? <Text style={st.metaOpen}>{opened} נפתחו</Text> : null}
      </View>
    </View>
  );
}

export function PushScreen() {
  const [data, setData] = useState<PushStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    const d = await fetchPushStats(force).catch(() => null);
    setData(d);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const max = data?.rows[0]?.sent ?? 0;
  const deliveryRate = data ? pct(data.totalOk, data.totalAttempts) : 0;
  const issues = data ? data.totalFailed : 0;

  return (
    <Screen
      title="תקינות שליחה"
      subtitle="סיכום עד 1,000 ההתראות האחרונות"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load(true);
          }}
        />
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : !data ? (
        <Empty text="לא הצלחנו לטעון נתוני פוש" />
      ) : (
        <>
          <View style={st.tiles}>
            <StatTile label="רשומות התראה" value={data.totalSent.toLocaleString()} />
            <StatTile
              label="ניסיונות שהתקבלו"
              value={data.totalOk.toLocaleString()}
              sub={`${deliveryRate}% הצלחה`}
              tone="green"
            />
            <StatTile
              label="ניסיונות שנכשלו"
              value={issues.toLocaleString()}
              tone={issues > 0 ? 'amber' : 'default'}
            />
          </View>

          {/* Delivery health breakdown */}
          <Text style={st.section}>תקינות שליחה</Text>
          <Card style={st.healthCard}>
            <HealthLine label="התקבלו בשירות השליחה" value={data.totalOk} total={data.totalAttempts} tint={colors.green} />
            <HealthLine
              label="ניסיונות שנכשלו"
              value={data.totalFailed}
              total={data.totalAttempts}
              tint={colors.red}
            />
            <HealthLine
              label="אין טוקן למשתמש"
              value={data.totalNoToken}
              total={data.totalSent}
              tint={colors.amber}
            />
            <HealthLine
              label="כיבו את ההתראה (העדפות)"
              value={data.totalPrefOff}
              total={data.totalSent}
              tint={colors.textMuted}
            />
          </Card>

          {/* Honest note about opens */}
          <Disclosure title="איך מחושבים נתוני השליחה?"><Card style={st.note}>
            <Ionicons name="information-circle" size={18} color={colors.primary} />
            <Text style={st.noteTxt}>
              אחוז ההצלחה מחושב מתוך ניסיונות שליחה למכשירים, ולא מתוך מספר רשומות ההתראה. קבלת שירות השליחה אינה הוכחה להצגה במכשיר. נתוני פתיחה נספרים לפי סימון קריאה. הסיכום מבוסס על עד 1,000 הרשומות האחרונות לפי מועד יצירה, ואינו בהכרח כל ההיסטוריה.
            </Text>
          </Card>

          </Disclosure>
          <Text style={st.section}>נשלח לפי סוג ({data.rows.length})</Text>
          {data.rows.length === 0 ? (
            <Empty text="לא נשלחו פושים" />
          ) : (
            <Card style={st.listCard}>
              {data.rows.map((r) => (
                <TypeRow
                  key={r.type}
                  label={r.label}
                  sent={r.sent}
                  ok={r.ok}
                  failed={r.failed}
                  noToken={r.noToken}
                  opened={r.opened}
                  max={max}
                />
              ))}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const st = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  section: { direction: 'rtl' as const, color: colors.text, fontSize: 15, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, marginBottom: 8 },
  healthCard: { gap: 10, marginBottom: 14 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hDot: { width: 9, height: 9, borderRadius: 999 },
  hLabel: { direction: 'rtl' as const, flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  hPct: { direction: 'rtl' as const, color: colors.textMuted, fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: RTL_VALUE_ALIGN },
  hVal: { direction: 'rtl' as const, color: colors.text, fontSize: 16, fontWeight: '900', minWidth: 50, textAlign: RTL_VALUE_ALIGN, fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  noteTxt: { direction: 'rtl' as const, flex: 1, color: colors.textSoft, fontSize: 12.5, lineHeight: 18, textAlign: RTL_LABEL_ALIGN },
  listCard: { gap: 14 },
  row: { gap: 6 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { direction: 'rtl' as const, flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  rowSent: { color: colors.text, fontSize: 17, fontWeight: '900', marginInlineStart: 10, fontVariant: ['tabular-nums'] },
  barTrack: { height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  rowMetaRow: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' },
  metaOk: { color: colors.green, fontSize: 11.5, fontWeight: '700' },
  metaBad: { color: colors.amber, fontSize: 11.5, fontWeight: '700' },
  metaOpen: { color: colors.primary, fontSize: 11.5, fontWeight: '700' },
});
