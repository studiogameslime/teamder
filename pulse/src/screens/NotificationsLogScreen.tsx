// "התראות אחרונות" — two views via a segmented control:
//   • שרת  — every push ever sent (Firestore notifications), with who got it
//            and whether it landed. The complete, recoverable history.
//   • מקומי — the local on-device log of what Pulse itself was alerted about.

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { navRef } from '../navigation/navRef';
import { Screen, Card, Empty } from '../components/ui';
import { colors, radius } from '../theme';
import { timeAgo } from '../format';
import { getNotificationLog, clearNotificationLog, type NotifLogEntry } from '../services/notifLog';
import { fetchServerNotifs, type ServerNotif } from '../services/serverNotifs';

type Seg = 'server' | 'local';

function iconFor(kind?: string): { icon: keyof typeof Ionicons.glyphMap; color: string } {
  switch (kind) {
    case 'onboardingActivity': return { icon: 'footsteps', color: colors.primary };
    case 'gameCreate': return { icon: 'football', color: '#22C55E' };
    case 'gameJoin': return { icon: 'person-add', color: '#3B82F6' };
    case 'communityCreate': return { icon: 'people-circle', color: '#8B5CF6' };
    case 'communityJoin': return { icon: 'people', color: '#14B8A6' };
    case 'review': return { icon: 'star', color: colors.star };
    case 'newUser': return { icon: 'person', color: '#3B82F6' };
    case 'quota': return { icon: 'speedometer', color: '#F59E0B' };
    default: return { icon: 'notifications', color: colors.textSoft };
  }
}

function dayBucket(at: number): string {
  const d = new Date(at);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const now = new Date();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days <= 0) return 'היום';
  if (days === 1) return 'אתמול';
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

function ServerRow({ n }: { n: ServerNotif }) {
  const issues = n.failed + n.noToken;
  return (
    <Card style={s.srvRow}>
      <View style={[s.statusDot, { backgroundColor: n.ok > 0 ? colors.green : issues > 0 ? colors.red : colors.textMuted }]} />
      <View style={{ flex: 1 }}>
        <View style={s.titleRow}>
          <Text style={s.title} numberOfLines={1}>{n.label}</Text>
          <Text style={s.time}>{n.at ? timeAgo(n.at) : ''}</Text>
        </View>
        <Text style={s.recipient} numberOfLines={1}>אל: {n.recipientName}</Text>
        <View style={s.metaRow}>
          {n.ok > 0 ? <Text style={s.ok}>{n.ok} נמסרו</Text> : null}
          {n.failed > 0 ? <Text style={s.bad}>{n.failed} נכשלו</Text> : null}
          {n.noToken > 0 ? <Text style={s.warn}>אין טוקן</Text> : null}
          {n.ok === 0 && issues === 0 ? <Text style={s.muted}>{n.delivered ? 'ללא נמענים' : 'בתהליך'}</Text> : null}
        </View>
      </View>
    </Card>
  );
}

export function NotificationsLogScreen() {
  const nav = useNavigation<any>();
  const [seg, setSeg] = useState<Seg>('server');
  const [q, setQ] = useState('');
  // server
  const [server, setServer] = useState<ServerNotif[] | null>(null);
  const [loadingSrv, setLoadingSrv] = useState(false);
  // local
  const [items, setItems] = useState<NotifLogEntry[]>([]);
  const [loadedLocal, setLoadedLocal] = useState(false);

  const loadServer = useCallback(async () => {
    setLoadingSrv(true);
    setServer(await fetchServerNotifs().catch(() => []));
    setLoadingSrv(false);
  }, []);
  const loadLocal = useCallback(async () => {
    setItems(await getNotificationLog());
    setLoadedLocal(true);
  }, []);

  useEffect(() => {
    loadServer();
    loadLocal();
  }, [loadServer, loadLocal]);
  useEffect(() => nav.addListener('focus', loadLocal), [nav, loadLocal]);

  const onClear = () => {
    if (!items.length) return;
    Alert.alert('לנקות את ההיסטוריה המקומית?', 'הלוג המקומי שבמכשיר יימחק (השרת לא מושפע).', [
      { text: 'ביטול', style: 'cancel' },
      { text: 'נקה', style: 'destructive', onPress: async () => { await clearNotificationLog(); setItems([]); } },
    ]);
  };

  const filtered = (server ?? []).filter(
    (n) => !q.trim() || n.label.includes(q.trim()) || n.recipientName.includes(q.trim()),
  );
  let lastBucket = '';

  return (
    <Screen
      title="התראות אחרונות"
      subtitle={seg === 'server' ? 'כל הפושים שנשלחו (שרת)' : 'הלוג המקומי של Pulse'}
      right={
        seg === 'local' && items.length ? (
          <Pressable onPress={onClear} hitSlop={8}><Text style={s.clear}>נקה</Text></Pressable>
        ) : undefined
      }
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={seg === 'server' ? loadServer : loadLocal}
          tintColor={colors.primary}
        />
      }
    >
      {/* segmented control */}
      <View style={s.segs}>
        {(['server', 'local'] as Seg[]).map((k) => (
          <Pressable key={k} onPress={() => setSeg(k)} style={[s.segBtn, seg === k && s.segOn]}>
            <Text style={[s.segTxt, seg === k && s.segTxtOn]}>{k === 'server' ? 'שרת' : 'מקומי'}</Text>
          </Pressable>
        ))}
      </View>

      {seg === 'server' ? (
        <>
          <View style={s.searchBox}>
            <Ionicons name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={s.searchInput}
              placeholder="חיפוש לפי סוג או נמען…"
              placeholderTextColor={colors.textMuted}
              value={q}
              onChangeText={setQ}
            />
          </View>
          {loadingSrv && !server ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 30 }} />
          ) : filtered.length === 0 ? (
            <Empty text={server ? 'אין התראות תואמות' : 'טוען…'} />
          ) : (
            <>
              <Text style={s.count}>{filtered.length} התראות</Text>
              {filtered.map((n) => {
                const bucket = dayBucket(n.at);
                const showHeader = bucket !== lastBucket;
                lastBucket = bucket;
                return (
                  <View key={n.id}>
                    {showHeader ? <Text style={s.dayHeader}>{bucket}</Text> : null}
                    <ServerRow n={n} />
                  </View>
                );
              })}
            </>
          )}
        </>
      ) : items.length === 0 ? (
        <Card>
          <View style={s.emptyWrap}>
            <Ionicons name="notifications-off-outline" size={34} color={colors.textMuted} />
            <Text style={s.empty}>{loadedLocal ? 'אין עדיין התראות מקומיות' : 'טוען…'}</Text>
          </View>
        </Card>
      ) : (
        items.map((n) => {
          const bucket = dayBucket(n.at);
          const showHeader = bucket !== lastBucket;
          lastBucket = bucket;
          const { icon, color } = iconFor(n.kind);
          return (
            <View key={n.id}>
              {showHeader ? <Text style={s.dayHeader}>{bucket}</Text> : null}
              <Pressable disabled={!n.sessionId} onPress={() => (navRef as any).navigate('OnboardingActivity', { sessionId: n.sessionId })}><Card style={s.row}>
                <View style={[s.iconWrap, { backgroundColor: color + '22' }]}>
                  <Ionicons name={icon} size={20} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.titleRow}>
                    <Text style={s.title} numberOfLines={1}>{n.title || '—'}</Text>
                    <Text style={s.time}>{timeAgo(n.at)}</Text>
                  </View>
                  {n.body ? <Text style={s.body} numberOfLines={3}>{n.body}</Text> : null}
                </View>
              </Card></Pressable>
            </View>
          );
        })
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  clear: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  segs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  segBtn: {
    flex: 1, paddingVertical: 8, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  segOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  segTxt: { color: colors.textMuted, fontSize: 13, fontWeight: '800' },
  segTxtOn: { color: '#fff' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
    backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, marginBottom: 10,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, textAlign: 'right', paddingVertical: 10 },
  count: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginBottom: 6 },
  emptyWrap: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  empty: { color: colors.textMuted, fontSize: 14 },
  dayHeader: { color: colors.textMuted, fontSize: 12, fontWeight: '800', textAlign: 'right', marginTop: 14, marginBottom: 6 },
  srvRow: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 999, marginTop: 5 },
  recipient: { color: colors.textSoft, fontSize: 12.5, textAlign: 'right', marginTop: 1 },
  metaRow: { flexDirection: 'row-reverse', gap: 12, flexWrap: 'wrap', marginTop: 3 },
  ok: { color: colors.green, fontSize: 11.5, fontWeight: '700' },
  bad: { color: colors.red, fontSize: 11.5, fontWeight: '700' },
  warn: { color: colors.amber, fontSize: 11.5, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 11.5, fontWeight: '700' },
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  iconWrap: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  time: { color: colors.textMuted, fontSize: 11, flexShrink: 0 },
  body: { color: colors.textSoft, fontSize: 13, textAlign: 'right', lineHeight: 19, marginTop: 2 },
});
