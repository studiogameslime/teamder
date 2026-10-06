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
  Keyboard,
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
import { goToCommunityChat, goToDirectChat } from '@/navigation/navigationRef';
import { dmConvId } from '@/services/chatService';
import { ensureNotGuest } from '@/utils/guestGate';
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
import { ClubTabs, type ClubTab, type ClubTabKey } from '@/components/club/ClubTabs';
import { CommunityPlayersScreen } from './CommunityPlayersScreen';
import { CommunityStatsScreen } from './CommunityStatsScreen';
import { CoverImagePicker } from '@/components/community/CoverImagePicker';
import { FriendsInvitePicker } from '@/components/games/FriendsInvitePicker';
import { CommunityStatsGrid } from '@/components/community/CommunityStatsGrid';
import { ClubAchievementsCard } from '@/components/community/ClubAchievementsCard';
import { CommunityChampionship } from '@/components/community/CommunityChampionship';
import { canEnterLive } from '@/services/gameLifecycle';
import { SeasonsCard } from '@/components/community/SeasonsCard';
import { UnverifiedEveningsCard } from '@/components/community/UnverifiedEveningsCard';
import { CommunityNotifyToggle } from '@/components/community/CommunityNotifyToggle';
import { NextGameCard } from '@/components/community/NextGameCard';
import { UpcomingMoreRow } from '@/components/community/UpcomingMoreRow';
import { CommunityShareInviteCta } from '@/components/community/CommunityShareInviteCta';
import { InviteMembersSheet } from '@/components/community/InviteMembersSheet';
import { RichRulesText } from '@/components/community/RichRulesText';
import { groupService } from '@/services';
import { logError, isExpectedDenial } from '@/services/errorLog';
import { pickAndUploadGroupCover } from '@/services/photoService';
import { gameService } from '@/services/gameService';
import { seasonHistoryService } from '@/services/seasonHistoryService';
import { deepLinkService } from '@/services/deepLinkService';
import { createShortInviteUrl } from '@/services/inviteLinkService';
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
import type { ClubMetrics } from '@/data/clubAchievements';
import {
  RTL_LABEL_ALIGN,
  clubAccent,
  clubShadow,
  clubSurface,
  colors,
  radius,
  spacing,
  typography,
} from '@/theme';
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

// Marketing/ad screenshot layout — driven by EXPO_PUBLIC_SCREENSHOT_MODE=1
// (same flag the mock banner / ad suppression use). When on, the community
// page shows ONLY the club's numbers + champions table (no level/titles, no
// operational cards) so a clean promo screenshot can be captured. NEVER true
// in a real store build → the app itself is unchanged.
const SCREENSHOT_MODE =
  (process.env.EXPO_PUBLIC_SCREENSHOT_MODE ?? '').trim() === '1';

export function CommunityDetailsScreen() {
  const nav = useNavigation<Nav>();
  const params = useRoute<Params>().params;
  const { groupId } = params;
  const celebrateOnArrival =
    (params as { celebrate?: boolean } | undefined)?.celebrate === true;
  const me = useUserStore((s) => s.currentUser);
  const leaveGroup = useGroupStore((s) => s.leaveGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  // Which tab is on screen. Resets to מידע on every arrival — a club opens on
  // what it IS, not on wherever the last club was left.
  const [tab, setTab] = useState<ClubTabKey>('info');
  /**
   * Which tabs have ever been opened.
   *
   * Drives the lazy-then-kept panes below: a tab enters the tree the first
   * time it is selected and stays for the life of the screen. `info` starts in
   * the set because it is the tab the screen opens on.
   */
  const [seen, setSeen] = useState<Set<ClubTabKey>>(() => new Set<ClubTabKey>(['info']));
  const showTab = (k: ClubTabKey) => {
    setTab(k);
    setSeen((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  };
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<User[]>([]);
  const [upcoming, setUpcoming] = useState<Game[]>([]);
  // Loaded only as the pre-stats fallback for the "מפגשים שנערכו" count; the
  // inline history LIST was removed (it duplicated the ⋯-menu history screen).
  const [history, setHistory] = useState<GameSummary[]>([]);
  const [communityStats, setCommunityStats] = useState<CommunityStatsData | null>(
    null,
  );
  // Goals for the club badges ("הישגי המועדון"), which moved onto this screen.
  //
  // Five of the six club metrics are already on this screen for free —
  // `communityStats.lifetime` carries three of them and the group doc the
  // other two. Goals are the one thing nothing here holds, so they are
  // fetched separately, and split in two because they come from two places:
  //   • `liveGoals` — the club's running total (`communityStats.goals`),
  //     which a season close ZEROES.
  //   • `archivedGoals` — what the sealed season cards remember of the same
  //     field, season by season.
  // A badge is a permanent thing the club did; without the archived half, a
  // club un-earned its gold "שערי המועדון" the morning after every close.
  //
  // Deliberately NOT part of `reload()`: that runs on every focus, and this
  // pair only changes when an evening is played. Keyed on the club instead,
  // so returning to the screen costs nothing.
  const [liveGoals, setLiveGoals] = useState<number | null>(null);
  const [archivedGoals, setArchivedGoals] = useState(0);
  // Mini-games, the same two halves as the goals and from the same two reads:
  // the live counter rides the `communityStats` doc the goal total already
  // fetches, and the archived counter rides the season list already listed.
  // The club's "נתוני מועדון" card needs both; neither costs a new read.
  const [liveRounds, setLiveRounds] = useState(0);
  const [archivedRounds, setArchivedRounds] = useState(0);
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
  // The invite prompt rides in AFTER the confetti rather than under it: two
  // things arriving at once reads as a glitch, and this is meant to be the
  // celebration's next beat, not an interruption of it.
  const [invitePrompt, setInvitePrompt] = useState(false);
  useEffect(() => {
    if (celebrateOnArrival) {
      successHaptic();
      setCelebrate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [invitingBusy, setInvitingBusy] = useState(false);
  const [lastCycleHolders, setLastCycleHolders] = useState<{
    ballId?: string;
    jerseysId?: string;
  }>({});

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
          new Set([
            ...(g.adminIds ?? []),
            ...(g.playerIds ?? []),
            ...(g.pendingPlayerIds ?? []),
          ]),
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
        // Not logged when the club is simply unreachable — deleted, or one the
        // viewer is not in. Both come back as `permission-denied` (see
        // `groupService.get`), and both are ordinary states of a stale link,
        // not defects. Anything else still reports.
        if (!isExpectedDenial(err)) {
          logError('communityDetailsReload', err, {
            screen: 'CommunityDetailsScreen',
            groupId,
            userId: me?.id,
          });
        }
        if (__DEV__) console.warn('[community] reload failed', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [groupId, me],
  );

  // Single load path — useFocusEffect covers the initial focus AND refresh on
  // return; a separate useEffect(reload) double-loaded the whole page on open.
  //
  // The dismiss is the other half of the dead-taps fix below, and it is the
  // half that actually removes the wasted tap. This screen owns no TextInput,
  // but the screen people arrive FROM does: the communities feed has a search
  // box, and the native stack keeps that screen mounted, so tapping a result
  // while the box still holds focus lands here with RN's TextInputState still
  // naming it. The ScrollView below then spends the next tap "dismissing the
  // keyboard" instead of pressing what was under the finger. Clearing the
  // focus on arrival means there is no stale input for it to key off.
  useFocusEffect(
    useCallback(() => {
      Keyboard.dismiss();
      reload();
    }, [reload]),
  );

  // "מהמחזור האחרון" — who brought the ball / jerseys last evening. The history
  // summaries don't carry the holder fields, so fetch the most recent finished
  // game's doc once. Non-blocking: absent/failed → the section just hides.
  const lastFinishedId = useMemo(
    () =>
      [...history]
        // "מהמחזור האחרון" must mean the last evening that actually happened.
        // One the system closed with nothing on it would otherwise claim to be
        // the last night, and name whoever was down to bring the ball to it.
        .filter((h) => (h.playState ?? 'happened') === 'happened')
        .sort((a, b) => b.date - a.date)[0]?.id ?? null,
    [history],
  );
  useEffect(() => {
    if (!lastFinishedId) {
      setLastCycleHolders({});
      return;
    }
    let alive = true;
    gameService
      .getGameById(lastFinishedId)
      .then((g) => {
        if (alive && g) {
          setLastCycleHolders({
            ballId: g.ballHolderUserId,
            jerseysId: g.jerseysHolderUserId,
          });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lastFinishedId]);
  const memberName = useCallback(
    (uid?: string) =>
      uid ? members.find((m) => m.id === uid)?.name ?? null : null,
    [members],
  );

  // NOTE: `?.` on playerIds/adminIds — a group snapshot can legitimately reach
  // a fresh member without these arrays populated (partial/stale doc), and a
  // bare `.includes` there throws during render → the whole screen crashes with
  // "משהו השתבש" (user report: a new member couldn't open community details).
  const isMember = useMemo(
    () => !!group && !!me && (group.playerIds ?? []).includes(me.id),
    [group, me],
  );
  const isAdmin = useMemo(
    () => !!group && !!me && (group.adminIds ?? []).includes(me.id),
    [group, me],
  );
  // The club's own people — the rules' definition of a member (playerIds OR
  // adminIds), which is what decides whether the club-badge aggregates below
  // are readable at all.
  const belongs = isMember || isAdmin;
  // Has this club any record at all — an evening held, or one called off.
  //
  // The badges hang off "נתוני מועדון", and that block hides ITSELF at zero
  // (CommunityStatsSection, below). Without the same gate a club created five
  // minutes ago got six locked medals floating under no heading — the one
  // state the badges were never shown in before the move, because the stats
  // screen replaced its whole body with an empty state. It also keeps that
  // club from paying a communityPlayerStats query for a card nobody sees.
  //
  // `communityStats` is never reset to null once loaded, so this cannot flip
  // back to false on a re-focus.
  const clubHasRecord =
    !!communityStats &&
    (communityStats.totalFinished > 0 || communityStats.totalCancelled > 0);

  // The live half of the club's goal total (see the state above).
  //
  // ONE document — `communityStats/{groupId}`, via `getCommunityTotals`.
  // This first read `getCommunityChampionship`, which answers the same
  // question by fetching every `communityPlayerStats` row in the club and
  // summing the goals column: one read per person who has ever played for it,
  // on every arrival at the club page, for a single number. The club doc
  // carries that number already — the same batch writes both — and it is the
  // very field the sealed seasons archived, so the two halves of the sum below
  // now come from one source instead of two.
  //
  // Members only — and not for politeness: `communityStats` is readable only
  // by the club's own members, so for a stranger browsing a public club this
  // read comes back denied and the total reads 0. A club's gold
  // "שערי המועדון" would then show LOCKED to the one person who has never
  // seen it — a wrong statement about the club, paid for with a round-trip
  // that was always going to fail.
  useEffect(() => {
    if (!groupId || !belongs || !clubHasRecord) return;
    let alive = true;
    gameService
      .getCommunityTotals(groupId)
      .then((t) => {
        if (!alive) return;
        setLiveGoals(t.goals);
        setLiveRounds(t.rounds);
      })
      // A failure must not hide the other five badges — treat it as "no goals
      // known yet" rather than as "no achievements".
      .catch(() => {
        if (alive) setLiveGoals(0);
      });
    return () => {
      alive = false;
    };
  }, [groupId, belongs, clubHasRecord]);

  // The archived half. Only a club that has actually CLOSED a season has one,
  // and everyone else pays no read for it.
  const closedSeasons = group?.seasons?.count ?? 0;
  useEffect(() => {
    if (!groupId || !belongs || !clubHasRecord || closedSeasons <= 0) {
      setArchivedGoals(0);
      setArchivedRounds(0);
      return;
    }
    let alive = true;
    seasonHistoryService
      .list(groupId)
      .then((list) => {
        // 'error' is NOT an empty list: a club with five sealed seasons told
        // that on a dropped connection would read as having lost them.
        if (!alive || list === 'error') return;
        setArchivedGoals(list.reduce((a, x) => a + x.totals.goals, 0));
        setArchivedRounds(list.reduce((a, x) => a + x.totals.rounds, 0));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [groupId, belongs, clubHasRecord, closedSeasons]);

  // Everything the club badges are scored on — all of it LIFETIME. Season
  // scoping any of these made a club's badges collapse the morning after a
  // close, which is exactly what a badge must never do.
  const clubMetrics: ClubMetrics | null = useMemo(() => {
    if (!belongs || !group || !communityStats || !clubHasRecord) return null;
    if (liveGoals === null) return null;
    return {
      gameNights: communityStats.lifetime?.totalFinished ?? 0,
      clubGoals: liveGoals + archivedGoals,
      members: group.playerIds?.length ?? 0,
      ageYears: group.createdAt
        ? Math.floor((Date.now() - group.createdAt) / (365.25 * 24 * 3600 * 1000))
        : 0,
      activeThisMonth: communityStats.lifetime?.activeThisMonth ?? 0,
      organizationRatePct: Math.round(
        (communityStats.lifetime?.organizationRate ?? 0) * 100,
      ),
    };
  }, [belongs, group, communityStats, clubHasRecord, liveGoals, archivedGoals]);

  // Only the CREATOR may delete the whole community — promoted admins
  // can manage it but not destroy it. Falls back to the first admin for
  // legacy docs that predate creatorId.
  const isCreator = useMemo(
    () =>
      !!group &&
      !!me &&
      me.id === (group.creatorId ?? group.adminIds?.[0]),
    [group, me],
  );
  const phoneValid =
    !!group?.contactPhone && isValidIsraeliPhone(group.contactPhone);

  // The admin to reach via the in-app chat: the community's founder, falling
  // back to the first admin for legacy docs that predate creatorId.
  const adminUid = useMemo(
    () => (group ? group.creatorId ?? group.adminIds?.[0] : undefined),
    [group],
  );

  // Open a 1:1 in-app DM with the community admin (parallel to the WhatsApp
  // contact button). DirectChatScreen creates the conversation on mount and
  // gracefully handles a friends-only restriction, so we just navigate.
  const handleChatAdmin = useCallback(() => {
    if (!me || !adminUid || me.id === adminUid) return;
    if (!ensureNotGuest(he.guestRegisterChatAdmin)) return;
    logEvent(AnalyticsEvent.CommunityContactAdminTapped, {
      groupId,
      channel: 'in_app',
      source: 'inline_button',
    });
    logEvent(AnalyticsEvent.ChatEntryPointTapped, {
      source: 'community_admin_dm',
      scope: 'dm',
    });
    goToDirectChat(dmConvId(me.id, adminUid));
  }, [me, adminUid, groupId]);

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
      // 'cancelled' is the user backing out, not a failure — don't log it.
      if (res.reason !== 'cancelled') {
        logEvent(AnalyticsEvent.PhotoUploadFailed, {
          source: 'community_cover',
          groupId: group.id,
          reason: res.reason,
        });
      }
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
      logEvent(AnalyticsEvent.PhotoUploadFailed, {
        source: 'community_cover',
        groupId: group.id,
        reason: 'metadata_save',
      });
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
      logEvent(AnalyticsEvent.FriendsInvitedToCommunity, {
        groupId: group.id,
        invitedCount: invited,
      });
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
    const admins = group.adminIds ?? [];
    if (admins.includes(me.id) && admins.length === 1) {
      appAlert(he.error, he.communityDetailsLeaveLastAdmin);
      return;
    }
    logEvent(AnalyticsEvent.GroupLeavePrompted, { groupId: group.id });
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
      const link = await createShortInviteUrl({
        type: 'team',
        id: group.id,
        invitedBy: me?.id,
        fallbackLong: deepLinkService.buildInviteUrl({
          type: 'team',
          id: group.id,
          invitedBy: me?.id,
        }),
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

  const handleCreateRecurring = (source: 'menu' | 'next_game_card') => {
    if (!group || !me) return;
    logEvent(AnalyticsEvent.CommunityRecurringCtaTapped, {
      groupId: group.id,
      source,
    });
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'wizard',
      source: 'community',
      mode: 'recurring',
      groupId: group.id,
    });
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

  /**
   * A game of THIS club being played right now.
   *
   * Asked of `canEnterLive`, the same gate both live screens use, so this
   * button can never offer a door the next screen would shut — including its
   * membership rule, which lets a member who is not on tonight's roster watch.
   */
  const liveNow = useMemo(
    () =>
      upcoming.find((g) =>
        canEnterLive(g, {
          isOrganizerOrAdmin: isAdmin,
          isParticipant: !!me && (g.players ?? []).includes(me.id),
          isClubMember: isMember || isAdmin,
        }),
      ) ?? null,
    [upcoming, isAdmin, isMember, me],
  );

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
  // "מחזורים שיצאו לפועל" stat shown lower on the same screen. The old source
  // (history list, limit 20, cancelled INCLUDED) both undercounted past ~20
  // games and contradicted that stat. Fall back to the history-derived count
  // only until the stats load.
  const matchesHeld =
    communityStats?.totalFinished ??
    // Evenings the club actually HELD. A summary with no `playState` was built
    // before that question had one answer, and counted as held — which is what
    // it did before, so nothing historical moves.
    history.filter((h) => (h.playState ?? 'happened') === 'happened').length;

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
                onPress: () => {
                  logEvent(AnalyticsEvent.CommunityEditOpened, {
                    groupId: group.id,
                  });
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'CommunityEdit',
                    { groupId: group.id },
                  );
                },
              },
            ]
          : []),
        ...(isAdmin
          ? [
              {
                id: 'recurring',
                label: he.communityMenuRecurringGame,
                icon: 'repeat-outline' as const,
                onPress: () => handleCreateRecurring('menu'),
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
                onPress: () => {
                  logEvent(AnalyticsEvent.CommunityApprovalsOpened, {
                    groupId: group.id,
                    pendingCount: group.pendingPlayerIds.length,
                  });
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'AdminApproval',
                    undefined,
                  );
                },
              },
            ]
          : []),
        // "לצפייה בכל השחקנים" and "סטטיסטיקה" are gone from this menu. Both
        // only switched to a TAB that is already on screen, two taps behind a
        // ☰ instead of one tap on the bar above — a menu row for something the
        // person can already see (owner, 28.09).
        {
          id: 'history',
          label: he.communityMenuHistory,
          icon: 'time-outline' as const,
          onPress: () =>
            (nav as { navigate: (s: string, p: unknown) => void }).navigate(
              'CommunityHistory',
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
                onPress: () => {
                  logEvent(AnalyticsEvent.CommunityContactAdminTapped, {
                    groupId: group.id,
                    channel: 'whatsapp',
                    source: 'menu',
                  });
                  openWhatsApp(group.contactPhone);
                },
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

  /**
   * Nothing is locked here, and the reason is structural rather than a policy
   * decision: reaching this render at all means `/groups/{id}` was READ, and
   * the rules only hand that document to a member. Whoever is looking at this
   * screen can already see everything the roster and the numbers would show.
   *
   * Gating the two tabs on `isMember || isAdmin` looked equivalent and is not —
   * `playerIds` membership and read access are different facts, and the gate
   * padlocked both tabs for a reader who had the document open in front of
   * them. The lock belongs to the visitor screen, which reads the public
   * projection and genuinely cannot answer either tab.
   */
  const clubTabs: ClubTab[] = [
    { key: 'info', label: he.clubTabInfo },
    { key: 'players', label: he.clubTabPlayers },
    { key: 'stats', label: he.clubTabStats },
  ];

  /**
   * Everything above the tab content: the hero, the floating club numbers that
   * overlap it, and the tab bar itself.
   *
   * Built once and handed to whichever tab is mounted, because each tab owns
   * its own scrolling — the roster is a virtualised FlatList and nesting it in
   * a shared ScrollView would throw its windowing away on a 200-member club.
   * So the header travels INTO the active tab's list rather than sitting above
   * three scroll views.
   *
   * Not sticky, and deliberately: FlatList can only pin its
   * ListHeaderComponent as a whole, which would pin the entire hero. Uniform
   * behaviour across the three tabs beats a pinned bar on one of them.
   */
  const header = (
    <>
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
            isMember && me
              ? () => {
                  logEvent(AnalyticsEvent.CommunityChatOpened, {
                    groupId: group.id,
                  });
                  logEvent(AnalyticsEvent.ChatEntryPointTapped, {
                    source: 'community_details',
                    scope: 'community',
                  });
                  goToCommunityChat(group.id);
                }
              : undefined
          }
        />

        {/* The two floating cards that used to overlap the hero — תאריך הקמה
            and מפגשים שנערכו — were removed on the owner's instruction. The
            same numbers live inside the tabs, where the rest of the club's
            figures are. */}
      <ClubTabs
        tabs={clubTabs}
        active={tab}
        onChange={(k) => {
          showTab(k);
          logEvent(AnalyticsEvent.ScreenView, { screen: 'ClubDetails', tab: k });
        }}
      />
    </>
  );

  return (
    <View style={styles.root}>
      {/* The overlay HOST stays mounted for the life of the screen and only
          its content toggles. Mounting and unmounting a zIndex'd absoluteFill
          View over a ScrollView leaves a stale native touch region on Fabric —
          the taps land on a layer that is no longer drawn, and the screen
          reads as dead until a scroll forces a re-hit-test. That is the shape
          behind "אני לוחץ על כפתורים וכלום לא נלחץ"; the match screen was
          changed to this form for the same reason and this screen was left
          behind. `pointerEvents="none"` means the permanent host never takes a
          touch itself. */}
      <View pointerEvents="none" style={styles.celebrationLayer}>
        {celebrate ? (
          <CelebrationOverlay
            onDone={() => {
              setCelebrate(false);
              // Only for a club the user has just made. Re-entering an
              // established club must never ask.
              if (celebrateOnArrival) setInvitePrompt(true);
            }}
          />
        ) : null}
      </View>
      {/* Mounted on FIRST visit, then kept — hidden, not destroyed.
       *
       *  It used to be a ternary: one tab alive, the other two gone. That is
       *  cheapest on open and wrong on every tap afterwards. Switching tabs
       *  unmounted a whole tree and built another, so the hero was torn down
       *  and rebuilt each time — "כשאני עובר בין טאבים אתה מרנדר את כל המסך",
       *  and the cover photo blinked with it — and the tab you came back to
       *  re-read its documents from scratch. A club browsed for a minute paid
       *  for the numbers tab three times.
       *
       *  Lazy keeps the saving that mattered: opening a club still mounts ONE
       *  tab, and a tab never visited is never built. What changes is the
       *  second visit — free, instant, and with its scroll position where the
       *  reader left it.
       *
       *  `display: none` rather than unmounting: an inactive tab keeps its
       *  state and its listeners but occupies no layout and paints nothing. */}
      {seen.has('info') ? (
      <View style={tab === 'info' ? styles.tabPane : styles.tabPaneHidden}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        // "I press buttons and nothing is pressed, and after I scroll the
        // screen a little the presses work" — reported from 1.1.8.
        //
        // Scrolling still working while taps do nothing narrows the cause to
        // exactly one place: ScrollView's onStartShouldSetResponderCapture. An
        // overlay would swallow the scroll too; a hit-test dead zone would kill
        // one region, not the page. The capture returns true — taking the touch
        // away from whatever was under the finger — when RN believes a keyboard
        // is dismissible, i.e. TextInputState still names a focused input.
        // Nothing on this page has one, but the feed we arrive from does (its
        // search box), and that focus survives the navigation.
        //
        // The release handler then blurs it, so strictly it is the FIRST tap
        // after each arrival that is eaten, not all of them — which is how a
        // page reads as dead until you poke it twice, and why the report's
        // "scroll a little and it works" is the same story.
        //
        // "handled" opts out of that capture entirely: the touch goes to the
        // button, and only an unclaimed tap falls through. It is what the
        // app's other tap-heavy scroll surfaces already pass — both wizards,
        // post-sign-in onboarding and both filter sheets. (Most screens here
        // still take the default; this is the fix for the ones a focused
        // search box upstream can reach, not a house rule.)
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => reload({ pullToRefresh: true })}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {header}

        <View style={styles.body}>
          {SCREENSHOT_MODE ? (
            /* Ad layout: club numbers on top, champions table below — nothing
               else (level/titles/next-game/players are hidden for the promo). */
            <>
              <CommunityStatsSection
                stats={communityStats}
                memberCount={group.playerIds?.length ?? 0}
                goals={(liveGoals ?? 0) + archivedGoals}
                miniGames={liveRounds + archivedRounds}
              />
              <CommunityChampionship
                groupId={group.id}
                memberIds={group.playerIds ?? []}
                attendedByUser={communityStats?.attendedByUser}
                seasonNo={
                  group.seasons?.enabled ? (group.seasons.currentNo ?? 1) : undefined
                }
              />
            </>
          ) : (
          <>
          {/* Single entry to the full stats window (club table + leaderboards
              + superlatives + club level). Was duplicated — a club-level chip
              here AND a button lower down both opened CommunityStats; per owner
              request the chip was dropped and the button lives here at the top. */}
          {/* A game being played RIGHT NOW is the most urgent thing this
              screen can say, so it sits directly under the club's numbers and
              above everything that describes the past. */}
          {liveNow ? (
            <Button
              title={he.communityLiveNowCta}
              variant="primary"
              size="lg"
              fullWidth
              iconLeft="football"
              onPress={() =>
                (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                  'MatchDetails',
                  { gameId: liveNow.id },
                )
              }
            />
          ) : null}

          {/* The one question the system cannot answer itself. Above the
              season card on purpose: an unconfirmed evening is missing from
              the very numbers the card below reports, so asking about it
              second would be explaining a total before correcting it. */}
          <UnverifiedEveningsCard
            groupId={group.id}
            // So a row does not repeat the club name already in the header
            // above it and push the date out of a one-line row.
            groupName={group.name}
            isAdmin={isAdmin}
            // Confirming an evening adds it to the very numbers on this
            // screen, so re-read them rather than leave a stale total under
            // the card that just changed it.
            onResolved={() => void reload({ pullToRefresh: true })}
          />

          {/* Who the club IS comes before how its season is going — the
              description and the rules are what a member reads once and a
              visitor reads first. */}
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

          {/* Where the season stands. Managing it lives in club settings. */}
          <SeasonsCard
            groupId={group.id}
            seasons={group.seasons}
            isMember={isMember || isAdmin}
          />

          {/* The full stats window used to be a button here that pushed a
              route. It is the third tab now — a button that scrolls you past
              the tab bar to reach what the tab bar already offers is one
              control too many. */}

          {/* The next game night leads the tab, per the reference: it is the
              one thing on this screen that is about to happen. It used to sit
              below the club's description, which is the one thing that never
              changes. */}
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
            playersCount={nextGame?.players?.length}
            maxPlayers={nextGame?.maxPlayers}
            format={nextGame?.format}
            fieldType={nextGame?.fieldType}
            registrationOpensAt={
              nextGame?.status === 'scheduled'
                ? nextGame.registrationOpensAt
                : undefined
            }
            // Admin-only CTA shown when the empty state renders. Lets
            // the admin open the Game wizard in recurring mode without
            // hunting through the hamburger menu.
            onCreateRecurring={
              isAdmin ? () => handleCreateRecurring('next_game_card') : undefined
            }
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
                      logEvent(AnalyticsEvent.CommunityNextGameLocked, {
                        groupId: group.id,
                        gameId: nextGame.id,
                        opensAt: nextGame.registrationOpensAt,
                      });
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


          {/* ③ Notification toggle — members only */}
          {isMember && me ? (
            <CommunityNotifyToggle
              subscribed={(me.newGameSubscriptions ?? []).includes(group.id)}
              onChange={handleNotify}
            />
          ) : null}

          {/* ── נתוני מועדון ── the reference's third card.
              Moved here from below the last-cycle block; there is exactly ONE
              of these. Adding a second in the reference's position while the
              original stayed put rendered the card twice, which is visible
              only on the device and was.
              Loaded once by the parent (read cost bounded to ~200
              finished/cancelled game docs) and passed down, so the count here
              AGREES with "מפגשים שנערכו". */}
          <CommunityStatsSection
            stats={communityStats}
            memberCount={group.playerIds?.length ?? 0}
            goals={(liveGoals ?? 0) + archivedGoals}
            miniGames={liveRounds + archivedRounds}
          />

          {/* The players preview used to sit here. It is gone: the roster is a
              TAB of this screen now, one tap away, and a strip of avatars over
              a "לצפייה בכל השחקנים" link was the same destination said twice. */}

          {/* "מהמחזור האחרון" — who brought the ball / jerseys last evening
              (user request). Vector icons, no emoji. Hidden when neither holder
              is known (old game / not assigned). */}
          {(() => {
            const ballName = memberName(lastCycleHolders.ballId);
            const jerseysName = memberName(lastCycleHolders.jerseysId);
            if (!ballName && !jerseysName) return null;
            return (
              <View style={styles.lastCycleWrap}>
                <Text style={styles.lastCycleTitle}>
                  {he.communityLastCycleTitle}
                </Text>
                <View style={styles.lastCycleRow}>
                  {ballName ? (
                    <View style={styles.lastCycleSquare}>
                      <View style={styles.lastCycleIcon}>
                        <Ionicons name="football" size={20} color={colors.primary} />
                      </View>
                      <Text style={styles.lastCycleLabel}>
                        {he.communityBroughtBall}
                      </Text>
                      <Text style={styles.lastCycleName} numberOfLines={1}>
                        {ballName}
                      </Text>
                    </View>
                  ) : null}
                  {jerseysName ? (
                    <View style={styles.lastCycleSquare}>
                      <View style={styles.lastCycleIcon}>
                        <Ionicons name="shirt" size={20} color={colors.primary} />
                      </View>
                      <Text style={styles.lastCycleLabel}>
                        {he.communityBroughtJerseys}
                      </Text>
                      <Text style={styles.lastCycleName} numberOfLines={1}>
                        {jerseysName}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })()}


          {/* ── הישגי המועדון (תארים) ──
              ישירות מתחת ל"נתוני מועדון", לבקשת הבעלים (דיווח של אלירן,
              1.1.9). התארים הם של המועדון לכל אורכו — הם נצברים מכל העונות
              יחד ואינם מתאפסים בסגירת עונה. */}
          <ClubAchievementsCard metrics={clubMetrics} />

          {/* The stats-table button that used to sit here (below "נתוני
              מועדון") was moved UP to the top of the body — it duplicated the
              club-level chip that also opened CommunityStats. */}

          {/* The per-community game-history list used to render here, but it
              duplicated the same list already reachable from the ⋯ menu's
              "היסטוריית מחזורים" (→ CommunityHistory). Removed at the owner's
              request; `history` is still loaded above solely as the pre-stats
              fallback for the "מפגשים שנערכו" count (matchesHeld). */}

          {/* WhatsApp contact CTA — for people who are NOT in the club yet and
              are deciding whether to join. A member already has the club's
              chat and every other way in; asking him to "contact the admin"
              treats him like an outsider. Removed for members at the owner's
              request; the ⋯ menu still carries the same action, so nobody
              loses the ability, only the prompt. */}
          {phoneValid && !isAdmin && !isMember ? (
            <Button
              title={he.communityDetailsContactAdmin}
              variant="outline"
              size="lg"
              fullWidth
              iconLeft="logo-whatsapp"
              onPress={() => {
                logEvent(AnalyticsEvent.CommunityContactAdminTapped, {
                  groupId: group.id,
                  channel: 'whatsapp',
                  source: 'inline_button',
                });
                openWhatsApp(group.contactPhone);
              }}
            />
          ) : null}

          {/* In-app chat contact — DM the admin without leaving the app. Same
              gate as the WhatsApp button above and for the same reason: it is
              an outsider's question. */}
          {!isAdmin && !isMember && me && adminUid && me.id !== adminUid ? (
            <Button
              title={he.communityDetailsChatAdmin}
              variant="outline"
              size="lg"
              fullWidth
              // Left, like the share button directly below it. Reported by a
              // user who had the two stacked on screen and saw one icon on each
              // side — the fifth instance of this, and the first that was a
              // wrong PROP rather than the direction-flipping bug the Button
              // itself used to have.
              iconLeft="chatbubble-ellipses-outline"
              onPress={handleChatAdmin}
            />
          ) : null}

          {/* ⑥ Share-invite CTA — members & admins only */}
          {isMember || isAdmin ? (
            <CommunityShareInviteCta onPress={handleInvite} />
          ) : null}
          </>
          )}
        </View>
      </ScrollView>
      </View>
      ) : null}
      {seen.has('players') ? (
        <View style={tab === 'players' ? styles.tabPane : styles.tabPaneHidden}>
          <CommunityPlayersScreen groupId={group.id} header={header} />
        </View>
      ) : null}
      {seen.has('stats') ? (
        <View style={tab === 'stats' ? styles.tabPane : styles.tabPaneHidden}>
          <CommunityStatsScreen groupId={group.id} header={header} />
        </View>
      ) : null}

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
            logEvent(AnalyticsEvent.GroupDeleted, {
              groupId: group.id,
              memberCount: group.playerIds?.length ?? 0,
            });
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
            <FriendsInvitePicker
              selected={inviteIds}
              onChange={setInviteIds}
              // Don't suggest friends already in the community (member, pending,
              // or admin) — inviting them again is a no-op that confused users.
              exclude={[
                ...(group?.playerIds ?? []),
                ...(group?.pendingPlayerIds ?? []),
                ...(group?.adminIds ?? []),
              ]}
            />
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

      {/* Same shape as the celebration host above: permanently mounted,
          `pointerEvents="none"`, content toggled. The white wash is painted
          only while leaving. */}
      <View
        style={[styles.busyOverlay, !busyLeave && styles.overlayIdle]}
        pointerEvents="none"
      >
        {busyLeave ? <SoccerBallLoader size={36} /> : null}
      </View>
      <InviteMembersSheet
        visible={invitePrompt}
        clubName={group?.name ?? ''}
        onShare={() => {
          setInvitePrompt(false);
          void handleInvite();
        }}
        onDismiss={() => setInvitePrompt(false)}
      />
    </View>
  );
}

// ─── Community stats section ────────────────────────────────────────────

function CommunityStatsSection({
  stats,
  memberCount,
  goals,
  miniGames,
}: {
  stats: CommunityStatsData | null;
  memberCount: number;
  /** Lifetime goals — live counter + every sealed season. */
  goals: number;
  /** Lifetime mini-games, the same two halves. */
  miniGames: number;
}) {
  if (!stats) return null;
  if (stats.totalFinished === 0 && stats.totalCancelled === 0) return null;

  // The reference's four: שחקנים · גולים · מחזורים · משחקים. All four are
  // already in hand — the goal and mini-game counters ride the two reads this
  // screen was making anyway, so the card costs nothing new.
  return (
    <View style={statsSectionStyles.wrap}>
      <Text style={statsSectionStyles.title}>{he.communityStatsTitle}</Text>
      <View style={statsSectionStyles.grid}>
        <StatCell
          icon="people"
          tint={clubAccent.purple}
          label={he.communityStatsPlayers}
          value={String(memberCount)}
        />
        <StatCell
          icon="football"
          tint={clubAccent.blue}
          label={he.communityStatsGoals}
          value={String(goals)}
        />
        <StatCell
          icon="calendar"
          tint={clubAccent.gold}
          label={he.communityStatsEvenings}
          value={String(stats.lifetime?.totalFinished ?? stats.totalFinished)}
        />
        <StatCell
          icon="grid"
          tint={clubAccent.green}
          label={he.communityStatsMiniGames}
          value={String(miniGames)}
        />
      </View>
    </View>
  );
}

function StatCell({
  label,
  value,
  icon,
  tint,
}: {
  label: string;
  value: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
}) {
  return (
    // Icon FIRST → visual LEFT is wrong here: under forceRTL the first child
    // lands on the RIGHT. The reference's info-tab cell puts the plate on the
    // LEFT and the number on the right, so the text block leads.
    <View style={statsSectionStyles.cell}>
      <View style={statsSectionStyles.cellText}>
        <Text style={statsSectionStyles.value}>{value}</Text>
        <Text style={statsSectionStyles.label} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={[statsSectionStyles.cellIcon, { backgroundColor: tint + '1A' }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
    </View>
  );
}

const statsSectionStyles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 18,
    ...clubShadow,
    padding: spacing.lg,
  },
  title: {
    fontSize: 16,
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
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 14,
    ...clubShadow,
  },
  cellText: { flexShrink: 1, minWidth: 0 },
  cellIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: {
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
    fontWeight: '900',
    textAlign: RTL_LABEL_ALIGN,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: 12,
    color: clubSurface.subtle,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 1,
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
  // Local club ground — cool and a step below white, so the cards on it
  // have an edge. See `clubSurface`.
  root: { flex: 1, backgroundColor: clubSurface.ground },
  lastCycleWrap: { marginTop: spacing.lg, paddingHorizontal: spacing.lg },
  lastCycleTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
    marginBottom: spacing.sm,
  },
  lastCycleRow: { flexDirection: 'row', gap: spacing.sm },
  lastCycleSquare: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  lastCycleIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${colors.primary}14`,
    marginBottom: 2,
  },
  lastCycleLabel: {
    ...typography.caption,
    color: colors.textMuted,
    writingDirection: 'rtl',
  },
  lastCycleName: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    writingDirection: 'rtl',
  },
  celebrationLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
  },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  // A pane fills the screen; an inactive one is out of the layout entirely.
  // `display: 'none'` keeps the subtree mounted — state, scroll offset and
  // listeners survive — while it paints nothing and measures nothing.
  tabPane: { flex: 1 },
  tabPaneHidden: { display: 'none' },
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
  // White on the page's tint, per the reference. The card used to be a blue
  // block, which put a second accent behind text that is already the club's
  // own words.
  descriptionCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    ...clubShadow,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  // Rules use a softer warning tone (amber tint) so the two cards
  // don't read as the same thing — description is identity ("who we
  // are"), rules is behaviour ("what we expect").
  rulesCard: {
    backgroundColor: '#FFFBEB',
    borderRadius: 18,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
  },
  descriptionTitle: {
    fontSize: 16,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: 6,
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
  // The reference's info tab: white cards on a faintly tinted page, which is
  // what separates one card from the next without a border on each.
  infoPage: { backgroundColor: colors.bg },
  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  // The idle state of a permanently-mounted overlay host: no wash, nothing
  // drawn. `opacity: 0` rather than `display: 'none'` so the native view keeps
  // its place in the hierarchy — taking it out and putting it back is the
  // thing that strands the touch region.
  overlayIdle: { opacity: 0 },
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
