// ProfileScreen — redesigned player card.
//
// New structure (replaces the previous identity + nav + settings
// blob):
//   ① Compact identity header (jersey + name + role badge + community)
//   ② 2×2 stats grid — משחקים / הגעה % / הופעות / ביטולים
//   ③ Full-width referral card
//   ④ Discipline row (last 10 games)
//   ⑤ Next-game card (soonest game the user is in, or empty state)
//   ⑥ Primary CTA — "הזמן חברים לאפליקציה"
//
// Everything that used to live inline (settings, nav rows, support,
// sign-out, delete account) has moved into the HamburgerMenu opened
// from the ☰ button at the top-leading edge.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  useFocusEffect,
  useNavigation,
  useScrollToTop,
} from '@react-navigation/native';
import Constants from 'expo-constants';

import { Button } from '@/components/Button';
import { DeleteAccountSheet } from '@/components/profile/DeleteAccountSheet';
import { currentAuthProviderId } from '@/firebase/auth';
// DisciplineRow (trust meter) hidden from UI for now — see render site below.
// import { DisciplineRow } from '@/components/profile/DisciplineRow';
import { ReferralCard } from '@/components/profile/ReferralCard';
import { rcBool, rcString, useRemoteConfig } from '@/services/remoteConfigService';
import { ProfileNextGameCard } from '@/components/profile/ProfileNextGameCard';
import { HomeGreetingHeader } from '@/components/home/HomeGreetingHeader';
import { AvailabilityCalendarCard } from '@/components/home/AvailabilityCalendarCard';
import {
  OnboardingChecklist,
  type ChecklistItem,
} from '@/components/home/OnboardingChecklist';
import { DidYouKnowCard, type Tip } from '@/components/home/DidYouKnowCard';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { gameService, userService } from '@/services';
import {
  achievementsService,
  type NewlyUnlocked,
} from '@/services/achievementsService';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import type { Game } from '@/types';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { deepLinkService } from '@/services/deepLinkService';
import {
  colors,
  radius,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore, useIsAdmin } from '@/store/groupStore';
import { type User } from '@/types';

// Support email + store URLs are remotely overridable via Remote Config
// (keys support_email / store_url_ios / store_url_android, defaults in
// remoteConfigService.RC_DEFAULTS). Read at point of use via rcString().

export function ProfileScreen() {
  useRemoteConfig(); // re-render when feature flags / config activate
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const localUser = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);
  const deleteOwnAccount = useUserStore((s) => s.deleteOwnAccount);
  const isAdmin = useIsAdmin(localUser?.id);
  const myCommunities = useGroupStore((s) => s.groups);

  // Pull a fresher copy of /users so stats stay current — the local
  // store only holds the auth/profile-edit slice and may be stale.
  const [user, setUser] = useState<User | null>(localUser);

  // Mirror profile-edit changes (name / avatarId / photoUrl) back
  // into our local copy. Without this, ProfileEdit → goBack would
  // show the previous photo until the next server refetch landed:
  // the useEffect below only re-fetches on `id` change, which
  // doesn't fire for an edit of the same user.
  useEffect(() => {
    if (!localUser || localUser.isGuest) return;
    setUser((prev) =>
      prev && prev.id === localUser.id ? { ...prev, ...localUser } : localUser,
    );
  }, [
    localUser,
    localUser?.name,
    localUser?.avatarId,
    localUser?.photoUrl,
  ]);
  const [refreshing, setRefreshing] = useState(false);
  const [referralCount, setReferralCount] = useState<number | null>(null);
  // Full referral list (who joined through the user + when) — powers
  // both the count tile and the recent-activity feed.
  const [referrals, setReferrals] = useState<
    Awaited<ReturnType<typeof userService.listInvitedUsers>>
  >([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  // The soonest game the user is registered for — drives the
  // next-game card that replaced the achievements rail. Null = none
  // upcoming (or still loading on first paint).
  const [nextGame, setNextGame] = useState<Game | null>(null);
  // Open, non-stale games the user CREATED (createdBy === me). Derived
  // from the same getMyGames fetch that powers nextGame — no extra
  // round-trip. Surfaced as the "משחקים שיצרתי" collection below.
  const [createdGames, setCreatedGames] = useState<Game[]>([]);
  // The user's full registered/created game list (getMyGames) — kept so
  // the activity feed can surface "created" + "registered to" events.
  const [myGames, setMyGames] = useState<Game[]>([]);
  // Live "games played" count — games the user was placed in the teams for
  // and that have passed. Replaces the dead user.stats.totalGames (never
  // incremented by any flow). null = not loaded yet.
  const [playedCount, setPlayedCount] = useState<number | null>(null);
  // Tiers crossed since last check — shown as a celebration overlay. We
  // derive achievements once per signed-in user (not per focus) to keep the
  // read cost down on this frequently-visited screen.
  const [celebrate, setCelebrate] = useState<NewlyUnlocked[]>([]);
  // Stores the uid we already derived for. Using the uid (not a bool) means
  // it naturally re-runs after an account switch, and gating on the groups
  // `hydrated` flag stops it firing with an empty groups list (which would
  // prune team-based tiers to 0).
  const derivedForRef = useRef<string | null>(null);
  const groupsHydrated = useGroupStore((s) => s.hydrated);

  // Scroll-to-top: react-navigation hook listens for tab re-press.
  const scrollRef = useRef<ScrollView>(null);
  useScrollToTop(scrollRef as React.RefObject<ScrollView>);

  const refreshUser = React.useCallback(async () => {
    if (!localUser || localUser.isGuest) return;
    setRefreshing(true);
    try {
      const u = await userService.getUserById(localUser.id);
      if (u) setUser(u);
    } finally {
      setRefreshing(false);
    }
  }, [localUser]);

  useEffect(() => {
    if (!localUser || localUser.isGuest) return;
    let alive = true;
    userService
      .getUserById(localUser.id)
      .then((u) => {
        if (alive && u) setUser(u);
      })
      .catch(() => {
        // Silent — we keep showing the cached store value.
      });
    return () => {
      alive = false;
    };
  }, [localUser?.id]);

  // Referral list — refreshes on focus so a new attribution lands in
  // both the count tile and the activity feed the next time the user
  // returns to the screen. We list (rather than just count) because the
  // activity feed needs each joiner's name + timestamp; the count is
  // simply the list length.
  useFocusEffect(
    React.useCallback(() => {
      const uid = user?.id;
      // Guests have an anonymous uid but no /users doc — listInvitedUsers
      // would just hit permission-denied and spam the error log. Skip.
      if (!uid || localUser?.isGuest) {
        setReferralCount(null);
        setReferrals([]);
        return;
      }
      let alive = true;
      userService
        .listInvitedUsers(uid)
        .then((list) => {
          if (!alive) return;
          setReferrals(list);
          setReferralCount(list.length);
        })
        .catch(() => {
          // Leave the previous values visible — flicker-back-to-loading
          // on every focus would be worse UX than a slightly stale 0.
        });
      return () => {
        alive = false;
      };
    }, [user?.id]),
  );

  // Load the user's soonest upcoming game. Refreshes on focus so a
  // game the user just joined (or one that filled/cancelled) is
  // reflected when they return to the profile tab.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest) {
        setNextGame(null);
        setMyGames([]);
        setCreatedGames([]);
        return;
      }
      let alive = true;
      gameService
        // getMyLiveOrUpcomingGames (NOT getMyGames): the latter is
        // status==='open' only, so a game the user is registered to that went
        // 'active' (live), 'locked', or was created 'scheduled' fell out — and
        // the home card wrongly showed the empty "find a game" state to a user
        // who IS in a game. Same source of truth the Games tab uses.
        .getMyLiveOrUpcomingGames(uid)
        .then((mine) => {
          if (!alive) return;
          // Sorted by startsAt ascending — a live game (past startsAt) sorts
          // first, otherwise the soonest upcoming. The first IS the game to show.
          setNextGame(mine[0] ?? null);
          setMyGames(mine);
          // Same list, filtered to the ones the user CREATED — powers
          // the "משחקים שיצרתי" section. createdBy is set by the wizard.
          setCreatedGames(mine.filter((g) => g.createdBy === uid));
        })
        .catch(() => {
          // Leave the previous value — a transient fetch error
          // shouldn't blank an already-shown game.
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Live "games played" count — refreshed on focus so it reflects a game
  // that just passed / got teams drawn.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid) {
        setPlayedCount(null);
        return;
      }
      let alive = true;
      // Exact, unbounded attended-games count — equals the Statistics screen's
      // "משחקים" tile (same `isAttendedGame` model, no 50-row cap).
      gameService
        .getPlayedGamesCount(uid)
        .then((count) => {
          if (alive && count !== null) setPlayedCount(count);
        })
        .catch(() => {
          // Keep the previous count on a transient error.
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Derive achievements once per mount and celebrate any tier just
  // crossed. Runs after groups hydrate so the team metrics are real.
  useEffect(() => {
    const uid = localUser?.id;
    // Wait for groups to hydrate — deriving with an empty list would prune
    // team-based tiers to 0. Re-runs when the uid changes (account switch).
    if (!uid || localUser?.isGuest || !groupsHydrated) return;
    if (derivedForRef.current === uid) return;
    derivedForRef.current = uid;
    let alive = true;
    achievementsService
      .deriveCounters(uid, {
        groups: myCommunities,
        friendsCount: localUser?.friends?.length ?? 0,
        goals: localUser?.stats?.goals ?? 0,
        assists: localUser?.stats?.assists ?? 0,
      })
      .then(async (c) => {
        const fresh = await achievementsService.persistDerivedUnlocks(uid, c);
        if (alive && fresh.length) setCelebrate(fresh);
      })
      .catch(() => {
        // Best-effort — no celebration on a transient failure.
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUser?.id, localUser?.isGuest, groupsHydrated, myCommunities.length]);

  // Admin-only: pending approvals across ALL the user's admin groups.
  // Surfaced as a badge on the hamburger row so it's still visible
  // without sitting in the focused player card.
  const pendingApprovals = useMemo(() => {
    if (!user) return 0;
    return myCommunities
      .filter((g) => g.adminIds.includes(user.id))
      .reduce((acc, g) => acc + g.pendingPlayerIds.length, 0);
  }, [myCommunities, user]);

  const onSignOut = () => {
    // Confirm before signing out — matches the delete-account guard and
    // prevents a stray tap from logging the user out.
    appAlert(
      he.profileSignOutConfirmTitle,
      he.profileSignOutConfirmBody,
      [
        { text: he.cancel, style: 'cancel' },
        { text: he.profileSignOut, style: 'destructive', onPress: signOut },
      ],
      { cancelable: true },
    );
  };

  // Open the typed-confirmation sheet (user must type בטוח) instead of a
  // one-tap destructive alert — deletion is irreversible.
  const onDeleteAccount = () => setDeleteSheetOpen(true);

  const confirmDeleteAccount = async (password?: string) => {
    try {
      setDeleting(true);
      await deleteOwnAccount(password);
      setDeleteSheetOpen(false);
    } catch (err) {
      if (__DEV__) console.warn('[profile] delete failed', err);
      appAlert(he.profileDeleteAccountFailed);
    } finally {
      setDeleting(false);
    }
  };

  if (!user) return null;

  // Live played-games count (teams-drawn + game passed). Falls back to the
  // legacy stat only while the live count is still loading.
  const totalGames = playedCount ?? user.stats?.totalGames ?? 0;

  // ── Home: activation checklist + rotating feature tips ──────────────
  // Each step's `done` comes from live state; the card hides once all done.
  const checklistItems: ChecklistItem[] = [
    {
      key: 'photo',
      label: he.homeStepPhoto,
      icon: 'person-outline',
      done: !!user.photoUrl,
      onPress: () => nav.navigate('ProfileEdit'),
    },
    {
      key: 'availability',
      label: he.homeStepAvailability,
      icon: 'calendar-outline',
      done: (user.availability?.preferredDays?.length ?? 0) > 0,
      onPress: () => nav.navigate('AvailabilityEdit'),
    },
    {
      key: 'community',
      label: he.homeStepCommunity,
      icon: 'people-outline',
      done: myCommunities.length > 0,
      onPress: () => nav.navigate('CommunitiesTab'),
    },
    {
      key: 'game',
      label: he.homeStepGame,
      icon: 'football-outline',
      done: totalGames > 0 || myGames.length > 0,
      onPress: () => nav.navigate('GameTab'),
    },
    {
      key: 'invite',
      label: he.homeStepInvite,
      icon: 'person-add-outline',
      // "Done" = someone actually joined through this user's invite link
      // (referralCount counts /users with invitedBy === me), not merely that
      // they tapped share — the meaningful signal the owner asked for.
      done: (referralCount ?? 0) > 0,
      onPress: () => {
        void handleShareInvite();
      },
    },
  ];
  const checklistComplete = checklistItems.every((i) => i.done);
  // Only judge the checklist once the data it reads has actually loaded —
  // otherwise communities/games read empty on first paint, every step looks
  // undone, and the "בוא נתחיל" activation card flashes for a frame before the
  // real data hides it (user report). `groupsHydrated` covers communities;
  // `playedCount !== null` covers games (null = still loading).
  // `referralCount !== null` covers the invite step (null = still loading);
  // guests never load it (no /users doc) so they're exempt from that gate.
  const homeDataReady =
    groupsHydrated &&
    playedCount !== null &&
    (localUser?.isGuest || referralCount !== null);
  const homeTips: Tip[] = [
    { text: he.homeTipAutoTeams, onPress: () => nav.navigate('CommunitiesTab') },
    { text: he.homeTipInternalRating, onPress: () => nav.navigate('CommunitiesTab') },
    { text: he.homeTipAvailability, onPress: () => nav.navigate('AvailabilityEdit') },
    { text: he.homeTipScheduled, onPress: () => nav.navigate('GameTab', { screen: 'GameCreate' }) },
    { text: he.homeTipCommunity, onPress: () => nav.navigate('CommunitiesTab') },
  ];

  // The user's communities split into the ones they OPENED (founder) vs
  // Pre-compute the share invite handler once.
  const handleShareInvite = async () => {
    if (!user) return;
    // Generic "invite to the app" — lands on the home/download page and
    // credits the inviter (invitedBy), WITHOUT pushing a specific
    // community/game. The old behaviour shared the user's first community.
    const link = deepLinkService.buildAppInviteUrl(user.id);
    try {
      const result = await Share.share({
        title: he.inviteShareSubject,
        message: he.profileInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { source: 'profile' });
      }
    } catch (err) {
      if (__DEV__) console.warn('[profile] invite share failed', err);
    }
  };

  // Build the hamburger sections. We do it inline rather than a
  // separate function so the closures over `nav` + `user` stay
  // type-safe without prop drilling.
  const sections: HamburgerSection[] = [
    {
      id: 'profile',
      title: he.profileMenuSectionProfile,
      items: [
        {
          id: 'achievements',
          label: he.profileSectionMyAchievements,
          icon: 'trophy-outline',
          // Dedicated achievements view — shows ONLY the badge grid
          // and detail popover, none of the rest of the player card.
          onPress: () => nav.navigate('Achievements'),
        },
        {
          id: 'statistics',
          label: he.statsMenuLabel,
          icon: 'stats-chart-outline',
          onPress: () => nav.navigate('Statistics'),
        },
        {
          id: 'edit',
          label: he.profileEdit,
          icon: 'create-outline',
          onPress: () => nav.navigate('ProfileEdit'),
        },
        ...(rcBool('feature_friends')
          ? [
              {
                id: 'friends',
                label: he.friendsTitle,
                icon: 'people-outline' as const,
                onPress: () => nav.navigate('Friends'),
              },
            ]
          : []),
      ],
    },
    {
      id: 'games',
      title: he.profileMenuSectionGames,
      items: [
        {
          id: 'availability',
          label: he.profileSectionAvailability,
          icon: 'calendar-outline',
          onPress: () => nav.navigate('AvailabilityEdit'),
        },
        {
          id: 'history',
          label: he.profileSectionHistory,
          icon: 'time-outline',
          onPress: () => nav.navigate('History'),
        },
        // Stats screen removed (2026-06-12) — its games/clubs/friends now
        // live on the profile hero card itself, so the separate page was
        // redundant.
      ],
    },
    // Admin-only: pending approvals. Rendered as its own section so
    // the badge is impossible to miss without bloating other sections.
    ...(isAdmin && pendingApprovals > 0
      ? [
          {
            id: 'admin',
            title: he.profileMenuSectionSystem,
            items: [
              {
                id: 'approvals',
                label: he.profileSectionApprovals,
                icon: 'shield-checkmark-outline' as const,
                onPress: () => nav.navigate('AdminApproval'),
                badge: pendingApprovals,
              },
            ],
          },
        ]
      : []),
    {
      id: 'system',
      title: isAdmin && pendingApprovals > 0 ? undefined : he.profileMenuSectionSystem,
      items: [
        {
          id: 'notifications',
          label: he.profileSectionNotifications,
          icon: 'notifications-outline',
          onPress: () => nav.navigate('NotificationsSettings'),
        },
        {
          id: 'blocked',
          label: he.profileSectionBlocked,
          icon: 'ban-outline',
          onPress: () => nav.navigate('BlockedUsers'),
        },
      ],
    },
    {
      id: 'support',
      title: he.profileMenuSectionSupport,
      items: [
        ...(rcBool('feature_feedback')
          ? [
              {
                id: 'bug',
                label: he.settingsReportBug,
                icon: 'bug-outline' as const,
                onPress: () => nav.navigate('Feedback', { type: 'bug' }),
              },
              {
                id: 'feature',
                label: he.settingsSuggestFeature,
                icon: 'bulb-outline' as const,
                onPress: () => nav.navigate('Feedback', { type: 'suggestion' }),
              },
            ]
          : []),
        {
          id: 'rate',
          label: he.settingsRateApp,
          icon: 'star-outline',
          onPress: openStore,
        },
      ],
    },
    {
      id: 'account',
      title: he.profileMenuSectionAccount,
      items: [
        {
          id: 'signout',
          label: he.profileSignOut,
          icon: 'log-out-outline',
          onPress: onSignOut,
        },
        {
          id: 'delete',
          label: he.profileDeleteAccount,
          icon: 'trash-outline',
          onPress: onDeleteAccount,
          tone: 'danger',
        },
      ],
    },
  ];

  // Guest session — no real profile/stats exist. Show a clean "register to
  // unlock your profile" prompt instead of an empty stats screen with
  // sign-out / delete-account controls that don't apply to a guest.
  if (localUser?.isGuest) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.guestWrap}>
          <View style={styles.guestIcon}>
            <Ionicons name="person-circle-outline" size={72} color={colors.primary} />
          </View>
          <Text style={styles.guestTitle}>{he.guestProfileTitle}</Text>
          <Text style={styles.guestBody}>{he.guestProfileBody}</Text>
          <Button
            title={he.guestRegisterCta}
            variant="primary"
            size="lg"
            onPress={() => void signOut()}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshUser}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① Compact greeting header — replaces the big stadium hero. */}
        <HomeGreetingHeader
          user={user}
          onMenu={() => setMenuOpen(true)}
          onEdit={() => nav.navigate('ProfileEdit')}
        />

        <View style={styles.body}>
          {/* ② Next-game card — the soonest game the user is in (or an
              empty state that jumps to the Games tab). */}
          <ProfileNextGameCard
            game={nextGame}
            userId={user.id}
            onOpenGame={(gameId) => nav.navigate('MatchDetails', { gameId })}
            onFindGame={() => nav.navigate('GameTab')}
          />

          {/* Availability calendar — how many players are free to play near you,
              per window. Tap a window to open a quick game. Self-isolating: it
              renders null on error, so it can never break the home screen. */}
          <AvailabilityCalendarCard
            onCreateGame={(dateMs, window, city) =>
              (nav as { navigate: (s: string, p?: unknown) => void }).navigate(
                'GameTab',
                {
                  screen: 'GameCreate',
                  params: {
                    quick: true,
                    prefillDateMs: dateMs,
                    prefillWindow: window,
                    prefillCity: city ?? undefined,
                    inviteAvailable: true,
                  },
                },
              )
            }
            onSetAvailability={() => nav.navigate('AvailabilityEdit')}
          />

          {/* ③ Pending join requests — admins only, when there are any. */}
          {isAdmin && pendingApprovals > 0 ? (
            <Pressable
              onPress={() => nav.navigate('Requests')}
              style={({ pressed }) => [
                styles.pendingBanner,
                pressed && { opacity: 0.9 },
              ]}
              accessibilityRole="button"
            >
              <Ionicons name="download-outline" size={20} color="#B45309" />
              <Text style={styles.pendingText} numberOfLines={1}>
                {he.homePendingRequests(pendingApprovals)}
              </Text>
              <Ionicons name="chevron-back" size={18} color="#B45309" />
            </Pressable>
          ) : null}

          {/* ④ Activation checklist — hidden once every step is done, and not
              shown at all until the data loaded (prevents a first-paint flash). */}
          {homeDataReady && !checklistComplete ? (
            <OnboardingChecklist items={checklistItems} />
          ) : null}

          {/* ⑤ Rotating "ידעת ש..." feature-discovery tip. */}
          <DidYouKnowCard tips={homeTips} />

          {/* ⑥ Quick actions — create a game / mark availability. */}
          <View style={styles.ctaRow}>
            <Pressable
              onPress={() =>
                nav.navigate('GameTab', {
                  screen: 'GamesList',
                  params: { openCreate: true },
                })
              }
              style={({ pressed }) => [
                styles.ctaPrimary,
                pressed && { opacity: 0.92 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.homeCreateGame}
            >
              <Ionicons name="football" size={18} color="#FFFFFF" />
              <Text style={styles.ctaPrimaryText}>{he.homeCreateGame}</Text>
            </Pressable>
            <Pressable
              onPress={() => nav.navigate('AvailabilityEdit')}
              style={({ pressed }) => [
                styles.ctaSecondary,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={he.homeMarkAvailability}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              <Text style={styles.ctaSecondaryText}>{he.homeMarkAvailability}</Text>
            </Pressable>
          </View>

          {/* ⑦ Referral row — tap → list of who joined through you. */}
          {rcBool('feature_referrals') ? (
            <ReferralCard
              count={referralCount}
              onPress={() => nav.navigate('Referrals')}
            />
          ) : null}

          {/* ⑧ Invite friends. */}
          <Pressable
            onPress={handleShareInvite}
            style={({ pressed }) => [
              styles.inviteCta,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.profileInviteFriendsCta}
          >
            <Ionicons name="share-social-outline" size={18} color="#FFFFFF" />
            <Text style={styles.inviteCtaText}>
              {he.profileInviteFriendsCta}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <HamburgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={sections}
      />

      <DeleteAccountSheet
        visible={deleteSheetOpen}
        loading={deleting}
        requirePassword={currentAuthProviderId() === 'password'}
        onCancel={() => setDeleteSheetOpen(false)}
        onConfirm={confirmDeleteAccount}
      />

      {celebrate.length > 0 ? (
        <AchievementCelebration items={celebrate} onDone={() => setCelebrate([])} />
      ) : null}
    </SafeAreaView>
  );
}

// ─── Side-effect helpers (preserved from previous implementation) ───────

function debugInfoBlock(uid: string): string {
  const v = Constants.expoConfig?.version ?? 'unknown';
  return [
    '\n\n— מידע טכני —',
    `App version: ${v}`,
    `Platform: ${Platform.OS} ${Platform.Version}`,
    `User: ${uid}`,
  ].join('\n');
}

async function openMailto(subject: string, uid: string): Promise<void> {
  const isBug = subject === he.settingsBugSubject;
  logEvent(
    isBug ? AnalyticsEvent.ReportBugClicked : AnalyticsEvent.SuggestFeatureClicked,
  );
  const subjectEnc = encodeURIComponent(subject);
  const bodyEnc = encodeURIComponent(debugInfoBlock(uid));
  // Remotely overridable support address (rcString); falls back to the
  // in-code default until a value is published in Remote Config.
  const supportEmail = rcString('support_email');

  // 1) Native mail composer. We deliberately do NOT gate on
  //    Linking.canOpenURL('mailto:…') — on Android 11+ it returns false
  //    unless the `mailto` scheme is declared in the manifest <queries>,
  //    which produced a false "no mail app" even on phones with Gmail
  //    installed. Firing the intent and catching the rejection is the
  //    reliable check.
  const mailto = `mailto:${supportEmail}?subject=${subjectEnc}&body=${bodyEnc}`;
  try {
    await Linking.openURL(mailto);
    return;
  } catch {
    /* no app handled the mailto intent — fall through to web */
  }

  // 2) Gmail web composer in the browser — works with no configured
  //    mail client (a browser is effectively always present).
  const gmailWeb =
    `https://mail.google.com/mail/?view=cm&fs=1` +
    `&to=${encodeURIComponent(supportEmail)}&su=${subjectEnc}&body=${bodyEnc}`;
  try {
    await Linking.openURL(gmailWeb);
    return;
  } catch {
    /* extremely unlikely — fall through to showing the address */
  }

  // 3) Last resort: surface the address so the user can still reach us.
  appAlert(
    he.settingsEmailUnavailable,
    `${he.settingsEmailUnavailableHint}\n\n${supportEmail}`,
  );
}

async function openStore(): Promise<void> {
  logEvent(AnalyticsEvent.RateAppClicked);
  // Explicit "rate us" tap → open the store listing's review screen
  // directly. We deliberately do NOT use StoreReview.requestReview here:
  // Apple (and Google) rate-limit the in-app prompt and may show nothing,
  // which on a button tap looks broken. The contextual auto-prompt after
  // a game fills (storeReviewService) keeps using requestReview — that's
  // the API's intended, non-button use.
  // Store URLs are remotely overridable (rcString); fall back to the
  // in-code constants until a value is published.
  const url =
    Platform.OS === 'ios'
      ? `${rcString('store_url_ios')}?action=write-review`
      : rcString('store_url_android');
  try {
    const ok = await Linking.canOpenURL(url);
    if (ok) await Linking.openURL(url);
    else appAlert(he.error, he.settingsRateUnavailable);
  } catch {
    if (__DEV__) appAlert(he.error, he.settingsRateUnavailable);
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  guestWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  guestIcon: { marginBottom: spacing.md },
  guestTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
  },
  guestBody: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  scroll: {
    paddingBottom: spacing.xxl,
  },
  // Floating stats card — pulled UP via negative margin to overlap
  // the bottom edge of the hero gradient, then padded so its
  // shadow doesn't get clipped by the next section.
  // Hero ↔ stats overlap tightened (-28 → -36) and bottom gap
  // bumped a touch so the card sits closer to the hero (more "lifted
  // and connected") and breathes more towards the next section.
  statsWrap: {
    marginTop: -36,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  // Amber "pending join requests" banner (admins only).
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  pendingText: {
    ...typography.body,
    color: '#92400E',
    fontWeight: '700',
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Quick-action row: create game (filled green) + mark availability (outline).
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  ctaPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#16A34A',
  },
  ctaPrimaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  ctaSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    height: 52,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  ctaSecondaryText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  // Bespoke invite CTA — bright royal blue (matches the new
  // profile palette) with a subtle shadow. Hand-rolled instead of
  // the brand-green Button so the screen's accent stays cohesive.
  inviteCta: {
    // row-reverse puts the share icon on the LEFT of the label (QA: the
    // icon read better on the leading-left side in this RTL layout).
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    marginTop: spacing.sm,
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  inviteCtaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  // Reserved aliases — keep so any straggling refs still resolve.
  _radius: { borderRadius: radius.lg },
});
