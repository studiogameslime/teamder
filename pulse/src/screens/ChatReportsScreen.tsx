// ChatReportsScreen — "דיווחי צ'אט". Every message a user reported as abusive
// (the top-level `chatReports` collection): the offending text, who sent it,
// who reported it, and where (game/community). Grouped by the reported sender
// so a repeat offender stands out. Status cycles new → נבדק → טופל; the poller
// fires a local push the moment a new report lands.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty, Screen } from '../components/ui';
import {
  listChatReports,
  setChatReportStatus,
  deleteChatReport,
  type ChatReport,
  type ChatReportStatus,
} from '../services/chatMonitorService';

const STATUS_META: Record<ChatReportStatus, { label: string; color: string }> = {
  new: { label: 'חדש', color: colors.primary },
  reviewed: { label: 'נבדק', color: colors.amber },
  done: { label: 'טופל', color: colors.green },
};
const STATUS_ORDER: ChatReportStatus[] = ['new', 'reviewed', 'done'];

type Filter = 'all' | 'open' | 'done';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'open', label: 'פתוחים' },
  { key: 'done', label: 'טופלו' },
];

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const scopeHe = (s: string) =>
  s === 'community' ? 'מועדון' : s === 'game' ? 'משחק' : s;

interface Group {
  key: string;
  label: string;
  reports: ChatReport[];
  open: number;
}

export function ChatReportsScreen() {
  const [items, setItems] = useState<ChatReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const rows = await listChatReports().catch(() => [] as ChatReport[]);
    setItems(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<ChatReport>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const cycleStatus = async (it: ChatReport) => {
    const next =
      STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
    patch(it.id, { status: next });
    await setChatReportStatus(it.id, next).catch(() => {});
  };
  const remove = (it: ChatReport) => {
    Alert.alert(
      'למחוק דיווח?',
      `הדיווח על ההודעה של ${it.senderName || 'משתמש'} יימחק לצמיתות.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק',
          style: 'destructive',
          onPress: async () => {
            setItems((prev) => prev.filter((r) => r.id !== it.id));
            await deleteChatReport(it.id).catch(() => {});
          },
        },
      ],
    );
  };

  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.status === 'done').length;
    return { total, done, open: total - done };
  }, [items]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'open':
        return items.filter((i) => i.status !== 'done');
      case 'done':
        return items.filter((i) => i.status === 'done');
      default:
        return items;
    }
  }, [items, filter]);

  // Group by the reported sender so a repeat offender is obvious.
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const r of filtered) {
      const key = r.senderId || r.senderName || 'unknown';
      let g = map.get(key);
      if (!g) {
        g = { key, label: r.senderName || 'משתמש', reports: [], open: 0 };
        map.set(key, g);
      }
      g.reports.push(r);
      if (r.status !== 'done') g.open += 1;
    }
    return [...map.values()].sort(
      (a, b) => b.open - a.open || b.reports.length - a.reports.length,
    );
  }, [filtered]);

  return (
    <Screen
      title="דיווחי צ'אט"
      subtitle="הודעות שדווחו כפוגעניות — מי שלח, מי דיווח, ומה נכתב"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load();
          }}
          tintColor={colors.primary}
        />
      }
    >
      <View style={s.statsRow}>
        <Stat n={stats.total} label="סה״כ" color={colors.textSoft} />
        <Stat n={stats.open} label="פתוחים" color={colors.amber} />
        <Stat n={stats.done} label="טופלו" color={colors.green} />
      </View>

      <View style={s.filterRow}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[s.filterChip, filter === f.key && s.filterChipOn]}
          >
            <Text style={[s.filterTxt, filter === f.key && s.filterTxtOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : groups.length === 0 ? (
        <Empty text="אין דיווחים בקטגוריה הזו" />
      ) : (
        groups.map((g) => (
          <View key={g.key} style={s.group}>
            <View style={s.reporter}>
              <Ionicons name="person-circle" size={20} color={colors.red} />
              <Text style={s.reporterName} numberOfLines={1}>
                {g.label}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={s.reporterCount}>
                {g.open}/{g.reports.length} פתוחים
              </Text>
            </View>

            {g.reports.map((it) => {
              const sm = STATUS_META[it.status];
              return (
                <Card key={it.id} style={s.item}>
                  <View style={s.head}>
                    <View style={s.kindTag}>
                      <Ionicons name="flag" size={12} color={colors.red} />
                      <Text style={[s.kindTxt, { color: colors.red }]}>{scopeHe(it.scope)}</Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    <Pressable
                      onPress={() => cycleStatus(it)}
                      style={[s.statusPill, { borderColor: sm.color }]}
                    >
                      <View style={[s.statusDot, { backgroundColor: sm.color }]} />
                      <Text style={[s.statusTxt, { color: sm.color }]}>{sm.label}</Text>
                    </Pressable>
                    <Pressable onPress={() => remove(it)} hitSlop={8} style={s.del}>
                      <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  {it.messageText ? (
                    <Text style={s.message}>“{it.messageText}”</Text>
                  ) : (
                    <Text style={s.messageEmpty}>(ההודעה ללא טקסט)</Text>
                  )}
                  <Text style={s.meta}>
                    {['דווח ע״י ' + (it.reporterId ? it.reporterId.slice(0, 6) : '—'), timeHe(it.createdAt)]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                </Card>
              );
            })}
          </View>
        ))
      )}
    </Screen>
  );
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statN, { color }]}>{n}</Text>
      <Text style={s.statLbl}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  statsRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 10 },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  statN: { fontSize: 20, fontWeight: '800' },
  statLbl: { ...font.small, color: colors.textMuted, marginTop: 1 },
  filterRow: { flexDirection: 'row-reverse', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTxt: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  filterTxtOn: { color: '#fff' },
  group: { marginBottom: 16, gap: 8 },
  reporter: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  reporterName: { ...font.body, color: colors.text, fontWeight: '800', textAlign: 'right', maxWidth: '55%' },
  reporterCount: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  item: { gap: 8, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  kindTag: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.red + '22',
  },
  kindTxt: { ...font.small, fontWeight: '800' },
  statusPill: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { ...font.small, fontWeight: '700' },
  del: { padding: 4 },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  message: { ...font.body, color: colors.text, textAlign: 'right', lineHeight: 21 },
  messageEmpty: { ...font.body, color: colors.textMuted, textAlign: 'right', fontStyle: 'italic' },
});
