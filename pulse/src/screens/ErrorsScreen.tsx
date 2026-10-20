// ErrorsBody — the "שגיאות" segment of the unified Dev Inbox (DevInboxScreen).
// Self-scrolling content (no Screen header) so it can sit under a shared
// segmented control. Reads technical errors only; user feedback has its own detail view.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RtlTextInput as TextInput } from '../components/RtlTextInput';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RTL_LABEL_ALIGN, colors, font, radius  } from '../theme';
import { SectionTabs, Card, Empty, StatTile } from '../components/ui';
import { fetchErrors } from '../services/errorsService';
import { describeError } from '../services/errorCatalog';
import { timeAgo } from '../format';
import type { ErrorRecord, ErrorStatus } from '../types';
import type { ErrorsStackParams } from '../navigation/ErrorsStack';

const STATUS_COLOR: Record<ErrorStatus, string> = {
  new: colors.red,
  reviewed: colors.amber,
  resolved: colors.green,
};
const STATUS_LABEL: Record<ErrorStatus, string> = {
  new: 'ממתין',
  reviewed: 'בטיפול 🛠️',
  resolved: 'תוקן ✓',
};

type Filter = 'open' | 'all' | 'resolved';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'open', label: 'פעילות' },
  { key: 'all', label: 'הכל' },
  { key: 'resolved', label: 'תוקנו' },
];

export function ErrorItem({ e }: { e: ErrorRecord }) {
  const v = describeError(e);
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <View style={[styles.dot, { backgroundColor: STATUS_COLOR[e.status] }]} />
        <Text style={styles.op} numberOfLines={2}>
          {v.title}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={styles.count}>×{e.count}</Text>
      </View>
      <View style={styles.meta}>
        <Text style={[styles.catTag, { color: v.catColor }]}>
          {v.catEmoji} {v.catLabel}
        </Text>
        {v.whereLabel ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{v.whereLabel}</Text>
          </>
        ) : null}
      </View>
      <Text style={styles.msg} numberOfLines={2}>
        {v.why}
      </Text>
      <View style={styles.meta}>
        <Text style={[styles.status, { color: STATUS_COLOR[e.status] }]}>
          {STATUS_LABEL[e.status]}
        </Text>
        <Text style={styles.metaDot}>·</Text>
        <Text style={styles.metaText}>{timeAgo(e.lastSeen)}</Text>
        {e.platform ? (
          <>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.metaText}>{e.platform}</Text>
          </>
        ) : null}
      </View>
    </Card>
  );
}

export function ErrorsBody() {
  const nav =
    useNavigation<NativeStackNavigationProp<ErrorsStackParams, 'DevInbox'>>();
  const [search, setSearch] = useState('');
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('open');

  const load = useCallback(async (force = false) => {
    try {
      setErrors(await fetchErrors(force));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh when returning from the detail screen (status may have changed).
  // Uses the cache (a status write already invalidated it), so 0 reads.
  useEffect(() => nav.addListener('focus', () => load()), [nav, load]);

  const shown = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    const matches = errors.filter(e => !needle || `${describeError(e).title} ${e.message} ${e.screen ?? ''} ${e.userId ?? ''}`.toLocaleLowerCase().includes(needle));
    if (filter === 'all') return matches;
    if (filter === 'resolved') return matches.filter((e) => e.status === 'resolved');
    return matches.filter((e) => e.status !== 'resolved');
  }, [errors, filter, search]);

  const openCount = errors.filter((e) => e.status !== 'resolved').length;
  const totalOccur = errors.reduce((s, e) => s + e.count, 0);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.scroll}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            load(true);
          }}
          tintColor={colors.primary}
        />
      }
    >
      <Card><Text style={font.title}>{loading ? 'טוען…' : `${openCount} שגיאות פתוחות`}</Text><Text style={font.small}>{errors.length} סוגי שגיאות · {totalOccur} מקרים</Text></Card>
      <TextInput accessibilityLabel="חיפוש שגיאה" value={search} onChangeText={setSearch} placeholder="חיפוש שגיאה, מסך או משתמש" placeholderTextColor={colors.textMuted} style={{ direction: 'rtl' as const,padding:14,color:colors.text,textAlign: RTL_LABEL_ALIGN,backgroundColor:colors.surface,borderRadius:12}} />
      <SectionTabs value={filter} onChange={setFilter} items={FILTERS} />

      {loading ? null : shown.length ? (
        shown.map((e) => (
          <Pressable
            key={`${e.coll ?? 'errors'}:${e.id}`}
            onPress={() => nav.navigate('ErrorDetail', { id: e.id, collection: e.coll ?? 'errors' })}
          >
            <ErrorItem e={e} />
          </Pressable>
        ))
      ) : (
        <Empty text={errors.length ? 'אין שגיאות בקטגוריה זו' : 'אין שגיאות 🎉'} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },
  row: { flexDirection: 'row', gap: 12 },
  chips: { flexDirection: 'row', gap: 8, marginVertical: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...font.small, color: colors.textSoft },
  chipTextActive: { color: colors.onPrimary, fontWeight: '700' },
  card: { gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  op: { ...font.title, fontSize: 15, flexShrink: 1 },
  catTag: { ...font.small, fontWeight: '700' },
  count: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  msg: { ...font.body, color: colors.text, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  status: { ...font.small, fontWeight: '700' },
  metaText: { ...font.small },
  metaDot: { color: colors.textMuted },
});
