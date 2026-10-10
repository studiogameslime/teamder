import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors, font, radius } from '../theme';
import { useDashboard } from '../state/DashboardContext';
import { Screen } from '../components/ui';
import { fetchErrors } from '../services/errorsService';
import { fetchUserCounts, type UserCounts } from '../services/firebase';
import { fetchLifetimeStats, type LifetimeStats } from '../services/downloads';
import { fetchLinkClickStats, type LinkClickStats } from '../services/linkClicks';
import { persist, readPersisted } from '../services/cache';
import { money, timeAgo } from '../format';
import type { ErrorRecord } from '../types';

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
};
const stars = (n: number) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

function Badge({
  icon,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22' }]}>
      <Ionicons name={icon} size={22} color={color} />
    </View>
  );
}

export function OverviewScreen() {
  const { snapshot, refreshing, refresh } = useDashboard();
  const nav = useNavigation<any>();
  const [errors, setErrors] = useState<ErrorRecord[]>([]);
  const [lifetime, setLifetime] = useState<LifetimeStats | null>(null);
  const [userCounts, setUserCounts] = useState<UserCounts | null>(null);
  const [clicks, setClicks] = useState<LinkClickStats | null>(null);

  const loadErrors = useCallback(async (force = false) => {
    try {
      const v = await fetchErrors(force);
      setErrors(v);
      persist('ov.errors', v);
    } catch {
      /* ignore */
    }
  }, []);
  const loadLifetime = useCallback(async () => {
    try {
      const v = await fetchLifetimeStats();
      setLifetime(v);
      persist('ov.lifetime', v);
    } catch {
      /* ignore */
    }
  }, []);
  const loadClicks = useCallback(async () => {
    try {
      const v = await fetchLinkClickStats();
      setClicks(v);
      persist('ov.clicks', v);
    } catch {
      /* ignore */
    }
  }, []);
  // Cheap user headline (count() + today range) — no full users scan.
  const loadUserCounts = useCallback(async () => {
    try {
      const v = await fetchUserCounts();
      setUserCounts(v);
      persist('ov.userCounts', v);
    } catch {
      /* ignore */
    }
  }, []);

  // Paint the LAST KNOWN numbers first. Three of the four fetches below go to
  // external services (Play install CSVs, App Store Connect, link stats) and
  // take seconds; without this the screen opens empty every cold start. Each
  // hydrate only fills a slot the network hasn't answered yet, so a fresh
  // value already in place is never overwritten by a stale one.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [e, l, u, c] = await Promise.all([
        readPersisted<ErrorRecord[]>('ov.errors'),
        readPersisted<LifetimeStats>('ov.lifetime'),
        readPersisted<UserCounts>('ov.userCounts'),
        readPersisted<LinkClickStats>('ov.clicks'),
      ]);
      if (!alive) return;
      if (e) setErrors((prev) => (prev.length ? prev : e));
      if (l) setLifetime((prev) => prev ?? l);
      if (u) setUserCounts((prev) => prev ?? u);
      if (c) setClicks((prev) => prev ?? c);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadErrors();
    loadLifetime();
    loadUserCounts();
    loadClicks();
  }, [loadErrors, loadLifetime, loadUserCounts, loadClicks]);
  // Focus re-renders hit the cache (no force) → 0 reads within the TTL.
  useEffect(() => nav.addListener('focus', () => loadErrors()), [nav, loadErrors]);

  const today = startOfToday();
  const an = snapshot.analytics;
  const rev = snapshot.revenue;
  const dl = snapshot.downloads;
  const asR = snapshot.ratings.find((r) => r.source === 'appstore');
  const gpR = snapshot.ratings.find((r) => r.source === 'googleplay');

  const bugsToday = useMemo(
    () => errors.filter((e) => e.status !== 'resolved' && e.lastSeen >= today),
    [errors, today],
  );

  const reviewsToday = useMemo(
    () => snapshot.reviews.filter((r) => Date.parse(r.createdAt) >= today),
    [snapshot.reviews, today],
  );
  const reviewsTodayAS = reviewsToday.filter((r) => r.source === 'appstore').length;
  const reviewsTodayGP = reviewsToday.filter((r) => r.source === 'googleplay').length;
  const lastBad = useMemo(() => {
    const bad = snapshot.reviews.filter((r) => r.rating <= 2);
    return (bad[0] ?? snapshot.reviews[0]) || null;
  }, [snapshot.reviews]);

  // Headline counts come from the cheap count()/range fetch (not a full scan).
  const newUsersToday = userCounts?.newToday ?? 0;
  const realUsers = userCounts?.total ?? 0;

  const revYesterday = rev?.daily?.[rev.daily.length - 2]?.value ?? 0;
  // Only show a day-over-day delta once today has some revenue — otherwise
  // every morning reads a misleading "▼100%" before the day has begun.
  const revDelta =
    rev && rev.today > 0 && revYesterday > 0
      ? Math.round(((rev.today - revYesterday) / revYesterday) * 100)
      : null;

  return (
    <Screen
      title="Pulse"
      subtitle="הנה התמונה של היום"
      right={
        <View style={styles.chip}>
          <Ionicons name="today-outline" size={14} color={colors.primary} />
          <Text style={styles.chipText}>היום</Text>
        </View>
      }
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            refresh();
            loadErrors(true); // pull-to-refresh forces past the cache
            loadLifetime();
            loadUserCounts();
            loadClicks();
          }}
          tintColor={colors.primary}
        />
      }
    >
      {/* 1 — Open bugs today (most prominent) */}
      <Pressable onPress={() => nav.navigate('DevInbox')}>
        <View style={[styles.card, styles.bugCard]}>
          <View style={styles.cardHead}>
            <Badge icon="bug" color={colors.red} />
            <Text style={styles.cardTitle}>באגים פתוחים מהיום</Text>
            <Text style={[styles.bigNum, { color: colors.red }]}>
              {bugsToday.length}
            </Text>
          </View>
          {bugsToday.slice(0, 3).map((b) => (
            <View key={b.id} style={styles.bugRow}>
              <View style={styles.bugDot} />
              <Text style={styles.bugText} numberOfLines={1}>
                {b.operation} — {b.message}
              </Text>
              <Text style={styles.bugTime}>{hhmm(b.lastSeen)}</Text>
            </View>
          ))}
          {bugsToday.length === 0 ? (
            <Text style={styles.allGood}>אין באגים חדשים היום 🎉</Text>
          ) : null}
          <Text style={styles.link}>צפה בכל הבאגים ←</Text>
        </View>
      </Pressable>

      {/* 2 — Link clicks (all sources) */}
      <Pressable onPress={() => nav.navigate('Sources')}>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Badge icon="link" color="#8B5CF6" />
            <Text style={styles.cardTitle}>כניסות לקישור</Text>
          </View>
          <View style={styles.twoStat}>
            <Stat value={clicks ? clicks.today.toLocaleString() : '—'} label="היום" tone="#8B5CF6" />
            <View style={styles.vline} />
            <Stat value={clicks ? clicks.yesterday.toLocaleString() : '—'} label="אתמול" />
            <View style={styles.vline} />
            <Stat value={clicks ? clicks.week.toLocaleString() : '—'} label="השבוע" />
            <View style={styles.vline} />
            <Stat value={clicks ? clicks.allTime.toLocaleString() : '—'} label="כל הזמנים" tone={colors.green} />
          </View>
          {clicks?.topToday ? (
            <View style={styles.topLinkRow}>
              <Text style={styles.topLinkFire}>🔥</Text>
              <Text style={styles.topLinkText} numberOfLines={1}>
                המקור הכי חזק היום:{' '}
                <Text style={styles.topLinkName}>{clicks.topToday.label}</Text>{' '}
                · {clicks.topToday.count.toLocaleString()}
              </Text>
            </View>
          ) : null}
          <Text style={styles.subtle}>מכל המקורות — שיתופים, הזמנות אישיות וקמפיינים</Text>
        </View>
      </Pressable>

      {/* 3 — Ad revenue today */}
      <Pressable onPress={() => nav.navigate('Revenue')}>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Badge icon="cash" color={colors.green} />
            <Text style={styles.cardTitle} numberOfLines={1}>הכנסות ממודעות</Text>
            <Text style={[styles.bigNum, styles.revNum, { color: colors.green }]} numberOfLines={1}>
              {rev ? money(rev.today, rev.currency) : '—'}
            </Text>
          </View>
          {/* All-time total, same card, right under today's figure. */}
          <View style={styles.allTimeRow}>
            <Text style={styles.allTimeLabel}>עד היום</Text>
            <Text style={styles.allTimeValue} numberOfLines={1}>
              {rev ? money(rev.allTime ?? rev.last28, rev.currency) : '—'}
            </Text>
          </View>
          {revDelta != null ? (
            <Text style={styles.subtle}>
              {revDelta >= 0 ? '▲' : '▼'} {Math.abs(revDelta)}% מאתמול
            </Text>
          ) : null}
        </View>
      </Pressable>

      {/* 4 — Users today */}
      <Pressable onPress={() => nav.navigate('Users')}>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Badge icon="people" color={colors.primary} />
            <Text style={styles.cardTitle}>משתמשים</Text>
            <Text style={[styles.bigNum, { color: colors.primary }]}>
              {realUsers.toLocaleString()}
            </Text>
          </View>
          <View style={styles.twoStat}>
            <Stat value={an ? String(an.activeToday) : '—'} label="התחברו היום" />
            <View style={styles.vline} />
            <Stat value={String(newUsersToday)} label="חדשים היום" tone={colors.green} />
          </View>
        </View>
      </Pressable>

    </Screen>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone?: string;
}) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function StoreCard({
  onPress,
  logo,
  logoColor,
  name,
  rating,
  totalRatings,
  reviewsToday,
  downloadsToday,
  downloads30,
}: {
  onPress: () => void;
  logo: keyof typeof Ionicons.glyphMap;
  logoColor: string;
  name: string;
  rating?: number;
  totalRatings?: number;
  reviewsToday: number;
  downloadsToday: number;
  downloads30?: number;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={[styles.card, { gap: 10 }]}>
        <View style={styles.storeHead}>
          <Ionicons name={logo} size={22} color={logoColor} />
          <Text style={styles.storeName}>{name}</Text>
        </View>
        <View style={styles.ratingRow}>
          <Text style={styles.ratingNum}>
            {rating != null ? rating.toFixed(1) : '—'}
          </Text>
          <Text style={styles.ratingStars}>{stars(rating ?? 0)}</Text>
        </View>
        <View style={styles.storeStats}>
          <StoreStat label="דירוגים" value={totalRatings ?? 0} />
          <StoreStat label="ביקורות היום" value={reviewsToday} />
          <StoreStat label="הורדות היום" value={downloadsToday} />
          <StoreStat label="הורדות (30 ימים)" value={downloads30 ?? 0} highlight />
        </View>
      </View>
    </Pressable>
  );
}

function StoreStat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <View style={[styles.storeStatRow, highlight && styles.storeStatRowHl]}>
      <Text style={[styles.storeStatLabel, highlight && { color: colors.text }]}>{label}</Text>
      <Text style={[styles.storeStatValue, highlight && { color: colors.primary, fontSize: 15 }]}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  chipText: { ...font.small, color: colors.text, fontWeight: '700' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    gap: 12,
    marginTop: 4,
  },
  bugCard: { borderColor: colors.red + '55', backgroundColor: '#1A1216' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { ...font.h2, fontSize: 17, flex: 1 },
  bigNum: { fontSize: 34, fontWeight: '900', flexShrink: 0 },
  revNum: { fontSize: 24 }, // currency strings are wider — keep them from crowding the title
  sourceNote: { ...font.small, color: colors.textMuted, fontSize: 11, textAlign: 'right', marginTop: 6, paddingHorizontal: 4 },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bugRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bugDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.red },
  bugText: { ...font.body, color: colors.text, flex: 1 },
  bugTime: { ...font.small, color: colors.textMuted },
  allGood: { ...font.body, color: colors.textMuted },
  link: { ...font.small, color: colors.primary, fontWeight: '700', marginTop: 2 },
  subtle: { ...font.small, color: colors.textSoft },
  topLinkRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 2,
  },
  topLinkFire: { fontSize: 13 },
  topLinkText: { ...font.small, color: colors.text, flex: 1, textAlign: 'right' },
  topLinkName: { fontWeight: '800', color: '#8B5CF6' },
  allTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  allTimeLabel: { ...font.small, color: colors.textSoft },
  allTimeValue: { ...font.title, fontSize: 18, fontWeight: '800', color: colors.green },
  lifeNote: { ...font.small, color: colors.textMuted, fontSize: 11 },
  // stores
  storesRow: { flexDirection: 'row', gap: 12 },
  storeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  storeName: { ...font.title, fontSize: 14 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingNum: { fontSize: 30, fontWeight: '900', color: colors.text },
  ratingStars: { color: colors.star, fontSize: 13 },
  storeStats: { gap: 5 },
  storeStatRow: { flexDirection: 'row', justifyContent: 'space-between' },
  storeStatRowHl: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 5, marginTop: 1 },
  storeStatLabel: { ...font.small, color: colors.textMuted },
  storeStatValue: { ...font.small, color: colors.text, fontWeight: '700' },
  // two-stat block
  twoStat: { flexDirection: 'row', alignItems: 'center' },
  vline: { width: 1, height: 36, backgroundColor: colors.border },
  statValue: { fontSize: 30, fontWeight: '900', color: colors.text },
  statLabel: { ...font.small, color: colors.textMuted },
  // review box
  reviewBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 12,
    gap: 4,
  },
  reviewStars: { color: colors.star, fontSize: 14 },
  reviewBody: { ...font.body, color: colors.text, lineHeight: 19 },
  reviewMeta: { ...font.small, color: colors.textMuted },
});
