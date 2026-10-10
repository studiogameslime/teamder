// QaUsersBody — the "QA" segment of the Dev Inbox. Lists the people who report
// (feedback authors). Tap a user to see all their reports + errors.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, radius } from '../theme';
import { Card, Empty } from '../components/ui';
import { listQaUsers, type QaUser } from '../services/qaService';
import type { ErrorsStackParams } from '../navigation/ErrorsStack';

function timeHe(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} · ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function QaUsersBody() {
  const nav =
    useNavigation<NativeStackNavigationProp<ErrorsStackParams, 'DevInbox'>>();
  const [users, setUsers] = useState<QaUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await listQaUsers());
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Counts may change after viewing/resolving a user's items.
  useEffect(() => nav.addListener('focus', load), [nav, load]);

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
      {loading ? (
        <View style={{ paddingVertical: 40 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : users.length === 0 ? (
        <Empty text="אין עדיין משתמשי QA (מי ששלח דיווח יופיע כאן)" />
      ) : (
        users.map((u) => (
          <Pressable
            key={u.userId}
            onPress={() =>
              nav.navigate('QaUser', { userId: u.userId, userName: u.userName })
            }
          >
            <Card style={s.row}>
              <View style={s.avatar}>
                <Ionicons name="person" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.name} numberOfLines={1}>
                  {u.userName}
                </Text>
                <Text style={s.sub}>פעילות אחרונה: {timeHe(u.lastAt) || '—'}</Text>
                <View style={s.tags}>
                  <View style={[s.tag, { borderColor: colors.primary }]}>
                    <Ionicons name="chatbox-ellipses" size={12} color={colors.primary} />
                    <Text style={[s.tagTxt, { color: colors.primary }]}>
                      {u.openReports}/{u.reports} דיווחים
                    </Text>
                  </View>
                  <View style={[s.tag, { borderColor: colors.red }]}>
                    <Ionicons name="bug" size={12} color={colors.red} />
                    <Text style={[s.tagTxt, { color: colors.red }]}>
                      {u.openErrors}/{u.errors} שגיאות
                    </Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-back" size={20} color={colors.textMuted} />
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { padding: 14, paddingBottom: 36, gap: 10 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { ...font.title, textAlign: 'right' },
  sub: { ...font.small, color: colors.textMuted, textAlign: 'right', marginTop: 1 },
  tags: { flexDirection: 'row-reverse', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  tag: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagTxt: { ...font.small, fontWeight: '800' },
});
