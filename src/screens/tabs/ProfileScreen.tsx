// ProfileScreen — redesigned player card.
//
// New structure (replaces the previous identity + nav + settings
// blob):
//   ① Compact identity header (jersey + name + role badge + community)
//   ② 2×2 stats grid — מחזורים / הגעה % / הופעות / ביטולים
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
import { LinearGradient } from 'expo-linear-gradient';
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
import { rcBool, rcString, useRemoteConfig } from '@/services/remoteConfigService';
import { NextGameCardEntrance } from '@/components/anim/game/NextGameCardEntrance';
import { guestJoinGameRequest } from '@/services/guestJoin';
import { AnimationLab } from '@/screens/dev/AnimationLab';
import { AvailabilityPromptCard } from '@/components/home/AvailabilityPromptCard';
import { HomeActionTiles } from '@/components/home/HomeDashboardParts';
import { HomeAvailabilityPanel } from '@/components/home/HomeAvailabilityPanel';
import { buildAvailabilityView } from '@/utils/homeAvailabilityView';
import { HomeHero } from '@/components/home/HomeHero';
import {
  UpcomingRoundCard,
  CompletedRoundCard,
  NoRoundCard,
  type RoundActions,
} from '@/components/home/HomeRoundCards';
import {
  deriveRoundState,
  isShowableUpcoming,
  pickHomeRound,
} from '@/utils/homeRoundState';
import { notificationsService } from '@/services/notificationsService';
import { ScreenEntrance } from '@/components/anim/ScreenEntrance';
import { PressableScale } from '@/components/PressableScale';
import { newAssistantNonce, resolveAssistantMessage } from '@/utils/assistant/resolve';
import { ASSISTANT_RULES } from '@/utils/assistant/rules';
import type {
  AssistantContext,
  AssistantMessage,
} from '@/utils/assistant/types';
import {
  assistantInsightsService,
  invalidateAssistantInsights,
  type ClubInsight,
} from '@/services/assistantInsightsService';
import {
  availabilityFeedService,
  type AvailabilityCounts,
} from '@/services/availabilityFeedService';
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
import { getInboxCount } from '@/services/requestsService';
import { getAvailabilityCardEnabled } from '@/services/homeConfigService';
import { dayDiff } from '@/utils/format';
import {
  achievementsService,
  type NewlyUnlocked,
} from '@/services/achievementsService';
import { AchievementCelebration } from '@/components/AchievementCelebration';
import { isUpdateGateOpen } from '@/services/updateService';
import type { Game } from '@/types';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { toast } from '@/components/Toast';
import { deepLinkService } from '@/services/deepLinkService';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import {
  colors,
  radius,
  spacing,
  typography,
  RTL_LABEL_ALIGN,
} from '@/theme';
import { motion } from '@/theme/motion';
import { he } from '@/i18n/he';
import { pickHomeHero } from '@/utils/homeHero';
import { useUserStore } from '@/store/userStore';
import { useAuthenticatedAction } from '@/hooks/useAuthenticatedAction';
import { useGroupStore, useIsAdmin } from '@/store/groupStore';
import { type User } from '@/types';

// Support email + store URLs are remotely overridable via Remote Config
// (keys support_email / store_url_ios / store_url_android, defaults in
// remoteConfigService.RC_DEFAULTS). Read at point of use via rcString().

// Marketing/QA screenshot layout — the same EXPO_PUBLIC_SCREENSHOT_MODE flag
// the club screen and the mock banner already read. It hides dev chrome only;
// nothing about the real screen changes.
const SCREENSHOT_MODE =
  (process.env.EXPO_PUBLIC_SCREENSHOT_MODE ?? '').trim() === '1';

export function ProfileScreen() {
  useRemoteConfig(); // re-render when feature flags / config activate
  const nav = useNavigation<any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const localUser = useUserStore((s) => s.currentUser);
  const signOut = useUserStore((s) => s.signOut);
  const deleteOwnAccount = useUserStore((s) => s.deleteOwnAccount);
  // For the guest card's register button only. Called unconditionally here
  // because the guest branch returns further down, after every hook.
  const authAction = useAuthenticatedAction();
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
  const [showLab, setShowLab] = useState(false); // DEV-only animation lab
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
  // Scheduled games (registration not yet open) in my communities — the
  // read-only "בקרוב" teaser shown in place of the empty no-game state.
  const [scheduledUpcoming, setScheduledUpcoming] = useState<Game[]>([]);
  // Games in my clubs that are OPEN for registration and that I have NOT
  // joined. This is the rung the hero was missing — see pickHomeHero.
  const [openToJoin, setOpenToJoin] = useState<Game[]>([]);
  // The fallback hero when I'm not in any game: a game I can still join beats a
  // game that hasn't opened yet. Ordering lives in a pure helper so it can be
  // tested without a renderer.
  const heroPick = pickHomeHero<Game>([], openToJoin, scheduledUpcoming);
  const heroGame = heroPick.game;
  // Unified count of incoming requests the user must act on — friend
  // requests + community-join requests (admin) + game-join requests
  // (creator). Drives the top-of-home "pending requests" banner, which is
  // NOT admin-only (friend requests reach every user). Async → fetched on
  // focus. See requestsService.getInboxCount.
  const [inboxCount, setInboxCount] = useState(0);
  // Pulse master switch (appConfig/features.availabilityCardEnabled) — off hides
  // the whole home availability surface. Defaults true (fail-open).
  const [availCardEnabled, setAvailCardEnabled] = useState(true);
  // Nearby availability counts (per day × window) — powers the "recommended
  // day" banner + the evening-availability podium. Fetched once on focus
  // (15-min service cache). Null = loading/none.
  const [availData, setAvailData] = useState<AvailabilityCounts | null>(null);
  // Games the user PLAYED since the start of this week (Sun 00:00) — powers
  // one of the smart-banner states. 0 = none yet this week.
  const [playedThisWeek, setPlayedThisWeek] = useState(0);
  // Epoch ms of the user's most recent played game (null = never / not loaded)
  // — drives the "haven't played in N days" banner line.
  const [lastPlayedMs, setLastPlayedMs] = useState<number | null>(null);
  // Open, non-stale games the user CREATED (createdBy === me). Derived
  // from the same getMyGames fetch that powers nextGame — no extra
  // round-trip. Surfaced as the "מחזורים שיצרתי" collection below.
  const [createdGames, setCreatedGames] = useState<Game[]>([]);
  // The user's full registered/created game list (getMyGames) — kept so
  // the activity feed can surface "created" + "registered to" events.
  const [myGames, setMyGames] = useState<Game[]>([]);
  // The evening that ended in the last 24h, if the user actually played it —
  // drives the "איך היה אתמול?" card under the coach message. Null the rest of
  // the time, which is most of the week.
  const [justPlayed, setJustPlayed] = useState<Game | null>(null);
  // Has the upcoming-games query answered yet? `homeDataReady` covers groups
  // and counters, not this one — and without it the round area renders "no
  // upcoming round" for the half second before the query returns one.
  const [gamesLoaded, setGamesLoaded] = useState(false);
  // The game whose join is in flight, so the button cannot double-fire.
  const [joiningId, setJoiningId] = useState<string | null>(null);
  /** The coach line, held for the visit. See where it is filled, far below. */
  const coachLatchRef = useRef<AssistantMessage | null>(null);
  /** Pending re-read after a join, so the reconciler has time to seat us. */
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // §22 — the "a season closed" notification, if this player has one from the
  // last 48 hours. Read once per focus from the notification doc itself. The
  // WINDOW is the dedupe now, not a read flag: nothing marks this one read,
  // so the card survives being opened and expires on its own.
  const [seasonClosed, setSeasonClosed] = useState<{
    id: string;
    groupId: string;
    seasonId: string;
    seasonNo: number;
    groupName: string;
  } | null>(null);
  // Live "games played" count — games the user was placed in the teams for
  // and that have passed. Replaces the dead user.stats.totalGames (never
  // incremented by any flow). null = not loaded yet.
  const [playedCount, setPlayedCount] = useState<number | null>(null);
  // Where the user stands in their main club — crowns, scorer place, rival,
  // attendance streak. The only piece of coach context not already on this
  // screen, so it's fetched behind a 30-minute cache and only for a signed-in
  // member of at least one club. Null is a perfectly good answer: the rules
  // that needed it simply stay quiet.
  const [clubInsight, setClubInsight] = useState<ClubInsight | null>(null);
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
    // A deliberate pull means "recompute what you're telling me" — drop the
    // cached club standing so the assistant's rivalry lines refresh too.
    invalidateAssistantInsights();
    try {
      const u = await userService.getUserById(localUser.id);
      if (u) setUser(u);
      const groupId = myCommunities[0]?.id;
      if (groupId) {
        setClubInsight(
          await assistantInsightsService
            .getClubInsight(localUser.id, groupId, lastPlayedMs)
            .catch(() => null),
        );
      }
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUser, myCommunities[0]?.id, lastPlayedMs]);

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

  // §22 — has a season this player took part in just closed?
  //
  // On focus rather than on mount: a season closes on the hourly sweep, so the
  // app can be open when it happens, and the card should appear on the next
  // return to home rather than on the next cold start.
  //
  // Guests are skipped for the same reason as the block above — an anonymous
  // uid has no notifications and the query would only produce noise. A failure
  // leaves the card hidden; this is a nice-to-have on a screen that must
  // render regardless.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest) {
        setSeasonClosed(null);
        return;
      }
      let alive = true;
      notificationsService
        .getUnreadSeasonClose(uid)
        .then((n) => {
          if (alive) setSeasonClosed(n);
        })
        .catch(() => {
          /* handled inside the service; the card stays hidden */
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id, localUser?.isGuest]),
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
        setJustPlayed(null);
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
          setGamesLoaded(true);
          // Same list, filtered to the ones the user CREATED — powers
          // the "מחזורים שיצרתי" section. createdBy is set by the wizard.
          setCreatedGames(mine.filter((g) => g.createdBy === uid));
        })
        .catch(() => {
          // Leave the previous value — a transient fetch error
          // shouldn't blank an already-shown game.
        });
      // Reads the SAME cached 48h window the call above just warmed, so this
      // costs no extra query — see getMyRecentGamesRaw.
      gameService
        .getJustFinishedGame(uid)
        .then((g) => {
          if (alive) setJustPlayed(g);
        })
        .catch(() => {
          if (alive) setJustPlayed(null);
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Games I could join right now, across my communities. getCommunityGames
  // already server-filters to status=='open' and drops anything I'm in, so this
  // is exactly "what can I still register for" — one query per 30 clubs, the
  // same one the games tab runs.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest || myCommunities.length === 0) {
        setOpenToJoin([]);
        return;
      }
      let alive = true;
      gameService
        .getCommunityGames(
          uid,
          myCommunities.map((g) => g.id),
        )
        .then((games) => {
          if (alive) setOpenToJoin(games);
        })
        .catch(() => {
          /* transient — keep the previous list */
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id, myCommunities.length]),
  );

  // Scheduled ("coming soon") games across my communities — surfaced as a
  // read-only teaser when I have no near game, so an empty home turns into
  // "a game is on the way, registration opens at…". Refetched on focus.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest || myCommunities.length === 0) {
        setScheduledUpcoming([]);
        return;
      }
      let alive = true;
      gameService
        .getMyUpcomingScheduledGames(
          uid,
          myCommunities.map((g) => g.id),
        )
        .then((games) => {
          if (alive) setScheduledUpcoming(games);
        })
        .catch(() => {
          /* transient — keep the previous list */
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id, myCommunities.length]),
  );

  // Cancel a pending post-join re-read on unmount, so it cannot fire into a
  // screen that is gone.
  useEffect(
    () => () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
    },
    [],
  );

  // Drop the coach's latched line when the tab loses focus, so the next visit
  // picks a fresh one. Sits with the other focus effects — above every early
  // return — because hook order has to be identical on every render.
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        coachLatchRef.current = null;
      };
    }, []),
  );

  // Unified incoming-requests count for the top banner — refreshed on focus
  // so approving/declining elsewhere (or a new friend request) is reflected.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest) {
        setInboxCount(0);
        return;
      }
      let alive = true;
      getInboxCount(uid)
        .then((n) => {
          if (alive) setInboxCount(n);
        })
        .catch(() => {
          /* transient — keep the previous count */
        });
      return () => {
        alive = false;
      };
    }, [localUser?.id]),
  );

  // Pulse master switch for the home availability surface — refreshed on focus.
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      getAvailabilityCardEnabled().then((on) => {
        if (alive) setAvailCardEnabled(on);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  // Nearby availability counts — refetched on focus (service caches 15 min so
  // an unchanged refocus is a no-op). Feeds the recommended-day banner + podium.
  useFocusEffect(
    React.useCallback(() => {
      let alive = true;
      availabilityFeedService
        .getAvailabilityCounts()
        .then((d) => {
          if (alive) setAvailData(d);
        })
        .catch(() => {
          /* keep previous — never blank the home screen on a transient error */
        });
      return () => {
        alive = false;
      };
    }, []),
  );

  // Games played since the start of this week (Sunday) — one smart-banner state.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      if (!uid || localUser?.isGuest) {
        setPlayedThisWeek(0);
        return;
      }
      let alive = true;
      // Start of the current week (Sunday 00:00, Israel week).
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());
      const weekStartMs = weekStart.getTime();
      gameService
        .getPlayedGames(uid, 20)
        .then((list) => {
          if (!alive) return;
          setPlayedThisWeek(list.filter((g) => g.date >= weekStartMs).length);
          // getPlayedGames is sorted by date desc, so the first is the latest.
          setLastPlayedMs(list.length > 0 ? list[0].date : null);
        })
        .catch(() => {
          /* keep previous count on a transient error */
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
      // "מחזורים" tile (same `isAttendedGame` model, no 50-row cap).
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

  // Club standing for the coach. Keyed on the FIRST club — a player in several
  // clubs gets their primary one, which is the table they think of as "the"
  // table. Cached in the service, so a refocus is free.
  useFocusEffect(
    React.useCallback(() => {
      const uid = localUser?.id;
      const groupId = myCommunities[0]?.id;
      if (!uid || localUser?.isGuest || !groupId) {
        setClubInsight(null);
        return;
      }
      let alive = true;
      assistantInsightsService
        .getClubInsight(uid, groupId, lastPlayedMs)
        .then((r) => {
          if (alive) setClubInsight(r);
        })
        .catch(() => {
          /* the assistant just skips the rivalry rules */
        });
      return () => {
        alive = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localUser?.id, myCommunities[0]?.id, lastPlayedMs]),
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
        cleanSheets: localUser?.stats?.cleanSheets ?? 0,
      })
      .then(async (c) => {
        const fresh = await achievementsService.persistDerivedUnlocks(uid, c);
        // Never in front of a store gate. A forced update modal is the one
        // thing on screen the user MUST be able to reach, and a celebration
        // covering it leaves the app unusable until they guess to dismiss
        // trophies first (Pulse). The unlocks are already persisted, so they
        // are not lost — they simply wait for a visit with nothing in the way.
        if (alive && fresh.length && !isUpdateGateOpen()) setCelebrate(fresh);
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
  const onDeleteAccount = () => {
    logEvent(AnalyticsEvent.AccountDeleteSheetOpened, {
      requirePassword: currentAuthProviderId() === 'password',
    });
    setDeleteSheetOpen(true);
  };

  const confirmDeleteAccount = async (password?: string) => {
    try {
      setDeleting(true);
      await deleteOwnAccount(password);
      setDeleteSheetOpen(false);
    } catch (err) {
      logEvent(AnalyticsEvent.AccountDeleteFailed, {
        reason: (err as { code?: string } | null)?.code ?? 'unknown',
      });
      if (__DEV__) console.warn('[profile] delete failed', err);
      appAlert(he.profileDeleteAccountFailed);
    } finally {
      setDeleting(false);
    }
  };

  // Drawn once per mount: the coach says something new every time the app
  // opens, and holds that line while the screen is up — a re-roll on each
  // render would reshuffle the words mid-read.
  const assistantNonce = useRef(newAssistantNonce()).current;

  // Every hook above this line, and this line is why. The component bails out
  // here when the user has not loaded; a hook below it runs on the render
  // AFTER the user arrives and not on the one before, which is the count
  // mismatch that unmounts a screen outright.
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
      onPress: () => {
        logEvent(AnalyticsEvent.OnboardingChecklistStepTapped, {
          step: 'photo',
          done: !!user.photoUrl,
        });
        nav.navigate('ProfileEdit');
      },
    },
    {
      key: 'availability',
      label: he.homeStepAvailability,
      icon: 'calendar-outline',
      done: (user.availability?.preferredDays?.length ?? 0) > 0,
      onPress: () => {
        logEvent(AnalyticsEvent.OnboardingChecklistStepTapped, {
          step: 'availability',
          done: (user.availability?.preferredDays?.length ?? 0) > 0,
        });
        nav.navigate('AvailabilityEdit');
      },
    },
    {
      key: 'community',
      label: he.homeStepCommunity,
      icon: 'people-outline',
      done: myCommunities.length > 0,
      onPress: () => {
        logEvent(AnalyticsEvent.OnboardingChecklistStepTapped, {
          step: 'community',
          done: myCommunities.length > 0,
        });
        nav.navigate('CommunitiesTab');
      },
    },
    {
      key: 'game',
      label: he.homeStepGame,
      icon: 'football-outline',
      done: totalGames > 0 || myGames.length > 0,
      onPress: () => {
        logEvent(AnalyticsEvent.OnboardingChecklistStepTapped, {
          step: 'game',
          done: totalGames > 0 || myGames.length > 0,
        });
        nav.navigate('GameTab');
      },
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
        logEvent(AnalyticsEvent.OnboardingChecklistStepTapped, {
          step: 'invite',
          done: (referralCount ?? 0) > 0,
        });
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
    { title: he.homeTipTeamsTitle, icon: 'people-outline', text: he.homeTipAutoTeams, onPress: () => nav.navigate('CommunitiesTab') },
    { title: he.homeTipAvailabilityTitle, icon: 'calendar-outline', text: he.homeTipAvailability, onPress: () => nav.navigate('AvailabilityEdit') },
    { title: he.homeTipHistoryTitle, icon: 'time-outline', text: he.homeTipHistory, onPress: () => nav.navigate('History') },
    { title: he.homeTipStatsTitle, icon: 'stats-chart-outline', text: he.homeTipStats, onPress: () => nav.navigate('Statistics') },
    { title: he.homeTipScheduledTitle, icon: 'alarm-outline', text: he.homeTipScheduled, onPress: () => nav.navigate('GameTab', { screen: 'GameCreate' }) },
    { title: he.homeTipInviteTitle, icon: 'person-add-outline', text: he.homeTipInvite, onPress: () => nav.navigate('CommunitiesTab') },
    { title: he.homeTipSeasonsTitle, icon: 'trophy-outline', text: he.homeTipSeasons, onPress: () => nav.navigate('CommunitiesTab') },
  ];

  // ── Home "hero" selection ──────────────────────────────────────────────
  // Exactly ONE primary card sits at the top, the most relevant to the user's
  // current state — so we never stack two "organize a game" cards, and never
  // show an empty card when a focused action fits better.
  //   • state 1 — a game within the next week  → the next-game card
  //   • state 2 — no near game + marked availability → the availability calendar
  //   • state 3 — no near game + not marked    → a big "set availability" prompt
  const markedAvailability =
    (user.availability?.preferredDays?.length ?? 0) > 0;

  // ── The round area ─────────────────────────────────────────────────────
  // One decision, taken from data this screen already holds. `nextGame` is a
  // game the viewer is IN (getMyLiveOrUpcomingGames); `heroGame` is the
  // fallback from `pickHomeHero` — a game they could still join, else one
  // whose registration has not opened. That order is unchanged.
  const upcomingRound = isShowableUpcoming(nextGame)
    ? nextGame
    : isShowableUpcoming(heroGame)
      ? heroGame
      : null;
  // `getJustFinishedGame` is the existing definition of "the round that just
  // finished": the latest evening within 24 hours that the viewer actually
  // played and that the server sealed as having happened. Reusing it means
  // the completed card inherits a boundary the app already agreed on, and
  // costs nothing — it reads the same cached window the query above warmed.
  const roundLayout = pickHomeRound(upcomingRound, justPlayed);
  // One clock for the whole area, taken at render. Countdowns move when the
  // screen does (focus, pull-to-refresh) rather than on a background timer.
  const nowMs = Date.now();
  const roundState = roundLayout.upcoming
    ? deriveRoundState(roundLayout.upcoming, user.id, nowMs)
    : null;

  const roundActions: RoundActions = {
    onDetails: (gameId) => {
      logEvent(AnalyticsEvent.HomeActionTileTapped, {
        tile: 'round_details',
        source: 'home_round',
        state: roundState?.kind ?? 'none',
      });
      nav.navigate('MatchDetails', { gameId });
    },
    onSummary: (gameId) => {
      logEvent(AnalyticsEvent.HomeActionTileTapped, {
        tile: 'round_summary',
        source: 'home_round',
      });
      // The match screen's STATISTICS tab, not the standalone personal
      // summary. Asked for directly: from there the evening's numbers, the
      // mini-games, the teams and everyone else's night are all one screen,
      // and the personal card is still one tap away — whereas EveningSummary
      // is only the personal card and leads nowhere else.
      nav.navigate('MatchDetails', { gameId, initialTab: 'stats' });
    },
    onJoin: async (game) => {
      // A guest is parked and resumed by the existing coordinator, exactly as
      // the games feed does it — the sheet opens in place and the join is
      // re-asked of the server afterwards, so a game that filled during the
      // sign-in comes back as a waitlist rather than a success that never was.
      if (localUser?.isGuest) {
        void authAction.request(guestJoinGameRequest(game.id));
        return;
      }
      if (joiningId) return;
      setJoiningId(game.id);
      try {
        const { bucket } = await gameService.requestJoinGame(game.id, user.id, 'home');
        toast.success(
          bucket === 'waitlist'
            ? he.toastGameJoinedWaitlist
            : bucket === 'pending'
              ? he.toastGameJoinedPending
              : he.toastGameJoined,
        );
        // Show it IMMEDIATELY, then reconcile.
        //
        // The fair-queue reconciler seats the player server-side a second or
        // two later (a Cloud Function), and this screen has no realtime
        // listener. An immediate re-read therefore returns the PRE-seating
        // snapshot and the card does not move — reported as "הצטרפתי מפה
        // למחזור וזה לא התעדכן בלייב שהצטרפתי. רק לאחר רענון זה מתעדכן".
        //
        // So the card is patched in place from the bucket the server already
        // told us, and the authoritative re-read follows once the reconciler
        // has had time to commit. Same shape the games feed uses, and it
        // costs no extra read — the patch is local.
        const me = user.id;
        const patch = (g: Game): Game => {
          if (g.id !== game.id) return g;
          if (
            g.players.includes(me) ||
            g.waitlist.includes(me) ||
            (g.pending ?? []).includes(me)
          ) {
            return g; // the server already reflects it
          }
          const next: Game = {
            ...g,
            participantIds: Array.from(new Set([...(g.participantIds ?? []), me])),
          };
          if (bucket === 'players') next.players = [...g.players, me];
          else if (bucket === 'waitlist') next.waitlist = [...g.waitlist, me];
          else next.pending = [...(g.pending ?? []), me];
          return next;
        };
        // The joined game may not be in `myGames` yet (it was a club game I
        // was not in), so patch what we have AND make sure it leads.
        setNextGame((prev) => (prev && prev.id === game.id ? patch(prev) : patch(game)));
        setMyGames((prev) =>
          prev.some((g) => g.id === game.id) ? prev.map(patch) : [patch(game), ...prev],
        );
        if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => {
          reconcileTimerRef.current = null;
          void gameService
            .getMyLiveOrUpcomingGames(me)
            .then((mine) => {
              setNextGame(mine[0] ?? null);
              setMyGames(mine);
            })
            .catch(() => {
              /* the optimistic patch already shows the right thing */
            });
        }, 2500);
      } catch (err) {
        const code =
          typeof (err as { code?: unknown })?.code === 'string'
            ? (err as { code: string }).code
            : '';
        if (code === 'REGISTRATION_CONFLICT') {
          // The home card has no conflict modal — that lives on the feed and
          // on the game screen, where there is room to resolve it. Say what
          // happened and send them where it can be sorted out.
          toast.info(he.registrationConflictTitle);
          nav.navigate('MatchDetails', { gameId: game.id });
        } else if (code === 'GAME_JOIN_REJECTED') {
          toast.info(he.matchDetailsJoinRejected);
        } else if (
          code === 'GAME_NOT_OPEN' ||
          code === 'GAME_STARTED' ||
          code === 'GAME_LIVE'
        ) {
          // A stale card raced the game's lifecycle. Soft, not an error.
          toast.info(he.gameNotJoinableToast);
        } else {
          logError('homeRoundJoin', err, { gameId: game.id, userId: user.id });
          toast.error(he.summaryShareFailed);
        }
      } finally {
        setJoiningId(null);
      }
    },
    onShare: undefined,
    onCreate: () => {
      logEvent(AnalyticsEvent.HomeActionTileTapped, {
        tile: 'create',
        source: 'home_round_empty',
      });
      nav.navigate('GameTab', { screen: 'GamesList', params: { openCreate: true } });
    },
    onFind: () => {
      logEvent(AnalyticsEvent.HomeActionTileTapped, {
        tile: 'find_game',
        source: 'home_round_empty',
      });
      nav.navigate('GameTab');
    },
  };

  // ── Availability-derived widgets (recommended day + evening podium) ──
  const availReady =
    !!availData &&
    !availData.error &&
    availData.hasLocation &&
    availData.days.length > 0;
  const eveningDays = availReady
    ? availData!.days.map((d) => ({
        dateMs: d.dateMs,
        count: d.windows.evening ?? 0,
        letter: he.availabilityDayLetter[new Date(d.dateMs).getDay()] ?? '',
      }))
    : [];
  // Which days to show, which one to recommend, and in what order — all of it
  // in one pure function so the ordering rule can be tested. Same arithmetic
  // this screen used to do inline; see `homeAvailabilityView` for the rule.
  const {
    recommended,
    days: podium,
    maxCount: podiumMax,
  } = buildAvailabilityView(eveningDays);

  // ── Smart contextual banner ──
  // ALWAYS a time-of-day greeting + name, then ONE contextual suffix chosen by
  // the player's current state (requests / game today / haven't played /
  // haven't scheduled / availability / etc.). So the top line always opens with
  // "בוקר טוב <שם>, …" and never feels empty.
  const firstName = (user.name ?? '').trim().split(/\s+/)[0] || '';
  const greetWord = (() => {
    const h = new Date().getHours();
    if (h >= 5 && h < 12) return he.greetingMorning;
    if (h >= 12 && h < 17) return he.greetingNoon;
    if (h >= 17 && h < 22) return he.greetingEvening;
    return he.greetingNight;
  })();
  // The standalone greeting banner is GONE. It used to greet you on one line
  // and then bolt on a contextual suffix chosen by a hand-rolled if/else chain
  // in this component — two voices, and one of its branches printed
  // "המחזור שלך היום ב-20:00" which the next-match card already states in
  // full. The hero now owns the greeting (`greetWord` + the name it derives
  // itself) and the coach's line continues it directly underneath, so the
  // whole thing is one sentence in one voice.

  // ── Teamder Assistant ──────────────────────────────────────────────────
  // Assemble everything the rules may look at, then let the resolver pick the
  // single highest-value line. All of it is state this screen already holds
  // (plus the cached club standing), so the assistant costs no extra fetch.
  //
  // `shown` is the anti-duplication channel: it tells the rules which cards
  // are on screen right now, so an availability message can silence itself
  // when the recommended-day banner or the podium is already stating the very
  // same headcount a few rows down.

  const assistantMessage = useMemo<AssistantMessage | null>(() => {
    const now = Date.now();
    const ctx: AssistantContext = {
      now,
      nonce: assistantNonce,
      user,
      nextGame,
      isGameToday: !!nextGame && dayDiff(nextGame.startsAt) <= 0,
      communities: myCommunities,
      isClubAdmin: myCommunities.some((g) => g.adminIds.includes(user.id)),
      playedThisWeek,
      lastPlayedMs,
      playedCount,
      markedAvailability,
      bestEvening: recommended
        ? {
            dateMs: recommended.dateMs,
            weekday: new Date(recommended.dateMs).getDay(),
            count: recommended.count,
          }
        : null,
      clubName: myCommunities[0]?.name ?? null,
      clubInsight,
      // Mirrors the render conditions below EXACTLY — if one of those changes,
      // change it here too, or the assistant starts echoing a card again.
      shown: {
        nextGameCard: !!nextGame,
        // Both now live in ONE card, so both mirror its render condition.
        // `recommendedDay` additionally needs a recommendation to exist: the
        // panel omits that block when nobody is free, and reading `true`
        // there let the coach stay silent about a day nothing had named.
        recommendedDay: availCardEnabled && podium.length > 0 && !!recommended,
        availabilityPodium: availCardEnabled && podium.length > 0,
        openToJoinCard: !nextGame && openToJoin.length > 0,
        upcomingScheduledCard:
          !nextGame && openToJoin.length === 0 && scheduledUpcoming.length > 0,
        // Mirrors the render condition below EXACTLY. It is NOT gated on
        // availCardEnabled: with the remote flag off the podium is hidden but
        // the prompt card still renders, and reading `false` here let the
        // coach ask for availability a second time on the same screen.
        availabilityPrompt:
          !(availCardEnabled && podium.length > 0) && !markedAvailability,
      },
    };
    return resolveAssistantMessage(ctx, ASSISTANT_RULES);
  }, [
    assistantNonce,
    user,
    nextGame,
    myCommunities,
    playedThisWeek,
    lastPlayedMs,
    playedCount,
    markedAvailability,
    recommended,
    clubInsight,
    availCardEnabled,
    podium.length,
    scheduledUpcoming.length,
    openToJoin.length,
  ]);

  /**
   * The coach says ONE thing, once.
   *
   * The context above is assembled from seven async sources, and the memo
   * re-ran as each landed: on first paint most were empty, a generic rule
   * won, and a second later the real data arrived and a better rule replaced
   * it on screen. From the outside that is a page that refreshes itself for
   * no reason — reported exactly that way ("ההודעה מהמאמן מתחלפת לאחר שניה.
   * יש רענון לא מוסבר לדף").
   *
   * So the line is not rendered until the sources the rules actually read
   * have answered, and the first message chosen after that is LATCHED for
   * the visit. Leaving the hero without a coach line for a moment is
   * invisible; swapping the sentence under the reader's eye is not.
   *
   * Latched into a REF during render rather than with an effect, for two
   * reasons: the hook would have to sit here, below this component's early
   * return (the repo has a test for exactly that), and a setState would cost
   * a second render to show a line we already have. The write is idempotent
   * — it only ever fills an empty slot. `coachLatchRef` is cleared on blur
   * by the focus effect up with the others, so a return to the tab
   * recomputes against whatever is true then.
   */
  const coachReady = gamesLoaded && playedCount !== null && groupsHydrated;
  if (coachReady && !coachLatchRef.current && assistantMessage) {
    coachLatchRef.current = assistantMessage;
  }
  const coachMessage = coachReady ? coachLatchRef.current : null;

  // `handleAssistantCta` is gone with the card that carried it.
  //
  // The coach's line is the hero's subtitle now — a sentence, not a surface —
  // and a subtitle has nowhere to put a button. The rules still emit a `cta`
  // and nothing reads it; that is deliberate rather than overlooked, so the
  // rule set does not have to be rewritten if the card ever comes back.

  // The user's communities split into the ones they OPENED (founder) vs
  // Pre-compute the share invite handler once.
  const handleShareInvite = async () => {
    if (!user) return;
    // Generic "invite to the app" — lands on the home/download page and
    // credits the inviter (invitedBy), WITHOUT pushing a specific
    // community/game. The old behaviour shared the user's first community.
    const link = await createShortInviteUrl({
      type: 'app',
      invitedBy: user.id,
      fallbackLong: deepLinkService.buildAppInviteUrl(user.id),
    });
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
        // NO separate "תארי עונה" row. It shipped in 1.1.11 as its own way in
        // to the cabinet, and it was one way in too many: `AchievementsScreen`
        // ALREADY renders `SeasonTitlesShelf` (line 161 there), so the row
        // above lands on a screen that shows the titles anyway, and the two
        // entries sent people to overlapping places. Checked before removing,
        // as asked. `SeasonTitlesScreen` stays registered and reachable — the
        // shelf's own "הצג הכל" still opens it.
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
        // Referrals — moved here from the home body (Pulse: "→ לתפריט").
        ...(rcBool('feature_referrals')
          ? [
              {
                id: 'referrals',
                label: he.referralsScreenTitle,
                icon: 'person-add-outline' as const,
                onPress: () => nav.navigate('Referrals'),
                badge: referralCount || undefined,
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
        {authAction.sheet}
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
            // Opens the auth sheet over this card. It used to call `signOut()`,
            // which is how the only control on the guest's own tab froze the
            // app: the anonymous session went away, nothing replaced it, and
            // RootNavigator had no branch for "no user, no failure" — so the
            // splash stayed up until the app was force-closed. Nothing is
            // gated here, so there is no pending action: `requestAuth` asks
            // for an account and nothing else.
            onPress={() => {
              logEvent(AnalyticsEvent.GuestRegisterCtaTapped, {
                source: 'profile_guest_card',
              });
              authAction.requestAuth();
            }}
            fullWidth
            style={{ marginTop: spacing.lg }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
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
        {/* ① Hero — the controls that used to sit on a white strip, now on a
            floodlit pitch, with the greeting and the coach's line on it. The
            same menu / bell / logo / avatar, in the same places. */}
        <HomeHero
          user={user}
          greeting={greetWord}
          hasNotif={inboxCount > 0}
          onMenu={() => setMenuOpen(true)}
          onBell={() => {
            logEvent(AnalyticsEvent.RequestsInboxOpened, {
              count: inboxCount,
              source: 'profile',
            });
            nav.navigate('Requests');
          }}
          onAvatar={() => nav.navigate('ProfileEdit')}
          /* ② The coach's line IS the greeting's second row now.
             It used to be a plate of its own under a static "מוכן למשחק הבא?",
             so the hero carried a question that knows nothing stacked on a
             sentence that does. The owner asked for the sentence to take the
             question's place and for the plate to go; when no rule has
             anything to say the static line is still the fallback. */
          coachLine={coachMessage?.text ?? null}
        />

        <View style={styles.body}>

          {/* §22 — "your season ended". The one in-app place this is ever said.
              `announceSeasonClosed` has been writing a notification per
              participant since the feature shipped, deduped on the season id,
              and the app never showed a single one: there is no notifications
              feed (the header bell opens the REQUESTS inbox), so the only
              channel these docs had was push, and push for this type was never
              implemented. Seven sat unread in production.
              The notification doc is the source AND the dedupe — opening or
              dismissing marks it read, and a read one never comes back. */}
          {seasonClosed ? (
            <ScreenEntrance index={1}>
            <PressableScale
              style={styles.seasonClosedCard}
              pressedScale={motion.press.cardScale}
              haptic={false}
              onPress={() => {
                // NOT marked read, and NOT cleared.
                //
                // It used to be both, so opening the summary once removed the
                // way back to it: "הוא היה מפה מקודם, לחצתי עליו והוא נעלם".
                // The 48-hour window is what retires this card now
                // (`getUnreadSeasonClose`), and a window is a better rule than
                // a one-shot latch for something a player will want to look at
                // more than once in the two days after a season ends. §22 asked
                // that the card not nag for ever; it does not — it expires.
                nav.navigate('SeasonSummary', {
                  groupId: seasonClosed.groupId,
                  seasonId: seasonClosed.seasonId,
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={he.homeSeasonClosedCta}
            >
              <View style={styles.justPlayedText}>
                <Text style={styles.seasonClosedTitle}>
                  {he.homeSeasonClosedTitle(seasonClosed.seasonNo)}
                </Text>
                <Text style={styles.seasonClosedBody}>
                  {he.homeSeasonClosedBodyOf(seasonClosed.groupName)}
                </Text>
                <View style={styles.justPlayedCtaRow}>
                  <Text style={styles.seasonClosedCta}>{he.homeSeasonClosedCta}</Text>
                  <Text style={styles.justPlayedCtaEmoji}>🏆</Text>
                </View>
              </View>
              {/* NO dismiss X. It existed because the card otherwise stayed
                  until it was opened; `getUnreadSeasonClose` now stops
                  returning it 48 hours after the close, so the card retires
                  itself and the X is one control fewer on a card whose whole
                  body is already a button. (Owner, 22.09.) */}
            </PressableScale>
            </ScreenEntrance>
          ) : null}

          {/* ③ The round area — one decision, up to three cards.
              `pickHomeRound` chooses the layout and `deriveRoundState` the
              state inside the upcoming card; both are pure and tested. The
              upcoming round always leads: a finished evening never outranks
              one the player can still act on. */}
          {roundLayout.upcoming && roundState ? (
            <NextGameCardEntrance triggerKey={roundLayout.upcoming.id}>
              <UpcomingRoundCard
                game={roundLayout.upcoming}
                state={roundState}
                clubName={
                  myCommunities.find((c) => c.id === roundLayout.upcoming!.groupId)?.name
                }
                actions={roundActions}
                busy={joiningId === roundLayout.upcoming.id}
                now={nowMs}
              />
            </NextGameCardEntrance>
          ) : null}

          {roundLayout.completed && roundLayout.completedRole ? (
            <ScreenEntrance index={1}>
              <CompletedRoundCard
                game={roundLayout.completed}
                clubName={
                  myCommunities.find((c) => c.id === roundLayout.completed!.groupId)?.name
                }
                role={roundLayout.completedRole}
                onSummary={roundActions.onSummary}
              />
            </ScreenEntrance>
          ) : null}

          {/* Shown only once the game queries have answered — otherwise the
              screen flashes "no upcoming round" for the half second before
              one arrives. */}
          {roundLayout.showEmpty && gamesLoaded ? (
            <NoRoundCard onCreate={roundActions.onCreate} onFind={roundActions.onFind} />
          ) : null}

          {/* ④ Three action tiles — the quick actions, straight under the
              hero card, because these are what most visits are for. */}
          <HomeActionTiles
            onOpen={() => {
              logEvent(AnalyticsEvent.HomeActionTileTapped, {
                tile: 'create',
                source: 'profile',
              });
              nav.navigate('GameTab', {
                screen: 'GamesList',
                params: { openCreate: true },
              });
            }}
            onAvailability={() => {
              logEvent(AnalyticsEvent.HomeActionTileTapped, {
                tile: 'availability',
                source: 'profile',
              });
              nav.navigate('AvailabilityEdit');
            }}
            onJoin={() => {
              logEvent(AnalyticsEvent.HomeActionTileTapped, {
                tile: 'join',
                source: 'profile',
              });
              nav.navigate('GameTab');
            }}
          />

          {/* ⑤ The week's availability AND the opening recommendation —
              ONE card. They used to be two: a banner naming the busiest day,
              and directly beneath it a podium in which that same day already
              wore a star. One fact, stated once.

              The recommendation keeps its day's CHRONOLOGICAL place in the
              row; `best` buys it a colour and a badge, never a position. */}
          {availCardEnabled && podium.length > 0 ? (
            <HomeAvailabilityPanel
              days={podium}
              maxCount={podiumMax}
              recommended={recommended}
              onShowWeek={() => nav.navigate('AvailabilityWeek')}
              onPressRecommended={() => {
                if (!recommended) return;
                logEvent(AnalyticsEvent.AvailabilityDayPicked, {
                  dateMs: recommended.dateMs,
                  window: 'evening',
                  source: 'home_recommended',
                  ...(availData?.viewerCity
                    ? { city: availData.viewerCity }
                    : {}),
                });
                (
                  nav as { navigate: (s: string, p?: unknown) => void }
                ).navigate('GameTab', {
                  screen: 'GameCreate',
                  params: {
                    quick: true,
                    prefillDateMs: recommended.dateMs,
                    prefillWindow: 'evening',
                    prefillCity: availData?.viewerCity ?? undefined,
                    inviteAvailable: true,
                  },
                });
              }}
              onPickDay={(dateMs) => {
                logEvent(AnalyticsEvent.AvailabilityDayPicked, {
                  dateMs,
                  window: 'evening',
                  source: 'home_podium',
                  ...(availData?.viewerCity
                    ? { city: availData.viewerCity }
                    : {}),
                });
                (
                  nav as { navigate: (s: string, p?: unknown) => void }
                ).navigate('GameTab', {
                  screen: 'GameCreate',
                  params: {
                    quick: true,
                    prefillDateMs: dateMs,
                    prefillWindow: 'evening',
                    prefillCity: availData?.viewerCity ?? undefined,
                    inviteAvailable: true,
                  },
                });
              }}
            />
          ) : !markedAvailability ? (
            // No availability marked → keep nudging the key action.
            <AvailabilityPromptCard
              onSetAvailability={() => {
                logEvent(AnalyticsEvent.AvailabilityPromptTapped, {
                  source: 'home_prompt_card',
                });
                nav.navigate('AvailabilityEdit');
              }}
            />
          ) : null}

          {/* Activation checklist — ALWAYS shown while incomplete (once data
              loaded, to avoid a first-paint flash), but positioned low: below
              the hero and the primary create/mark actions, since those are more
              relevant than a setup nudge. */}
          {homeDataReady && !checklistComplete ? (
            <OnboardingChecklist items={checklistItems} />
          ) : null}

          {/* Rotating "ידעת ש..." feature-discovery tip — passive, so it sits
              below the actionable content. */}
          <DidYouKnowCard tips={homeTips} />
          {/* Referrals moved OFF the home body into the ☰ menu (Pulse request). */}

          {/* ⑧ Invite friends. */}
          <Pressable
            onPress={handleShareInvite}
            style={({ pressed }) => [
              styles.inviteCta,
              pressed && { opacity: 0.92 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={he.profileInviteFriendsCta}
          >
            {/* Blue into violet, left to right. The only gradient CTA on the
                screen, which is what lets it close the page without competing
                with the next-game button above it. */}
            <LinearGradient
              colors={['#2563EB', '#6D28D9']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Text style={styles.inviteCtaText}>
              {he.profileInviteFriendsCta}
            </Text>
            <Ionicons name="share-social-outline" size={18} color="#FFFFFF" />
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

      {/* DEV-ONLY: animation lab (preview/record product animations). Never
          renders in a production build (__DEV__ is false there). */}
      {__DEV__ && !SCREENSHOT_MODE ? (
        <>
          <Pressable style={styles.labFab} onPress={() => setShowLab(true)}>
            <Text style={styles.labFabTxt}>🎬</Text>
          </Pressable>
          <AnimationLab visible={showLab} onClose={() => setShowLab(false)} />
        </>
      ) : null}
    </View>
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
    // A very light cool blue rather than the app's neutral `bg`. Every card
    // on this screen is white, and white on near-white leaves them with no
    // edge of their own; this is the one screen whose ground is tinted.
    backgroundColor: '#F2F6FC',
  },
  labFab: {
    position: 'absolute',
    bottom: 90,
    left: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#0B1B3B',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
    zIndex: 50,
  },
  labFabTxt: { fontSize: 20 },
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
    // Clears the bottom tab bar so the invite CTA is never half-hidden
    // behind it on a tall phone.
    paddingBottom: spacing.xxxxl,
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
    // Pulled UP over the hero's bottom edge so the next-game card sits ON the
    // pitch rather than below a seam. The hero carries matching bottom
    // padding, so the overlap costs no content — it is the same gap, shared.
    marginTop: -spacing.xxl,
  },
  // "איך היה אתמול?" — the 24h door back into the evening summary. Text first,
  // Same radius and the same soft shadow as every other card on the screen —
  // it used to be a flat tinted rectangle with a hard border, which read as a
  // notice pinned over the page rather than part of it. The green stays: it
  // is what says "this one is about an evening that already happened".
  justPlayedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#ECFDF5',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#A7F3D0',
    borderRadius: 20,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  justPlayedText: { flex: 1, gap: 2 },
  justPlayedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#065F46',
    // Not `'right'`: under forceRTL that resolves to the visual LEFT, and
    // `writingDirection` applies the same swap a second time. The card shipped
    // with its title and link hugging the left and a user sent a screenshot of
    // it. See theme/rtl.ts.
    textAlign: RTL_LABEL_ALIGN,
  },
  justPlayedBody: {
    fontSize: 13,
    color: '#047857',
    textAlign: RTL_LABEL_ALIGN,
  },
  // Link + ball on one row. Under forceRTL the first child takes the visual
  // RIGHT, so the label reads first and the ball trails it on the left.
  justPlayedCtaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  justPlayedCta: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F766E',
    textAlign: RTL_LABEL_ALIGN,
  },
  justPlayedCtaEmoji: { fontSize: 16 },
  // The season-close card. Amber rather than the green of "you just played":
  // one is about a night that happened, the other about a competition that
  // ended, and two identical cards stacked would read as one repeated.
  seasonClosedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  seasonClosedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#92400E',
    textAlign: RTL_LABEL_ALIGN,
  },
  seasonClosedBody: { fontSize: 13, color: '#B45309', textAlign: RTL_LABEL_ALIGN },
  seasonClosedCta: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B45309',
    textAlign: RTL_LABEL_ALIGN,
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
    // Plain `row`, not `row-reverse`. Under forceRTL the first child lands on
    // the visual RIGHT, so writing the label first and the icon second puts
    // the icon on the LEFT — which is where it was, and where QA wanted it.
    // The old `row-reverse` reversed an already-reversed row to reach the
    // same place by going round twice.
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: 999,
    // Clips the absolutely-positioned gradient to the pill. The flat colour
    // underneath is what shows if the gradient ever fails to draw.
    overflow: 'hidden',
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
