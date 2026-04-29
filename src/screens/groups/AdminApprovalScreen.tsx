// Admin-only screen: lists pending join requests with approve/reject buttons.
// Aggregates pending requests across EVERY community where the viewer is
// admin — so an admin who runs more than one community sees one combined
// queue, and a single user who requested two of those communities shows up
// twice (once per community), keyed by groupId+userId.

import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { toast } from '@/components/Toast';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGroupStore } from '@/store/groupStore';
import { useUserStore } from '@/store/userStore';
import { groupService } from '@/services';
import { Group, User } from '@/types';

interface PendingRow {
  group: Group;
  user: User;
}

export function AdminApprovalScreen() {
  const nav = useNavigation<any>();
  const groups = useGroupStore((s) => s.groups);
  const me = useUserStore((s) => s.currentUser);
  const [rows, setRows] = useState<PendingRow[]>([]);

  // Every community the viewer admins. We surface pending requests across
  // all of them, not just the currently-active one.
  const adminGroups = useMemo(
    () =>
      me ? groups.filter((g) => g.adminIds.includes(me.id)) : [],
    [groups, me],
  );

  // De-duplicated set of pending user ids across all admin groups, for a
  // single batched user-hydration call.
  const pendingUserIds = useMemo(() => {
    const set = new Set<string>();
    adminGroups.forEach((g) => g.pendingPlayerIds.forEach((id) => set.add(id)));
    return Array.from(set);
  }, [adminGroups]);

  useEffect(() => {
    let alive = true;
    if (pendingUserIds.length === 0) {
      setRows([]);
      return;
    }
    groupService.hydrateUsers(pendingUserIds).then((users) => {
      if (!alive) return;
      const usersById = new Map(users.map((u) => [u.id, u]));
      const next: PendingRow[] = [];
      for (const g of adminGroups) {
        for (const uid of g.pendingPlayerIds) {
          const u = usersById.get(uid);
          if (u) next.push({ group: g, user: u });
        }
      }
      setRows(next);
    });
    return () => {
      alive = false;
    };
  }, [adminGroups, pendingUserIds]);

  const handleApprove = async (row: PendingRow) => {
    // groupStore.approve targets the *current* group, so for a multi-group
    // admin we go through groupService directly with the explicit groupId.
    try {
      await groupService.approveMember(row.group.id, row.user.id);
      setRows((prev) =>
        prev.filter(
          (r) => !(r.group.id === row.group.id && r.user.id === row.user.id),
        ),
      );
      toast.success(he.toastMemberApproved);
    } catch (err) {
      if (__DEV__) console.warn('[approve] failed', err);
    }
  };

  const handleReject = async (row: PendingRow) => {
    try {
      await groupService.rejectMember(row.group.id, row.user.id);
      setRows((prev) =>
        prev.filter(
          (r) => !(r.group.id === row.group.id && r.user.id === row.user.id),
        ),
      );
      toast.info(he.toastMemberRejected);
    } catch (err) {
      if (__DEV__) console.warn('[reject] failed', err);
    }
  };

  if (!me) return null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.groupAdminApprovalTitle} />
      {rows.length === 0 ? (
        <Text style={styles.empty}>{he.groupAdminEmpty}</Text>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={rows}
          // Composite key so the same user requesting two groups doesn't
          // collapse to a single row.
          keyExtractor={(row) => `${row.group.id}:${row.user.id}`}
          renderItem={({ item }) => (
            <Card style={styles.row}>
              <Pressable
                style={styles.identityHit}
                onPress={() =>
                  nav.navigate('PlayerCard', {
                    userId: item.user.id,
                    groupId: item.group.id,
                  })
                }
              >
                <PlayerIdentity user={item.user} size={42} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {item.user.name}
                  </Text>
                  <Text style={styles.groupName} numberOfLines={1}>
                    {item.group.name}
                  </Text>
                </View>
              </Pressable>
              <Button
                title={he.approve}
                variant="success"
                size="sm"
                onPress={() => handleApprove(item)}
              />
              <Button
                title={he.reject}
                variant="outline"
                size="sm"
                onPress={() => handleReject(item)}
              />
            </Card>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  name: { ...typography.body, color: colors.text },
  groupName: { ...typography.caption, color: colors.textMuted },
  identityHit: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
});
