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
import {
  ManageEquipmentSheet,
  type EquipmentFlags,
} from '@/components/community/ManageEquipmentSheet';
import {
  CardCountBadges,
  RefereeCard,
  CARD_YELLOW,
  CARD_RED,
} from '@/components/community/CardCountBadges';
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
  // Equipment (ball / jerseys) sheet target + save-in-flight flag.
  const [equipTarget, setEquipTarget] = useState<User | null>(null);
  const [savingEquip, setSavingEquip] = useState(false);
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
  // ONE ⋮ menu per row with every action (no row-tap, no chevron). Card shows
  // for everyone; the admin/creator actions are gated. Rating is edited ONLY
  // here (the row chip is display-only).
  const menuItemsFor = (u: User): PlayerMenuItem[] => {
    const isMe = me?.id === u.id;
    const targetIsCreator = (group?.creatorId ?? group?.adminIds?.[0]) === u.id;
    const canManage = iAmCreator && !isMe;
    const removable = iAmAdmin && !iAmCreator && !isMe && !targetIsCreator;
    return [
      { key: 'card', icon: 'person-circle-outline', label: he.playerMenuCard, onPress: () => goToCard(u) },
      ...(iAmAdmin
        ? ([{ key: 'timeline', icon: 'time-outline', label: he.playerMenuTimeline, onPress: () => goToTimeline(u) }] as PlayerMenuItem[])
        : []),
      ...(internalRating && iAmAdmin
        ? ([{ key: 'rate', icon: 'star-outline', label: he.playerMenuRate, color: colors.warning, onPress: () => setRatingTarget(u) }] as PlayerMenuItem[])
        : []),
      ...(cardsOn && iAmAdmin
        ? ([
            { key: 'yellow', iconNode: <RefereeCard color={CARD_YELLOW} w={14} h={19} radius={3} />, label: he.cardYellow, color: colors.warning, onPress: () => setCardTarget({ user: u, type: 'yellow' }) },
            // A red card BLOCKS registration — confirm first (yellow stays one-tap).
            { key: 'red', iconNode: <RefereeCard color={CARD_RED} w={14} h={19} radius={3} />, label: he.cardRed, color: colors.danger, onPress: () => {
              warningHaptic();
              appAlert(he.cardRedConfirmTitle, he.cardRedConfirmBody(u.name), [
                { text: he.cancel, style: 'cancel' },
                { text: he.cardRed, style: 'destructive', onPress: () => setCardTarget({ user: u, type: 'red' }) },
              ]);
            } },
          ] as PlayerMenuItem[])
        : []),
      ...(iAmAdmin
        ? ([{ key: 'equipment', icon: 'cube-outline', label: he.playerMenuManageEquipment, onPress: () => setEquipTarget(u) }] as PlayerMenuItem[])
        : []),
      ...(canManage
        ? ([{ key: 'manage', icon: 'settings-outline', label: he.communityManageMember, onPress: () => handleManageMember(u) }] as PlayerMenuItem[])
        : removable
          ? ([{ key: 'remove', icon: 'person-remove-outline', label: he.communityRemoveMember, color: colors.danger, onPress: () => handleRemoveMember(u) }] as PlayerMenuItem[])
          : []),
    ];
  };

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

  // Persist this player's equipment flags. Holders are independent arrays
  // (several people can each hold a ball / jerseys), so we only add/remove
  // THIS player's id — never disturbing anyone else's mark. Optimistically
  // splice the group so the roster badges flip immediately; the realtime
  // subscription confirms it.
  const saveEquipment = useCallback(
    async (target: User, flags: EquipmentFlags) => {
      if (!group || !me) return;
      setSavingEquip(true);
      const ballWas = (group.ballHolderIds ?? []).includes(target.id);
      const jerseysWas = (group.jerseysHolderIds ?? []).includes(target.id);
      const toggle = (arr: UserId[] | undefined, on: boolean): UserId[] => {
        const set = new Set(arr ?? []);
        if (on) set.add(target.id);
        else set.delete(target.id);
        return Array.from(set);
      };
      const ballHolderIds = toggle(group.ballHolderIds, flags.ball);
      const jerseysHolderIds = toggle(group.jerseysHolderIds, flags.jerseys);
      try {
        await groupService.setEquipmentHolders(group.id, {
          ballHolderIds,
          jerseysHolderIds,
        });
        // Record each actual change on the player's timeline — received when
        // marked, returned when cleared. Best-effort: a timeline write failure
        // shouldn't undo the (already-saved) holder change.
        const logs: Promise<void>[] = [];
        if (flags.ball !== ballWas) {
          logs.push(
            communityEventsService.logEquipmentChange(
              group.id, target.id, 'ball', me.id, !flags.ball,
            ),
          );
        }
        if (flags.jerseys !== jerseysWas) {
          logs.push(
            communityEventsService.logEquipmentChange(
              group.id, target.id, 'jerseys', me.id, !flags.jerseys,
            ),
          );
        }
        await Promise.allSettled(logs);
        setGroup((g) => (g ? { ...g, ballHolderIds, jerseysHolderIds } : g));
        setEquipTarget(null);
        successHaptic();
        toast.success(he.equipmentUpdatedToast);
      } catch (err) {
        logError('setEquipmentHolders', err, { groupId, userId: target.id });
        toast.error(he.equipmentUpdateFailed);
      } finally {
        setSavingEquip(false);
      }
    },
    [group, me, groupId],
  );

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
                  // Show the rating chip to admins (display-only); editing is
                  // via the "דרג" menu item, not a chip tap.
                  showRating={internalRating && iAmAdmin && !ratingsHiddenFromMe}
                  // ONLY the ⋮ opens the menu — the row body is not tappable and
                  // there's no chevron (user request).
                  onOpenMenu={(e) => openPlayerMenu(u, e)}
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
      <ManageEquipmentSheet
        visible={!!equipTarget}
        playerName={equipTarget?.name ?? ''}
        initial={{
          ball: !!equipTarget && (group?.ballHolderIds ?? []).includes(equipTarget.id),
          jerseys: !!equipTarget && (group?.jerseysHolderIds ?? []).includes(equipTarget.id),
        }}
        saving={savingEquip}
        onSave={(flags) => equipTarget && saveEquipment(equipTarget, flags)}
        onClose={() => (savingEquip ? null : setEquipTarget(null))}
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
  showRating,
  onOpenMenu,
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
  /** Admin-only: show the (display-only) rating chip. Editing is via the menu. */
  showRating?: boolean;
  /** Open the player's ⋮ action menu (the ONLY interaction — no row tap). */
  onOpenMenu: (e: GestureResponderEvent) => void;
}) {
  const games = stats?.gamesPlayed ?? 0;
  return (
    <View style={[styles.row, showDivider && styles.rowDivider]}>
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
          {/* Internal rating is ADMIN-ONLY and DISPLAY-ONLY here: the chip shows
              the value (or "לא דורג"), but tapping does nothing — rating is
              edited from the "דרג" item in the player's ⋮ menu. Members never
              see it; when internal rating is off, no chip at all. */}
          {internalRating && showRating ? (
            <View style={[styles.chip, styles.ratingChip]}>
              <Ionicons name="star" size={12} color={colors.warning} />
              <Text style={[styles.chipText, styles.ratingChipText]}>
                {isRated(rating) ? formatRating(rating) : he.ratingNotRated}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Pressable
        onPress={onOpenMenu}
        hitSlop={10}
        style={({ pressed }) => [styles.removeBtn, pressed && { opacity: 0.6 }]}
        accessibilityRole="button"
        accessibilityLabel="אפשרויות שחקן"
      >
        <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
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
    // The name is never truncated: it stays full on ONE line, and the badges
    // (admin / ball / jerseys / cards) WRAP to the next line when there isn't
    // room for both — instead of crushing the name to "ב…".
    flexWrap: 'wrap',
  },
  name: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    // Don't shrink — force the badges to wrap first. Cap at the row width so a
    // genuinely screen-wide name still clips gracefully rather than overflowing.
    flexShrink: 0,
    maxWidth: '100%',
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
