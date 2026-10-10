import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Screen } from '../components/ui';
import { Donut } from '../components/Donut';
import { compact } from '../format';
import {
  fetchAnalyticsFull,
  type AnalyticsFull,
  type RangeKey,
} from '../services/analyticsFull';
import type { NameCount } from '../types';

type Range = RangeKey;
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'היום' },
  { key: 'yesterday', label: 'אתמול' },
  { key: '7d', label: '7 ימים' },
  { key: 'all', label: 'כל הזמנים' },
];
const DONUT = ['#22C55E', '#0A84FF', '#06B6D4', '#A855F7', '#F59E0B', '#94A3B8'];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function Delta({ d }: { d: number | null }) {
  if (d == null) return null;
  const up = d >= 0;
  return (
    <Text style={[styles.delta, { color: up ? colors.green : colors.red }]}>
      {up ? '↑' : '↓'} {Math.abs(d)}% מהתקופה הקודמת
    </Text>
  );
}

function Kpi({ label, value, delta, icon, color }: {
  label: string; value: string; delta: number | null;
  icon: keyof typeof Ionicons.glyphMap; color: string;
}) {
  return (
    <Card style={styles.kpi}>
      <View style={[styles.kpiBadge, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{value}</Text>
      <Delta d={delta} />
    </Card>
  );
}

function Funnel({ label, pct, sub, icon, color }: {
  label: string; pct: number; sub: string;
  icon: keyof typeof Ionicons.glyphMap; color: string;
}) {
  return (
    <Card style={styles.funnel}>
      <Text style={styles.funnelLabel} numberOfLines={2}>{label}</Text>
      <Text style={styles.funnelPct}>{pct.toFixed(pct < 10 ? 1 : 0)}%</Text>
      <Ionicons name={icon} size={20} color={color} />
      <View style={styles.funnelTrack}>
        <View style={[styles.funnelFill, { width: `${Math.min(100, pct)}%`, backgroundColor: color }]} />
      </View>
      <Text style={[styles.funnelSub, { color }]}>{sub}</Text>
    </Card>
  );
}

function LegendRow({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel} numberOfLines={1}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={styles.legendPct}>{pct}%</Text>
    </View>
  );
}

export function AnalyticsScreen() {
  const [data, setData] = useState<AnalyticsFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('7d');
  const [showAllActions, setShowAllActions] = useState(false);

  const load = useCallback(async (r: Range, force = false) => {
    try {
      setData(await fetchAnalyticsFull(r, { force }));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { setLoading(true); load(range); }, [range, load]);

  const d = data;
  const totalU = d?.totalUsers || 1;
  const acqTotal = useMemo(() => (d?.acquisition ?? []).reduce((s, a) => s + a.value, 0) || 1, [d]);
  const devTotal = useMemo(() => (d?.devices ?? []).reduce((s, a) => s + a.value, 0) || 1, [d]);
  const openRate = d && d.pushSent ? Math.round((d.pushOpened / d.pushSent) * 100) : 0;

  return (
    <Screen
      title="אנליטיקה"
      subtitle="Google Analytics + נתוני אפליקציה"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(range, true); }} tintColor={colors.primary} />}
    >
      <View style={styles.segment}>
        {RANGES.map((r) => {
          const a = range === r.key;
          return (
            <Pressable key={r.key} onPress={() => setRange(r.key)} style={[styles.seg, a && styles.segActive]}>
              <Text numberOfLines={1} style={[styles.segText, a && styles.segTextActive]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* 4 KPIs */}
      <View style={styles.row}>
        <Kpi label="משתמשים פעילים" value={compact(d?.activeUsers ?? 0)} delta={d?.activeUsersDelta ?? null} icon="people" color="#A855F7" />
        <Kpi label="משתמשים חדשים" value={compact(d?.newUsers ?? 0)} delta={d?.newUsersDelta ?? null} icon="person-add" color={colors.green} />
      </View>
      <View style={styles.row}>
        <Kpi label="שיעור חזרה" value={`${Math.round((d?.returnRate ?? 0) * 100)}%`} delta={d?.returnRateDelta ?? null} icon="refresh" color="#0A84FF" />
        <Kpi label="זמן ממוצע באפליקציה" value={d ? mmss(d.avgEngagementSec) : '—'} delta={d?.avgEngagementDelta ?? null} icon="time" color={colors.amber} />
      </View>

      {/* engagement funnels */}
      <Text style={styles.section}>מעורבות משתמשים</Text>
      <View style={styles.funnelRow}>
        <Funnel label="בקהילה" pct={(d?.inCommunity ?? 0) / totalU * 100} sub={`${d?.inCommunity ?? 0} מתוך ${totalU}`} icon="people" color="#A855F7" />
        <Funnel label="ללא קהילה" pct={(d?.notInCommunity ?? 0) / totalU * 100} sub={`${d?.notInCommunity ?? 0} מתוך ${totalU}`} icon="people-outline" color={colors.amber} />
        <Funnel label="יצרו משחק" pct={(d?.createdGame ?? 0) / totalU * 100} sub={`${d?.createdGame ?? 0} מתוך ${totalU}`} icon="football" color={colors.green} />
        <Funnel label="נרשמו למשחק" pct={(d?.registeredGame ?? 0) / totalU * 100} sub={`${d?.registeredGame ?? 0} מתוך ${totalU}`} icon="checkmark-circle" color="#0A84FF" />
        <Funnel label="יצרו קהילה" pct={(d?.createdCommunity ?? 0) / totalU * 100} sub={`${d?.createdCommunity ?? 0} מתוך ${totalU}`} icon="flag" color={colors.red} />
      </View>

      {/* top actions */}
      {d?.topActions.length ? (
        <Card style={{ gap: 6 }}>
          <Text style={[styles.section, { marginBottom: 4 }]}>פעולות מובילות באפליקציה</Text>
          {(showAllActions ? d.topActions : d.topActions.slice(0, 8)).map((a, i, arr) => (
            <View key={a.name + i} style={[styles.evRow, i < arr.length - 1 && styles.evDivider]}>
              <Text style={styles.evCount}>{compact(a.value)}</Text>
              <Text style={styles.evName}>{a.name}</Text>
            </View>
          ))}
          {d.topActions.length > 8 ? (
            <Pressable onPress={() => setShowAllActions((v) => !v)}>
              <Text style={styles.more}>
                {showAllActions ? 'הצג פחות ▲' : `הצג עוד (${d.topActions.length - 8}) ▼`}
              </Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {/* acquisition */}
      {d?.acquisition.length ? (
        <Card style={{ gap: 12 }}>
          <Text style={styles.section}>מקורות גיוס משתמשים</Text>
          <View style={styles.donutWrap}>
            <Donut segments={d.acquisition.map((a, i) => ({ value: a.value, color: DONUT[i % DONUT.length] }))} size={104} thickness={16} />
            <View style={{ flex: 1, gap: 7 }}>
              {d.acquisition.slice(0, 6).map((a, i) => (
                <LegendRow key={a.name + i} color={DONUT[i % DONUT.length]} label={a.name} value={a.value} total={acqTotal} />
              ))}
            </View>
          </View>
        </Card>
      ) : null}

      {/* push */}
      <Card style={{ gap: 12 }}>
        <Text style={styles.section}>התרעות (Push)</Text>
        <View style={styles.pushRow}>
          <PushStat label="נשלחו" value={compact(d?.pushSent ?? 0)} />
          <View style={styles.vline} />
          <PushStat label="נפתחו" value={compact(d?.pushOpened ?? 0)} />
          <View style={styles.vline} />
          <PushStat label="שיעור פתיחה" value={`${openRate}%`} tone={colors.green} />
        </View>
      </Card>

      {/* friends */}
      <Card style={{ gap: 12 }}>
        <Text style={styles.section}>חברויות</Text>
        <View style={styles.pushRow}>
          <PushStat label="נשלחו" value={compact(d?.friendsSent ?? 0)} />
          <View style={styles.vline} />
          <PushStat label="אושרו" value={compact(d?.friendsAccepted ?? 0)} tone={colors.green} />
          <View style={styles.vline} />
          <PushStat
            label="שיעור אישור"
            value={`${d && d.friendsSent ? Math.round((d.friendsAccepted / d.friendsSent) * 100) : 0}%`}
            tone={colors.green}
          />
        </View>
      </Card>

      {/* devices */}
      {d?.devices.length ? (
        <Card style={{ gap: 12 }}>
          <Text style={styles.section}>מכשירים</Text>
          <View style={styles.donutWrap}>
            <Donut
              segments={d.devices.map((dv) => ({ value: dv.value, color: /android/i.test(dv.name) ? '#34A853' : /ios|iphone/i.test(dv.name) ? '#A855F7' : '#94A3B8' }))}
              size={104}
              thickness={16}
            />
            <View style={{ flex: 1, gap: 8 }}>
              {d.devices.map((dv) => {
                const c = /android/i.test(dv.name) ? '#34A853' : /ios|iphone/i.test(dv.name) ? '#A855F7' : '#94A3B8';
                const pct = devTotal ? Math.round((dv.value / devTotal) * 100) : 0;
                return (
                  <View key={dv.name} style={styles.deviceRow}>
                    <View style={[styles.legendDot, { backgroundColor: c }]} />
                    <Text style={styles.deviceName}>{dv.name}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={styles.devicePct}>{pct}% · {compact(dv.value)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </Card>
      ) : null}

      {loading && !d ? <Text style={styles.loadingText}>טוען…</Text> : null}
    </Screen>
  );
}

function PushStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 3 }}>
      <Text style={[styles.pushValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.pushLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  seg: { flex: 1, paddingVertical: 9, paddingHorizontal: 2, borderRadius: radius.sm, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { ...font.body, fontSize: 13, color: colors.textSoft, fontWeight: '600' },
  segTextActive: { color: '#fff', fontWeight: '800' },

  row: { flexDirection: 'row', gap: 12 },
  kpi: { flex: 1, gap: 4, alignItems: 'center', paddingVertical: 16 },
  kpiBadge: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  kpiLabel: { ...font.small, color: colors.textMuted, textAlign: 'center' },
  kpiValue: { fontSize: 28, fontWeight: '900', color: colors.text },
  delta: { ...font.small, fontWeight: '700' },

  section: { ...font.h2, fontSize: 16, marginTop: 4 },
  funnelRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  funnel: { width: '47%', flexGrow: 1, alignItems: 'center', gap: 7, paddingVertical: 14 },
  funnelLabel: { ...font.small, color: colors.textSoft, textAlign: 'center', minHeight: 32 },
  funnelPct: { fontSize: 24, fontWeight: '900', color: colors.text },
  funnelTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  funnelFill: { height: 6, borderRadius: 3 },
  funnelSub: { ...font.small, fontWeight: '700' },

  donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...font.body, color: colors.text },
  legendPct: { ...font.small, color: colors.textSoft, fontWeight: '700' },

  pushRow: { flexDirection: 'row', alignItems: 'center' },
  vline: { width: 1, height: 38, backgroundColor: colors.border },
  pushValue: { fontSize: 24, fontWeight: '900', color: colors.text },
  pushLabel: { ...font.small, color: colors.textMuted },

  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  deviceName: { ...font.body, color: colors.text, fontWeight: '600' },
  devicePct: { ...font.small, color: colors.textSoft, fontWeight: '700' },

  loadingText: { ...font.body, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
  more: { ...font.small, color: colors.primary, fontWeight: '700', textAlign: 'center', paddingVertical: 4 },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  evDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  evCount: { ...font.title, fontSize: 16, color: colors.text, minWidth: 40, textAlign: 'left' },
  evName: { flex: 1, ...font.body, color: colors.text, fontSize: 15, textAlign: 'right' },
});
