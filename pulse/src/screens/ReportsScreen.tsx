import { DiagnosticTimeline } from '../components/DiagnosticTimeline';
// ReportsBody — "דיווחים ממשתמשים" segment of the unified Dev Inbox. Every
// user-submitted bug report / suggestion (the `feedback` collection) with text,
// context, and the attached SCREENSHOT (tap to zoom). Grouped by reporter/screen.
// Each report can be FLAGGED "fix this" for Claude to process. Self-scrolling
// (no Screen header) so it sits under the shared segmented control.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty } from '../components/ui';
import {
  listReports,
  groupByReporter,
  groupByScreen,
  setReportStatus,
  setReportFixRequested,
  deleteReport,
  type ReportItem,
  type ReportStatus,
} from '../services/reportsService';
import { screenHe } from '../services/screenNames';

type GroupMode = 'reporter' | 'screen';

const dataUri = (b64: string) => `data:image/jpeg;base64,${b64}`;

const STATUS_META: Record<ReportStatus, { label: string; color: string }> = {
  new: { label: 'חדש', color: colors.primary },
  reviewed: { label: 'נבדק', color: colors.amber },
  done: { label: 'טופל', color: colors.green },
};
const STATUS_ORDER: ReportStatus[] = ['new', 'reviewed', 'done'];

type Filter = 'all' | 'fix' | 'open' | 'done';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'fix', label: 'מסומן לתיקון' },
  { key: 'open', label: 'פתוחים' },
  { key: 'done', label: 'טופלו' },
];

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ReportsBody() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [groupMode, setGroupMode] = useState<GroupMode>('reporter');

  const load = useCallback(async () => {
    const rows = await listReports().catch(() => [] as ReportItem[]);
    setItems(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<ReportItem>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const cycleStatus = async (it: ReportItem) => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
    patch(it.id, { status: next });
    await setReportStatus(it.id, next).catch(() => {});
  };
  const toggleFix = async (it: ReportItem) => {
    patch(it.id, { fixRequested: !it.fixRequested });
    await setReportFixRequested(it.id, !it.fixRequested).catch(() => {});
  };
  const remove = (it: ReportItem) => {
    // Confirm first — deletion is permanent and was previously a single tap.
    Alert.alert(
      'למחוק דיווח?',
      `הדיווח של ${it.userName || 'משתמש'} יימחק לצמיתות ולא ניתן לשחזר.`,
      [
        { text: 'ביטול', style: 'cancel' },
        {
          text: 'מחק',
          style: 'destructive',
          onPress: async () => {
            setItems((prev) => prev.filter((r) => r.id !== it.id));
            await deleteReport(it.id).catch(() => {});
          },
        },
      ],
    );
  };

  // Stats over ALL items (not the filtered view).
  const stats = useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.status === 'done').length;
    const flagged = items.filter((i) => i.fixRequested && i.status !== 'done').length;
    return { total, done, open: total - done, flagged };
  }, [items]);

  const filtered = useMemo(() => {
    switch (filter) {
      case 'fix':
        return items.filter((i) => i.fixRequested && i.status !== 'done');
      case 'open':
        return items.filter((i) => i.status !== 'done');
      case 'done':
        return items.filter((i) => i.status === 'done');
      default:
        return items;
    }
  }, [items, filter]);

  const groups = useMemo(
    () => (groupMode === 'screen' ? groupByScreen(filtered) : groupByReporter(filtered)),
    [filtered, groupMode],
  );

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={s.scroll}
      showsVerticalScrollIndicator={false}
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
      {/* Stats row */}
      <View style={s.statsRow}>
        <Stat n={stats.total} label="סה״כ" color={colors.textSoft} />
        <Stat n={stats.open} label="פתוחים" color={colors.amber} />
        <Stat n={stats.done} label="טופלו" color={colors.green} />
        <Stat n={stats.flagged} label="לתיקון" color={colors.red} />
      </View>

      {/* Group-by toggle */}
      <View style={s.filterRow}>
        <Pressable
          onPress={() => setGroupMode('reporter')}
          style={[s.segChip, groupMode === 'reporter' && s.segChipOn]}
        >
          <Ionicons name="person" size={13} color={groupMode === 'reporter' ? '#fff' : colors.textSoft} />
          <Text style={[s.filterTxt, groupMode === 'reporter' && s.filterTxtOn]}>לפי מדווח</Text>
        </Pressable>
        <Pressable
          onPress={() => setGroupMode('screen')}
          style={[s.segChip, groupMode === 'screen' && s.segChipOn]}
        >
          <Ionicons name="phone-portrait" size={13} color={groupMode === 'screen' ? '#fff' : colors.textSoft} />
          <Text style={[s.filterTxt, groupMode === 'screen' && s.filterTxtOn]}>לפי מסך</Text>
        </Pressable>
      </View>

      {/* Filters */}
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
            {/* Group header — reporter name or screen name + counts */}
            <View style={s.reporter}>
              <Ionicons
                name={groupMode === 'screen' ? 'phone-portrait' : 'person-circle'}
                size={20}
                color={colors.primary}
              />
              <Text style={s.reporterName} numberOfLines={1}>
                {g.label}
              </Text>
              <View style={{ flex: 1 }} />
              {g.fixRequested > 0 ? (
                <View style={s.flagBadge}>
                  <Ionicons name="construct" size={11} color={colors.red} />
                  <Text style={s.flagBadgeTxt}>{g.fixRequested}</Text>
                </View>
              ) : null}
              <Text style={s.reporterCount}>
                תוקנו {g.fixed}/{g.total}
              </Text>
            </View>

            {g.reports.map((it) => {
              const sm = STATUS_META[it.status];
              const isBug = it.type === 'bug';
              return (
                <Card key={it.id} style={s.item}>
                  <View style={s.head}>
                    <View
                      style={[s.kindTag, { backgroundColor: (isBug ? colors.red : colors.primary) + '22' }]}
                    >
                      <Ionicons name={isBug ? 'bug' : 'bulb'} size={12} color={isBug ? colors.red : colors.primary} />
                      <Text style={[s.kindTxt, { color: isBug ? colors.red : colors.primary }]}>
                        {isBug ? 'באג' : 'הצעה'}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }} />
                    {/* Flag for Claude to fix */}
                    <Pressable
                      onPress={() => toggleFix(it)}
                      style={[s.fixBtn, it.fixRequested && s.fixBtnOn]}
                    >
                      <Ionicons
                        name="construct"
                        size={13}
                        color={it.fixRequested ? '#fff' : colors.textMuted}
                      />
                      <Text style={[s.fixTxt, it.fixRequested && { color: '#fff' }]}>
                        {it.fixRequested ? 'מסומן' : 'תקן'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => cycleStatus(it)} style={[s.statusPill, { borderColor: sm.color }]}>
                      <View style={[s.statusDot, { backgroundColor: sm.color }]} />
                      <Text style={[s.statusTxt, { color: sm.color }]}>{sm.label}</Text>
                    </Pressable>
                    <Pressable onPress={() => remove(it)} hitSlop={8} style={s.del}>
                      <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  <Text style={s.meta}>
                    {[it.userName, it.screen ? screenHe(it.screen) : null, it.appVersion, it.platform, timeHe(it.createdAt)]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                  <DiagnosticTimeline docPath={`feedback/${it.id}`} />
                  {it.message ? <Text style={s.message}>{it.message}</Text> : null}
                  {it.image ? (
                    <Pressable style={s.shotWrap} onPress={() => setZoom(it.image!)}>
                      <Image source={{ uri: dataUri(it.image) }} style={s.shot} resizeMode="cover" />
                      <View style={s.zoomHint}>
                        <Ionicons name="expand-outline" size={13} color="#fff" />
                        <Text style={s.zoomHintTxt}>הגדל</Text>
                      </View>
                    </Pressable>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ))
      )}

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <Pressable style={s.zoomBackdrop} onPress={() => setZoom(null)}>
          {zoom ? <Image source={{ uri: dataUri(zoom) }} style={s.zoomImg} resizeMode="contain" /> : null}
          <View style={s.zoomClose}>
            <Ionicons name="close" size={26} color="#fff" />
          </View>
        </Pressable>
      </Modal>
    </ScrollView>
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
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },
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
  segChip: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  group: { marginBottom: 16, gap: 8 },
  reporter: { flexDirection: 'row-reverse', alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  reporterName: { ...font.body, color: colors.text, fontWeight: '800', textAlign: 'right', maxWidth: '55%' },
  reporterCount: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  flagBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.red + '1A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  flagBadgeTxt: { ...font.small, color: colors.red, fontWeight: '800' },
  item: { gap: 8, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  kindTag: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm },
  kindTxt: { ...font.small, fontWeight: '800' },
  fixBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fixBtnOn: { backgroundColor: colors.red, borderColor: colors.red },
  fixTxt: { ...font.small, color: colors.textMuted, fontWeight: '700' },
  statusPill: { flexDirection: 'row-reverse', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { ...font.small, fontWeight: '700' },
  del: { padding: 4 },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
  message: { ...font.body, color: colors.text, textAlign: 'right', lineHeight: 21 },
  shotWrap: { borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  shot: { width: '100%', height: 200 },
  zoomHint: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row-reverse', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  zoomHintTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '94%', height: '82%' },
  zoomClose: { position: 'absolute', top: 48, right: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
