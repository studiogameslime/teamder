// CommunityDetailsScreen — full read-only view of a single community for
// members + admins, with primary actions (WhatsApp / invite / leave).
//
// Phase A scope: the screen renders, contact + invite + leave work,
// upcoming games are loaded from gameService. Editing the community is
// covered later (Phase B's CreateGroupScreen extension is reused for
// edit). For now we don't show edit affordances here.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { PlayerIdentity } from '@/components/PlayerIdentity';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MatchCard } from '@/components/MatchCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { toast } from '@/components/Toast';
import { groupService } from '@/services';
import { deepLinkService } from '@/services/deepLinkService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { ratingsService } from '@/services/ratingsService';
import { gameService } from '@/services/gameService';
import {
  canCancelRegistration,
  canJoinGame,
  isCancelled,
  isFinished,
  isRoundRunning,
} from '@/services/gameLifecycle';
import { notificationsService } from '@/services/notificationsService';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import { Game, Group, User, WeekdayIndex, getTeamCreatorId } from '@/types';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { Switch } from 'react-native';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetails'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetails'>;

function formatDays(days: WeekdayIndex[] | undefined): string {
  if (!days || days.length === 0) return '';
  return days
    .slice()
    .sort()
    .map((d) => he.availabilityDayShort[d])
    .join(', ');
}

export function CommunityDetailsScreen() {
  const nav = useNavigation<Nav>();
  const { groupId } = useRoute<Params>().params;
  const me = useUserStore((s) => s.currentUser);
  const leaveGroup = useGroupStore((s) => s.leaveGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [upcoming, setUpcoming] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyLeave, setBusyLeave] = useState(false);
  const [busyRecurring, setBusyRecurring] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const g = await groupService.get(groupId);
      setGroup(g);
      if (g) {
        logEvent(AnalyticsEvent.GroupViewed, { groupId: g.id });
        // Pull pending users into the same hydrate batch so the
        // approval section below can render their names + jerseys
        // without a second round-trip.
        const memberIds = Array.from(
          new Set([...g.adminIds, ...g.playerIds, ...g.pendingPlayerIds])
        );
        const [users, games] = await Promise.all([
          groupService.hydrateUsers(memberIds),
          gameService.getCommunityGames(me?.id ?? '', [g.id]).catch(() => [] as Game[]),
        ]);
        // Include games where the user is already involved too.
        const myGames = me
          ? await gameService.getMyGames(me.id).catch(() => [] as Game[])
          : [];
        const allUpcoming = mergeById([...games, ...myGames]).filter(
          (x) => x.groupId === g.id && x.status === 'open'
        );
        allUpcoming.sort((a, b) => a.startsAt - b.startsAt);
        setMembers(users);
        setUpcoming(allUpcoming);
      } else {
        setMembers([]);
        setUpcoming([]);
      }
    } finally {
      setLoading(false);
    }
  }, [groupId, me]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const isMember = useMemo(
    () => !!group && !!me && group.playerIds.includes(me.id),
    [group, me]
  );
  const isAdmin = useMemo(
    () => !!group && !!me && group.adminIds.includes(me.id),
    [group, me]
  );

  const adminMembers = useMemo(
    () => members.filter((u) => group?.adminIds.includes(u.id)),
    [members, group]
  );
  const regularMembers = useMemo(
    () =>
      members.filter(
        (u) =>
          group?.playerIds.includes(u.id) && !group?.adminIds.includes(u.id)
      ),
    [members, group]
  );

  const creatorId = group ? getTeamCreatorId(group) : undefined;

  const handlePromote = async (uid: string) => {
    if (!group || !me) return;
    try {
      const next = await groupService.promoteToCoach(group.id, me.id, uid);
      // Reflect locally so the lists re-partition without a refetch.
      setGroup(next);
    } catch (e) {
      Alert.alert(he.error, String((e as Error).message ?? e));
    }
  };
  const handleDemote = async (uid: string) => {
    if (!group || !me) return;
    Alert.alert(he.communityDetailsDemoteConfirmTitle, '', [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.communityDetailsDemoteConfirm,
        style: 'destructive',
        onPress: async () => {
          try {
            const next = await groupService.demoteCoach(
              group.id,
              me.id,
              uid,
            );
            setGroup(next);
          } catch (e) {
            Alert.alert(he.error, String((e as Error).message ?? e));
          }
        },
      },
    ]);
  };

  const phoneValid =
    !!group?.contactPhone && isValidIsraeliPhone(group.contactPhone);

  const handleLeave = () => {
    if (!group || !me) return;
    if (group.adminIds.includes(me.id) && group.adminIds.length === 1) {
      Alert.alert(he.error, he.communityDetailsLeaveLastAdmin);
      return;
    }
    Alert.alert(
      he.communityDetailsLeaveConfirmTitle,
      he.communityDetailsLeaveConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.communityDetailsLeave,
          style: 'destructive',
          onPress: async () => {
            setBusyLeave(true);
            try {
              await leaveGroup(group.id, me.id);
              nav.goBack();
            } catch (e) {
              const msg = (e as Error).message;
              if (msg === 'LAST_ADMIN') {
                Alert.alert(he.error, he.communityDetailsLeaveLastAdmin);
              } else {
                Alert.alert(he.error, String(msg ?? e));
              }
            } finally {
              setBusyLeave(false);
            }
          },
        },
      ]
    );
  };

  const handleInvite = async () => {
    if (!group) return;
    try {
      const link = deepLinkService.buildInviteUrl({
        type: 'team',
        id: group.id,
        invitedBy: me?.id,
      });
      const result = await Share.share({
        title: he.inviteShareSubject,
        message: he.communityInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { groupId: group.id });
      }
    } catch (err) {
      if (__DEV__) console.warn('[community] share failed', err);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <SoccerBallLoader size={40} style={{ marginTop: spacing.lg }} />
      </SafeAreaView>
    );
  }

  if (!group) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.loading} />
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{he.communitiesEmpty}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const days = formatDays(group.preferredDays);
  const memberCount = (group.playerIds?.length ?? 0);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScreenHeader
        title={group.name}
        actions={
          isAdmin
            ? [
                {
                  icon: 'create-outline',
                  onPress: () =>
                    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                      'CommunityEdit',
                      { groupId: group.id },
                    ),
                  label: he.communityEditTitle,
                },
              ]
            : undefined
        }
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① HERO — name + role badge + city/field sub-info */}
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {group.name}
            </Text>
            <HeroRoleBadge isAdmin={isAdmin} isMember={isMember} />
          </View>
          <View style={styles.heroSub}>
            {group.city || group.fieldAddress ? (
              <View style={styles.subLine}>
                <View style={styles.subRow}>
                  <Ionicons
                    name="location-outline"
                    size={14}
                    color={colors.textMuted}
                    style={styles.subIcon}
                  />
                  <Text style={styles.subText} numberOfLines={1}>
                    {[group.city, group.fieldAddress]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <View />
              </View>
            ) : null}
            <View style={styles.subLine}>
              <View style={styles.subRow}>
                <Ionicons
                  name="football-outline"
                  size={14}
                  color={colors.textMuted}
                  style={styles.subIcon}
                />
                <Text style={styles.subText} numberOfLines={1}>
                  {group.fieldName}
                </Text>
              </View>
              <View />
            </View>
          </View>
          <View style={styles.divider} />
        </View>

        {/* ② INFO GRID — strict 2×2 */}
        <View style={styles.infoGrid}>
          <InfoCell
            icon="people-outline"
            label={he.communityDetailsMembers}
            value={String(memberCount)}
          />
          <InfoCell
            icon="calendar-outline"
            label={he.communityDetailsPreferredDays}
            value={days || '—'}
          />
          <InfoCell
            icon="time-outline"
            label={he.communityDetailsPreferredHour}
            value={group.preferredHour || '—'}
          />
          <InfoCell
            icon="football-outline"
            label={he.communityDetailsField}
            value={group.fieldName || '—'}
          />
        </View>

        {/* ③ ABOUT (description) */}
        {group.description ? (
          <View>
            <Text style={styles.sectionTitle}>{he.communityDetailsAbout}</Text>
            <Card style={styles.bodyCard}>
              <Text style={styles.bodyText}>{group.description}</Text>
            </Card>
          </View>
        ) : null}

        {/* ④ RULES */}
        {group.rules ? (
          <View>
            <Text style={styles.sectionTitle}>{he.communityDetailsRules}</Text>
            <Card style={styles.bodyCard}>
              <Text style={styles.bodyText}>{group.rules}</Text>
            </Card>
          </View>
        ) : null}

        {/* ⑤ NOTES */}
        {group.notes ? (
          <View>
            <Text style={styles.sectionTitle}>{he.communityDetailsNotes}</Text>
            <Card style={styles.bodyCard}>
              <Text style={styles.bodyText}>{group.notes}</Text>
            </Card>
          </View>
        ) : null}

        {/* Phase 7: recurring-game block. Shown when the community has
            either explicit recurring config or fallback preferred-days/
            hour info that's enough to derive the next occurrence. */}
        {isAdmin && me && hasRecurringInfo(group) ? (
          <View>
            <Text style={styles.sectionTitle}>
              {he.communityDetailsRecurring}
            </Text>
            <Card style={styles.bodyCard}>
              <Text style={styles.bodyText}>{recurringSummary(group)}</Text>
            <Button
              title={he.communityDetailsCreateRecurringGame}
              variant="outline"
              size="md"
              fullWidth
              iconLeft="add-circle-outline"
              loading={busyRecurring}
              disabled={busyRecurring}
              onPress={() => {
                if (!me || busyRecurring) return;
                const ts = nextOccurrence(group);
                if (!ts) {
                  Alert.alert(he.error, he.communityDetailsRecurringNoConfig);
                  return;
                }
                Alert.alert(
                  he.communityDetailsCreateRecurringGame,
                  `${recurringSummary(group)} · ${formatHebrewDate(ts)}`,
                  [
                    { text: he.cancel, style: 'cancel' },
                    {
                      text: he.communityDetailsRecurringConfirm,
                      onPress: async () => {
                        // Lock immediately so the dialog's confirm tap
                        // can't double-fire (Android can stack dialogs;
                        // a fast double-tap can also re-enter).
                        if (busyRecurring) return;
                        setBusyRecurring(true);
                        try {
                          const r = await createRecurring(group, me.id);
                          if (!r.ok) {
                            Alert.alert(
                              he.error,
                              he.communityDetailsRecurringFailed,
                            );
                          }
                        } finally {
                          setBusyRecurring(false);
                        }
                      },
                    },
                  ],
                );
              }}
              style={{ marginTop: spacing.sm }}
            />
            </Card>
          </View>
        ) : null}

        {/* Contact admin button stays near the top — it's the only
            non-management action and members reach for it often. The
            management actions (edit / invite / leave) are grouped at
            the bottom of the screen. */}
        {phoneValid ? (
          <Button
            title={he.communityDetailsContactAdmin}
            variant="outline"
            size="lg"
            fullWidth
            iconLeft="logo-whatsapp"
            onPress={() => openWhatsApp(group.contactPhone)}
          />
        ) : null}

        {/* Per-community "new game" subscription. Only members see it —
            non-members can't get notifications for a community they
            haven't joined. */}
        {isMember && me ? (
          <Card style={styles.section}>
            {(() => {
              const subscribed = (me.newGameSubscriptions ?? []).includes(
                group.id,
              );
              const flip = (next: boolean) => {
                const cur = me.newGameSubscriptions ?? [];
                const updated = next
                  ? Array.from(new Set([...cur, group.id]))
                  : cur.filter((g) => g !== group.id);
                // Optimistic local update so the switch responds
                // immediately; the persist write is fire-and-forget.
                useUserStore.setState({
                  currentUser: { ...me, newGameSubscriptions: updated },
                });
                notificationsService.setCommunitySubscription(
                  me.id,
                  group.id,
                  next,
                );
              };
              return (
                // Tap-anywhere: wrapping the row in a Pressable lets
                // the user hit the label (not just the small Switch)
                // to toggle the subscription.
                <Pressable
                  onPress={() => flip(!subscribed)}
                  style={styles.subscriptionRow}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subscriptionLabel}>
                      {he.communityNotifyNewGames}
                    </Text>
                  </View>
                  <Switch
                    value={subscribed}
                    onValueChange={flip}
                    trackColor={{
                      false: colors.border,
                      true: colors.primary,
                    }}
                    thumbColor="#fff"
                  />
                </Pressable>
              );
            })()}
          </Card>
        ) : null}

        {/* Admins */}
        {adminMembers.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>
              {he.communityDetailsAdmins}{' '}
              <Text style={styles.sectionCount}>({adminMembers.length})</Text>
            </Text>
            <Card style={styles.membersCard}>
              {adminMembers.map((u, i) => (
                <MemberRow
                  key={u.id}
                  user={u}
                  groupId={group.id}
                  isAdmin
                  isCreator={creatorId === u.id}
                  viewerIsCreator={!!me && creatorId === me.id}
                  onDemote={
                    !!me && creatorId === me.id && creatorId !== u.id
                      ? () => handleDemote(u.id)
                      : undefined
                  }
                  onOpenCard={() =>
                    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                      'PlayerCard',
                      { userId: u.id, groupId: group.id },
                    )
                  }
                  showDivider={i > 0}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {/* Pending join approvals — admin-only. Each row gets ✓/✗
            actions that call groupService.approveMember/rejectMember
            and reload to refresh the list. The same hydrateUsers call
            above already loaded these user docs. */}
        {isAdmin && group.pendingPlayerIds.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>
              {he.communityDetailsPendingTitle}{' '}
              <Text style={styles.sectionCount}>
                ({group.pendingPlayerIds.length})
              </Text>
            </Text>
            <Card style={styles.membersCard}>
              {group.pendingPlayerIds.map((uid, i) => {
                const u = members.find((m) => m.id === uid);
                const name = u?.name ?? '...';
                return (
                  <View
                    key={`pending:${uid}`}
                    style={[
                      styles.pendingRow,
                      i > 0 && styles.pendingRowDivider,
                    ]}
                  >
                    <PlayerIdentity
                      user={{ id: uid, name, jersey: u?.jersey }}
                      size={32}
                    />
                    <Text style={styles.pendingName} numberOfLines={1}>
                      {name}
                    </Text>
                    <View style={styles.pendingActions}>
                      <Pressable
                        onPress={async () => {
                          try {
                            // Use the store wrapper so the local
                            // `groups` cache flips immediately —
                            // calling the service directly here used
                            // to leave the badge stale until app
                            // restart.
                            await useGroupStore
                              .getState()
                              .approveMember(group.id, uid);
                            await reload();
                          } catch (err) {
                            if (__DEV__) {
                              console.warn(
                                '[communityDetails] approveMember failed',
                                err,
                              );
                            }
                            toast.error(he.error);
                          }
                        }}
                        hitSlop={6}
                        accessibilityLabel={he.pendingApprove}
                        style={({ pressed }) => [
                          styles.pendingApproveBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons
                          name="checkmark"
                          size={16}
                          color={colors.textOnPrimary}
                        />
                      </Pressable>
                      <Pressable
                        onPress={async () => {
                          try {
                            await useGroupStore
                              .getState()
                              .rejectMember(group.id, uid);
                            await reload();
                          } catch (err) {
                            if (__DEV__) {
                              console.warn(
                                '[communityDetails] rejectMember failed',
                                err,
                              );
                            }
                            toast.error(he.error);
                          }
                        }}
                        hitSlop={6}
                        accessibilityLabel={he.pendingReject}
                        style={({ pressed }) => [
                          styles.pendingRejectBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons
                          name="close"
                          size={16}
                          color={colors.danger}
                        />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </Card>
          </View>
        ) : null}

        {/* Regular members */}
        {regularMembers.length > 0 ? (
          <View>
            <Text style={styles.sectionTitle}>
              {he.communityDetailsMembers}{' '}
              <Text style={styles.sectionCount}>({regularMembers.length})</Text>
            </Text>
            <Card style={styles.membersCard}>
              {regularMembers.map((u, i) => (
                <MemberRow
                  key={u.id}
                  user={u}
                  groupId={group.id}
                  isAdmin={false}
                  isCreator={false}
                  viewerIsCreator={!!me && creatorId === me.id}
                  onPromote={
                    !!me && creatorId === me.id
                      ? () => handlePromote(u.id)
                      : undefined
                  }
                  onOpenCard={() =>
                    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                      'PlayerCard',
                      { userId: u.id, groupId: group.id },
                    )
                  }
                  showDivider={i > 0}
                />
              ))}
            </Card>
          </View>
        ) : null}

        {/* Nearest upcoming game — uses MatchCard so it matches the
            Games tab pixel-for-pixel. Full multi-game listing lives
            in the Games tab. */}
        <View>
          <Text style={styles.sectionTitle}>
            {he.communityDetailsNextGame}
          </Text>
          {upcoming.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {he.communityDetailsNoUpcoming}
              </Text>
            </Card>
          ) : (
            <MatchCard
              game={upcoming[0]}
              userId={me?.id ?? ''}
              onPrimary={async (cta) => {
                // Real join/cancel — same logic MatchDetails runs but
                // inline so the user doesn't need to navigate away.
                // After a successful mutation we reload() to refresh
                // the upcoming preview with the new roster.
                if (!me) return;
                const game = upcoming[0];
                const wantJoin =
                  cta === 'join' ||
                  cta === 'waitlist' ||
                  cta === 'pending';
                const wantCancel =
                  cta === 'cancel' || cta === 'leaveWaitlist';
                if (wantJoin) {
                  if (!canJoinGame(game)) {
                    if (isFinished(game)) {
                      toast.info(he.matchDetailsAlreadyFinished);
                    } else if (isCancelled(game)) {
                      toast.info(he.matchDetailsAlreadyCancelled);
                    } else if (isRoundRunning(game)) {
                      toast.info(he.matchDetailsAlreadyLive);
                    } else if (
                      game.startsAt && game.startsAt < Date.now()
                    ) {
                      toast.info(he.matchDetailsAlreadyStarted);
                    } else {
                      toast.info(he.matchDetailsClosedForRegistration);
                    }
                    return;
                  }
                } else if (wantCancel) {
                  if (!canCancelRegistration(game)) {
                    toast.info(he.matchDetailsAlreadyLive);
                    return;
                  }
                } else {
                  return;
                }
                try {
                  // Splice the local upcoming preview directly with
                  // the result instead of doing a getDoc-based
                  // reload — same race avoidance as the guest-add
                  // path. The CF realtime listeners on other devices
                  // still fire normally; only the local UI is
                  // updated optimistically.
                  if (wantJoin) {
                    const result = await gameService.joinGameV2(
                      game.id,
                      me.id,
                    );
                    setUpcoming((prev) =>
                      prev.map((g) => {
                        if (g.id !== game.id) return g;
                        const next = { ...g };
                        if (
                          result.bucket === 'players' &&
                          !g.players.includes(me.id)
                        ) {
                          next.players = [...g.players, me.id];
                        } else if (
                          result.bucket === 'waitlist' &&
                          !g.waitlist.includes(me.id)
                        ) {
                          next.waitlist = [...g.waitlist, me.id];
                        } else if (
                          result.bucket === 'pending' &&
                          !(g.pending ?? []).includes(me.id)
                        ) {
                          next.pending = [...(g.pending ?? []), me.id];
                        }
                        next.participantIds = Array.from(
                          new Set([...(g.participantIds ?? []), me.id]),
                        );
                        return next;
                      }),
                    );
                    toast.success(
                      result.bucket === 'players'
                        ? he.toastGameJoined
                        : result.bucket === 'waitlist'
                          ? he.toastGameJoinedWaitlist
                          : he.toastGameJoinedPending,
                    );
                  } else {
                    await gameService.cancelGameV2(game.id, me.id);
                    setUpcoming((prev) =>
                      prev.map((g) => {
                        if (g.id !== game.id) return g;
                        const wasPlayer = g.players.includes(me.id);
                        const players = g.players.filter(
                          (id) => id !== me.id,
                        );
                        let waitlist = g.waitlist.filter(
                          (id) => id !== me.id,
                        );
                        const pending = (g.pending ?? []).filter(
                          (id) => id !== me.id,
                        );
                        let promotedPlayers = players;
                        if (
                          wasPlayer &&
                          waitlist.length > 0 &&
                          players.length < g.maxPlayers
                        ) {
                          promotedPlayers = [...players, waitlist[0]];
                          waitlist = waitlist.slice(1);
                        }
                        const participantIds = (
                          g.participantIds ?? []
                        ).filter((id) => id !== me.id);
                        return {
                          ...g,
                          players: promotedPlayers,
                          waitlist,
                          pending,
                          participantIds,
                        };
                      }),
                    );
                    toast.success(he.toastGameLeft);
                  }
                } catch (err) {
                  if (__DEV__) {
                    console.warn(
                      '[communityDetails] join/cancel failed',
                      err,
                    );
                  }
                  const msg = String((err as Error)?.message ?? '');
                  const code =
                    typeof (err as { code?: unknown })?.code === 'string'
                      ? ((err as { code: string }).code)
                      : '';
                  if (msg.includes('GAME_STARTED')) {
                    toast.info(he.matchDetailsAlreadyStarted);
                  } else if (msg.includes('GAME_LIVE')) {
                    toast.info(he.matchDetailsAlreadyLive);
                  } else if (msg.includes('GAME_NOT_OPEN')) {
                    toast.info(he.matchDetailsClosedForRegistration);
                  } else if (__DEV__) {
                    toast.error(
                      `${he.error}: ${code || msg || 'unknown'}`,
                    );
                  } else {
                    toast.error(he.error);
                  }
                }
              }}
            />
          )}
        </View>

        {/* Bottom action stack — management actions live here, away
            from the read-mostly content. Admin gets edit; members
            get invite; everyone in the community can leave (with the
            admin-last guard handled inside the handler). Leave is
            visually red so it doesn't compete with the green primary
            actions further up the screen. */}
        {isMember || isAdmin ? (
          <View style={[styles.actions, { marginTop: spacing.md }]}>
            {isMember ? (
              <Button
                title={he.communityDetailsInvite}
                variant="outline"
                size="lg"
                fullWidth
                iconLeft="share-outline"
                onPress={handleInvite}
              />
            ) : null}
            {/* Destructive row — leave + (admin-only) delete side by side. */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  title={he.communityDetailsLeave}
                  variant="danger"
                  size="lg"
                  fullWidth
                  iconLeft="exit-outline"
                  loading={busyLeave}
                  onPress={handleLeave}
                />
              </View>
              {isAdmin ? (
                <View style={{ flex: 1 }}>
                  <Button
                    title={he.deleteGroupTitle}
                    variant="danger"
                    size="lg"
                    fullWidth
                    iconLeft="trash-outline"
                    onPress={() => setDeleteOpen(true)}
                  />
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDestructiveModal
        visible={deleteOpen}
        title={he.deleteGroupTitle}
        body={he.deleteGroupBody}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          if (!me) return;
          try {
            await deleteGroup(group.id, me.id);
            setDeleteOpen(false);
            toast.success(he.deleteGroupSuccess);
            (nav as { goBack: () => void }).goBack();
          } catch (err) {
            if (__DEV__) console.warn('[community] delete failed', err);
            toast.error(he.error);
          }
        }}
      />
    </SafeAreaView>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatHebrewDate(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

function effectiveRecurringDay(g: Group): WeekdayIndex | undefined {
  if (typeof g.recurringDayOfWeek === 'number') return g.recurringDayOfWeek;
  // Fallback to the first preferred day so existing communities can use
  // the recurring shortcut without an editor screen.
  return g.preferredDays?.[0];
}
function effectiveRecurringTime(g: Group): string | undefined {
  return g.recurringTime || g.preferredHour;
}
function hasRecurringInfo(g: Group): boolean {
  return !!effectiveRecurringDay(g) && !!effectiveRecurringTime(g);
}
function recurringSummary(g: Group): string {
  const dayIdx = effectiveRecurringDay(g);
  const time = effectiveRecurringTime(g);
  if (dayIdx === undefined || !time) return '';
  return `${he.availabilityDayShort[dayIdx]} · ${time}`;
}
function nextOccurrence(g: Group): number | null {
  const dayIdx = effectiveRecurringDay(g);
  const time = effectiveRecurringTime(g);
  if (dayIdx === undefined || !time) return null;
  const [hh, mm] = time.split(':').map((n) => parseInt(n, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const now = new Date();
  const target = new Date(now);
  const delta = (dayIdx - now.getDay() + 7) % 7;
  target.setDate(now.getDate() + (delta === 0 ? 7 : delta));
  target.setHours(hh, mm, 0, 0);
  return target.getTime();
}
async function createRecurring(
  group: Group,
  creatorId: string,
): Promise<{ ok: boolean; gameId?: string }> {
  const ts = nextOccurrence(group);
  if (!ts) return { ok: false };
  const fmt: import('@/types').GameFormat =
    group.recurringDefaultFormat ?? '5v5';
  const teams = group.recurringNumberOfTeams ?? 2;
  const perTeam = fmt === '5v5' ? 5 : fmt === '6v6' ? 6 : 7;
  try {
    const created = await import('@/services/gameService').then((m) =>
      m.gameService.createGameV2({
        groupId: group.id,
        title: group.name,
        startsAt: ts,
        fieldName: group.fieldName,
        maxPlayers: perTeam * teams,
        format: fmt,
        numberOfTeams: teams,
        cancelDeadlineHours: undefined,
        // Quick-create from a community always defaults to
        // community-only — the admin can flip to public from the
        // game's own MatchDetails toggle if they want broader reach.
        visibility: 'community',
        requiresApproval: !group.isOpen,
        bringBall: true,
        bringShirts: true,
        createdBy: creatorId,
      }),
    );
    return { ok: true, gameId: created.id };
  } catch {
    return { ok: false };
  }
}

function mergeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function MetaRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  if (!value) return null;
  return (
    <View style={styles.metaRow}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.metaLabel}>{label}:</Text>
      <Text style={styles.metaValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

/** Hero badge — same visual language as MatchDetails. */
function HeroRoleBadge({
  isAdmin,
  isMember,
}: {
  isAdmin: boolean;
  isMember: boolean;
}) {
  if (isAdmin) {
    return (
      <Badge
        label={he.communityDetailsAdminBadge}
        tone="primary"
        icon="star"
        size="md"
      />
    );
  }
  if (isMember) {
    return (
      <Badge
        label={he.groupsActionMember}
        tone="primary"
        icon="checkmark-circle"
        size="md"
      />
    );
  }
  return null;
}

/** Mirror of MatchDetails' InfoCell so the two screens read identically. */
function InfoCell({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoCell}>
      <Ionicons
        name={icon}
        size={18}
        color={colors.primary}
        style={styles.infoCellIcon}
      />
      <View style={styles.infoCellText}>
        <Text style={styles.infoLabel} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function MemberRow({
  user,
  groupId,
  isAdmin,
  isCreator,
  viewerIsCreator,
  onPromote,
  onDemote,
  onOpenCard,
  showDivider,
}: {
  user: User;
  groupId: string;
  isAdmin: boolean;
  isCreator?: boolean;
  viewerIsCreator?: boolean;
  onPromote?: () => void;
  onDemote?: () => void;
  onOpenCard?: () => void;
  /** When true, render a hairline above the row. First row in a card
   *  shouldn't have one — the caller decides per index. */
  showDivider?: boolean;
}) {
  const [avg, setAvg] = useState<number>(0);
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    const unsub = ratingsService.subscribeSummary(groupId, user.id, (s) => {
      setAvg(s.average);
      setCount(s.count);
    });
    return unsub;
  }, [groupId, user.id]);
  return (
    <Pressable
      style={[styles.memberRow, showDivider && styles.memberRowDivider]}
      onPress={onOpenCard}
    >
      <PlayerIdentity user={user} size="sm" onPress={onOpenCard} />
      <Text style={styles.memberName} numberOfLines={1}>
        {user.name}
      </Text>
      {count > 0 ? (
        <View style={styles.ratingChip}>
          <Ionicons name="star" size={12} color={colors.warning} />
          <Text style={styles.ratingChipText}>{avg.toFixed(1)}</Text>
        </View>
      ) : null}
      {isCreator ? (
        <View style={[styles.adminBadge, { backgroundColor: colors.primary }]}>
          <Text style={[styles.adminBadgeText, { color: '#fff' }]}>
            {he.communityDetailsCreatorBadge}
          </Text>
        </View>
      ) : isAdmin ? (
        <View style={styles.adminBadge}>
          <Text style={styles.adminBadgeText}>
            {he.communityDetailsAdminBadge}
          </Text>
        </View>
      ) : null}
      {viewerIsCreator && onPromote ? (
        <Pressable onPress={onPromote} hitSlop={8}>
          <Text style={styles.roleAction}>
            {he.communityDetailsPromoteCoach}
          </Text>
        </Pressable>
      ) : null}
      {viewerIsCreator && onDemote ? (
        <Pressable onPress={onDemote} hitSlop={8}>
          <Text style={[styles.roleAction, { color: colors.danger }]}>
            {he.communityDetailsDemoteCoach}
          </Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },

  // ① HERO — title + role badge + sub-info, mirrors MatchDetailsScreen.
  hero: { gap: spacing.sm },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    // Same fix as MatchDetails heroTitle: without an explicit width
    // hint, RN sizes Text to its content and `textAlign` has no
    // canvas to anchor against. `flex:1` lets it occupy all the row
    // space the badge doesn't claim; the badge is content-sized so
    // it stays compact on the leading edge.
    flex: 1,
  },
  heroSub: { gap: 4 },
  subLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  subIcon: { marginEnd: 8 },
  subText: { color: colors.textMuted, fontSize: 14 },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: spacing.sm,
  },

  // ② INFO GRID
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  infoCell: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  infoCellText: {
    alignItems: 'flex-start',
    flexShrink: 1,
  },
  infoCellIcon: { marginEnd: spacing.sm },
  infoLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Section header — same as MatchDetails
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.sm,
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },

  // Free-text body card (about / rules / notes / recurring summary)
  bodyCard: {
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  bodyText: {
    ...typography.body,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Legacy metaRow — kept for the fallback MetaRow component (no
  // current callsites, but other screens import it indirectly through
  // PR diffs, so leaving the style in place is harmless).
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metaLabel: { ...typography.caption, color: colors.textMuted },
  metaValue: {
    ...typography.caption,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  label: { ...typography.label, color: colors.textMuted, marginTop: spacing.xs },

  // Action buttons row — gap matches MatchDetails sticky CTA spacing.
  actions: { gap: spacing.sm },

  // Members card — single Card holding multiple rows separated by
  // hairlines (same shape as MatchDetails.playersCard).
  membersCard: {
    padding: 0,
    overflow: 'hidden',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  memberRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  memberName: { ...typography.body, color: colors.text, flex: 1 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pendingRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  pendingName: { ...typography.body, color: colors.text, flex: 1 },
  pendingActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pendingApproveBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingRejectBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adminBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  adminBadgeText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  ratingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingChipText: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
  },
  roleAction: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },

  // Subscription card retains the old `section` style — leaving the
  // alias here so the existing `styles.section` reference still
  // resolves with a sensible look.
  section: { gap: spacing.xs },
  subscriptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  subscriptionLabel: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },

  emptyCard: { alignItems: 'center', paddingVertical: spacing.lg },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
