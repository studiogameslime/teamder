// TokenHealthScreen — push reachability. Who can actually receive a push, who
// has no token, and who has a token that keeps failing (stale). The operational
// view behind the low FCM delivery rate.

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import { Card, Empty, Screen, StatTile } from '../components/ui';
import { fetchTokenHealth, type TokenHealth, type UnreachableUser } from '../services/tokenHealth';

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function UserRow({ u }: { u: UnreachableUser }) {
  const failing = u.reason === 'failing';
  return (
    <View style={st.row}>
      <View style={[st.tag, { backgroundColor: (failing ? colors.red : colors.amber) + '22' }]}>
        <Text style={[st.tagTxt, { color: failing ? colors.red : colors.amber }]}>
          {failing ? 'טוקן נכשל' : 'אין טוקן'}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={st.name} numberOfLines={1}>{u.name}</Text>
        <Text style={st.sub}>
          נשלחו {u.sent} · נמסרו {u.ok} · נכשלו {u.failed}
        </Text>
      </View>
    </View>
  );
}

export function TokenHealthScreen() {
  const [data, setData] = useState<TokenHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setData(await fetchTokenHealth().catch(() => null));
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const reachPct = data ? pct(data.reachable, data.targeted) : 0;

  return (
    <Screen
      title="בריאות טוקנים"
      subtitle="מי יכול לקבל פוש — ומי לא"
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
        <Empty text="לא הצלחנו לטעון נתונים" />
      ) : (
        <>
          <View style={st.tiles}>
            <StatTile label="נגישים" value={data.reachable.toLocaleString()} sub={`${reachPct}% מהממוענים`} tone="green" />
            <StatTile label="טוקן נכשל" value={data.failing.toLocaleString()} tone={data.failing > 0 ? 'red' : 'default'} />
            <StatTile label="ללא טוקן" value={data.noToken.toLocaleString()} tone="amber" />
          </View>

          <Card style={st.note}>
            <Text style={st.noteTxt}>
              מבוסס על תוצאות מסירה אמיתיות. "נגיש" = לפחות פוש אחד נמסר אליו בהצלחה (גם אם חלק
              מהטוקנים הישנים שלו נכשלים — זו התיישנות רגילה). "טוקן נכשל" = נשלחו פושים אבל אף אחד
              לא נמסר. "ללא טוקן" = השרת לא מצא לו טוקן.
              {data.neverSent > 0 ? ` (${data.neverSent} משתמשים לא קיבלו אף פוש עדיין.)` : ''}
            </Text>
          </Card>

          <Text style={st.section}>משתמשים לא נגישים ({data.problems.length})</Text>
          {data.problems.length === 0 ? (
            <Empty text="כל המשתמשים נגישים 🎉" />
          ) : (
            <Card style={st.listCard}>
              {data.problems.map((u) => (
                <UserRow key={u.id} u={u} />
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
  note: { marginBottom: 14 },
  noteTxt: { color: colors.textSoft, fontSize: 12.5, lineHeight: 18, textAlign: 'right' },
  section: { color: colors.text, fontSize: 15, fontWeight: '800', textAlign: 'right', marginBottom: 8 },
  listCard: { gap: 12 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 10 },
  tag: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999 },
  tagTxt: { fontSize: 11, fontWeight: '800' },
  name: { color: colors.text, fontSize: 14, fontWeight: '700', textAlign: 'right' },
  sub: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 1 },
});
