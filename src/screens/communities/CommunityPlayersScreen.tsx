// CommunityPlayersScreen — full member list with per-community stats.
// Reachable from the redesigned CommunityDetailsScreen via the
// PlayersPreview tap, and from the hamburger menu.
//
// Visual: identity-row card per player (jersey + name + admin badge
// + games played). Sorted admins-first, then by games-played desc.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { successHaptic, warningHaptic } from '@/utils/haptics';
import { AdminRatingSheet } from '@/components/AdminRatingSheet';
import {
  PlayerActionMenu,
  type PlayerMenuItem,
  type PlayerMenuTarget,
} from '@/components/match/PlayerActionMenu';
import { IssueCardSheet } from '@/components/community/IssueCardSheet';
import { CardCountBadges } from '@/components/community/CardCountBadges';
import { communityEventsService } from '@/services';
import type { CardCounts, CardCountsMap } from '@/services/communityEventsService';
import { formatRating, isRated } from '@/utils/rating';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
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
  // Admin player menu (tap a player) + the card-issue sheet it opens.
  const [menuTarget, setMenuTarget] = useState<PlayerMenuTarget | null>(null);
  const [cardTarget, setCardTarget] = useState<{ user: User; type: 'yellow' | 'red' } | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  // Per-player ACTIVE yellow/red counts → the roster discipline badges.
  const [cardCounts, setCardCounts] = useState<CardCountsMap>({});

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.get(groupId);
      setGroup(g);
      if (!g) {
        setMembers([]);
        setStats({});
        setCardCounts({});
        return;
      }
      const ids = Array.from(new Set([...g.adminIds, ...g.playerIds]));
      const iAmGroupAdmin = !!me && g.adminIds.includes(me.id);
      const [users, derived, counts] = await Promise.all([
        groupService.hydrateUsers(ids),
        gameService.getCommunityPlayerStats(g.id, ids).catch(() => ({})),
        // Card badges are admin-only and only when the club uses cards.
        iAmGroupAdmin && g.cardsEnabled
          ? communityEventsService
              .getActiveCardCounts(g.id, g.yellowCardValidityDays, g.redCardValidityDays)
              .catch(() => ({}))
          : Promise.resolve({}),
      ]);
      setMembers(users);
      setStats(derived);
      setCardCounts(counts);
    } catch (err) {
      logError('communityPlayersLoad', err, {
        screen: 'CommunityPlayersScreen',
        groupId,
      });
      if (__DEV__) console.warn('[communityPlayers] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [groupId, me]);

  // Single load path: useFocusEffect fires on the initial focus AND on return,
  // so it also refreshes the roster badge after a card is revoked from a
  // player's timeline. (A separate useEffect(reload) would double-load on open.)
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Viewer-is-admin gate. Only group admins see the "remove member"
  // affordance, and only on rows that aren't the creator / aren't
  // themselves. Closes TU-22 — kicking a member used to be impossible
  // without manual Firestore edits.
  const iAmAdmin = !!me && !!group && group.adminIds.includes(me.id);
  // Only the creator can promote/demote admins (and delete the group).
  const iAmCreator =
    !!me && !!group && me.id === (group.creatorId ?? group.adminIds[0]);
  // Internal-rating mode: admins set player ratings; everyone sees them —
  // UNLESS hideInternalRating is on, in which case regular members see no
  // ratings at all (admins still see + edit them as an internal signal).
  const internalRating = group?.internalRating === true;
  const ratingsHiddenFromMe =
    internalRating && group?.hideInternalRating === true && !iAmAdmin;

  // Admin taps a player → anchored menu (card / timeline / issue card). The
  // anchor is a POINT at the touch location (the row has no measurable avatar
  // here), which the popover positions itself below.
  const openPlayerMenu = (u: User, e: GestureResponderEvent) => {
    setMenuTarget({
      player: { id: u.id, name: u.name, avatarId: u.avatarId, photoUrl: u.photoUrl },
      anchor: { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, width: 0, height: 0 },
    });
  };

  const goToCard = (u: User) =>
    nav.navigate('PlayerCard', { userId: u.id, groupId });
  const goToTimeline = (u: User) =>
    nav.navigate('PlayerTimeline', { userId: u.id, groupId, name: u.name });

  // Yellow/red card actions only appear when the club enabled the cards
  // feature in its advanced settings. The player-card + timeline entries
  // always show for admins.
  const cardsOn = !!group?.cardsEnabled;
  const menuItemsFor = (u: User): PlayerMenuItem[] => [
    { key: 'card', icon: 'person-circle-outline', label: he.playerMenuCard, onPress: () => goToCard(u) },
    { key: 'timeline', icon: 'time-outline', label: he.playerMenuTimeline, onPress: () => goToTimeline(u) },
    ...(cardsOn
      ? ([
          { key: 'yellow', icon: 'card', label: he.cardYellow, color: colors.warning, onPress: () => setCardTarget({ user: u, type: 'yellow' }) },
          // A red card BLOCKS registration — confirm first (yellow stays one-tap).
          { key: 'red', icon: 'card', label: he.cardRed, color: colors.danger, onPress: () => {
            warningHaptic();
            appAlert(he.cardRedConfirmTitle, he.cardRedConfirmBody(u.name), [
              { text: he.cancel, style: 'cancel' },
              { text: he.cardRed, style: 'destructive', onPress: () => setCardTarget({ user: u, type: 'red' }) },
            ]);
          } },
        ] as PlayerMenuItem[])
      : []),
  ];

  const menuUser = useMemo(
    () => members.find((m) => m.id === menuTarget?.player.id) ?? null,
    [members, menuTarget],
  );

  const saveCard = async (detail: string) => {
    if (!me || !cardTarget) return;
    setSavingCard(true);
    try {
      // Snapshot the club's CURRENT validity for this card type onto the event
      // so a later config change can't rewrite this card's expiry (null = no
      // expiry). Yellow uses yellowCardValidityDays, red uses redCardValidityDays.
      const validityDays =
        cardTarget.type === 'red'
          ? group?.redCardValidityDays ?? null
          : group?.yellowCardValidityDays ?? null;
      await communityEventsService.logCardEvent(
        groupId,
        cardTarget.user.id,
        cardTarget.type,
        me.id,
        detail,
        validityDays,
      );
      successHaptic();
      toast.success(he.cardIssuedToast);
      setCardTarget(null);
      // Refresh so the new card immediately bumps the roster discipline badge.
      reload();
    } catch (err) {
      logError('issueCommunityCard', err, { groupId, userId: cardTarget.user.id });
      appAlert(he.error, he.cardIssueFailed);
    } finally {
      setSavingCard(false);
    }
  };

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
                  holdsBall={(group.ballHolderIds ?? []).includes(u.id)}
                  holdsJerseys={(group.jerseysHolderIds ?? []).includes(u.id)}
                  cardCounts={cardCounts[u.id]}
                  internalRating={internalRating}
                  rating={
                    ratingsHiddenFromMe ? undefined : group.adminRatings?.[u.id]
                  }
                  onSetRating={
                    internalRating && iAmAdmin
                      ? () => setRatingTarget(u)
                      : undefined
                  }
                  onPress={(e) =>
                    iAmAdmin
                      ? openPlayerMenu(u, e)
                      : nav.navigate('PlayerCard', { userId: u.id, groupId: group.id })
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

      <PlayerActionMenu
        target={menuTarget}
        items={menuUser ? menuItemsFor(menuUser) : []}
        onClose={() => setMenuTarget(null)}
      />
      <IssueCardSheet
        visible={!!cardTarget}
        playerName={cardTarget?.user.name ?? ''}
        cardType={cardTarget?.type ?? null}
        saving={savingCard}
        onSave={saveCard}
        onClose={() => (savingCard ? null : setCardTarget(null))}
      />
    </SafeAreaView>
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
  holdsBall,
  holdsJerseys,
  cardCounts,
}: {
  user: User;
  isAdmin: boolean;
  stats?: PlayerStats;
  showDivider: boolean;
  /** Currently holds the club's ball / jerseys (from the end-evening handoff). */
  holdsBall?: boolean;
  holdsJerseys?: boolean;
  /** Admin-only: active yellow/red card counts → discipline badges. */
  cardCounts?: CardCounts;
  /** Community is in internal-rating mode → show the admins' rating. */
  internalRating?: boolean;
  /** The admin-assigned rating for this player, if set. */
  rating?: number;
  /** Admin-only: open the rating editor for this player. */
  onSetRating?: () => void;
  onPress: (e: GestureResponderEvent) => void;
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
          {holdsBall ? (
            <View style={styles.holderBadge} accessibilityLabel={he.equipmentHolderBallA11y}>
              <Ionicons name="football" size={13} color="#1D4ED8" />
            </View>
          ) : null}
          {holdsJerseys ? (
            <View style={styles.holderBadge} accessibilityLabel={he.equipmentHolderJerseysA11y}>
              <Ionicons name="shirt" size={13} color="#7C3AED" />
            </View>
          ) : null}
          <CardCountBadges counts={cardCounts} />
        </View>
        <View style={styles.statsRow}>
          <StatChip
            icon="football-outline"
            text={he.communityPlayerGames(games)}
          />
          {/* Internal rating is ADMIN-ONLY: the "דרג" chip shows solely to
              admins (onSetRating is provided). Members never see it — not even
              read-only — so the rating stays internal. When internal rating is
              off entirely, no chip at all. */}
          {internalRating && onSetRating ? (
            <Pressable onPress={onSetRating} hitSlop={6}>
              <View style={[styles.chip, styles.ratingChip]}>
                <Ionicons name="star" size={12} color={colors.warning} />
                <Text style={[styles.chipText, styles.ratingChipText]}>
                  {isRated(rating) ? formatRating(rating) : he.communityAdminRatingSet}
                </Text>
              </View>
            </Pressable>
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
  holderBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
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
});
