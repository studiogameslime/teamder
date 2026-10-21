import { observeCaughtError } from '../services/errorObservation';
import { useNavigation } from '@react-navigation/native';
// ReportsBody — "דיווחים ממשתמשים" segment of the unified Dev Inbox. Every
// user-submitted bug report / suggestion (the `feedback` collection) with text,
// context, and the attached SCREENSHOT (tap to zoom). Grouped by reporter/screen.
// Each report can be FLAGGED "fix this" for Claude to process. Self-scrolling
// (no Screen header) so it sits under the shared segmented control.

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';
import { Disclosure, Card, Empty } from '../components/ui';
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
  const nav = useNavigation<any>();
  const [items, setItems] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [groupMode, setGroupMode] = useState<GroupMode>('reporter');
  const saving = useRef(new Set<string>());

  const load = useCallback(async () => {
    const rows = await listReports().catch((caughtError4a1ecedb8b: unknown) => { observeCaughtError(caughtError4a1ecedb8b, {"source":"pulse/src/screens/ReportsScreen.tsx","handler":"ReportsBody","site":"ReportsScreen:4a1ecedb8b"}); return [] as ReportItem[]; });
    setItems(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (id: string, p: Partial<ReportItem>) =>
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const saveChange = async (id: string, write: () => Promise<boolean>, apply: () => void) => {
    if (saving.current.has(id)) return;
    saving.current.add(id);
    try {
      if (!await write()) throw new Error('not saved');
      apply();
    } catch (caughtError83832a5633) {
    observeCaughtError(caughtError83832a5633, {"source":"pulse/src/screens/ReportsScreen.tsx","handler":"saveChange","site":"ReportsScreen:83832a5633"}); Alert.alert('השינוי לא נשמר', 'הדיווח נשאר במצבו הקודם. נסו שוב.'); }
    finally { saving.current.delete(id); }
  };
  const cycleStatus = async (it: ReportItem) => {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(it.status) + 1) % STATUS_ORDER.length];
    await saveChange(it.id, () => setReportStatus(it.id, next), () => patch(it.id, { status: next }));
  };
  const toggleFix = async (it: ReportItem) => {
    await saveChange(it.id, () => setReportFixRequested(it.id, !it.fixRequested), () => patch(it.id, { fixRequested: !it.fixRequested }));
  };
  const remove = (it: ReportItem) => Alert.alert('למחוק דיווח?', it.userName || 'משתמש', [
    { text: 'ביטול', style: 'cancel' },
    { text: 'מחק', style: 'destructive', onPress: () => void saveChange(it.id,
      () => deleteReport(it.id), () => setItems(previous => previous.filter(row => row.id !== it.id))) },
  ]);

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
      <Text style={{ ...font.title,textAlign: RTL_LABEL_ALIGN,marginBottom:12}}>{stats.open} דיווחים פתוחים · {stats.flagged} מסומנים לתיקון</Text>
      <Disclosure title="קיבוץ הדיווחים">
      {/* Group-by toggle */}
      <View style={s.filterRow}>
        <Pressable
          onPress={() => setGroupMode('reporter')}
          style={[s.segChip, groupMode === 'reporter' && s.segChipOn]}
        >
          <Ionicons name="person" size={13} color={groupMode === 'reporter' ? colors.onPrimary : colors.textSoft} />
          <Text style={[s.filterTxt, groupMode === 'reporter' && s.filterTxtOn]}>לפי מדווח</Text>
        </Pressable>
        <Pressable
          onPress={() => setGroupMode('screen')}
          style={[s.segChip, groupMode === 'screen' && s.segChipOn]}
        >
          <Ionicons name="phone-portrait" size={13} color={groupMode === 'screen' ? colors.onPrimary : colors.textSoft} />
          <Text style={[s.filterTxt, groupMode === 'screen' && s.filterTxtOn]}>לפי מסך</Text>
        </Pressable>
      </View>

      </Disclosure>
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
                  {it.message ? <Text style={s.message} numberOfLines={3}>{it.message}</Text> : null}
                  <Pressable accessibilityRole="button" onPress={() => nav.navigate('ErrorDetail', {id:it.id,collection:'feedback'})} style={{paddingVertical:14}}><Text style={{ direction: 'rtl' as const,color:colors.primary,fontWeight:'700',textAlign: RTL_LABEL_ALIGN}}>פתיחת אבחון, צילום ורצף פעולות</Text></Pressable>
                  <Disclosure title="פעולות ופרטי הדיווח">
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

                  {it.message ? <Text style={s.message}>{it.message}</Text> : null}
                  </Disclosure>
                </Card>
              );
            })}
          </View>
        ))
      )}


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
  statsRow: { flexDirection: 'row', direction: 'rtl' as const, gap: 8, marginBottom: 10 },
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
  filterRow: { flexDirection: 'row', direction: 'rtl' as const, gap: 8, marginBottom: 12, flexWrap: 'wrap' },
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
  filterTxtOn: { color: colors.onPrimary },
  segChip: {
    flexDirection: 'row', direction: 'rtl' as const,
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
  reporter: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 7, paddingHorizontal: 2 },
  reporterName: {  ...font.body, color: colors.text, fontWeight: '800', textAlign: RTL_LABEL_ALIGN, maxWidth: '55%' },
  reporterCount: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  flagBadge: {
    flexDirection: 'row', direction: 'rtl' as const,
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.red + '1A',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  flagBadgeTxt: { ...font.small, color: colors.red, fontWeight: '800' },
  item: { gap: 8, marginBottom: 8 },
  head: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 6 },
  kindTag: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm },
  kindTxt: { ...font.small, fontWeight: '800' },
  fixBtn: {
    flexDirection: 'row', direction: 'rtl' as const,
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
  statusPill: { flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { ...font.small, fontWeight: '700' },
  del: { padding: 4 },
  meta: {  ...font.small, color: colors.textMuted, textAlign: RTL_LABEL_ALIGN },
  message: {  ...font.body, color: colors.text, textAlign: RTL_LABEL_ALIGN, lineHeight: 21 },
  shotWrap: { borderRadius: radius.md, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  shot: { width: '100%', height: 200 },
  zoomHint: { position: 'absolute', bottom: 6, left: 6, flexDirection: 'row', direction: 'rtl' as const, alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  zoomHintTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  zoomImg: { width: '94%', height: '82%' },
  zoomClose: { position: 'absolute', top: 48, right: 20, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
});
