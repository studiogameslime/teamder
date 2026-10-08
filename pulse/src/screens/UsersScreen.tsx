import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, font, radius } from '../theme';
import { Card, Screen } from '../components/ui';
import { Donut } from '../components/Donut';
import { fetchUsersWithAuth } from '../services/firebase';
import { timeAgo } from '../format';
import type { AppUser } from '../types';
import type { UsersStackParams } from '../navigation/UsersStack';

const DAY = 86_400_000;
const ONLINE_MS = 5 * 60 * 1000;

type Range = 'today' | '7d' | '30d' | 'all';
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'היום' },
  { key: '7d', label: '7 ימים' },
  { key: '30d', label: '30 ימים' },
  { key: 'all', label: 'הכל' },
];

type Filter =
  | 'all' | 'google' | 'apple' | 'online' | 'new' | 'deleted'
  | 'inactive7' | 'inactive30' | 'testers';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'הכל' },
  { key: 'google', label: 'Google' },
  { key: 'apple', label: 'Apple' },
  { key: 'online', label: 'מחוברים עכשיו' },
  { key: 'new', label: 'חדשים' },
  { key: 'deleted', label: 'מחקו חשבון' },
  { key: 'testers', label: '🧪 בודקים' },
];

const AV = ['#3B82F6', '#22C55E', '#F59E0B', '#EF4444', '#A855F7', '#06B6D4', '#EC4899'];
const avatarColor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AV[Math.abs(h) % AV.length];
};
const isOnline = (u: AppUser) => !!u.lastActiveAt && Date.now() - u.lastActiveAt < ONLINE_MS;
// "Last seen" = real app activity. Firebase's lastLoginAt only updates on an
// actual SIGN-IN; a user with a persisted session (the norm — esp. Apple)
// opens the app daily without ever re-authenticating, so lastLoginAt freezes
// at their first sign-in. lastActiveAt (last ID-token refresh) reflects each
// app open, so it's the meaningful signal. Fall back to lastLoginAt only when
// no refresh timestamp is available.
const lastSeenAt = (u: AppUser): number | undefined => u.lastActiveAt ?? u.lastLoginAt;

function Kpi({
  label, value, sub, icon, color,
}: {
  label: string; value: string; sub: string;
  icon: keyof typeof Ionicons.glyphMap; color: string;
}) {
  return (
    <Card style={styles.kpi}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <Text style={styles.kpiValue}>{value}</Text>
        <Text style={styles.kpiSub}>{sub}</Text>
      </View>
      <View style={[styles.kpiBadge, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
    </Card>
  );
}

function UserRow({ u, onPress }: { u: AppUser; onPress: () => void }) {
  const online = isOnline(u);
  return (
    <Pressable onPress={onPress} style={styles.row}>
      <View style={[styles.avatar, { backgroundColor: avatarColor(u.id) }]}>
        <Text style={styles.avatarText}>{(u.name || '?').trim()[0]}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowName} numberOfLines={1}>{u.name}</Text>
        <Text style={styles.rowCity} numberOfLines={1}>{u.city ?? '—'}</Text>
      </View>
      <View style={styles.rowRight}>
        <View style={styles.lastSeen}>
          {online ? <View style={styles.onlineDot} /> : null}
          <Text style={styles.rowTime}>
            {lastSeenAt(u) ? timeAgo(lastSeenAt(u)!) : '—'}
          </Text>
        </View>
        {u.provider === 'google' ? (
          <Ionicons name="logo-google" size={15} color="#EA4335" />
        ) : u.provider === 'apple' ? (
          <Ionicons name="logo-apple" size={16} color={colors.textSoft} />
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

export function UsersScreen() {
  const nav =
    useNavigation<NativeStackNavigationProp<UsersStackParams, 'UsersList'>>();
  const [all, setAll] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<Range>('30d');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [showAllCities, setShowAllCities] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      setAll(await fetchUsersWithAuth(force));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  // Focus hits the cache (no force) → no re-scan of the users collection.
  useEffect(() => nav.addListener('focus', () => load()), [nav, load]);

  const now = Date.now();
  const rangeStart =
    range === 'today'
      ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
      : range === '7d' ? now - 7 * DAY
      : range === '30d' ? now - 30 * DAY
      : 0;

  const real = useMemo(() => all.filter((u) => !u.isTest), [all]);
  const live = useMemo(() => real.filter((u) => !u.deleted), [real]);

  // KPIs
  const total = live.length;
  const active = live.filter((u) => {
    const t = lastSeenAt(u);
    return !!t && t >= rangeStart;
  }).length;
  const created = live.filter((u) => u.joinedAt >= rangeStart).length;
  const deleted = real.filter((u) => u.deleted && (u.updatedAt ?? 0) >= rangeStart).length;

  // return-to-usage (fixed windows) — based on real activity, not sign-in
  const notReturned7 = live.filter((u) => {
    const t = lastSeenAt(u);
    return !!t && t < now - 7 * DAY;
  }).length;
  const notReturned30 = live.filter((u) => {
    const t = lastSeenAt(u);
    return !!t && t < now - 30 * DAY;
  }).length;

  // login method
  const google = live.filter((u) => u.provider === 'google').length;
  const apple = live.filter((u) => u.provider === 'apple').length;
  const provTotal = google + apple || 1;

  // by city
  const cities = useMemo(() => {
    const m = new Map<string, number>();
    live.forEach((u) => { if (u.city) m.set(u.city, (m.get(u.city) ?? 0) + 1); });
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [live]);
  const cityMax = cities[0]?.value ?? 1;

  // list
  const listed = useMemo(() => {
    let base: AppUser[];
    switch (filter) {
      case 'google': base = live.filter((u) => u.provider === 'google'); break;
      case 'apple': base = live.filter((u) => u.provider === 'apple'); break;
      case 'online': base = live.filter(isOnline); break;
      case 'new': base = live.filter((u) => u.joinedAt >= rangeStart); break;
      case 'deleted': base = real.filter((u) => u.deleted); break;
      case 'inactive7': base = live.filter((u) => { const t = lastSeenAt(u); return !!t && t < now - 7 * DAY; }); break;
      case 'inactive30': base = live.filter((u) => { const t = lastSeenAt(u); return !!t && t < now - 30 * DAY; }); break;
      // Test/QA accounts — normally hidden everywhere; this filter surfaces
      // them so you can watch what the testers are doing in the app.
      case 'testers': base = all.filter((u) => u.isTest && !u.deleted); break;
      default: base = live;
    }
    const q = query.trim();
    if (q) base = base.filter((u) => u.name.includes(q) || (u.city ?? '').includes(q));
    return [...base].sort((a, b) => (b.lastActiveAt ?? b.lastLoginAt ?? 0) - (a.lastActiveAt ?? a.lastLoginAt ?? 0));
  }, [live, real, all, filter, query, rangeStart, now]);

  const periodSub =
    range === 'today' ? 'היום' : range === '7d' ? '7 ימים' : range === '30d' ? '30 ימים' : 'כל הזמנים';

  return (
    <Screen
      title="משתמשים"
      subtitle={`${total.toLocaleString()} רשומים`}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={colors.primary} />
      }
    >
      {/* date range */}
      <View style={styles.segment}>
        {RANGES.map((r) => {
          const a = range === r.key;
          return (
            <Pressable key={r.key} onPress={() => setRange(r.key)} style={[styles.seg, a && styles.segActive]}>
              <Text style={[styles.segText, a && styles.segTextActive]}>{r.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* 4 KPIs */}
      <View style={styles.kpiRow}>
        <Kpi label="סה״כ משתמשים" value={total.toLocaleString()} sub="כל הזמנים" icon="people" color={colors.primary} />
        <Kpi label="פעילים בתקופה" value={active.toLocaleString()} sub={periodSub} icon="pulse" color={colors.green} />
      </View>
      <View style={styles.kpiRow}>
        <Kpi label="חדשים בתקופה" value={created.toLocaleString()} sub={periodSub} icon="person-add" color="#0A84FF" />
        <Kpi label="מחקו חשבון" value={deleted.toLocaleString()} sub={periodSub} icon="trash" color={colors.red} />
      </View>

      {/* return to usage */}
      <Card style={{ gap: 12 }}>
        <Text style={styles.section}>חזרה לשימוש</Text>
        <View style={styles.kpiRow}>
          <Pressable style={{ flex: 1 }} onPress={() => setFilter('inactive30')}>
            <View style={styles.retCard}>
              <Text style={styles.retLabel}>לא חזרו 30 יום</Text>
              <Text style={[styles.retNum, { color: colors.red }]}>{notReturned30.toLocaleString()}</Text>
              <Text style={styles.retSub}>משתמשים</Text>
            </View>
          </Pressable>
          <Pressable style={{ flex: 1 }} onPress={() => setFilter('inactive7')}>
            <View style={styles.retCard}>
              <Text style={styles.retLabel}>לא חזרו 7 ימים</Text>
              <Text style={[styles.retNum, { color: colors.amber }]}>{notReturned7.toLocaleString()}</Text>
              <Text style={styles.retSub}>משתמשים</Text>
            </View>
          </Pressable>
        </View>
      </Card>

      {/* login method + by city */}
      <View style={styles.kpiRow}>
        <Card style={{ flex: 1, gap: 12 }}>
          <Text style={styles.section}>שיטת התחברות</Text>
          <View style={{ alignItems: 'center', paddingVertical: 2 }}>
            <Donut
              segments={[
                { value: google, color: colors.primary },
                { value: apple, color: '#A855F7' },
              ]}
              size={88}
              thickness={14}
            />
          </View>
          <View style={{ gap: 9 }}>
            <Legend color={colors.primary} label="Google" value={google} pct={Math.round((google / provTotal) * 100)} />
            <Legend color="#A855F7" label="Apple" value={apple} pct={Math.round((apple / provTotal) * 100)} />
          </View>
        </Card>
        <Card style={{ flex: 1, gap: 8 }}>
          <Text style={styles.section}>לפי עיר</Text>
          {(showAllCities ? cities : cities.slice(0, 5)).map((c) => (
            <View key={c.name} style={styles.cityRow}>
              <Text style={styles.cityName} numberOfLines={1}>{c.name}</Text>
              <View style={styles.cityTrack}>
                <View style={[styles.cityFill, { width: `${(c.value / cityMax) * 100}%` }]} />
              </View>
              <Text style={styles.cityVal}>{c.value}</Text>
            </View>
          ))}
          {cities.length > 5 ? (
            <Pressable onPress={() => setShowAllCities((v) => !v)}>
              <Text style={styles.more}>{showAllCities ? 'הצג פחות' : 'הצג עוד'}</Text>
            </Pressable>
          ) : null}
        </Card>
      </View>

      {/* filters */}
      <View style={styles.chips}>
        {FILTERS.map((f) => {
          const a = filter === f.key;
          return (
            <Pressable key={f.key} onPress={() => setFilter(f.key)} style={[styles.chip, a && styles.chipActive]}>
              <Text style={[styles.chipText, a && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {/* search */}
      <View style={styles.searchPill}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="חיפוש משתמש"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
        />
      </View>

      {/* list */}
      {loading ? null : listed.length ? (
        listed.map((u) => (
          <UserRow key={u.id} u={u} onPress={() => nav.navigate('UserDetail', { userId: u.id })} />
        ))
      ) : (
        <Text style={styles.empty}>אין משתמשים בקטגוריה זו</Text>
      )}
    </Screen>
  );
}

function Legend({
  color, label, value, pct,
}: {
  color: string; label: string; value: number; pct: number;
}) {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
      <View style={{ flex: 1 }} />
      <Text style={styles.legendVal}>
        {value} · {pct}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 4, gap: 4 },
  seg: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: 'center' },
  segActive: { backgroundColor: colors.primary },
  segText: { ...font.body, color: colors.textSoft, fontWeight: '600' },
  segTextActive: { color: '#fff', fontWeight: '800' },

  kpiRow: { flexDirection: 'row', gap: 12 },
  kpi: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, minHeight: 96 },
  kpiLabel: { ...font.small, color: colors.textMuted },
  kpiValue: { fontSize: 30, fontWeight: '900', color: colors.text },
  kpiSub: { ...font.small, color: colors.textMuted },
  kpiBadge: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  section: { ...font.h2, fontSize: 16 },
  retCard: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: 14, alignItems: 'center', gap: 2 },
  retLabel: { ...font.small, color: colors.textSoft },
  retNum: { fontSize: 26, fontWeight: '900' },
  retSub: { ...font.small, color: colors.textMuted },

  legend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...font.body, color: colors.text, fontWeight: '600' },
  legendVal: { ...font.small, color: colors.textSoft, fontWeight: '700' },

  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cityName: { ...font.small, color: colors.text, width: 64 },
  cityTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  cityFill: { height: 7, borderRadius: 4, backgroundColor: colors.primary },
  cityVal: { ...font.small, color: colors.textSoft, width: 34, textAlign: 'left' },
  more: { ...font.small, color: colors.primary, fontWeight: '700', textAlign: 'center', marginTop: 2 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...font.small, color: colors.textSoft },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  searchPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14 },
  searchInput: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 11, textAlign: 'right' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  rowName: { ...font.title, fontSize: 16 },
  rowCity: { ...font.small, color: colors.textMuted, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  lastSeen: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.green },
  rowTime: { ...font.small, color: colors.textSoft },
  empty: { ...font.body, color: colors.textMuted, textAlign: 'center', marginTop: 20 },
});
