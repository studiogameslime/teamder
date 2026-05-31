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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useUserStore } from '@/store/userStore';
import { userService } from '@/services';
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
  const nav = useNavigation<{ goBack: () => void }>();
  const currentUserId = useUserStore((s) => s.currentUser?.id ?? null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!currentUserId) {
      setRows([]);
      return;
    }
    const list = await userService.listInvitedUsers(currentUserId);
    setRows(list);
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
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => nav.goBack()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.headerBtn,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.back}
        >
          <Ionicons name="chevron-forward" size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{he.referralsScreenTitle}</Text>
        <View style={styles.headerBtn} />
      </View>

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
            <Row key={row.id} row={row} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Row({ row }: { row: Row }) {
  return (
    <View style={styles.row}>
      <View style={styles.avatarWrap}>
        <Avatar
          name={row.name}
          avatarId={row.avatarId}
          uri={row.photoUrl}
          size={48}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {row.name || he.referralsScreenAnonymous}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {row.invitedAt
            ? he.referralsScreenJoinedAt(formatRelativeOrDate(row.invitedAt))
            : he.referralsScreenJoinedUnknownTime}
        </Text>
      </View>
      <View
        style={[
          styles.badge,
          row.invitedByType === 'session' && styles.badgeSession,
        ]}
      >
        <Text style={styles.badgeText}>
          {row.invitedByType === 'session'
            ? he.referralsScreenViaGame
            : row.invitedByType === 'team'
              ? he.referralsScreenViaCommunity
              : he.referralsScreenViaLink}
        </Text>
      </View>
    </View>
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
    flexDirection: 'row-reverse',
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
  avatarWrap: {
    width: 48,
    height: 48,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  rowName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  badge: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeSession: {
    backgroundColor: 'rgba(34,197,94,0.15)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1D4ED8',
  },
});
