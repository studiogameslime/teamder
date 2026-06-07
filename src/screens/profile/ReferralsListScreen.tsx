// ReferralsListScreen — the page that opens when the user taps the
// "שחקנים שהצטרפו דרכי" tile on Profile. Lists every user whose
// invitedBy field equals the current user's id, sorted newest-first,
// with name + avatar + invite timestamp.
//
// Data source: userService.listInvitedUsers. We don't try to denormalise
// or cache — the list is small (this is a "look who I brought" page,
// not a high-traffic feed) and a one-shot Firestore read on focus is
// cheap and always fresh.

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useUserStore } from '@/store/userStore';
import { userService } from '@/services';
import { logError } from '@/services/errorLog';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Avatar } from '@/components/Avatar';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';

interface Row {
  id: string;
  name: string;
  avatarId?: string;
  photoUrl?: string;
  invitedAt?: number;
  invitedByType?: 'session' | 'team';
}

export function ReferralsListScreen() {
  const nav = useNavigation<{
    goBack: () => void;
    navigate: (screen: string, params?: object) => void;
  }>();
  const openCard = useCallback(
    (userId: string) => nav.navigate('PlayerCard', { userId }),
    [nav],
  );
  const currentUserId = useUserStore((s) => s.currentUser?.id ?? null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setRows([]);
      return;
    }
    try {
      const list = await userService.listInvitedUsers(currentUserId);
      setRows(list);
    } catch (err) {
      // Never leave `rows` as null — that drives the perpetual spinner
      // (loading is derived from `rows === null`). On failure fall back to
      // an empty list so the user sees the empty state, not a frozen load.
      // The empty state is indistinguishable from "genuinely no referrals",
      // so without this the failed read would vanish — record it.
      logError('loadReferrals', err, {
        screen: 'ReferralsListScreen',
        userId: currentUserId,
      });
      if (__DEV__) console.warn('[referrals] load failed', err);
      setRows([]);
    }
  }, [currentUserId]);

  // Refresh on every focus — the user may have arrived here after
  // sharing a new invite, and a stale cache would surprise them.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const loading = rows === null;
  const empty = !loading && rows.length === 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.referralsScreenTitle} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : empty ? (
        <View style={styles.center}>
          <View style={styles.emptyIcon}>
            <Ionicons name="people-outline" size={42} color="#94A3B8" />
          </View>
          <Text style={styles.emptyTitle}>
            {he.referralsScreenEmptyTitle}
          </Text>
          <Text style={styles.emptyBody}>{he.referralsScreenEmptyBody}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.summary}>
            {he.referralsScreenSummary(rows.length)}
          </Text>
          {rows.map((row) => (
            <Row key={row.id} row={row} onOpen={openCard} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ row, onOpen }: { row: Row; onOpen: (id: string) => void }) {
  const when = row.invitedAt
    ? formatRelativeOrDate(row.invitedAt)
    : he.referralsScreenJoinedUnknownTime;
  return (
    <Pressable
      onPress={() => onOpen(row.id)}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      accessibilityRole="button"
      accessibilityLabel={row.name || he.referralsScreenAnonymous}
    >
      <Avatar
        name={row.name}
        avatarId={row.avatarId}
        uri={row.photoUrl}
        size={48}
      />
      <Text style={styles.rowName} numberOfLines={1}>
        {row.name || he.referralsScreenAnonymous}
      </Text>
      <Text style={styles.rowDate} numberOfLines={2}>
        {when}
      </Text>
      {/* Chevron — announces the row as navigable (tap → PlayerCard).
          Without it the row read as static text and users didn't
          realise they could open the invited player's profile. */}
      <Ionicons
        name="chevron-back"
        size={18}
        color={colors.textMuted}
        style={styles.rowChevron}
      />
    </Pressable>
  );
}

/**
 * Render the join time as either "לפני X" for the last few days or a
 * full Hebrew date for older entries. The threshold (7d) is the point
 * where "לפני 5 ימים" stops feeling more useful than the date.
 */
function formatRelativeOrDate(ms: number): string {
  const now = Date.now();
  const dMs = Math.max(0, now - ms);
  const day = 24 * 60 * 60 * 1000;
  if (dMs < day) {
    const hours = Math.floor(dMs / (60 * 60 * 1000));
    if (hours < 1) return he.referralsScreenJustNow;
    if (hours === 1) return he.referralsScreenAnHourAgo;
    return he.referralsScreenHoursAgo(hours);
  }
  const days = Math.floor(dMs / day);
  if (days < 7) {
    return days === 1
      ? he.referralsScreenYesterday
      : he.referralsScreenDaysAgo(days);
  }
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  emptyIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  summary: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.md,
    gap: spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  rowName: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowDate: {
    ...typography.caption,
    color: colors.textMuted,
    maxWidth: 104,
    textAlign: RTL_LABEL_ALIGN,
  },
  rowChevron: {
    opacity: 0.6,
  },
});
