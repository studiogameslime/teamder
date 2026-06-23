// CommunityDetailsScreen — premium "stadium-style" community page.
//
// Layout (top → bottom, RTL):
//   ① Stadium hero (full-bleed photo + dark gradient + ⋯/☰ + name)
//   ② Floating 2×2 stats grid lifted onto the bottom of the hero
//   ③ Notification toggle row (members only)
//   ④ Next-game card — primary focus, dark blue gradient
//   ⑤ Active-players preview — horizontal jersey rail
//   ⑥ "שתף הזמנה למועדון" gradient CTA (members only)
//
// All admin / destructive actions live behind the ☰ hamburger menu;
// the ⋯ overflow opens the same menu (a single source of truth keeps
// menu items consistent regardless of which icon the user tapped).

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import {
  RouteProp,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/Button';
import { goToCommunityChat } from '@/navigation/navigationRef';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { ScreenHeader } from '@/components/ScreenHeader';
import { CollapsibleContent } from '@/components/CollapsibleContent';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { toast } from '@/components/Toast';
import { CelebrationOverlay } from '@/components/anim/CelebrationOverlay';
import { successHaptic } from '@/utils/haptics';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { CommunityStadiumHero } from '@/components/community/CommunityStadiumHero';
import { CoverImagePicker } from '@/components/community/CoverImagePicker';
import { FriendsInvitePicker } from '@/components/games/FriendsInvitePicker';
import { CommunityStatsGrid } from '@/components/community/CommunityStatsGrid';
import { CommunityChampionship } from '@/components/community/CommunityChampionship';
import { GameHistoryRow } from '@/components/match/GameHistoryRow';
import { CommunityNotifyToggle } from '@/components/community/CommunityNotifyToggle';
import { NextGameCard } from '@/components/community/NextGameCard';
import { UpcomingMoreRow } from '@/components/community/UpcomingMoreRow';
import { PlayersPreview } from '@/components/community/PlayersPreview';
import { CommunityShareInviteCta } from '@/components/community/CommunityShareInviteCta';
import { RichRulesText } from '@/components/community/RichRulesText';
import { groupService } from '@/services';
import { logError } from '@/services/errorLog';
import { pickAndUploadGroupCover } from '@/services/photoService';
import { gameService } from '@/services/gameService';
import { deepLinkService } from '@/services/deepLinkService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { notificationsService } from '@/services/notificationsService';
import {
  isValidIsraeliPhone,
  openWhatsApp,
} from '@/services/whatsappService';
import {
  Game,
  GameSummary,
  Group,
  User,
  WeekdayIndex,
} from '@/types';
import { colors, radius, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

type Nav = NativeStackNavigationProp<
  CommunitiesStackParamList,
  'CommunityDetails'
>;
type Params = RouteProp<CommunitiesStackParamList, 'CommunityDetails'>;

type CommunityStatsData = Awaited<
  ReturnType<typeof gameService.getCommunityStats>
>;

export function CommunityDetailsScreen() {
  const nav = useNavigation<Nav>();
  const params = useRoute<Params>().params;
  const { groupId } = params;
  const celebrateOnArrival =
    (params as { celebrate?: boolean } | undefined)?.celebrate === true;
  const me = useUserStore((s) => s.currentUser);
  const leaveGroup = useGroupStore((s) => s.leaveGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [upcoming, setUpcoming] = useState<Game[]>([]);
  const [history, setHistory] = useState<GameSummary[]>([]);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [communityStats, setCommunityStats] = useState<CommunityStatsData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  // Pull-to-refresh has its own state so the native RefreshControl
  // spinner doesn't fire at the same time as our SoccerBallLoader.
  const [refreshing, setRefreshing] = useState(false);
  const [busyLeave, setBusyLeave] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteIds, setInviteIds] = useState<string[]>([]);
  // Celebration burst when arriving fresh from creating this group.
  const [celebrate, setCelebrate] = useState(false);
  useEffect(() => {
    if (celebrateOnArrival) {
      successHaptic();
      setCelebrate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [invitingBusy, setInvitingBusy] = useState(false);

  const reload = useCallback(
    async (opts: { pullToRefresh?: boolean } = {}) => {
      if (opts.pullToRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const g = await groupService.get(groupId);
        setGroup(g);
        if (!g) {
          setMembers([]);
          setUpcoming([]);
          setHistory([]);
          setCommunityStats(null);
          return;
        }
        logEvent(AnalyticsEvent.GroupViewed, { groupId: g.id });
        const memberIds = Array.from(
          new Set([...g.adminIds, ...g.playerIds, ...g.pendingPlayerIds]),
        );
        const [users, games, hist, cStats] = await Promise.all([
          groupService.hydrateUsers(memberIds),
          gameService.getUpcomingGamesForGroup(g.id).catch(() => [] as Game[]),
          gameService.getHistory(g.id).catch(() => [] as GameSummary[]),
          gameService.getCommunityStats(g.id).catch(() => null),
        ]);
        setMembers(users);
        setUpcoming(games);
        setHistory(hist);
        setCommunityStats(cStats);
      } catch (err) {
        logError('communityDetailsReload', err, {
          screen: 'CommunityDetailsScreen',
          groupId,
          userId: me?.id,
        });
        if (__DEV__) console.warn('[community] reload failed', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [groupId, me],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    reload();
  }, [reload]);

  const isMember = useMemo(
    () => !!group && !!me && group.playerIds.includes(me.id),
    [group, me],
  );
  const isAdmin = useMemo(
    () => !!group && !!me && group.adminIds.includes(me.id),
    [group, me],
  );
  // Only the CREATOR may delete the whole community — promoted admins
  // can manage it but not destroy it. Falls back to the first admin for
  // legacy docs that predate creatorId.
  const isCreator = useMemo(
    () =>
      !!group &&
      !!me &&
      me.id === (group.creatorId ?? group.adminIds[0]),
    [group, me],
  );
  const phoneValid =
    !!group?.contactPhone && isValidIsraeliPhone(group.contactPhone);

  // ─── Action handlers ────────────────────────────────────────────────────

  // Tapping the hero's "change cover" affordance opens the picker
  // (gallery + device upload).
  const handleEditCover = () => {
    if (!group || !me) return;
    setCoverPickerOpen(true);
  };

  // Pick one of the curated built-in covers — clears any uploaded photo
  // so the gallery image takes effect.
  const handleSelectBuiltinCover = async (coverImageId: string) => {
    if (!group || !me) return;
    setCoverPickerOpen(false);
    try {
      const fresh = await groupService.updateGroupMetadata(group.id, me.id, {
        coverImageId,
        coverPhotoUrl: '',
      });
      setGroup(fresh);
      logEvent(AnalyticsEvent.CommunityCoverUploaded, { groupId: group.id });
      toast.success(he.communityCoverUpdated);
    } catch (e) {
      logError('updateGroupMetadata', e, {
        screen: 'CommunityDetailsScreen',
        groupId: group.id,
        field: 'coverImageId',
      });
      appAlert(he.error, he.communityCoverUploadFailed);
    }
  };

  // Upload a custom cover from the device gallery.
  const handleUploadCover = async () => {
    if (!group || !me || uploadingCover) return;
    setUploadingCover(true);
    const res = await pickAndUploadGroupCover(group.id);
    if (!res.ok) {
      setUploadingCover(false);
      // 'cancelled' and 'permission' are no-ops — the user backed out of the
      // picker or denied access. Built-in cover images are available, and
      // App Store guideline 5.1.1(iv) forbids nagging to reconsider / sending
      // the user to Settings after a denial, so we stay silent there.
      if (res.reason === 'unavailable') {
        appAlert(he.error, he.profilePhotoUnavailable);
      } else if (res.reason === 'network') {
        appAlert(he.error, he.communityCoverUploadFailed);
      }
      return;
    }
    try {
      const fresh = await groupService.updateGroupMetadata(group.id, me.id, {
        coverPhotoUrl: res.url,
      });
      setGroup(fresh);
      setCoverPickerOpen(false);
      logEvent(AnalyticsEvent.PhotoUploaded, { source: 'community_cover' });
      logEvent(AnalyticsEvent.CommunityCoverUploaded, { groupId: group.id });
      toast.success(he.communityCoverUpdated);
    } catch (e) {
      logError('updateGroupMetadata', e, {
        screen: 'CommunityDetailsScreen',
        groupId: group.id,
        field: 'coverPhotoUrl',
      });
      if (__DEV__) console.warn('[community] cover meta save failed', e);
      appAlert(he.error, he.communityCoverUploadFailed);
    } finally {
      setUploadingCover(false);
    }
  };

  const handleSendInvites = async () => {
    if (!group || inviteIds.length === 0) return;
    setInvitingBusy(true);
    try {
      const { invited } = await groupService.inviteFriendsToGroup(
        group.id,
        inviteIds,
      );
      setInviteOpen(false);
      setInviteIds([]);
      toast.success(he.communityInviteFriendsSent(invited));
      reload();
    } catch (e) {
      logError('inviteFriendsToGroup', e, {
        screen: 'CommunityDetailsScreen',
        groupId: group.id,
        inviteCount: inviteIds.length,
      });
      if (__DEV__) console.warn('[community] invite friends failed', e);
      appAlert(he.error, he.communityInviteFriendsFailed);
    } finally {
      setInvitingBusy(false);
    }
  };

  const handleLeave = () => {
    if (!group || !me) return;
    if (group.adminIds.includes(me.id) && group.adminIds.length === 1) {
      appAlert(he.error, he.communityDetailsLeaveLastAdmin);
      return;
    }
    setLeaveOpen(true);
  };

  const confirmLeave = async () => {
    if (!group || !me) return;
    setBusyLeave(true);
    try {
      await leaveGroup(group.id, me.id);
      setLeaveOpen(false);
      nav.goBack();
    } catch (e) {
      const msg = (e as Error).message;
      setLeaveOpen(false);
      if (msg === 'LAST_ADMIN') {
        appAlert(he.error, he.communityDetailsLeaveLastAdmin);
      } else {
        appAlert(he.error, String(msg ?? e));
      }
    } finally {
      setBusyLeave(false);
    }
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
        // Body carries the community name + (when set) description so
        // recipients see what the group is about even before tapping
        // the link. Cover image + name + description are ALSO in the
        // WhatsApp link-preview card via the SSR /team/{id} og: tags.
        message: he.communityInviteShareBody({
          link,
          name: group.name,
          description: group.description,
        }),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { groupId: group.id });
      }
    } catch (err) {
      logError('communityShare', err, {
        screen: 'CommunityDetailsScreen',
        groupId: group.id,
      });
      if (__DEV__) console.warn('[community] share failed', err);
    }
  };

  const handleCreateRecurring = () => {
    if (!group || !me) return;
    // Recurring is now a step-3 toggle inside the Game wizard itself
    // — the community no longer owns recurring defaults (preferred
    // day / time / format / # teams). For legacy groups that DO have
    // those fields, we still derive the next occurrence to pre-fill
    // `startsAt`; new groups will simply land on the wizard's default
    // (next Thursday 20:00) and the admin can edit it.
    const ts = nextOccurrence(group);
    (nav as { navigate: (s: string, p: unknown) => void }).navigate(
      'GameCreate',
      {
        recurring: true,
        groupId: group.id,
        startsAt: ts ?? undefined,
        // Legacy recurring presets are kept here as a hint when the
        // community has them; new groups won't carry these fields and
        // the wizard falls back to its own defaults (5v5, 2 teams).
        format: group.recurringDefaultFormat,
        numberOfTeams: group.recurringNumberOfTeams,
      },
    );
  };

  const handleNotify = (next: boolean) => {
    if (!me || !group) return;
    // Optimistic local store update — other screens see the change
    // immediately. Persist write is fire-and-forget.
    const cur = me.newGameSubscriptions ?? [];
    const updated = next
      ? Array.from(new Set([...cur, group.id]))
      : cur.filter((g) => g !== group.id);
    useUserStore.setState({
      currentUser: { ...me, newGameSubscriptions: updated },
    });
    notificationsService.setCommunitySubscription(me.id, group.id, next);
  };

  // ─── Loading / empty states ─────────────────────────────────────────────

  if (loading && !group) {
    return (
      <View style={styles.root}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <SoccerBallLoader size={40} />
        </View>
      </View>
    );
  }

  if (!group) {
    // Group genuinely doesn't exist (deleted by admin or never
    // existed). Show a friendly fallback with an explicit way back
    // to the main communities feed — a deep-link entry has no
    // back-stack, so silent goBack would leave the user stranded.
    return (
      <View style={styles.root}>
        <ScreenHeader title={he.loading} />
        <View style={styles.center}>
          <Ionicons
            name="trash-outline"
            size={48}
            color={colors.textMuted}
          />
          <Text style={styles.emptyText}>
            {he.communityDetailsDeletedTitle}
          </Text>
          <Text style={[styles.emptyText, { marginTop: spacing.sm }]}>
            {he.communityDetailsDeletedBody}
          </Text>
          <Button
            title={he.deletedTargetBackToMain}
            variant="primary"
            size="lg"
            style={{ marginTop: spacing.lg }}
            onPress={() => {
              const navAny = nav as unknown as { navigate: (s: string, p?: unknown) => void };
              navAny.navigate('CommunitiesTab', {
                screen: 'CommunitiesFeed',
              });
            }}
          />
        </View>
      </View>
    );
  }

  const nextGame = upcoming[0];
  // Use the authoritative finished-games count from getCommunityStats (windowed
  // to ~200 terminal docs, cancelled excluded) so this number AGREES with the
  // "משחקים שיצאו לפועל" stat shown lower on the same screen. The old source
  // (history list, limit 20, cancelled INCLUDED) both undercounted past ~20
  // games and contradicted that stat. Fall back to the history-derived count
  // only until the stats load.
  const matchesHeld =
    communityStats?.totalFinished ??
    history.filter((h) => h.status === 'finished').length;

  // Hamburger menu — all admin / destructive / contact actions live
  // here. The ⋯ overflow opens the same sheet so users get one mental
  // model: "more actions live in the menu".
  const sections: HamburgerSection[] = [
    {
      id: 'main',
      items: [
        ...(isAdmin
          ? [
              {
                id: 'edit',
                label: he.communityEditTitle,
                icon: 'create-outline' as const,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'CommunityEdit',
                    { groupId: group.id },
                  ),
              },
            ]
          : []),
        ...(isAdmin
          ? [
              {
                id: 'recurring',
                label: he.communityMenuRecurringGame,
                icon: 'repeat-outline' as const,
                onPress: handleCreateRecurring,
              },
            ]
          : []),
        ...(isAdmin && group.pendingPlayerIds.length > 0
          ? [
              {
                id: 'approvals',
                label: he.communityMenuApprovals,
                icon: 'shield-checkmark-outline' as const,
                badge: group.pendingPlayerIds.length,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'AdminApproval',
                    undefined,
                  ),
              },
            ]
          : []),
        {
          id: 'allPlayers',
          label: he.communityPlayersSeeAll,
          icon: 'people-outline' as const,
          onPress: () =>
            (nav as { navigate: (s: string, p: unknown) => void }).navigate(
              'CommunityPlayers',
              { groupId: group.id },
            ),
        },
        {
          id: 'stats',
          label: he.communityMenuStats,
          icon: 'stats-chart-outline' as const,
          onPress: () =>
            (nav as { navigate: (s: string, p: unknown) => void }).navigate(
              'CommunityStats',
              { groupId: group.id },
            ),
        },
        ...(isMember || isAdmin
          ? [
              {
                id: 'inviteFriends',
                label: he.communityMenuInviteFriends,
                icon: 'person-add-outline' as const,
                onPress: () => {
                  setMenuOpen(false);
                  setInviteIds([]);
                  setInviteOpen(true);
                },
              },
            ]
          : []),
        ...(phoneValid && !isAdmin
          ? [
              {
                id: 'whatsapp',
                label: he.communityMenuContactAdmin,
                icon: 'logo-whatsapp' as const,
                onPress: () => openWhatsApp(group.contactPhone),
              },
            ]
          : []),
        ...(isMember || isAdmin
          ? [
              {
                id: 'leave',
                label: he.communityDetailsLeave,
                icon: 'exit-outline' as const,
                onPress: handleLeave,
                tone: 'danger' as const,
              },
            ]
          : []),
        ...(isCreator
          ? [
              {
                id: 'delete',
                label: he.deleteGroupTitle,
                icon: 'trash-outline' as const,
                onPress: () => setDeleteOpen(true),
                tone: 'danger' as const,
              },
            ]
          : []),
      ],
    },
  ];

  const openMenu = () => setMenuOpen(true);

  return (
    <View style={styles.root}>
      {celebrate ? (
        <View pointerEvents="none" style={styles.celebrationLayer}>
          <CelebrationOverlay onDone={() => setCelebrate(false)} />
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => reload({ pullToRefresh: true })}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① Stadium hero */}
        <CommunityStadiumHero
          name={group.name}
          memberCount={group.playerIds?.length ?? 0}
          coverUrl={group.coverPhotoUrl}
          coverImageId={group.coverImageId}
          canEditCover={isAdmin}
          uploadingCover={uploadingCover}
          onBackPress={() => nav.goBack()}
          onMenuPress={openMenu}
          onEditCoverPress={handleEditCover}
          onChatPress={
            isMember && me ? () => goToCommunityChat(group.id) : undefined
          }
        />

        {/* ② Floating stats grid — pulled UP via negative margin so it
            overlaps the bottom of the hero (the hero leaves a 56px
            strip of stadium for exactly this overlap zone). Trimmed
            to two stats: founding date and matches held. The other
            two metrics moved elsewhere — member count is now a pill
            badge under the title in the hero, and the regular field
            is shown on each game card already. */}
        <View style={styles.statsFloat}>
          <CommunityStatsGrid
            items={[
              {
                icon: 'calendar',
                label: he.communityStatsCreatedAt,
                value: formatShortDate(group.createdAt),
              },
              {
                icon: 'football',
                // Always show the number — including "0" — to match the
                // profile stats ("0 משחקים"). matchesHeld is a known
                // count, so "0" means zero, not "no data".
                label: he.communityStatsMatchesHeld,
                value: String(matchesHeld),
              },
            ]}
          />
        </View>

        <View style={styles.body}>
          {/* Group description — free-text "about this group" copy
              the admin set in the create / edit wizard. Rendered
              prominently right after the stats so visitors see the
              group's character before scrolling into the operational
              details. Hidden when empty so new groups don't show an
              empty card. Note: `rules` is a separate (newer) field
              that the existing edit screen surfaces in the menu;
              this card is the "what is this group about" copy. */}
          {group.description?.trim() ? (
            <View style={styles.descriptionCard}>
              <Text style={styles.descriptionTitle}>
                {he.communityDescriptionTitle}
              </Text>
              <CollapsibleContent>
                <Text style={styles.descriptionBody}>
                  {group.description.trim()}
                </Text>
              </CollapsibleContent>
            </View>
          ) : null}

          {/* Group rules — distinct from `description`. The wizard
              captures explicit do/don't copy here (no kickers, no
              smoking, "show up 5 min early", etc.) so it deserves
              its own card. Hidden when empty. */}
          {group.rules?.trim() ? (
            <View style={styles.rulesCard}>
              <Text style={styles.descriptionTitle}>
                {he.communityRulesTitle}
              </Text>
              {/* Rules support markdown-lite (**bold** + "- " bullets).
                  RichRulesText parses + renders; plain legacy rules
                  fall through as ordinary paragraphs. Collapsed by default
                  when long so the rules don't fill the whole screen. */}
              <CollapsibleContent>
                <RichRulesText text={group.rules.trim()} />
              </CollapsibleContent>
            </View>
          ) : null}

          {/* ③ Notification toggle — members only */}
          {isMember && me ? (
            <CommunityNotifyToggle
              subscribed={(me.newGameSubscriptions ?? []).includes(group.id)}
              onChange={handleNotify}
            />
          ) : null}

          {/* ④ Next game — main focus.
               Navigates within THIS stack (CommunitiesStack now hosts
               MatchDetails too) so back returns to CommunityDetails.
               Crossing into GameTab would dump the user on GamesList
               on back.
               If the next game is still in `scheduled` status (its
               `registrationOpensAt` is in the future), tapping the
               card pops a small Alert telling the user when
               registration opens — admins can still navigate to the
               edit screen via the overflow menu, but anyone (admins
               included) sees the same lock UI on the card. */}
          <NextGameCard
            startsAt={nextGame?.startsAt}
            fieldName={nextGame?.fieldName ?? group.fieldName ?? ''}
            registrationOpensAt={
              nextGame?.status === 'scheduled'
                ? nextGame.registrationOpensAt
                : undefined
            }
            // Admin-only CTA shown when the empty state renders. Lets
            // the admin open the Game wizard in recurring mode without
            // hunting through the hamburger menu.
            onCreateRecurring={isAdmin ? handleCreateRecurring : undefined}
            onPress={
              nextGame
                ? () => {
                    // Admin path: always allow tap-through. A scheduled
                    // (deferred-open) recurring game has no public way
                    // to reach its MatchDetails for editing — without
                    // this branch admins were stuck on the lock alert
                    // and couldn't change the game time / cancel it.
                    if (
                      nextGame.status === 'scheduled' &&
                      typeof nextGame.registrationOpensAt === 'number' &&
                      !isAdmin
                    ) {
                      const d = new Date(nextGame.registrationOpensAt);
                      const dd = String(d.getDate()).padStart(2, '0');
                      const mm = String(d.getMonth() + 1).padStart(2, '0');
                      const hh = String(d.getHours()).padStart(2, '0');
                      const mn = String(d.getMinutes()).padStart(2, '0');
                      appAlert(
                        he.communityNextGameLocked,
                        he.communityNextGameLockedBody(
                          `${dd}.${mm} ${hh}:${mn}`,
                        ),
                      );
                      return;
                    }
                    nav.navigate('MatchDetails', { gameId: nextGame.id });
                  }
                : undefined
            }
          />

          {/* Additional scheduled games — admin sets up a few weeks
              of recurring games in advance and previously had no way
              to see/edit anything except the very next one. The row
              renders nothing when there's only one upcoming game. */}
          <UpcomingMoreRow
            upcoming={upcoming}
            onPress={(gid) => nav.navigate('MatchDetails', { gameId: gid })}
          />

          {/* ⑤ Players preview */}
          <PlayersPreview
            total={group.playerIds?.length ?? 0}
            members={members.filter((u) => group.playerIds.includes(u.id))}
            adminIds={group.adminIds}
            onSeeAll={() =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'CommunityPlayers',
                { groupId: group.id },
              )
            }
            onPressMember={(uid) =>
              (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                'PlayerCard',
                { userId: uid, groupId: group.id },
              )
            }
          />

          {/* Community-level aggregate stats. Loaded once by the parent
              (read cost bounded to ~200 finished/cancelled game docs) and
              passed down so the count here AGREES with "מפגשים שנערכו". */}
          <CommunityStatsSection stats={communityStats} />

          {/* Goals championship — club-scoped scorers leaderboard. */}
          <CommunityChampionship groupId={group.id} />

          {/* Per-community game history — finished games, same row style as the
              player History tab (user report: history per community too). */}
          {(() => {
            const finished = history.filter((h) => h.status === 'finished');
            if (finished.length === 0) return null;
            const shown = historyExpanded ? finished : finished.slice(0, 5);
            return (
              <View style={styles.historySection}>
                <Text style={styles.historyTitle}>{he.communityHistoryTitle}</Text>
                <View style={{ gap: spacing.sm }}>
                  {shown.map((h) => (
                    <GameHistoryRow
                      key={h.id}
                      item={h}
                      onPress={() =>
                        nav.navigate('MatchDetails', { gameId: h.id })
                      }
                    />
                  ))}
                </View>
                {finished.length > 5 ? (
                  <Pressable
                    onPress={() => setHistoryExpanded((v) => !v)}
                    style={styles.historyToggle}
                  >
                    <Text style={styles.historyToggleText}>
                      {historyExpanded
                        ? he.communityHistoryShowLess
                        : he.communityHistorySeeAll(finished.length)}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })()}


          {/* WhatsApp contact CTA — visible to non-admin members (and
              non-members on this private view) when the community has
              a valid phone on file. Mirrors the public-showcase page,
              which always exposed this button. The hamburger menu also
              has the same action, but the inline button keeps it
              reachable without opening the overflow. */}
          {phoneValid && !isAdmin ? (
            <Button
              title={he.communityDetailsContactAdmin}
              variant="outline"
              size="lg"
              fullWidth
              // iconRight lands the WhatsApp glyph on the visual LEFT of
              // the label in this RTL layout (QA request).
              iconRight="logo-whatsapp"
              onPress={() => openWhatsApp(group.contactPhone)}
            />
          ) : null}

          {/* ⑥ Share-invite CTA — members & admins only */}
          {isMember || isAdmin ? (
            <CommunityShareInviteCta onPress={handleInvite} />
          ) : null}
        </View>
      </ScrollView>

      <HamburgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={sections}
      />

      <CoverImagePicker
        visible={coverPickerOpen}
        selectedId={group.coverImageId}
        hasUploadedPhoto={!!group.coverPhotoUrl}
        uploading={uploadingCover}
        onSelectBuiltin={handleSelectBuiltinCover}
        onUploadFromDevice={handleUploadCover}
        onClose={() => setCoverPickerOpen(false)}
      />

      <ConfirmDialog
        visible={leaveOpen}
        tone="danger"
        title={he.communityDetailsLeaveConfirmTitle}
        body={he.communityDetailsLeaveConfirmBody}
        cancelLabel={he.cancel}
        confirmLabel={he.communityDetailsLeave}
        confirmVariant="danger"
        onConfirm={confirmLeave}
        onClose={() => setLeaveOpen(false)}
      />

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
            nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[community] delete failed', err);
            toast.error(he.error);
          }
        }}
      />

      {/* Invite app-friends to this community. They land in the
          approval queue and get a groupInvitation push. */}
      <Modal
        visible={inviteOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setInviteOpen(false)}
      >
        <Pressable
          style={styles.inviteBackdrop}
          onPress={() => setInviteOpen(false)}
        >
          <Pressable style={styles.inviteSheet} onPress={() => {}}>
            <Text style={styles.inviteSheetTitle}>
              {he.communityMenuInviteFriends}
            </Text>
            <FriendsInvitePicker selected={inviteIds} onChange={setInviteIds} />
            <Button
              title={he.communityInviteFriendsSend(inviteIds.length)}
              onPress={handleSendInvites}
              disabled={inviteIds.length === 0 || invitingBusy}
              loading={invitingBusy}
              size="lg"
            />
          </Pressable>
        </Pressable>
      </Modal>

      {busyLeave ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <SoccerBallLoader size={36} />
        </View>
      ) : null}
    </View>
  );
}

// ─── Community stats section ────────────────────────────────────────────

function CommunityStatsSection({ stats }: { stats: CommunityStatsData | null }) {
  if (!stats) return null;
  if (stats.totalFinished === 0 && stats.totalCancelled === 0) return null;

  const orgPct = Math.round(stats.organizationRate * 100);
  const avg = stats.avgAttendance.toFixed(1);

  return (
    <View style={statsSectionStyles.wrap}>
      <Text style={statsSectionStyles.title}>{he.communityStatsTitle}</Text>
      <View style={statsSectionStyles.grid}>
        <StatCell
          label={he.communityStatsTotalFinished}
          value={String(stats.totalFinished)}
        />
        <StatCell
          label={he.communityStatsThisMonth}
          value={String(stats.thisMonthFinished)}
        />
        <StatCell
          label={he.communityStatsOrgRate}
          value={`${orgPct}%`}
        />
        <StatCell
          label={he.communityStatsAvgAttendance}
          value={avg}
        />
      </View>

      <Text
        style={[statsSectionStyles.title, { marginTop: spacing.md }]}
      >
        {he.communityStatsVitalityTitle}
      </Text>
      <View style={statsSectionStyles.grid}>
        <StatCell
          label={he.communityStatsActiveMonth}
          value={String(stats.activeThisMonth)}
        />
        <StatCell
          label={he.communityStatsActiveYear}
          value={String(stats.activeThisYear)}
        />
      </View>
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={statsSectionStyles.cell}>
      <Text style={statsSectionStyles.value}>{value}</Text>
      <Text style={statsSectionStyles.label}>{label}</Text>
    </View>
  );
}

const statsSectionStyles = StyleSheet.create({
  wrap: { gap: spacing.sm, marginTop: spacing.md },
  title: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  cell: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 14,
    alignItems: 'center',
  },
  value: {
    ...typography.h2,
    color: colors.text,
    fontWeight: '800',
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatShortDate(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${String(
    d.getFullYear(),
  ).slice(2)}`;
}

function effectiveRecurringDay(g: Group): WeekdayIndex | undefined {
  if (typeof g.recurringDayOfWeek === 'number') return g.recurringDayOfWeek;
  return g.preferredDays?.[0];
}
function effectiveRecurringTime(g: Group): string | undefined {
  return g.recurringTime || g.preferredHour;
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
const styles = StyleSheet.create({
  historySection: { gap: spacing.sm, marginTop: spacing.lg },
  historyTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  historyToggle: { alignItems: 'center', paddingVertical: spacing.sm },
  historyToggleText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  root: { flex: 1, backgroundColor: colors.bg },
  celebrationLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Pulls the stats grid up onto the bottom of the stadium hero. The
  // hero leaves 56px of paddingBottom for this overlap; if you tweak
  // one of these, tweak the other in tandem.
  statsFloat: {
    paddingHorizontal: spacing.lg,
    marginTop: -42,
  },
  // "About this group" copy. Sits between the stats grid and the
  // operational section. Uses primaryLight as the accent so it reads
  // as a "first impression" surface — different from the white cards
  // below which feel transactional.
  descriptionCard: {
    backgroundColor: colors.primaryLight,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  // Rules use a softer warning tone (amber tint) so the two cards
  // don't read as the same thing — description is identity ("who we
  // are"), rules is behaviour ("what we expect").
  rulesCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  descriptionTitle: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '700',
    marginBottom: 4,
  },
  descriptionBody: {
    ...typography.body,
    color: colors.text,
    lineHeight: 22,
  },
  // Tighter gap between secondary sections so the page reads as
  // one community profile rather than a stack of independent cards.
  // The hero still gets the larger lg outer paddings.
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  inviteBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7,12,32,0.45)',
    justifyContent: 'flex-end',
  },
  inviteSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  inviteSheetTitle: {
    ...typography.h3,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
});
