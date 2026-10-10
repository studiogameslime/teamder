// MessagesScreen — every conversation between a user and the Teamder account,
// in one place.
//
// Before this the only way in was a small box at the top of the tasks screen
// that appeared solely when someone was waiting: a thread vanished the moment
// it was answered, so "did they ever reply to what I sent?" had no answer
// short of finding the user and opening their profile. This lists all of them,
// answered included, newest first, with the ones waiting on us pulled to the
// top and marked.

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

import { colors } from '../theme';
import { Card, Empty, Screen } from '../components/ui';
import { TeamderChatSheet } from '../components/TeamderChatSheet';
import { listThreads, type ThreadSummary } from '../services/teamderChatService';
import { timeAgo } from '../format';

export function MessagesScreen() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ThreadSummary | null>(null);

  const load = useCallback(async (force = false) => {
    try {
      setThreads(await listThreads(force));
    } catch {
      /* offline — whatever is on screen stays */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  }, [load]);

  // Waiting-on-us first, then by recency inside each half. A thread someone is
  // waiting on is the only actionable row here, so it should never be below a
  // conversation that's already closed.
  const sorted = useMemo(
    () =>
      [...threads].sort((a, b) =>
        a.awaitingReply === b.awaitingReply
          ? b.lastMessageAt - a.lastMessageAt
          : a.awaitingReply
            ? -1
            : 1,
      ),
    [threads],
  );
  const waiting = sorted.filter((t) => t.awaitingReply).length;

  return (
    <Screen
      title="הודעות"
      subtitle={
        loading
          ? undefined
          : waiting > 0
            ? `${waiting} ${waiting === 1 ? 'ממתין לתשובה' : 'ממתינים לתשובה'} · ${threads.length} שיחות`
            : `${threads.length} שיחות`
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 28 }} />
      ) : sorted.length === 0 ? (
        <Empty text="עוד לא נפתחה שיחה עם משתמש" />
      ) : (
        sorted.map((t) => (
          <Pressable key={t.userId} onPress={() => setOpen(t)}>
            <Card style={st.row}>
              <View
                style={[
                  st.dot,
                  { backgroundColor: t.awaitingReply ? colors.red : 'transparent' },
                ]}
              />
              <View style={st.body}>
                <View style={st.line}>
                  <Text style={st.name} numberOfLines={1}>
                    {t.userName || 'משתמש'}
                  </Text>
                  <Text style={st.when}>{timeAgo(t.lastMessageAt)}</Text>
                </View>
                <Text
                  style={[st.preview, t.awaitingReply && st.previewUnread]}
                  numberOfLines={1}
                >
                  {/* Say who spoke last — otherwise our own outgoing message
                      reads as if the user had sent it. */}
                  {t.awaitingReply ? t.lastText : `Teamder: ${t.lastText}`}
                </Text>
              </View>
              <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))
      )}

      <TeamderChatSheet
        visible={open !== null}
        userId={open?.userId ?? ''}
        userName={open?.userName ?? ''}
        onClose={() => {
          setOpen(null);
          load(true);
        }}
      />
    </Screen>
  );
}

const st = StyleSheet.create({
  // row-reverse: this is an RTL app, so the first child lands on the right.
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  body: { flex: 1, gap: 2 },
  line: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'right' },
  when: { color: colors.textMuted, fontSize: 11 },
  preview: { color: colors.textMuted, fontSize: 13, textAlign: 'right' },
  previewUnread: { color: colors.text, fontWeight: '600' },
});
