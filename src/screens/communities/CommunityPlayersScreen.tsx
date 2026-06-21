// CommunityPlayersScreen — full member list with per-community stats.
// Reachable from the redesigned CommunityDetailsScreen via the
// PlayersPreview tap, and from the hamburger menu.
//
// Visual: identity-row card per player (jersey + name + admin badge
// + games played). Sorted admins-first, then by games-played desc.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { RatingStars } from '@/components/RatingStars';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { toast } from '@/components/Toast';
import { groupService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { useUserStore } from '@/store/userStore';
import { colors, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import type { Group, User, UserId } from '@/types';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityPlayers'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityPlayers'>;

interface PlayerStats {
  gamesPlayed: number;
}

export function CommunityPlayersScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [stats, setStats] = useState<Record<UserId, PlayerStats> | null>(null);
  const [loading, setLoading] = useState(true);
  // Admin-rating editor target (internalRating communities only).
  const [ratingTarget, setRatingTarget] = useState<User | null>(null);
  const [savingRating, setSavingRating] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.get(groupId);
      setGroup(g);
      if (!g) {
        setMembers([]);
        setStats({});
        return;
      }
      const ids = Array.from(new Set([...g.adminIds, ...g.playerIds]));
      const [users, derived] = await Promise.all([
        groupService.hydrateUsers(ids),
        gameService.getCommunityPlayerStats(g.id, ids).catch(() => ({})),
      ]);
      setMembers(users);
      setStats(derived);
    } catch (err) {
      logError('communityPlayersLoad', err, {
        screen: 'CommunityPlayersScreen',
        groupId,
      });
      if (__DEV__) console.warn('[communityPlayers] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Viewer-is-admin gate. Only group admins see the "remove member"
  // affordance, and only on rows that aren't the creator / aren't
  // themselves. Closes TU-22 — kicking a member used to be impossible
  // without manual Firestore edits.
  const iAmAdmin = !!me && !!group && group.adminIds.includes(me.id);
  // Only the creator can promote/demote admins (and delete the group).
  const iAmCreator =
    !!me && !!group && me.id === (group.creatorId ?? group.adminIds[0]);
  // Internal-rating mode: admins set player ratings; everyone sees them.
  const internalRating = group?.internalRating === true;

  const saveAdminRating = useCallback(
    async (playerId: UserId, rating: number | null) => {
      if (!me || !group) return;
      setSavingRating(true);
      try {
        await groupService.setAdminRating(group.id, me.id, playerId, rating);
        setRatingTarget(null);
        await reload();
      } catch (err) {
        logError('setAdminRating', err, { groupId, playerId });
        toast.error(he.error);
      } finally {
        setSavingRating(false);
      }
    },
    [me, group, groupId, reload],
  );

  const handleRemoveMember = useCallback(
    (target: User) => {
      if (!group || !me) return;
      appAlert(
        he.communityRemoveMemberConfirmTitle,
        he.communityRemoveMemberConfirmBody(target.name),
        [
          { text: he.cancel, style: 'cancel' },
          {
            text: he.communityRemoveMember,
            style: 'destructive',
            onPress: async () => {
              try {
                await groupService.removeMember(group.id, me.id, target.id);
                toast.success(he.communityRemoveMemberDone);
                await reload();
              } catch (e) {
                if (__DEV__) console.warn('[removeMember] failed', e);
                const code = (e as Error)?.message;
                appAlert(
                  he.error,
                  code === 'CANNOT_REMOVE_CREATOR'
                    ? he.communityRemoveMemberCreatorBlocked
                    : he.friendsActionFailed,
                );
              }
            },
          },
        ],
      );
    },
    [group, me, reload],
  );

  // Creator-only: promote a member to admin, or demote an admin back to
  // a regular member. Opens a small action menu per row.
  const handleManageMember = useCallback(
    (target: User) => {
      if (!group || !me) return;
      const targetIsAdmin = group.adminIds.includes(target.id);
      const creatorId = group.creatorId ?? group.adminIds[0];
      // The creator's own row never reaches here (filtered at the call
      // site), so `target` is always someone else.
      const runPromote = async () => {
        try {
          await groupService.promoteToCoach(group.id, me.id, target.id);
          toast.success(he.communityPromoteAdminDone);
          await reload();
        } catch (e) {
          if (__DEV__) console.warn('[promoteAdmin] failed', e);
          appAlert(he.error, he.friendsActionFailed);
        }
      };
      const runDemote = async () => {
        try {
          await groupService.demoteCoach(group.id, me.id, target.id);
          toast.success(he.communityDemoteAdminDone);
          await reload();
        } catch (e) {
          if (__DEV__) console.warn('[demoteAdmin] failed', e);
          appAlert(he.error, he.friendsActionFailed);
        }
      };
      appAlert(target.name, he.communityManageMemberBody, [
        targetIsAdmin
          ? { text: he.communityDemoteAdmin, onPress: runDemote }
          : { text: he.communityPromoteAdmin, onPress: runPromote },
        ...(creatorId !== target.id
          ? [
              {
                text: he.communityRemoveMember,
                style: 'destructive' as const,
                onPress: () => handleRemoveMember(target),
              },
            ]
          : []),
        { text: he.cancel, style: 'cancel' as const },
      ]);
    },
    [group, me, reload, handleRemoveMember],
  );

  // Sort: admins first (by name), then players by games-played desc,
  // tie-broken by name. Ensures the top of the list is the most
  // active/relevant entries.
  const ordered = useMemo(() => {
    if (!group) return [];
    const adminSet = new Set(group.adminIds);
    return [...members].sort((a, b) => {
      const aAdmin = adminSet.has(a.id) ? 1 : 0;
      const bAdmin = adminSet.has(b.id) ? 1 : 0;
      if (aAdmin !== bAdmin) return bAdmin - aAdmin;
      const aGames = stats?.[a.id]?.gamesPlayed ?? 0;
      const bGames = stats?.[b.id]?.gamesPlayed ?? 0;
      if (aGames !== bGames) return bGames - aGames;
      return a.name.localeCompare(b.name, 'he');
    });
  }, [members, stats, group]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader title={he.communityPlayersScreenTitle} />
      {loading && !group ? (
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      ) : !group ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{he.communitiesEmpty}</Text>
        </View>
      ) : ordered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>{he.communityPlayersEmpty}</Text>
        </View>
      ) : (
        // FlatList virtualises the row list so a 200-member community
        // renders only the visible window. We keep the single
        // wrapping Card by spreading FlatList contents through
        // ListHeaderComponent + the renderItem; the visual matches
        // the old ScrollView + map.
        <FlatList
          data={ordered}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            <Text style={styles.headline}>
              {he.communityPlayersTitle}{' '}
              <Text style={styles.headlineCount}>({ordered.length})</Text>
            </Text>
          }
          renderItem={({ item: u, index: i }) => {
            const isMe = me?.id === u.id;
            const targetIsCreator =
              (group.creatorId ?? group.adminIds[0]) === u.id;
            // Creator → full management menu (promote / demote / remove)
            // on every row but their own. Non-creator admin → remove only.
            const canManage = iAmCreator && !isMe;
            const removable =
              iAmAdmin && !iAmCreator && !isMe && !targetIsCreator;
            return (
              <View style={i === 0 ? styles.listCard : null}>
                <PlayerRow
                  user={u}
                  isAdmin={group.adminIds.includes(u.id)}
                  stats={stats?.[u.id]}
                  showDivider={i > 0}
                  internalRating={internalRating}
                  rating={group.adminRatings?.[u.id]}
                  onSetRating={
                    internalRating && iAmAdmin
                      ? () => setRatingTarget(u)
                      : undefined
                  }
                  onPress={() =>
                    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                      'PlayerCard',
                      { userId: u.id, groupId: group.id },
                    )
                  }
                  onLongPress={
                    canManage
                      ? () => handleManageMember(u)
                      : removable
                        ? () => handleRemoveMember(u)
                        : undefined
                  }
                  onManage={canManage ? () => handleManageMember(u) : undefined}
                  onRemove={
                    removable ? () => handleRemoveMember(u) : undefined
                  }
                />
              </View>
            );
          }}
          initialNumToRender={20}
          windowSize={10}
        />
      )}

      <AdminRatingSheet
        target={ratingTarget}
        current={
          ratingTarget ? group?.adminRatings?.[ratingTarget.id] ?? 0 : 0
        }
        saving={savingRating}
        onClose={() => setRatingTarget(null)}
        onSave={(rating) => ratingTarget && saveAdminRating(ratingTarget.id, rating)}
      />
    </SafeAreaView>
  );
}

/** Bottom-sheet editor for an admin-assigned player rating (1–5, or clear). */
function AdminRatingSheet({
  target,
  current,
  saving,
  onClose,
  onSave,
}: {
  target: User | null;
  current: number;
  saving: boolean;
  onClose: () => void;
  onSave: (rating: number | null) => void;
}) {
  const [value, setValue] = useState(current);
  // Sync the local stars to the opened player's stored rating.
  useEffect(() => {
    setValue(current);
  }, [current, target?.id]);
  return (
    <Modal
      visible={!!target}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheetCard} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.sheetTitle}>
            {target ? he.communityAdminRatingTitle(target.name) : ''}
          </Text>
          <Text style={styles.sheetHint}>{he.communityAdminRatingHint}</Text>
          <RatingStars value={value} onChange={setValue} size={36} />
          <View style={styles.sheetActions}>
            <Pressable
              onPress={() => onSave(null)}
              disabled={saving}
              style={({ pressed }) => [styles.sheetClear, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.sheetClearText}>{he.communityAdminRatingClear}</Text>
            </Pressable>
            <Pressable
              onPress={() => onSave(value === 0 ? null : value)}
              disabled={saving}
              style={({ pressed }) => [
                styles.sheetSave,
                (saving) && { opacity: 0.6 },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.sheetSaveText}>{he.save}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PlayerRow({
  user,
  isAdmin,
  stats,
  showDivider,
  internalRating,
  rating,
  onSetRating,
  onPress,
  onLongPress,
  onManage,
  onRemove,
}: {
  user: User;
  isAdmin: boolean;
  stats?: PlayerStats;
  showDivider: boolean;
  /** Community is in internal-rating mode → show the admins' rating. */
  internalRating?: boolean;
  /** The admin-assigned rating for this player, if set. */
  rating?: number;
  /** Admin-only: open the rating editor for this player. */
  onSetRating?: () => void;
  onPress: () => void;
  /** Optional admin action — long-press opens the manage/remove dialog.
   *  Undefined for rows the viewer can't act on. */
  onLongPress?: () => void;
  /** Creator-only "manage member" menu (promote / demote / remove),
   *  rendered as a visible ⋯ button. Takes precedence over onRemove. */
  onManage?: () => void;
  /** Remove action (non-creator admins) as a VISIBLE trash button. */
  onRemove?: () => void;
}) {
  const games = stats?.gamesPlayed ?? 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={500}
      style={({ pressed }) => [
        styles.row,
        showDivider && styles.rowDivider,
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
      accessibilityRole="button"
      accessibilityLabel={user.name}
      accessibilityHint={onLongPress ? he.communityRemoveMember : undefined}
    >
      <PlayerIdentity user={user} size="sm" />
      <View style={styles.rowBody}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {user.name}
          </Text>
          {isAdmin ? (
            <View style={styles.adminBadge}>
              <Text style={styles.adminBadgeText}>
                {he.communityDetailsAdminBadge}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={styles.statsRow}>
          <StatChip
            icon="football-outline"
            text={he.communityPlayerGames(games)}
          />
          {internalRating ? (
            onSetRating ? (
              // Admin in an internal-rating community → tappable to edit.
              <Pressable onPress={onSetRating} hitSlop={6}>
                <View style={[styles.chip, styles.ratingChip]}>
                  <Ionicons name="star" size={12} color={colors.warning} />
                  <Text style={[styles.chipText, styles.ratingChipText]}>
                    {rating ? String(rating) : he.communityAdminRatingSet}
                  </Text>
                </View>
              </Pressable>
            ) : rating ? (
              // Member view — read-only admins' rating.
              <View style={[styles.chip, styles.ratingChip]}>
                <Ionicons name="star" size={12} color={colors.warning} />
                <Text style={[styles.chipText, styles.ratingChipText]}>
                  {String(rating)}
                </Text>
              </View>
            ) : null
          ) : null}
        </View>
      </View>
      {onManage ? (
        <Pressable
          onPress={onManage}
          hitSlop={10}
          style={({ pressed }) => [
            styles.removeBtn,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.communityManageMember}
        >
          <Ionicons
            name="ellipsis-vertical"
            size={20}
            color={colors.textMuted}
          />
        </Pressable>
      ) : onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          style={({ pressed }) => [
            styles.removeBtn,
            pressed && { opacity: 0.6 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.communityRemoveMember}
        >
          <Ionicons name="person-remove-outline" size={20} color={colors.danger} />
        </Pressable>
      ) : null}
      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

function StatChip({
  icon,
  text,
  tint = colors.textMuted,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tint?: string;
}) {
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={12} color={tint} />
      <Text style={[styles.chipText, { color: tint }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  headline: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  headlineCount: {
    color: colors.textMuted,
    fontWeight: '500',
    fontSize: 14,
  },
  listCard: {
    padding: 0,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  removeBtn: {
    padding: 4,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  rowBody: {
    flex: 1,
    gap: 4,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  adminBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.primaryLight,
  },
  adminBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    fontSize: 11,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipText: {
    ...typography.caption,
    fontWeight: '600',
  },
  ratingChip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ratingChipText: {
    color: colors.text,
    fontWeight: '800',
  },
  // ── Admin-rating editor sheet ──
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  sheetTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: 'center',
  },
  sheetHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  sheetActions: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
  },
  sheetSave: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sheetSaveText: { ...typography.bodyBold, color: '#FFFFFF', fontWeight: '800' },
  sheetClear: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  sheetClearText: { ...typography.body, color: colors.danger, fontWeight: '700' },
});
