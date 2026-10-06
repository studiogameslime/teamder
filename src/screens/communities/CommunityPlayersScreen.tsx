// CommunityPlayersScreen — full member list with per-community stats.
// Reachable from the redesigned CommunityDetailsScreen via the
// the שחקנים tab, and from the hamburger menu. (The info tab's players
// preview that used to lead here was removed — the tab replaced it.)
//
// Visual: identity-row card per player (jersey + name + admin badge
// + games played). Sorted admins-first, then by games-played desc.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { UserAvatar } from '@/components/UserAvatar';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { toast } from '@/components/Toast';
import { groupService } from '@/services';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import { RTL_LABEL_ALIGN, clubAccent, clubSurface, colors, spacing, typography } from '@/theme';
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

export interface CommunityPlayersScreenProps {
  /**
   * Set when the roster is rendered as a TAB of the club screen rather than
   * pushed as its own route. Then the club id comes from the shell, and the
   * shell owns the chrome: this component drops its SafeAreaView and its
   * ScreenHeader, and renders the shell's hero + tab bar as the list's sticky
   * header instead.
   */
  groupId?: string;
  /** The shell's hero + tab bar. Sticks to the top of the list. */
  header?: React.ReactElement | null;
}

/** Stable empty list — a fresh [] each render would churn FlatList. */
const EMPTY_ROWS: User[] = [];

export function CommunityPlayersScreen(props: CommunityPlayersScreenProps = {}) {
  const nav = useNavigation<Nav>();
  // Route params only when pushed as a route. `useRoute` still runs — hooks
  // cannot be conditional — but its params are ignored in embedded mode.
  const routeParams = useRoute<Params>().params as Params['params'] | undefined;
  // One of the two always holds it: embedded, the shell passes it; standalone,
  // the CommunityPlayers route cannot be reached without it.
  const groupId: string = props.groupId ?? routeParams!.groupId;
  const embedded = !!props.groupId;
  // Search and the three filter chips, both from the reference. Pure view
  // state over the roster that is ALREADY loaded — no query, no extra read,
  // and the virtualised list keeps windowing whatever survives the filter.
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<'all' | 'admins' | 'players'>('all');
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

  // Screen-open analytics — fired once, after the first load resolves so the
  // member count is real. The ref guards the refocus reloads.
  const openLogged = useRef(false);
  useEffect(() => {
    if (openLogged.current || !group) return;
    openLogged.current = true;
    logEvent(AnalyticsEvent.CommunityPlayersOpened, {
      groupId,
      memberCount: members.length,
    });
  }, [group, members.length, groupId]);

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
  // Head-to-head comparison — anchored to THIS community's groupId (unambiguous
  // here, unlike the player card which had to guess the group). Per-community
  // stats vs the viewer.
  const goToCompare = (u: User) => {
    logEvent(AnalyticsEvent.PlayerCompareOpened, { groupId, otherUid: u.id });
    nav.navigate('PlayerCompare', { groupId, otherUid: u.id, otherName: u.name });
  };

  // Yellow/red card actions only appear when the club enabled the cards
  // feature in its advanced settings. The player-card + timeline entries
  // always show for admins.
  const cardsOn = !!group?.cardsEnabled;
  // Single entry point to the issue-card sheet (yellow is one-tap, red only
  // after the confirm) — so the prompt is counted once per type.
  const openCardSheet = (u: User, type: 'yellow' | 'red') => {
    logEvent(AnalyticsEvent.DisciplineCardPrompted, {
      groupId,
      userId: u.id,
      type,
    });
    setCardTarget({ user: u, type });
  };
  // ONE ⋮ menu per row with every action (no row-tap, no chevron). Card shows
  // for everyone; the admin/creator actions are gated. Rating is edited ONLY
  // here (the row chip is display-only).
  const menuItemsFor = (u: User): PlayerMenuItem[] => {
    const isMe = me?.id === u.id;
    const targetIsCreator = (group?.creatorId ?? group?.adminIds?.[0]) === u.id;
    const canManage = iAmCreator && !isMe;
    // A non-creator admin cannot remove a peer admin: the server rejects it
    // (removeMember's arrayRemove(adminIds) trips the creator-only rule) and
    // the user just got a permission error. Hide the action for admin targets.
    const targetIsAdmin = !!group?.adminIds?.includes(u.id);
    const removable =
      iAmAdmin && !iAmCreator && !isMe && !targetIsCreator && !targetIsAdmin;
    return [
      { key: 'card', icon: 'person-circle-outline', label: he.playerMenuCard, onPress: () => goToCard(u) },
      // Compare THIS player to me (any member can) — but not myself.
      ...(!isMe
        ? ([{ key: 'compare', icon: 'podium-outline', label: he.compareCta, onPress: () => goToCompare(u) }] as PlayerMenuItem[])
        : []),
      ...(iAmAdmin
        ? ([{ key: 'timeline', icon: 'time-outline', label: he.playerMenuTimeline, onPress: () => goToTimeline(u) }] as PlayerMenuItem[])
        : []),
      ...(internalRating && iAmAdmin
        ? ([{ key: 'rate', icon: 'star-outline', label: he.playerMenuRate, color: colors.warning, onPress: () => {
            logEvent(AnalyticsEvent.RatingSheetOpened, {
              groupId,
              hasRating: (group?.adminRatings?.[u.id] ?? 0) > 0,
            });
            setRatingTarget(u);
          } }] as PlayerMenuItem[])
        : []),
      ...(cardsOn && iAmAdmin
        ? ([
            { key: 'yellow', iconNode: <RefereeCard color={CARD_YELLOW} w={14} h={19} radius={3} />, label: he.cardYellow, color: colors.warning, onPress: () => openCardSheet(u, 'yellow') },
            // A red card BLOCKS registration — confirm first (yellow stays one-tap).
            { key: 'red', iconNode: <RefereeCard color={CARD_RED} w={14} h={19} radius={3} />, label: he.cardRed, color: colors.danger, onPress: () => {
              warningHaptic();
              appAlert(he.cardRedConfirmTitle, he.cardRedConfirmBody(u.name), [
                { text: he.cancel, style: 'cancel' },
                { text: he.cardRed, style: 'destructive', onPress: () => openCardSheet(u, 'red') },
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
        if (rating !== null) {
          logEvent(AnalyticsEvent.PlayerRated, {
            groupId: group.id,
            rating,
            wasRated: (group.adminRatings?.[playerId] ?? 0) > 0,
          });
        } else {
          logEvent(AnalyticsEvent.RatingCleared, { groupId: group.id });
        }
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

  const adminSet = new Set(group?.adminIds ?? []);
  const needle = query.trim().toLowerCase();
  const visible = ordered.filter((u) => {
    if (chip === 'admins' && !adminSet.has(u.id)) return false;
    if (chip === 'players' && adminSet.has(u.id)) return false;
    if (needle && !(u.name ?? '').toLowerCase().includes(needle)) return false;
    return true;
  });
  const adminCount = ordered.filter((u) => adminSet.has(u.id)).length;

  return (
    // Top only. This screen sits inside the tab navigator, which already
    // reserves the bottom inset — claiming it here counted it twice and left a
    // visible band above the ad banner. Same shape as the two live screens
    // that had it before; targeting API 36 made the inset large enough to see.
    // Embedded, the shell above already claimed the top inset — claiming it
    // again pushes the hero down by the status-bar height.
    <SafeAreaView style={styles.root} edges={embedded ? [] : ['top']}>
      {embedded ? null : <ScreenHeader title={he.communityPlayersScreenTitle} />}
      {/* ONE list for all four states.
       *
       *  Loading, no-group and no-members each rendered the header as a bare
       *  sibling, and only the populated state put it inside the list. React
       *  sees two different element types at that position, so the swap
       *  UNMOUNTED the hero and mounted a new one: the stadium photo blanked
       *  and reloaded and the page re-laid-out under it, every time this tab
       *  was opened. Reported on 1.1.18 as "כשעוברים בין טאבים נראה שכל המסך
       *  קופץ"; the numbers tab had the same fault.
       *
       *  The list is the same element throughout now — `data` stays empty
       *  until there are members and ListEmptyComponent carries the three
       *  messages.
       *
       *  FlatList virtualises the row list so a 200-member community renders
       *  only the visible window. We keep the single wrapping Card by
       *  spreading FlatList contents through ListHeaderComponent + the
       *  renderItem; the visual matches the old ScrollView + map. */}
      <FlatList
          data={group && ordered.length > 0 ? visible : EMPTY_ROWS}
          keyExtractor={(u) => u.id}
          contentContainerStyle={[
            styles.content,
            // `center` is flex:1 and only means something in a container that
            // is allowed to grow.
            !(group && ordered.length > 0) && styles.contentFill,
          ]}
          ListEmptyComponent={
            <View style={styles.center}>
              {/* `loading`, not `loading && !group`. The club document lands
                  before its member docs do, and gating the loader on the
                  document meant the roster announced "אין שחקנים" for the
                  second it took the people to arrive — a club with 29 members
                  claiming to be empty. Same ball the numbers tab spins. */}
              {loading ? (
                <SoccerBallLoader size={40} />
              ) : (
                <Text style={styles.empty}>
                  {!group ? he.communitiesEmpty : he.communityPlayersEmpty}
                </Text>
              )}
            </View>
          }
          ListHeaderComponent={
            <>
              {props.header ? (
                <View style={styles.headerBleed}>{props.header}</View>
              ) : null}
              {/* Search and filters belong to a roster that HAS people; over
                  an empty list they are three controls that do nothing. */}
              {group && ordered.length > 0 ? (
              <>
              <View style={styles.search}>
                <Ionicons name="search" size={18} color={colors.textMuted} />
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={he.communityPlayersSearch}
                  placeholderTextColor={colors.textMuted}
                  returnKeyType="search"
                  accessibilityLabel={he.communityPlayersSearch}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.chips}>
                {(
                  [
                    ['all', he.communityPlayersChipAll, ordered.length],
                    ['admins', he.communityPlayersChipAdmins, adminCount],
                    ['players', he.communityPlayersChipPlayers, ordered.length - adminCount],
                  ] as const
                ).map(([key, label, n]) => (
                  <Pressable
                    key={key}
                    onPress={() => setChip(key)}
                    style={[styles.chipPill, chip === key && styles.chipPillOn]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: chip === key }}
                  >
                    <Text style={[styles.chipLabel, chip === key && styles.chipLabelOn]}>
                      {`${label} (${n})`}
                    </Text>
                  </Pressable>
                ))}
              </View>
              </>
              ) : null}
            </>
          }
          renderItem={({ item: u, index: i }) => {
            // Unreachable while `data` is empty without a group, but the
            // compiler cannot see that through the ternary above.
            if (!group) return null;
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
                  // Every MEMBER sees the rating, per the reference — the
                  // number under the name. It was admin-only for no reason the
                  // data supports: `adminRatings` lives on the group document,
                  // which the rules already hand to members and nobody else, so
                  // the admin check was hiding a field the reader could already
                  // fetch. Editing stays admin-only (the "דרג" menu item);
                  // this is display.
                  //
                  // `ratingsHiddenFromMe` is UNTOUCHED: a club that switched
                  // `hideInternalRating` on has said it does not want its
                  // members comparing numbers, and that decision still holds.
                  showRating={internalRating && !ratingsHiddenFromMe}
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
  const ratingShown = !!internalRating && !!showRating;
  const hasCards = (cardCounts?.yellow ?? 0) > 0 || (cardCounts?.red ?? 0) > 0;
  return (
    <View style={[styles.row, showDivider && styles.rowDivider]}>
      {/* `md` (56 → rendered at 48 by the wrapper's own padding) rather than
          `sm` (36): the reference's roster avatar is the row's anchor and reads
          at a glance. `sm` made the row look like a settings list. */}
      <UserAvatar user={user} size={48} />
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
        {/* Internal rating is ADMIN-ONLY and DISPLAY-ONLY here: the chip shows
            the value (or "לא דורג"), but tapping does nothing — rating is
            edited from the "דרג" item in the player's ⋮ menu. Members never
            see it; when internal rating is off, no chip at all — and with the
            games-played stat removed (user report) the row then has no stats
            line, so we skip the wrapper entirely to avoid a phantom gap. */}
        {/* The reference puts the rating straight under the name as
            "4.5 ⭐" — number first, star closing it on the left. Not a chip:
            a pill around every row's rating turned the column into a row of
            buttons. The GATE is unchanged (admins only, internal rating on,
            not hidden); only the presentation moved. */}
        {/* The second line: the rating, then the badges that qualify this
            person — who is holding the ball and the jerseys, and any active
            cards. The badges used to sit up in the NAME row, pushed out past
            the admin chip and a long name, which left them floating in the
            middle of the row with nothing to read them against (owner, 02.10:
            "תוריד את הגופיה והכדור שיהיו ליד הדירוג"). Down here they share a
            baseline with the rating, which is the other per-player fact.

            Rendered whenever there is ANYTHING to show, not only for a rated
            admin view — moving them into the rating's own condition would
            have hidden the equipment holders from every ordinary member. */}
        {ratingShown || holdsBall || holdsJerseys || hasCards ? (
          <View style={styles.ratingRow}>
            {ratingShown ? (
              <>
                <Text style={styles.ratingValue}>
                  {isRated(rating) ? formatRating(rating) : he.ratingNotRated}
                </Text>
                <Ionicons name="star" size={14} color={colors.warning} />
              </>
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
        ) : null}
      </View>
      {/* No position number. The roster is a list of the club's members, not a
          league table — the numbers read as a ranking nobody had earned, and
          the standings that DO rank people live in the סטטיסטיקות tab. */}
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

const styles = StyleSheet.create({
  // The reference's search field: a soft grey pill with the magnifier on the
  // leading edge.
  search: {
    // Clear of the tab bar above it — the field sat flush against the tabs and
    // read as part of them.
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 46,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
    backgroundColor: '#E8EEF8',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    padding: 0,
  },
  chips: {
    // Clear of the search field above, for the same reason the field is clear
    // of the tab bar: flush against it, the chips read as part of the search
    // control rather than as a filter over the list below.
    marginTop: spacing.xs,
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  ratingValue: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  chipPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#E8EEF8',
  },
  chipPillOn: { backgroundColor: clubAccent.blue },
  chipLabel: { fontSize: 13.5, fontWeight: '700', color: '#4B5878' },
  chipLabelOn: { color: colors.textOnPrimary },
  // Local club ground — cool and a step below white, so the cards on it
  // have an edge. See `clubSurface`.
  root: { flex: 1, backgroundColor: clubSurface.ground },
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
  contentFill: { flexGrow: 1 },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  // The shell's hero is full-bleed; this list's content container is not.
  // Undo its gutter for the header alone rather than un-padding every row.
  headerBleed: {
    marginHorizontal: -spacing.lg,
    marginTop: -spacing.lg,
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
    // The reference's rows breathe: ~68pt of pitch per player, against the
    // ~52 this had. Density was the single loudest difference on this tab.
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    minHeight: 72,
  },
  removeBtn: {
    padding: 4,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: clubSurface.divider,
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
    fontSize: 17,
    color: colors.text,
    fontWeight: '800',
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
