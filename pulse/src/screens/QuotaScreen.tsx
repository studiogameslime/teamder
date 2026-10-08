import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, font, radius } from '../theme';
import { Card, Screen, SectionHeader } from '../components/ui';
import {
  fetchQuota,
  notifyQuotaAlerts,
  type QuotaItem,
  type QuotaReport,
} from '../services/quota';

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

// "מתאפס בעוד 8 שעות" / "בעוד 3 ימים" / "בעוד 12 דק׳"
function resetLabel(resetAt: number | null, period: QuotaItem['period']): string {
  if (resetAt == null) return 'לא מתאפס · מכסה קבועה';
  const ms = resetAt - Date.now();
  if (ms <= 0) return 'מתאפס עכשיו';
  const mins = Math.round(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) return `מתאפס בעוד ${days} ${days === 1 ? 'יום' : 'ימים'}`;
  if (hours >= 1) return `מתאפס בעוד ${hours} ${hours === 1 ? 'שעה' : 'שעות'}`;
  return `מתאפס בעוד ${mins} דק׳`;
}

function toneFor(pct: number) {
  if (pct >= 0.8) return colors.red;
  if (pct >= 0.5) return colors.amber;
  return colors.green;
}

function QuotaBar({ item }: { item: QuotaItem }) {
  const unknown = item.used == null;
  const used = item.used ?? 0;
  const raw = item.limit > 0 ? used / item.limit : 0;
  const pct = Math.min(1, raw);
  // A fixed free allowance sitting exactly at its limit (e.g. 3/3 Scheduler
  // jobs) is the normal steady state, not an overage — show amber, not red.
  const tone = unknown
    ? colors.textMuted
    : item.period === 'קבוע' && raw <= 1
      ? raw >= 1
        ? colors.amber
        : toneFor(raw)
      : toneFor(raw);
  const pctText = unknown ? '—' : `${(pct * 100).toFixed(pct >= 0.1 ? 0 : 1)}%`;
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={[styles.pct, { color: tone }]}>{pctText}</Text>
        <View style={styles.rowLabelWrap}>
          <Text style={styles.rowLabel}>{item.label}</Text>
          <Ionicons name={item.icon as any} size={15} color={colors.textSoft} />
        </View>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: tone }]} />
      </View>
      <View style={styles.rowMeta}>
        {item.resetAt != null ? (
          <Text style={styles.rowReset}>{resetLabel(item.resetAt, item.period)}</Text>
        ) : (
          <View />
        )}
        <Text style={styles.rowNums}>
          {unknown ? 'לא זמין כרגע' : `${fmt(used)} / ${fmt(item.limit)} ל${item.period}`}
        </Text>
      </View>
      {item.detail ? <Text style={styles.rowDetail}>{item.detail}</Text> : null}
      {item.breakdown && item.breakdown.length ? (
        <View style={styles.breakdown}>
          {item.breakdown.map((b, i) => {
            const max = item.breakdown!.reduce((m, x) => Math.max(m, x.value), 1);
            return (
              <View key={i} style={styles.bdRow}>
                <Text style={styles.bdVal}>{fmt(b.value)}</Text>
                <View style={styles.bdBarTrack}>
                  <View style={[styles.bdBarFill, { width: `${(b.value / max) * 100}%` }]} />
                </View>
                <Text style={styles.bdLabel} numberOfLines={1}>{b.label}</Text>
              </View>
            );
          })}
        </View>
      ) : null}
      {item.note ? <Text style={styles.rowNote}>{item.note}</Text> : null}
    </View>
  );
}

export function QuotaScreen() {
  const nav = useNavigation<any>();
  const [data, setData] = useState<QuotaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const report = await fetchQuota();
      setData(report);
      setErr(null);
      notifyQuotaAlerts(report); // push if anything crossed 80% (deduped)
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only resettable quotas (daily/monthly) trend toward a cliff; a fixed
  // free allowance at its limit is steady-state, so it doesn't raise the alarm.
  const anyDanger = data?.groups.some((g) =>
    g.items.some(
      (i) => i.period !== 'קבוע' && i.used != null && i.used / i.limit >= 0.8,
    ),
  );

  return (
    <Screen
      title="מכסות וחינמי"
      subtitle="כמה רחוק אתה מלשלם — Firebase / Google Cloud"
      onBack={() => nav.goBack()}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.text} />}
    >
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons
          name={anyDanger ? 'warning' : 'shield-checkmark'}
          size={22}
          color={anyDanger ? colors.amber : colors.green}
        />
        <Text style={styles.statusText}>
          {err
            ? 'שגיאה בטעינת הנתונים'
            : !data
              ? 'טוען נתוני שימוש…'
              : anyDanger
                ? 'יש מכסה שמתקרבת לגבול — שווה לבדוק'
                : 'הכל בתוך החינמי בנוחות ✓'}
        </Text>
      </Card>

      {err ? <Text style={styles.err}>{err}</Text> : null}

      {data?.groups.map((g) => (
        <View key={g.title} style={{ gap: 10 }}>
          <SectionHeader>{g.title}</SectionHeader>
          <Card style={{ gap: 18 }}>
            {g.items.map((it) => (
              <QuotaBar key={it.key} item={it} />
            ))}
            <Text style={styles.reset}>{g.resetNote}</Text>
          </Card>
        </View>
      ))}

      {data ? (
        <Text style={styles.foot}>
          עודכן{' '}
          {new Date(data.fetchedAt).toLocaleTimeString('he-IL', {
            hour: '2-digit',
            minute: '2-digit',
          })}{' '}
          · נתונים מ-Cloud Monitoring (יכול להתעדכן בעיכוב של כמה דקות)
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusText: { ...font.body, color: colors.text, flex: 1, textAlign: 'right' },
  err: { ...font.small, color: colors.red, textAlign: 'center' },
  row: { gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rowLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  rowLabel: { ...font.title, color: colors.text },
  pct: { fontSize: 18, fontWeight: '800', minWidth: 52 },
  track: {
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 5 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowNums: { ...font.small, color: colors.textSoft, textAlign: 'right' },
  rowReset: { ...font.small, color: colors.textMuted, textAlign: 'left' },
  rowDetail: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 2 },
  rowNote: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 6, lineHeight: 17 },
  breakdown: { marginTop: 8, gap: 5 },
  bdRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  bdLabel: { ...font.small, color: colors.textSoft, flex: 1, textAlign: 'right' },
  bdVal: { ...font.small, color: colors.text, fontWeight: '800', minWidth: 54, textAlign: 'left' },
  bdBarTrack: { width: 70, height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  bdBarFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  reset: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 2 },
  foot: { ...font.small, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
});
