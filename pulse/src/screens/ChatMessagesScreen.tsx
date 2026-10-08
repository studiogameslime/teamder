// ChatMessagesScreen — "הודעות צ'אט". A live, newest-first feed of every chat
// message across all games & communities (sender + text + where). The poller
// fires a local push per new message; this screen is the concentrated view to
// scroll back through them. Read-only.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty, Screen } from '../components/ui';
import { listRecentChatMessages, type ChatMsg } from '../services/chatMonitorService';

type Filter = 'all' | 'game' | 'community';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'community', label: 'מועדונים' },
  { key: 'game', label: 'משחקים' },
];

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const scopeHe = (s: string) =>
  s === 'community' ? 'מועדון' : s === 'game' ? 'משחק' : s;

export function ChatMessagesScreen() {
  const [items, setItems] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    const rows = await listRecentChatMessages(80).catch(() => [] as ChatMsg[]);
    setItems(rows);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((m) => m.scope === filter)),
    [items, filter],
  );

  return (
    <Screen
      title="הודעות צ'אט"
      subtitle="כל הודעה שנשלחה בצ׳אטים — שולח, היכן, ומה נכתב"
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
      ) : filtered.length === 0 ? (
        <Empty text="אין הודעות להצגה" />
      ) : (
        filtered.map((m) => (
          <Card key={`${m.parentId}:${m.id}`} style={s.item}>
            <View style={s.head}>
              <Ionicons
                name={m.scope === 'community' ? 'shield' : 'football'}
                size={14}
                color={colors.primary}
              />
              <Text style={s.sender} numberOfLines={1}>
                {m.senderName || 'משתמש'}
              </Text>
              <View style={{ flex: 1 }} />
              <Text style={s.scope}>{scopeHe(m.scope)}</Text>
            </View>
            {m.text ? <Text style={s.message}>{m.text}</Text> : null}
            <Text style={s.meta}>{timeHe(m.createdAt)}</Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
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
  item: { gap: 6, marginBottom: 8 },
  head: { flexDirection: 'row-reverse', alignItems: 'center', gap: 6 },
  sender: { ...font.body, color: colors.text, fontWeight: '800', textAlign: 'right', maxWidth: '60%' },
  scope: { ...font.small, color: colors.textSoft, fontWeight: '700' },
  message: { ...font.body, color: colors.text, textAlign: 'right', lineHeight: 21 },
  meta: { ...font.small, color: colors.textMuted, textAlign: 'right' },
});
