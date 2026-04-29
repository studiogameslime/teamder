// Search public group directory by name. Tapping "בקש להצטרף" lands the user
// in the group's pendingPlayerIds; admin approves via AdminApprovalScreen.

import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { colors, radius, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
import { groupService } from '@/services';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { GroupSearchHit } from '@/types';
import type { GroupStackParamList } from '@/navigation/GroupStack';

type Nav = NativeStackNavigationProp<GroupStackParamList, 'GroupSearch'>;

type RowAction = 'request' | 'pending' | 'member';

export function GroupSearchScreen() {
  const nav = useNavigation<Nav>();
  const user = useUserStore((s) => s.currentUser);
  const memberGroups = useGroupStore((s) => s.groups);
  const pendingGroups = useGroupStore((s) => s.pendingGroups);
  const requestJoinById = useGroupStore((s) => s.requestJoinById);

  const [text, setText] = useState('');
  const [hits, setHits] = useState<GroupSearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  // Debounced search.
  useEffect(() => {
    if (text.trim().length === 0) {
      setHits([]);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = await groupService.searchGroups(text);
        setHits(results);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  const memberIds = useMemo(
    () => new Set(memberGroups.map((g) => g.id)),
    [memberGroups]
  );
  const pendingIds = useMemo(
    () => new Set(pendingGroups.map((g) => g.id)),
    [pendingGroups]
  );

  function actionFor(hit: GroupSearchHit): RowAction {
    if (memberIds.has(hit.id)) return 'member';
    if (pendingIds.has(hit.id)) return 'pending';
    return 'request';
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.groupsSearchTitle} />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={he.groupsSearchPlaceholder}
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          textAlign="right"
          autoFocus
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      ) : text.trim().length === 0 ? (
        <Text style={styles.empty}>{he.groupsSearchPrompt}</Text>
      ) : hits.length === 0 ? (
        <Text style={styles.empty}>{he.groupsSearchEmpty}</Text>
      ) : (
        <FlatList
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm }}
          data={hits}
          keyExtractor={(h) => h.id}
          renderItem={({ item }) => (
            <GroupRow
              hit={item}
              action={actionFor(item)}
              onRequest={async () => {
                if (!user) return;
                await requestJoinById(item.id, user.id);
              }}
            />
          )}
        />
      )}

      <View style={styles.codeBlock}>
        <Text style={styles.codeText}>{he.groupsSearchByCode}</Text>
        <Button
          title={he.groupsJoin}
          variant="outline"
          iconLeft="link-outline"
          onPress={() => nav.navigate('GroupJoin')}
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
}

function GroupRow({
  hit,
  action,
  onRequest,
}: {
  hit: GroupSearchHit;
  action: RowAction;
  onRequest: () => void;
}) {
  return (
    <Card style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName}>{hit.name}</Text>
        <Text style={styles.rowSub}>{hit.fieldName}</Text>
        {hit.fieldAddress && <Text style={styles.rowSub}>{hit.fieldAddress}</Text>}
        <Text style={styles.rowMembers}>{he.groupsSearchMembers(hit.memberCount)}</Text>
      </View>
      {action === 'request' && (
        <Button title={he.groupsActionRequest} variant="primary" size="sm" onPress={onRequest} />
      )}
      {action === 'pending' && (
        <View style={[styles.statusPill, { backgroundColor: colors.surfaceMuted }]}>
          <Text style={[styles.statusText, { color: colors.textMuted }]}>
            {he.groupsActionPending}
          </Text>
        </View>
      )}
      {action === 'member' && (
        <View style={[styles.statusPill, { backgroundColor: colors.primaryLight }]}>
          <Text style={[styles.statusText, { color: colors.primary }]}>
            {he.groupsActionMember}
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  searchInput: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    paddingVertical: spacing.sm,
  },
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
  rowName: { ...typography.bodyBold, color: colors.text },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowMembers: { ...typography.caption, color: colors.primary, marginTop: spacing.xs },
  statusPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  statusText: { ...typography.caption, fontWeight: '600' },
  codeBlock: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  codeText: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
});
