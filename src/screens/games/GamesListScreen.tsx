// Sectioned rounds feed: my rounds first, upcoming registration, then discovery.
// Club photos and personal status live on the cards; registration stays in the services.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  useScrollToTop,
} from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Button } from '@/components/Button';
import { MatchCardSkeleton } from '@/components/anim/MatchCardSkeleton';
import { AppearItem } from '@/components/anim/AppearItem';
import { joinLocation } from '@/utils/format';
import { BouncingBall } from '@/components/anim/BouncingBall';
import { toast } from '@/components/Toast';
import { appAlert } from '@/components/AppDialog';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { RegistrationConflictModal } from '@/components/games/RegistrationConflictModal';
import { AvailabilityNudgeModal } from '@/components/AvailabilityNudgeModal';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { guestJoinGameRequest } from '@/services/guestJoin';
import type { RegistrationConflict } from '@/services/gameService';
import {
  MatchListCard,
  type MatchCardCta,
} from '@/components/match/MatchListCard';
import { MatchesHero } from '@/components/match/MatchesHero';
import { MatchEmptyHintCard } from '@/components/match/MatchEmptyHintCard';
import { AreaDemandCard } from '@/components/games/AreaDemandCard';
import { NearbyClubsSection } from '@/components/games/NearbyClubsSection';
import { feedDensity, gamesFeedConfig } from '@/config/gamesFeedDiscovery';
import { availabilityFeedService } from '@/services/availabilityFeedService';
import { invalidateNearbyClubs } from '@/services/nearbyClubsService';
import { UpcomingScheduledGameCard } from '@/components/home/UpcomingScheduledGameCard';
import {
  GameFilterSheet,
  EMPTY_GAME_FILTERS,
  applyGameFilters,
  activeFiltersCount,
  type GameFilters,
  type GameApplyContext,
} from '@/components/GameFilterSheet';
import {
  resolveNearbyLocation,
  promptLocationDenied,
  type NearbyLocation,
} from '@/utils/nearby';
import { gameService } from '@/services/gameService';
import { logError } from '@/services/errorLog';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { rcBool, useRemoteConfig } from '@/services/remoteConfigService';
import {
  isVisibleInMyGames,
  isVisibleInOpenGames,
} from '@/services/gameLifecycle';
import { storage } from '@/services/storage';
import { Game, type TimeBucket } from '@/types';
import { mergeRoundCovers, resolveRoundCover, type RoundCoverCache } from '@/utils/roundFeedCovers';
import { spacing, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { getInboxCount } from '@/services/requestsService';
import { groupService } from '@/services/groupService';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'GamesList'>;

type Tab = 'mine' | 'open';

export function GamesListScreen() {
  useRemoteConfig(); // re-render when feature flags activate
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<GameStackParamList, 'GamesList'>>();
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);

  // "Mark your available days" nudge — shown once (then snoozed 3 days) to a
  // logged-in user who hasn't set any preferredDays, so the app can suggest
  // matching games. Stays dismissed for good once they set their days.
  const [availNudge, setAvailNudge] = useState(false);
  const availNudgeCheckedRef = useRef(false);
  useEffect(() => {
    if (availNudgeCheckedRef.current || !user) return;
    availNudgeCheckedRef.current = true;
    if ((user.availability?.preferredDays?.length ?? 0) > 0) return;
    (async () => {
      const last = await storage.getAvailNudgeLastShownAt();
      const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
      if (last && Date.now() - last < SNOOZE_MS) return;
      setAvailNudge(true);
      await storage.setAvailNudgeLastShownAt(Date.now());
    })();
  }, [user]);

  // Tracks the deferred post-join reconcile timer so it's cancelled on
  // unmount — otherwise a quick navigate-away leaves a setTimeout that fires
  // reload() (a setState) on an unmounted screen.
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
    },
    [],
  );

  const scrollRef = useRef<ScrollView>(null);
  // React 19's useRef returns RefObject<T|null>; useScrollToTop's older
  // type signature expects non-null. Safe to cast — the hook itself
  // null-checks before calling .scrollTo(). Drops when React Navigation
  // updates its types for React 19.
  useScrollToTop(scrollRef as React.RefObject<ScrollView>);

  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();

  const [myGames, setMyGames] = useState<Game[]>([]);
  const [communityGames, setCommunityGames] = useState<Game[]>([]);
  const [openGames, setOpenGames] = useState<Game[]>([]);
  // Scheduled ("בקרוב") games in my communities — registration not yet open.
  const [scheduledUpcoming, setScheduledUpcoming] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  // Tracks pull-to-refresh ONLY. The native RefreshControl spinner
  // and our SoccerBallLoader used to share `loading`, which made
  // both show simultaneously on initial load (the screenshot bug).
  // Splitting the two states keeps them mutually exclusive: native
  // spinner only when the user pulls down, custom loader only on
  // first load / re-load with empty list.
  const [refreshing, setRefreshing] = useState(false);
  const [busyGameId, setBusyGameId] = useState<string | null>(null);
  // Header bell badge — pending friend/community/game requests. Refreshed on
  // focus (cheap aggregation; see requestsService).
  const [requestCount, setRequestCount] = useState(0);
  useEffect(() => {
    const fetchCount = () => {
      if (user) getInboxCount(user.id).then(setRequestCount).catch(() => {});
    };
    fetchCount();
    return nav.addListener('focus', fetchCount);
  }, [nav, user]);
  // Soft-confirm for cancellations past the cancel-deadline window.
  // Holds the target game so onConfirm knows what to cancel.
  const [lateCancelGame, setLateCancelGame] = useState<Game | null>(null);
  // Overlap popup: when a join is refused because the user is already
  // booked into a clashing game, we show the conflict modal (the same
  // one MatchDetails uses) instead of a toast that's easy to miss.
  const [conflict, setConflict] = useState<{
    info: RegistrationConflict;
    target: Game;
  } | null>(null);
  const [cancelOtherBusy, setCancelOtherBusy] = useState(false);

  const [clubsOnly, setClubsOnly] = useState(false);
  const [publicCovers, setPublicCovers] = useState<RoundCoverCache>({ ownerId: null, covers: {} });
  const [filters, setFilters] = useState<GameFilters>(EMPTY_GAME_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // "Near me" location — resolved (GPS, with city fallback) only while the
  // filter is on. Held null when off so re-toggling re-prompts.
  const [nearbyLoc, setNearbyLoc] = useState<NearbyLocation | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  useEffect(() => {
    if (!filters.nearby) {
      setNearbyLoc(null);
      return;
    }
    let alive = true;
    (async () => {
      setNearbyLoading(true);
      const loc = await resolveNearbyLocation(user?.availability?.preferredCity);
      if (!alive) return;
      // Require location permission for "near me" — otherwise the list
      // would silently show nothing. Prompt + turn the toggle back off.
      if (!loc.granted) {
        // Close the filter sheet first — the styled alert is a Modal and
        // can't render over the (also-Modal) sheet on Android.
        setFilterOpen(false);
        setNearbyLoc(null);
        setNearbyLoading(false);
        setFilters((f) => ({ ...f, nearby: false }));
        promptLocationDenied(loc.canAskAgain);
        return;
      }
      setNearbyLoc(loc);
      setNearbyLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [filters.nearby, user?.availability?.preferredCity]);

  // First-run hint pointing at the FAB. Surfaces once per device,
  // dismissible, never blocks taps on the FAB itself.
  const [hintVisible, setHintVisible] = useState(false);
  useEffect(() => {
    storage.getHintCreateGameSeen().then((seen) => {
      if (!seen) setHintVisible(true);
    });
  }, []);
  const dismissHint = () => {
    setHintVisible(false);
    storage.setHintCreateGameSeen();
  };

  const reload = useCallback(
    async (opts: { pullToRefresh?: boolean } = {}) => {
      if (!user) return;
      if (opts.pullToRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      try {
        const myCommunityIds = myCommunities.map((g) => g.id);
        const [a, b, c, d] = await Promise.all([
          // getMyLiveOrUpcomingGames (not getMyGames): the latter is
          // `status==='open'` only, so a game that went 'active' (live),
          // 'locked', or was created 'scheduled' fell out of "המחזורים שלי".
          // For a one-time PRIVATE game (in the user's hidden personal
          // group) there's no community feed to fall back to, so it vanished
          // entirely. This variant keeps scheduled|open|locked|active; the
          // render layer already allows them (isVisibleInMyGames = non-
          // terminal), and the open-only community/open sections below can't
          // duplicate the non-open games this adds.
          gameService.getMyLiveOrUpcomingGames(user.id),
          gameService.getCommunityGames(user.id, myCommunityIds),
          gameService.getOpenGames(user.id, myCommunityIds),
          gameService.getMyUpcomingScheduledGames(user.id, myCommunityIds),
        ]);
        setMyGames(a);
        setCommunityGames(b);
        setOpenGames(c);
        setScheduledUpcoming(d);
        const uids = Array.from(
          new Set(
            [...a, ...b, ...c].flatMap((g) => [
              ...g.players,
              ...g.waitlist,
              ...(g.pending ?? []),
            ]),
          ),
        );
        if (uids.length > 0) hydratePlayers(uids);
        return { mine: a, community: b, open: c };
      } catch (err) {
        logError('reloadGamesList', err, {
          screen: 'GamesListScreen',
          userId: user.id,
          pullToRefresh: !!opts.pullToRefresh,
        });
        if (__DEV__) console.warn('[gamesList] reload failed', err);
        return undefined;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user, myCommunities, hydratePlayers],
  );

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    reload();
  }, [reload]);

  // The "+" offers a quick (no-community) game as the primary path, with
  // the community game as the secondary choice. Quick is the headline:
  // create + play without setting up a community.
  //
  // We used to open Alert.alert here, but that surfaced as a native
  // OS dialog with three flat buttons — felt like an error / off-
  // brand. The replacement is a centred modal with two big tappable
  // cards that double as the choice + the explanation, matching the
  // visual language of the onboarding cards.
  const [createSheetVisible, setCreateSheetVisible] = useState(false);
  const handleCreate = () => {
    // A guest OPENS the wizard. The gate used to sit here, which meant somebody
    // without an account never saw the form at all — and the draft work in
    // GameCreateScreen would have been unreachable. The boundary belongs at
    // SAVE, where the person has decided what they want and there is something
    // worth preserving.
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'chooser',
      source: 'games_list_fab',
    });
    setCreateSheetVisible(true);
  };

  // Home quick-action ("צור מחזור") routes here with openCreate:true so the
  // same chooser the FAB shows opens — one consistent create entry point
  // instead of the home CTA jumping straight into the quick-game wizard.
  useEffect(() => {
    if (route.params?.openCreate) {
      handleCreate();
      // Clear the param so returning to the tab later doesn't re-pop it.
      nav.setParams({ openCreate: undefined } as never);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.openCreate]);

  // Returns true if "now" is inside the cancel-deadline danger
  // window (e.g. < 12h before kickoff with a 12h deadline). The
  // service no longer hard-blocks late cancels; we ask once.
  const isPastCancelDeadline = (g: Game): boolean => {
    if (!g.cancelDeadlineHours || g.cancelDeadlineHours <= 0) return false;
    if (typeof g.startsAt !== 'number') return false;
    return Date.now() > g.startsAt - g.cancelDeadlineHours * 60 * 60 * 1000;
  };

  const runCancel = async (game: Game) => {
    if (!user) return;
    setBusyGameId(game.id);
    try {
      await gameService.cancelGameV2(game.id, user.id);
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[gamesList] late-cancel failed', err);
      toast.error(he.error);
    } finally {
      setBusyGameId(null);
    }
  };

  const handleCardPrimary = async (game: Game, cta: MatchCardCta) => {
    if (!user || cta === 'none' || cta === 'pending') return;
    // Soft-confirm late cancellations. Only the cancel CTA goes
    // through the modal — `leaveWaitlist` is harmless, no prompt.
    if (cta === 'cancel' && isPastCancelDeadline(game)) {
      setLateCancelGame(game);
      return;
    }
    // Cancelling from the card used to be a single unguarded tap: one press on
    // a small control in a scrolling list and the registration was gone, with
    // the game details screen never opened. Ask first — and only here, so the
    // late-cancel modal above still owns its own case rather than stacking two
    // prompts. `leaveWaitlist` stays unprompted: a waitlist place is not a
    // confirmed spot, and it is what the card's own copy already says.
    if (cta === 'cancel') {
      appAlert(he.leaveGameConfirmTitle, he.leaveGameConfirmBody, [
        { text: he.cancel, style: 'cancel' },
        {
          text: he.matchMenuLeave,
          style: 'destructive',
          onPress: () => void runCancel(game),
        },
      ]);
      return;
    }
    // ── The gate this screen never had ────────────────────────────────────
    //
    // A guest may browse this feed, and joining needs an identity. There was
    // no `isGuest` check anywhere in this file, so the tap below went straight
    // to `requestJoinGame` with an anonymous uid — the one join surface in the
    // app that knew nothing about the contextual auth built for exactly this.
    // And it is the commoner of the two: the matches tab is a root, and Home's
    // "לכל המחזורים" lands here.
    //
    // Same request object as MatchDetails, so they cannot drift again. The
    // coordinator parks the intent, the sheet opens in place, and the resumer
    // asks the server fresh afterwards — which is what makes a game that
    // filled up during the sign-in come back as a waitlist rather than a
    // success that never happened.
    if (isGuest && (cta === 'join' || cta === 'requestJoin' || cta === 'waitlist')) {
      void authAction.request(guestJoinGameRequest(game.id));
      return;
    }
    setBusyGameId(game.id);
    try {
      if (cta === 'join' || cta === 'requestJoin' || cta === 'waitlist') {
        // Surface the outcome — the card join was silent (user report), so a
        // user who landed on the WAITLIST (e.g. a full game holding a spot for
        // a pending promotion) had no idea they weren't actually in the roster.
        const { bucket } = await gameService.requestJoinGame(game.id, user.id, 'games_list');
        toast.success(
          bucket === 'waitlist'
            ? he.toastGameJoinedWaitlist
            : bucket === 'pending'
              ? he.toastGameJoinedPending
              : he.toastGameJoined,
        );
        // The fair-queue reconciler seats the user ASYNC (a Cloud Function,
        // ~1-2s). A single immediate reload races it, reads the pre-seating
        // snapshot, and the card looks unchanged / the count doesn't move
        // (user report) — unlike MatchDetails, which reflects it via its
        // realtime listener. Optimistically patch the card in-place now (zero
        // extra reads — this is the read-cost branch), then reconcile after
        // the reconciler has had time to commit.
        const me = user.id;
        const patch = (g: Game): Game => {
          if (g.id !== game.id) return g;
          if (
            g.players.includes(me) ||
            g.waitlist.includes(me) ||
            (g.pending ?? []).includes(me)
          ) {
            return g; // already reflected
          }
          const next: Game = {
            ...g,
            participantIds: Array.from(
              new Set([...(g.participantIds ?? []), me]),
            ),
          };
          if (bucket === 'players') next.players = [...g.players, me];
          else if (bucket === 'waitlist') next.waitlist = [...g.waitlist, me];
          else next.pending = [...(g.pending ?? []), me];
          return next;
        };
        setMyGames((prev) => prev.map(patch));
        setCommunityGames((prev) => prev.map(patch));
        setOpenGames((prev) => prev.map(patch));
        // Reconcile once the reconciler has committed (also re-categorises the
        // game into "שלי"). Fire-and-forget; by then the server matches the
        // optimistic state, so there's no flicker.
        if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = setTimeout(() => {
          reconcileTimerRef.current = null;
          void reload();
        }, 2500);
      } else if (cta === 'leaveWaitlist') {
        // Only the waitlist case reaches here now — a real cancel is confirmed
        // above and then runs through `runCancel`.
        await gameService.cancelGameV2(game.id, user.id);
        await reload();
      }
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'REGISTRATION_CONFLICT') {
        // The user is already registered to a clashing game. Pop the
        // conflict modal (cancel-other / view-other) so they can resolve
        // it in place — the old top toast was easy to miss and gave no
        // way to act. Fall back to the toast only if the error somehow
        // arrived without its conflict payload.
        const info = (err as { conflict?: RegistrationConflict }).conflict;
        if (info) {
          setConflict({ info, target: game });
        } else {
          toast.info(he.registrationConflictTitle);
        }
      } else if (code === 'GAME_JOIN_REJECTED') {
        // Expected: an organizer-rejected user re-tapped join. Same friendly
        // top-toast as MatchDetails (user report: show it here too), NOT an
        // error — it's normal product behaviour, not a failure.
        toast.info(he.matchDetailsJoinRejected);
      } else if (
        code === 'GAME_NOT_OPEN' ||
        code === 'GAME_STARTED' ||
        code === 'GAME_LIVE'
      ) {
        // Stale list/deep-link raced the game's lifecycle. Soft toast, no log.
        toast.info(he.gameNotJoinableToast);
      } else {
        // Non-conflict failure. The underlying service (joinGameV2 /
        // cancelGameV2) self-logs the op, but capture the SCREEN
        // context (which card + cta) so the admin panel ties the
        // failure to this list interaction.
        logError('gamesListAction', err, {
          screen: 'GamesListScreen',
          cta,
          gameId: game.id,
          userId: user.id,
        });
        if (__DEV__) console.warn('[gamesList] action failed', err);
      }
    } finally {
      setBusyGameId(null);
    }
  };

  const sortByStart = (a: Game, b: Game) => a.startsAt - b.startsAt;

  // "Near me" context for the discovery list. While location is still
  // resolving we pass an empty ctx so nothing matches yet (predictable,
  // like the communities feed).
  const gameCtx: GameApplyContext = useMemo(
    () => ({
      nearbyLatLng: nearbyLoc?.latLng ?? undefined,
      nearbyCityFallback: nearbyLoc?.city ?? undefined,
    }),
    [nearbyLoc],
  );
  // When "near me" is on but the location isn't ready, suppress the radius
  // filter on the discovery list (it would otherwise hide everything).
  const restFilters = useMemo(
    () =>
      filters.nearby && (nearbyLoading || !nearbyLoc)
        ? { ...filters, nearby: false }
        : filters,
    [filters, nearbyLoading, nearbyLoc],
  );

  // Single sectioned list (like Communities): the games I'm registered to on
  // top, everything else below — no tabs. "Near me" is a DISCOVERY filter, so
  // it applies to the rest list only — my own games always show regardless of
  // distance (`nearby: false` for mine).
  // Games shown in the "בקרוב" teaser section (registration not yet open) must
  // NOT also appear in "המחזורים שלי"/"פתוחים" — otherwise a scheduled game the
  // user is registered to shows twice (user report). "בקרוב" wins.
  const scheduledIds = useMemo(
    () => new Set(scheduledUpcoming.map((g) => g.id)),
    [scheduledUpcoming],
  );
  const mineList = useMemo(
    () =>
      applyGameFilters(
        myGames.filter((g) => isVisibleInMyGames(g) && !scheduledIds.has(g.id) &&
          (!clubsOnly || myCommunities.some((club) => club.id === g.groupId))),
        {
          ...filters,
          nearby: false,
        },
      ).sort(sortByStart),
    [myGames, filters, scheduledIds, clubsOnly, myCommunities],
  );
  const restList = useMemo(() => {
    const mineIds = new Set(mineList.map((g) => g.id));
    const set = new Map<string, Game>();
    [...communityGames, ...openGames]
      .filter((g) => isVisibleInOpenGames(g) && (!clubsOnly || myCommunities.some((club) => club.id === g.groupId)))
      .forEach((g) => {
        if (!mineIds.has(g.id) && !scheduledIds.has(g.id)) set.set(g.id, g);
      });
    return applyGameFilters(Array.from(set.values()), restFilters, gameCtx).sort(
      sortByStart,
    );
  }, [communityGames, openGames, restFilters, gameCtx, mineList, scheduledIds, clubsOnly, myCommunities]);

  // One public read per distinct non-member club per feed refresh. No private club reads.
  useEffect(() => {
    let active = true;
    if (!user?.id) return;
    const ownerId = user.id;
    const memberIds = new Set(myCommunities.map((g) => g.id));
    const ids = [...new Set([...myGames, ...communityGames, ...openGames]
      .map((g) => g.groupId).filter((id): id is string => !!id && !memberIds.has(id)))];
    Promise.allSettled(ids.map((id) => groupService.getPublic(id))).then((results) => {
      if (!active) return;
      setPublicCovers(previous => mergeRoundCovers(previous, ownerId, ids, results));
    });
    return () => { active = false; };
  }, [user?.id, myCommunities, myGames, communityGames, openGames]);
  const coverForGame = (g: Game) => resolveRoundCover(g.isOrphanContext ? undefined : g.groupId, myCommunities, publicCovers, user?.id ?? null);
  const scopedUpcoming = clubsOnly
    ? scheduledUpcoming.filter((g) => myCommunities.some((club) => club.id === g.groupId))
    : scheduledUpcoming;
  const filterCount = activeFiltersCount(filters) + Number(clubsOnly);
  // A community game needs a community the user admins. When they admin
  // none, the chooser's "community game" option is locked with a hint.
  const canCreateCommunityGame =
    !!user && myCommunities.some((g) => g.adminIds.includes(user.id));
  // Being in NO club and being in clubs you don't administer both fail the
  // check above, and they are not the same problem — one needs a club, the
  // other needs an admin. Telling a member of two clubs "you have no club"
  // reads as the app not knowing who they are.
  const hasAnyCommunity = myCommunities.length > 0;
  const isEmpty = mineList.length === 0 && restList.length === 0 && scopedUpcoming.length === 0;

  // ── How full does this tab feel, and what do we put underneath ─────────
  // While the app is growing there are stretches with few (or zero) public
  // matches, and the tab reads as "nothing happens here". Rather than three
  // screens we keep one and vary what sits BELOW the list: real demand from
  // declared availability, then clubs near the viewer. Thresholds live in
  // gamesFeedDiscovery (Remote Config backed) — see that file for the rules.
  //
  // The count includes the viewer's own matches and the "בקרוב" teasers, not
  // just the public ones: a screen already full of the viewer's own matches
  // doesn't need padding out.
  const feedCfg = gamesFeedConfig();
  const visibleGamesCount =
    mineList.length + restList.length + scopedUpcoming.length;
  const density = feedDensity(visibleGamesCount, feedCfg.richMin);
  // Filters hiding everything is a different problem with a different fix
  // ("clear the filter"), so that case keeps the original empty state rather
  // than pivoting the user to clubs.
  const filteredToNothing = isEmpty && filterCount > 0;
  // Discovery is supporting content: it appears only when real matches don't
  // already carry the screen, and always BELOW them.
  const showDiscovery = !filteredToNothing && density !== 'many';
  // Bumped by pull-to-refresh. Passed as a PROP, not a key: keying it
  // remounted both blocks, which threw away good content before the refetch
  // had produced any — so a refresh whose request then failed left an empty
  // padded box where the section had been (user report, iOS 1.0.97). As a prop
  // it refetches in place and what is on screen survives until new data lands.
  const [discoveryTick, setDiscoveryTick] = useState(0);

  const openCreateForSlot = (
    dateMs: number,
    window: TimeBucket,
    city: string | null,
  ) => {
    // Same reasoning as the FAB above: the wizard opens, the save gates.
    logEvent(AnalyticsEvent.GameCreateStarted, {
      stage: 'wizard',
      source: 'availability_slot',
      mode: 'quick',
      prefilled: true,
    });
    nav.navigate('GameCreate', {
      quick: true,
      prefillDateMs: dateMs,
      prefillWindow: window,
      prefillCity: city ?? undefined,
      inviteAvailable: true,
    });
  };

  // "בקרוב" — scheduled club matches whose registration hasn't opened yet.
  // Read-only teasers. They sit BELOW "המחזורים שלי": a match you're already
  // registered to is more urgent than one you can't even join yet (manager
  // request). Still shown when there's nothing joinable at all.
  const upcomingSection =
    !loading && scopedUpcoming.length > 0 ? (
      <View style={{ marginBottom: spacing.lg }}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{he.homeUpcomingSectionTitle}</Text>
          <View style={styles.sectionUnderline} />
        </View>
        <View style={styles.cardsList}>
          {scopedUpcoming.map((g, idx) => (
            <AppearItem key={g.id} index={idx}>
              <UpcomingScheduledGameCard
                game={g}
                communityName={myCommunities.find((c) => c.id === g.groupId)?.name}
                onOpen={(gameId) => nav.navigate('MatchDetails', { gameId })}
              />
            </AppearItem>
          ))}
        </View>
      </View>
    ) : null;

  const discovery = showDiscovery ? (
    <View style={styles.discovery}>
      <AreaDemandCard
        refreshTick={discoveryTick}
        onCreateGame={openCreateForSlot}
        onSetAvailability={() => nav.navigate('AvailabilityEdit')}
      />
      <NearbyClubsSection
        refreshTick={discoveryTick}
        radiusKm={feedCfg.clubsRadiusKm}
        limit={feedCfg.clubsMax}
        minMembers={feedCfg.clubsMinMembers}
        onOpenClub={(groupId) =>
          nav.navigate('CommunityDetailsPublic', { groupId })
        }
      />
    </View>
  ) : null;

  return (
    <View style={styles.root}>
      {/* The contextual auth sheet, for a guest who tapped Join on a card.
          Rendered here so it opens OVER the feed — the person never leaves
          the list they were reading. */}
      {authAction.sheet}
      {/* Header and quick filters stay above the scrolling feed. */}
      <MatchesHero onCreate={() => { if (hintVisible) dismissHint(); handleCreate(); }} />
      <View style={styles.controlsFloat}>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.quickFilters}>
          {[
            { label: he.roundFeedAll, active: !clubsOnly && !filters.nearby,
              press: () => { setClubsOnly(false); setFilters((f) => ({ ...f, nearby: false })); } },
            { label: he.roundFeedClubs, active: clubsOnly,
              press: () => { setClubsOnly((v) => !v); setFilters((f) => ({ ...f, nearby: false })); } },
            { label: he.roundFeedNearby, active: filters.nearby,
              press: () => { setClubsOnly(false); setFilters((f) => ({ ...f, nearby: !f.nearby })); } },
          ].map((chip) => <Pressable key={chip.label} onPress={chip.press} accessibilityRole="button"
            accessibilityState={{ selected: chip.active }} style={[styles.quickFilter, chip.active && styles.quickFilterActive]}>
            <Text style={[styles.quickFilterText, chip.active && { color: '#FFFFFF' }]}>{chip.label}</Text>
          </Pressable>)}
        </ScrollView>
        {/* The map button is OUT of this row too (owner, 28.09) — same call
            as the communities feed: the row carried three controls over one
            search field, and the field is what people reach for. Removed
            rather than hidden, because the payload it assembles (every open
            game, plus my clubs geocoded by city) came with it and a
            commented-out block that large rots. `GamesMap` and its route are
            untouched; restore this from git when the row has room. */}
        <Pressable
          onPress={() => {
            logEvent(AnalyticsEvent.GameFilterSheetOpened);
            setFilterOpen(true);
          }}
          style={({ pressed }) => [
            styles.filterBtn,
            filterCount > 0 && styles.filterBtnActive,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={he.gameFiltersButton}
        >
          <Ionicons
            name="options"
            size={20}
            color={filterCount > 0 ? '#FFFFFF' : '#1E40AF'}
          />
          {filterCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{filterCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => nav.navigate('Requests')}
          style={({ pressed }) => [styles.filterBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={he.requestsTitle}
        >
          <Ionicons name="notifications-outline" size={20} color="#1E40AF" />
          {requestCount > 0 ? (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{requestCount > 99 ? '99+' : requestCount}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              // A deliberate pull means "give me fresh everything" — drop the
              // discovery caches and remount those blocks so they refetch too,
              // instead of re-serving a snapshot up to 15 minutes old.
              availabilityFeedService.invalidate();
              invalidateNearbyClubs();
              setDiscoveryTick((n) => n + 1);
              reload({ pullToRefresh: true });
            }}
            tintColor="#3B82F6"
            colors={['#3B82F6']}
          />
        }
      >

        <View style={styles.body}>
          {loading && isEmpty ? (
            // Skeleton placeholder cards — shape-accurate so the
            // layout doesn't shove when the real cards land.
            <MatchCardSkeleton count={3} />
          ) : filteredToNothing ? (
            // A filter is hiding matches that exist — clearing it is the fix,
            // so keep the focused empty state instead of pivoting to clubs.
            <FullEmptyState
              tab="open"
              hasGamesInOtherTab={false}
              hasActiveFilters
              onCreate={handleCreate}
              onSwitchToOpen={handleCreate}
              onClearFilters={() => { setClubsOnly(false); setFilters(EMPTY_GAME_FILTERS); }}
            />
          ) : isEmpty ? (
            // Nothing open right now: one honest line instead of a big empty
            // state, then the discovery content so there's always a next step.
            <>
              <View style={styles.noOpenBox}>
                <Text style={styles.noOpenTitle}>{he.gamesNoOpenTitle}</Text>
                <Text style={styles.noOpenBody}>{he.gamesNoOpenBody}</Text>
              </View>
              {upcomingSection}
              <MatchEmptyHintCard onPress={handleCreate} />
              {discovery}
            </>
          ) : (
            <>
              {/* Section 1 — games I'm registered to (top). */}
              {mineList.length > 0 ? (
                <>
                  <View style={styles.sectionTitleRow}>
                    <Text style={styles.sectionTitle}>{he.matchesSectionMine}</Text>
                    <View style={styles.sectionUnderline} />
                  </View>
                  <View style={styles.cardsList}>
                    {mineList.map((g, idx) => (
                      <AppearItem key={g.id} index={idx}>
                        <MatchListCard
                          game={g}
                          cover={coverForGame(g)}
                          coverLoading={!!g.groupId && !g.isOrphanContext && coverForGame(g) === undefined}
                          userId={user?.id ?? ''}
                          busy={busyGameId === g.id}
                          onPrimary={(cta) => handleCardPrimary(g, cta)}
                        />
                      </AppearItem>
                    ))}
                  </View>
                </>
              ) : null}

              {upcomingSection}

              {/* Section 2 — everything else (below). */}
              {restList.length > 0 ? (
                <>
                  <View style={[styles.sectionTitleRow, mineList.length > 0 && { marginTop: spacing.lg }]}>
                    <Text style={styles.sectionTitle}>{he.matchesSectionOpen}</Text>
                    <View style={styles.sectionUnderline} />
                  </View>
                  <View style={styles.cardsList}>
                    {restList.map((g, idx) => (
                      <AppearItem key={g.id} index={idx}>
                        <MatchListCard
                          game={g}
                          cover={coverForGame(g)}
                          coverLoading={!!g.groupId && !g.isOrphanContext && coverForGame(g) === undefined}
                          userId={user?.id ?? ''}
                          busy={busyGameId === g.id}
                          onPrimary={(cta) => handleCardPrimary(g, cta)}
                        />
                      </AppearItem>
                    ))}
                    <MatchEmptyHintCard onPress={handleCreate} />
                  </View>
                </>
              ) : null}

              {/* Discovery sits BELOW every real match — a joinable match
                  always outranks demand, and demand outranks a club. */}
              {discovery}
            </>
          )}
        </View>
      </ScrollView>

      <GameFilterSheet
        visible={filterOpen}
        filters={filters}
        nearbyCaption={
          filters.nearby
            ? nearbyLoading
              ? he.locationResolving
              : nearbyLoc?.city ?? undefined
            : undefined
        }
        // Radius-preview map centre: resolved GPS first, else the user's
        // saved home city, else null (map hidden, pin shown instead).
        mapCenter={
          nearbyLoc?.latLng ??
          (typeof user?.availability?.homeCityLat === 'number' &&
          typeof user?.availability?.homeCityLng === 'number'
            ? {
                lat: user.availability.homeCityLat,
                lng: user.availability.homeCityLng,
              }
            : null)
        }
        hasAdditionalFilters={clubsOnly}
        matchCount={mineList.length + restList.length}
        onChange={(next) => {
          if (next === EMPTY_GAME_FILTERS) setClubsOnly(false);
          // Compare before/after counts so we can differentiate
          // applying a filter from clearing one.
          const before = activeFiltersCount(filters);
          const after = activeFiltersCount(next);
          if (after > before) {
            logEvent(AnalyticsEvent.GameFilterApplied, { count: after });
          } else if (after === 0 && before > 0) {
            logEvent(AnalyticsEvent.GameFilterCleared);
          }
          setFilters(next);
        }}
        onClose={() => setFilterOpen(false)}
      />

      <ConfirmDestructiveModal
        visible={!!lateCancelGame}
        title={he.lateCancelTitle}
        body={he.lateCancelBody(lateCancelGame?.cancelDeadlineHours ?? 0)}
        confirmLabel={he.lateCancelConfirm}
        onClose={() => setLateCancelGame(null)}
        onConfirm={async () => {
          const target = lateCancelGame;
          setLateCancelGame(null);
          if (target) await runCancel(target);
        }}
      />

      <RegistrationConflictModal
        conflict={conflict?.info ?? null}
        targetGroupId={conflict?.target.groupId}
        targetStartsAt={conflict?.target.startsAt}
        communities={myCommunities}
        cancelBusy={cancelOtherBusy}
        onCancelOther={async (conflictGameId) => {
          if (!user) return;
          setCancelOtherBusy(true);
          try {
            // Drop the user's registration in the clashing game, then
            // re-try the join they originally wanted so a single
            // "cancel other" tap actually lands them in the new game.
            await gameService.cancelGameV2(conflictGameId, user.id);
            const target = conflict?.target;
            if (target) {
              await gameService.requestJoinGame(target.id, user.id, 'games_list');
            }
            setConflict(null);
            const fresh = await reload();
            // Same read-after-write guard as handleCardPrimary: the join
            // we just committed can be missed by the immediate one-time
            // query, so the freshly-joined game showed up only after a
            // manual pull-to-refresh (QA report). If it isn't in any list
            // yet, wait a beat for the write to propagate and reload once.
            if (target && fresh) {
              const inAnyList =
                fresh.mine.some((g) => g.id === target.id) ||
                fresh.community.some((g) => g.id === target.id) ||
                fresh.open.some((g) => g.id === target.id);
              if (!inAnyList) {
                await new Promise((r) => setTimeout(r, 800));
                await reload();
              }
            }
            toast.success(he.registrationConflictResolved);
          } catch (e) {
            logError('gamesListConflictCancelOther', e, {
              screen: 'GamesListScreen',
              conflictGameId,
              userId: user.id,
            });
            toast.error(he.error);
          } finally {
            setCancelOtherBusy(false);
          }
        }}
        onViewOther={(conflictGameId) => {
          setConflict(null);
          nav.navigate('MatchDetails', { gameId: conflictGameId });
        }}
        onClose={() => setConflict(null)}
      />

      <AvailabilityNudgeModal
        visible={availNudge}
        onClose={() => setAvailNudge(false)}
        onConfirm={() => {
          setAvailNudge(false);
          // AvailabilityEdit lives in the Profile tab's stack — the tab
          // navigator is an ancestor, so this bubbles up correctly.
          (nav as unknown as { navigate: (t: string, p?: unknown) => void }).navigate(
            'ProfileTab',
            { screen: 'AvailabilityEdit' },
          );
        }}
      />

      {/* Custom create-game chooser. Replaces the native Alert with
          two big tappable cards — each describes its mode so the user
          picks confidently without dismissing the chooser to read the
          wizard. Same z-stack & dismiss semantics as a Modal. */}
      <Modal
        visible={createSheetVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setCreateSheetVisible(false)}
      >
        <Pressable
          style={createSheetStyles.backdrop}
          onPress={() => setCreateSheetVisible(false)}
        >
          <Pressable style={createSheetStyles.card} onPress={() => undefined}>
            <Text style={createSheetStyles.title}>
              {he.createGameChooseTitle}
            </Text>
            {rcBool('feature_quick_games') ? (
              <Pressable
                style={({ pressed }) => [
                  createSheetStyles.choice,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
                onPress={() => {
                  setCreateSheetVisible(false);
                  nav.navigate('GameCreate', { quick: true });
                }}
              >
                <View style={createSheetStyles.choiceIcon}>
                  <Ionicons name="flash" size={22} color="#1E40AF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={createSheetStyles.choiceTitle}>
                    {he.createGameChooseQuickTitle}
                  </Text>
                  <Text style={createSheetStyles.choiceBody}>
                    {he.createGameChooseQuickBody}
                  </Text>
                </View>
              </Pressable>
            ) : null}
            <Pressable
              disabled={!canCreateCommunityGame}
              style={({ pressed }) => [
                createSheetStyles.choice,
                !canCreateCommunityGame && createSheetStyles.choiceLocked,
                pressed &&
                  canCreateCommunityGame && {
                    opacity: 0.92,
                    transform: [{ scale: 0.99 }],
                  },
              ]}
              onPress={() => {
                if (!canCreateCommunityGame) return;
                setCreateSheetVisible(false);
                nav.navigate('GameCreate');
              }}
            >
              <View style={createSheetStyles.choiceIcon}>
                <Ionicons
                  name={canCreateCommunityGame ? 'people' : 'lock-closed'}
                  size={22}
                  color="#1E40AF"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={createSheetStyles.choiceTitle}>
                  {he.createGameChooseCommunityTitle}
                </Text>
                <Text style={createSheetStyles.choiceBody}>
                  {canCreateCommunityGame
                    ? he.createGameChooseCommunityBody
                    : hasAnyCommunity
                      ? he.createGameChooseCommunityNotAdmin
                      : he.createGameChooseCommunityLocked}
                </Text>
              </View>
            </Pressable>
            {/* No community yet → drive the user to create their first one. */}
            {!canCreateCommunityGame ? (
              <Pressable
                style={({ pressed }) => [
                  createSheetStyles.createCommunityCta,
                  pressed && { opacity: 0.9 },
                ]}
                onPress={() => {
                  setCreateSheetVisible(false);
                  (
                    nav as unknown as {
                      getParent?: () => {
                        navigate: (t: string, p?: unknown) => void;
                      } | undefined;
                    }
                  )
                    .getParent?.()
                    ?.navigate('CommunitiesTab', { screen: 'CommunitiesCreate' });
                }}
              >
                {/* Label first → rightmost under forceRTL; the plus closes
                    the row on its left, like every other CTA (owner, 02.10). */}
                <Text style={createSheetStyles.createCommunityCtaText}>
                  {hasAnyCommunity
                    ? he.createGameCreateOwnCommunityCta
                    : he.createGameCreateCommunityCta}
                </Text>
                <Ionicons name="add-circle-outline" size={20} color="#FFFFFF" />
              </Pressable>
            ) : null}
            <Pressable
              style={({ pressed }) => [
                createSheetStyles.cancelBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() => setCreateSheetVisible(false)}
            >
              <Text style={createSheetStyles.cancelText}>{he.cancel}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const createSheetStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  choiceLocked: { opacity: 0.55 },
  createCommunityCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: '#1E40AF',
    borderRadius: 14,
    paddingVertical: spacing.md,
  },
  createCommunityCtaText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  choiceIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(59,130,246,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: 2,
  },
  choiceBody: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    textAlign: RTL_LABEL_ALIGN,
  },
  cancelBtn: {
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
});

// ─── Empty state (no cards in the active tab) ───────────────────────────

function FullEmptyState({
  tab,
  hasGamesInOtherTab,
  hasActiveFilters,
  onCreate,
  onSwitchToOpen,
  onClearFilters,
}: {
  tab: Tab;
  hasGamesInOtherTab: boolean;
  /** True when a filter is hiding games that actually exist. */
  hasActiveFilters?: boolean;
  onCreate: () => void;
  onSwitchToOpen: () => void;
  onClearFilters?: () => void;
}) {
  return (
    <View style={emptyStyles.wrap}>
      <View style={emptyStyles.icon}>
        {/* Bouncing ball reads as "the app is alive, just nothing
            here yet" — much better than a static football icon. */}
        <BouncingBall size={64} color="#3B82F6" />
      </View>
      <Text style={emptyStyles.body}>
        {hasActiveFilters
          ? he.emptyHomeFilteredBody
          : hasGamesInOtherTab
            ? he.emptyHomeBody
            : he.emptyHomeNoGamesAnywhere}
      </Text>
      <View style={emptyStyles.actions}>
        {hasActiveFilters ? (
          // Filter is the cause — offer to clear it, not "create a game".
          <Button
            title={he.emptyHomeClearFilters}
            variant="primary"
            size="lg"
            iconLeft="close-circle-outline"
            onPress={onClearFilters}
            fullWidth
          />
        ) : (
          <>
            <Button
              title={he.emptyHomePrimary}
              variant="primary"
              size="lg"
              iconLeft="add-circle-outline"
              onPress={onCreate}
              fullWidth
            />
            {hasGamesInOtherTab && tab === 'mine' ? (
              <Button
                title={he.emptyHomeSecondary}
                variant="outline"
                size="lg"
                iconLeft="search-outline"
                onPress={onSwitchToOpen}
                fullWidth
              />
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  scroll: {
    paddingBottom: 24,
  },
  // Quick filters remain pinned below the compact header.
  quickFilters: { gap: 6, alignItems: 'center', paddingEnd: 4 },
  quickFilter: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 18, backgroundColor: '#E8EFFA', justifyContent: 'center' },
  quickFilterActive: { backgroundColor: '#2563EB' },
  quickFilterText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  controlsFloat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: 12,
    marginBottom: 12,
    zIndex: 2,
    elevation: 2,
  },
  filterBtn: {
    width: 40,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  filterBtnActive: {
    backgroundColor: '#1E40AF',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  // Section title row + blue underline indicator. `alignItems:
  // 'flex-start'` resolves to the visual RIGHT under forceRTL — the
  // same trick used on the Communities screen.
  sectionTitleRow: {
    paddingHorizontal: spacing.xs,
    alignItems: 'flex-start',
    gap: 4,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
  },
  sectionUnderline: {
    width: 36,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#3B82F6',
  },
  // "Nothing open right now" — a quiet header, not a full-screen empty state:
  // the discovery content below it is the real answer.
  noOpenBox: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.md,
    gap: 2,
  },
  noOpenTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  noOpenBody: {
    fontSize: 13,
    color: '#64748B',
    textAlign: RTL_LABEL_ALIGN,
    writingDirection: 'rtl',
  },
  discovery: { marginTop: spacing.lg, gap: spacing.lg },
  cardsList: {
    gap: spacing.md,
  },
  loadingWrap: {
    // Push the loader well down the screen so it lands roughly in
    // the visible empty area (below the hero + tabs + section title).
    // Full vertical centering is hard inside a ScrollView with a
    // sticky header above; this fixed offset gets us "looks
    // centered" on phones in the 6"–6.5" range.
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
  },


});

const emptyStyles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(59,130,246,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    maxWidth: 280,
  },
  actions: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
});
