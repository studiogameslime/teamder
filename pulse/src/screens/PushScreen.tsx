// PushScreen — per-push-type analytics + delivery health. Real "sent" counts
// grouped by type, exact delivery breakdown (delivered / failed / no-token /
// muted) from each notification's stats block, and an honest note that true
// tap/open tracking lands in the next app build.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { Card, Empty, Screen, StatTile } from '../components/ui';
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

  const load = useCallback(async () => {
    const d = await fetchPushStats().catch(() => null);
    setData(d);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const max = data?.rows[0]?.sent ?? 0;
  const deliveryRate = data ? pct(data.totalOk, data.totalSent) : 0;
  const issues = data ? data.totalFailed + data.totalNoToken : 0;

  return (
    <Screen
      title="פושים"
      subtitle="נשלח לפי סוג + תקינות שליחה אמיתית"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
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
            <StatTile label="נשלחו" value={data.totalSent.toLocaleString()} />
            <StatTile
              label="נמסרו"
              value={data.totalOk.toLocaleString()}
              sub={`${deliveryRate}% הצלחה`}
              tone="green"
            />
            <StatTile
              label="בעיות טוקן"
              value={issues.toLocaleString()}
              tone={issues > 0 ? 'amber' : 'default'}
            />
          </View>

          {/* Delivery health breakdown */}
          <Text style={st.section}>תקינות שליחה</Text>
          <Card style={st.healthCard}>
            <HealthLine label="נמסרו ל-FCM" value={data.totalOk} total={data.totalSent} tint={colors.green} />
            <HealthLine
              label="נכשלו (טוקן לא תקין)"
              value={data.totalFailed}
              total={data.totalSent}
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
          <Card style={st.note}>
            <Ionicons name="information-circle" size={18} color={colors.primary} />
            <Text style={st.noteTxt}>
              "נמסרו" = ה-FCM קיבל את ההודעה לשליחה. "נפתחו" (תקתוק) עדיין לא מתועד — ייכנס
              בגרסת האפליקציה הבאה ואז יופיע שיעור פתיחה אמיתי לכל סוג.
            </Text>
          </Card>

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
  section: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'right', marginBottom: 8 },
  healthCard: { gap: 10, marginBottom: 14 },
  hRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hDot: { width: 9, height: 9, borderRadius: 999 },
  hLabel: { flex: 1, color: colors.text, fontSize: 13.5, fontWeight: '700', textAlign: 'right' },
  hPct: { color: colors.textMuted, fontSize: 12, fontWeight: '700', minWidth: 36, textAlign: 'left' },
  hVal: { color: colors.text, fontSize: 16, fontWeight: '900', minWidth: 50, textAlign: 'left', fontVariant: ['tabular-nums'] },
  note: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 14 },
  noteTxt: { flex: 1, color: colors.textSoft, fontSize: 12.5, lineHeight: 18, textAlign: 'right' },
  listCard: { gap: 14 },
  row: { gap: 6 },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  rowSent: { color: colors.text, fontSize: 17, fontWeight: '900', marginInlineStart: 10, fontVariant: ['tabular-nums'] },
  barTrack: { height: 8, borderRadius: 999, backgroundColor: colors.border, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 999, backgroundColor: colors.primary },
  rowMetaRow: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' },
  metaOk: { color: colors.green, fontSize: 11.5, fontWeight: '700' },
  metaBad: { color: colors.amber, fontSize: 11.5, fontWeight: '700' },
  metaOpen: { color: colors.primary, fontSize: 11.5, fontWeight: '700' },
});
