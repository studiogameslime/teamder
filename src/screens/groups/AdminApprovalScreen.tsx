// Admin-only screen: lists pending join requests with approve/reject buttons.
// Reachable from the Profile tab when the current user is admin of the group.

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { toast } from '@/components/Toast';
import { colors, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { useGroupStore, useCurrentGroup } from '@/store/groupStore';
import { groupService } from '@/services';
import { User } from '@/types';

export function AdminApprovalScreen() {
  const nav = useNavigation<any>();
  const group = useCurrentGroup();
  const approve = useGroupStore((s) => s.approve);
  const reject = useGroupStore((s) => s.reject);
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    let alive = true;
    if (!group) return;
    groupService.hydrateUsers(group.pendingPlayerIds).then((list) => {
      if (alive) setUsers(list);
    });
    return () => {
      alive = false;
    };
  }, [group]);

  if (!group) return null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader title={he.groupAdminApprovalTitle} />
      {users.length === 0 ? (
        <Text style={styles.empty}>{he.groupAdminEmpty}</Text>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={({ item }) => (
            <Card style={styles.row}>
              <PlayerIdentity
                user={item}
                size={42}
                onPress={() =>
                  nav.navigate('PlayerCard', { userId: item.id })
                }
              />
              <Text style={styles.name}>{item.name}</Text>
              <Button
                title={he.approve}
                variant="success"
                size="sm"
                onPress={() => {
                  approve(item.id);
                  setUsers((prev) => prev.filter((u) => u.id !== item.id));
                  toast.success(he.toastMemberApproved);
                }}
              />
              <Button
                title={he.reject}
                variant="outline"
                size="sm"
                onPress={() => {
                  reject(item.id);
                  setUsers((prev) => prev.filter((u) => u.id !== item.id));
                  toast.info(he.toastMemberRejected);
                }}
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
  name: { ...typography.body, color: colors.text, flex: 1 },
});
