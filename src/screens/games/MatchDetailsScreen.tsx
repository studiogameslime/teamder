// MatchDetailsScreen — read-mostly view of a single match.
//
// Five vertical bands, all left-aligned to the same 16dp gutter:
//
//   ① Header — large title, sub-line (📅 date · time + 📍 location),
//      hairline divider beneath.
//   ② Info grid — symmetric 2×2: format / players / surface / duration.
//   ③ Players — clean rows (avatar + name + status badge for guest /
//      admin) with subtle dividers, NOT pill buttons.
//   ④ Manage row — admin-only secondary link (organizer / coach).
//   ⑤ Sticky bottom CTA — outline-only red for cancel, full pill green
//      for join.

import React, { useEffect, useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
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
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { GuestModal } from '@/components/GuestModal';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { PlayerCountBar } from '@/components/PlayerCountBar';
import { CelebrationOverlay } from '@/components/anim/CelebrationOverlay';
import { successHaptic } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { MatchStadiumHero } from '@/components/match/MatchStadiumHero';
import { MatchStatsStrip } from '@/components/match/MatchStatsStrip';
import { MatchDetailsGrid } from '@/components/match/MatchDetailsGrid';
import {
  MatchParticipantsSection,
  // (FillerInterestsSection imported separately below — keeps the
  // existing match-component barrel pristine.)
  type ParticipantEntry,
} from '@/components/match/MatchParticipantsSection';
import { FillerInterestsSection } from '@/components/match/FillerInterestsSection';
import { PinnedAdminMessageCard } from '@/components/match/PinnedAdminMessageCard';
import { MatchFactsRow } from '@/components/match/MatchFactsRow';
import { gameService, type RegistrationConflict } from '@/services/gameService';
import { logError, logUnexpected } from '@/services/errorLog';
import { ratingsService } from '@/services/ratingsService';
import { maybeRequestStoreReview } from '@/services/storeReviewService';
import { useGameEvents } from '@/services/useGameEvents';
import {
  canCancelRegistration,
  canEditGame,
  canEnterLive,
  canJoinGame,
  isCancelled,
  isFinished,
  isOpen,
  isRoundRunning,
  isScheduled,
  isTerminal as isTerminalGame,
} from '@/services/gameLifecycle';
import { deepLinkService } from '@/services/deepLinkService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  getForecastFor,
  weatherIcon,
  type WeatherForecast,
} from '@/services/weatherService';
import {
  Game,
  GameFormat,
  FieldType,
  LiveMatchState,
  LiveMatchZone,
  UserId,
  toGuestRosterId,
} from '@/types';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDateShortYear, formatDayDate } from '@/utils/format';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { useGameStore } from '@/store/gameStore';
import type { GameStackParamList } from '@/navigation/GameStack';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchDetails'>;
type Params = RouteProp<GameStackParamList, 'MatchDetails'>;

type CardStatus = 'joined' | 'waitlist' | 'pending' | 'none';

function statusForUser(g: Game, uid: UserId): CardStatus {
  if (g.players.includes(uid)) return 'joined';
  if (g.waitlist.includes(uid)) return 'waitlist';
  if ((g.pending ?? []).includes(uid)) return 'pending';
  return 'none';
}

// Conflict-modal display: "{day-long} · DD/MM · HH:MM". Slashes
// give the right rhythm against the surrounding modal copy.
function formatDateLong(ms: number): string {
  return formatDayDate(ms, {
    dateSeparator: '/',
    withTime: true,
  });
}

// "DD.MM.YY" — used for the static "נוצר בתאריך" cell in the
// details grid. Compact enough to share a row with a label.
const formatShortDate = formatDateShortYear;

function formatLabel(f: GameFormat | undefined): string | null {
  if (f === '5v5') return he.gameFormat5;
  if (f === '6v6') return he.gameFormat6;
  if (f === '7v7') return he.gameFormat7;
  return null;
}

function fieldTypeLabel(f: FieldType): string {
  if (f === 'asphalt') return he.fieldTypeAsphalt;
  if (f === 'synthetic') return he.fieldTypeSynthetic;
  return he.fieldTypeGrass;
}

// ─── Session-state machine ───────────────────────────────────────────────
// Derived from the persisted `liveMatch.phase`, the registered roster
// vs. the minimum required to play, and a quick scan of player
// assignments. Drives the single primary CTA + the status pill at the
// top of the screen.
type SessionStatus =
  | 'waiting_for_players'
  | 'ready_to_create_teams'
  | 'teams_invalid'
  | 'teams_ready'
  | 'active';

/**
 * Minimum number of registered players (incl. guests) required before
 * teams can be generated. Honours the organizer's explicit override
 * (`game.minPlayers`); otherwise we fall back to "enough for two
 * on-field teams" using the chosen format.
 */
function effectiveMinPlayers(game: Game): number {
  if (game.minPlayers && game.minPlayers > 0) return game.minPlayers;
  const perTeam =
    game.format === '6v6' ? 6 : game.format === '7v7' ? 7 : 5;
  return perTeam * 2;
}

/**
 * True when "now" is past the cancel-deadline window, i.e. inside
 * the danger zone right before kickoff. Cancellation is still
 * allowed in this window — the discipline tracker flags it — but
 * the UI shows a destructive confirmation prompt first.
 */
function isPastCancelDeadline(g: Game): boolean {
  if (!g.cancelDeadlineHours || g.cancelDeadlineHours <= 0) return false;
  if (typeof g.startsAt !== 'number') return false;
  return Date.now() > g.startsAt - g.cancelDeadlineHours * 60 * 60 * 1000;
}

/**
 * Inspect `liveMatch.assignments` against the current registered roster.
 * Stale uids (a player who was assigned to a team and then unregistered
 * from the game) cause `state: 'invalid'` so the UI can prompt to
 * rebuild the teams. Bench-zone stale entries are silently dropped —
 * they're not visible to the user and don't affect team validity.
 *
 * Returns the cleaned assignment map (only registered roster members)
 * so renderers don't have to filter at every call site.
 */
function teamsValidity(game: Game): {
  state: 'no_teams' | 'valid' | 'invalid';
  cleanedAssignments: Record<UserId, LiveMatchZone>;
} {
  if (!game.liveMatch) {
    return { state: 'no_teams', cleanedAssignments: {} };
  }
  const validIds = new Set<UserId>([
    ...game.players,
    ...(game.guests ?? []).map((g) => toGuestRosterId(g.id)),
  ]);
  const cleaned: Record<UserId, LiveMatchZone> = {};
  let hasPlacement = false;
  let hasStalePlacement = false;
  const assignments = game.liveMatch.assignments ?? {};
  for (const uid of Object.keys(assignments) as UserId[]) {
    const z = assignments[uid];
    if (validIds.has(uid)) {
      cleaned[uid] = z;
      if (z !== 'bench') hasPlacement = true;
    } else if (z !== 'bench') {
      hasStalePlacement = true;
    }
  }
  if (hasStalePlacement) {
    return { state: 'invalid', cleanedAssignments: cleaned };
  }
  return {
    state: hasPlacement ? 'valid' : 'no_teams',
    cleanedAssignments: cleaned,
  };
}

function deriveSessionStatus(
  game: Game,
  totalParticipants: number,
): SessionStatus {
  const validity = teamsValidity(game);
  if (validity.state === 'invalid') return 'teams_invalid';
  if (validity.state === 'valid') {
    // Stage 2: Game.status='active' OR legacy liveMatch.phase='live'.
    // The helper centralises both cases so we don't drift from the
    // service / rule definitions of "match is live".
    return isRoundRunning(game) || game.status === 'active'
      ? 'active'
      : 'teams_ready';
  }
  // No teams placed (or only bench) — fall back to the roster gate.
  const min = effectiveMinPlayers(game);
  return totalParticipants >= min
    ? 'ready_to_create_teams'
    : 'waiting_for_players';
}

/**
 * Auto-shuffle the registered roster into N teams matching the game's
 * format. Mirrors the LiveMatchScreen shuffle algorithm but stays local
 * to this screen so the session-details flow can stand on its own.
 *
 * Each on-field team's first player becomes the keeper (gkA / gkB);
 * the rest fill outfield slots in order. Players beyond
 * `numberOfTeams * playersPerTeam` are placed on the bench.
 */

/**
 * Resolve title + subtitle + CTA shape for the MatchStatusCTACard.
 * Pulled into a pure function so the giant ternary lives outside
 * the JSX. Inputs intentionally widened — caller passes in just
 * what's needed to decide the copy / kind, no hidden dependencies.
 */
function buildStatusCardProps(args: {
  game: Game;
  isAdmin: boolean;
  status: CardStatus;
  sessionStatus: ReturnType<typeof deriveSessionStatus>;
  totalParticipants: number;
  minPlayers: number;
  primary: { title: string; onPress: () => void } | null;
  primaryDestructive: boolean;
  primaryLabel: string;
  blockedByConflict: boolean;
  handlePrimary: () => void;
}): {
  title: string;
  subtitle?: string;
  kind: import('@/components/match/MatchStatusCTACard').CTAKind;
  primaryLabel?: string;
} {
  const {
    game,
    isAdmin,
    status,
    sessionStatus,
    totalParticipants,
    minPlayers,
    primary,
    primaryDestructive,
    primaryLabel,
    blockedByConflict,
  } = args;

  // Terminal states win — they short-circuit everything else.
  if (game.status === 'finished') {
    return { title: he.matchStatusCardFinished, kind: 'none' };
  }
  if (game.status === 'cancelled') {
    return { title: he.matchStatusCardCancelled, kind: 'none' };
  }

  // Subtitle for waiting state — always reflects "how many to go".
  const missing = Math.max(0, minPlayers - totalParticipants);
  const waitingSubtitle =
    missing > 0 ? he.matchStatusCardWaitingHelper(missing) : undefined;

  // Title selection — registered users see the personal "אתה רשום
  // למשחק" copy regardless of whether the game is still waiting or
  // teams are forming. Admin session-states override only when the
  // user is NOT yet in the roster (admin who hasn't joined sees the
  // session state directly).
  const userIsIn = status !== 'none';
  let title: string;
  if (userIsIn) {
    title = he.matchStatusCardYouRegistered;
  } else if (sessionStatus === 'ready_to_create_teams') {
    title = he.matchStatusCardReadyTeams;
  } else if (sessionStatus === 'teams_ready') {
    title = he.matchStatusCardTeamsReady;
  } else if (sessionStatus === 'teams_invalid') {
    title = he.matchStatusCardTeamsInvalid;
  } else if (sessionStatus !== 'waiting_for_players') {
    title = he.matchStatusCardLive;
  } else {
    title = he.matchStatusCardWaiting;
  }

  // CTA kind + label.
  if (blockedByConflict) {
    return {
      title,
      subtitle: waitingSubtitle,
      kind: 'blocked',
      primaryLabel: he.matchPrimaryConflict,
    };
  }
  if (!primary) {
    // No positive primary action — usually waiting + already
    // registered. Show the cancel pill so users still have an exit.
    if (primaryDestructive) {
      return {
        title,
        subtitle: waitingSubtitle,
        kind: 'cancel',
        primaryLabel: he.matchCancelRegistrationLink,
      };
    }
    return { title, subtitle: waitingSubtitle, kind: 'none' };
  }
  // Admin session-action wins as a positive primary even when the
  // user is registered (e.g. "צור כוחות").
  const isAdminAction =
    isAdmin && sessionStatus !== 'waiting_for_players';
  if (isAdminAction) {
    return {
      title,
      subtitle: waitingSubtitle,
      kind: 'admin',
      primaryLabel: primary.title,
    };
  }
  // Plain join.
  return {
    title,
    subtitle: waitingSubtitle,
    kind: 'join',
    primaryLabel: primary.title,
  };
}

export function MatchDetailsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const gameId = route.params?.gameId;
  // Set by GameCreate after a successful create → celebrate on arrival.
  const celebrateOnArrival =
    (route.params as { celebrate?: boolean } | undefined)?.celebrate === true;
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  // Pull-to-refresh state — kept separate from `loading` so the
  // native RefreshControl spinner doesn't fire on top of our
  // SoccerBallLoader during initial load.
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Open when the user taps "cancel" and we're already past the
  // cancel-deadline window. Soft-confirm — the cancellation is
  // allowed, but we ask once with a destructive-styled prompt.
  const [lateCancelOpen, setLateCancelOpen] = useState(false);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  // Local-only dismiss for the post-game "rate teammates" banner.
  // Intentionally not persisted — re-entering the screen is a fine
  // place to surface the prompt again if the user navigated away
  // without acting. If we ever want it sticky, switch to AsyncStorage
  // keyed by gameId.
  const [rateBannerDismissed, setRateBannerDismissed] = useState(false);
  // Set when Firestore returns permission-denied for this game —
  // typically a non-member following an old invite link to a game
  // that's now visibility='community'. We render a dedicated blocked
  // screen (NOT the normal MatchDetails layout) to guarantee no
  // private info is rendered for that user.
  const [accessBlocked, setAccessBlocked] = useState(false);
  // Distinct from `accessBlocked` — the doc DOESN'T EXIST (deleted
  // or never was) vs. exists-but-rules-deny. Drives the "המשחק לא
  // נמצא" fallback screen with a button back to the main tab.
  const [notFound, setNotFound] = useState(false);
  // Conflict modal — set when joinGameV2 throws REGISTRATION_CONFLICT,
  // OR when the user taps "join" while preCheckConflict is already set.
  // Either way the same modal renders.
  const [conflictModal, setConflictModal] = useState<RegistrationConflict | null>(
    null,
  );
  // Pre-check result — populated by an effect after the game loads,
  // so the join CTA can render disabled with a helper text BEFORE
  // the user even taps. Null === no conflict (or check skipped).
  const [preCheckConflict, setPreCheckConflict] =
    useState<RegistrationConflict | null>(null);
  // Bumped every time the user taps the (blocked) join button. The
  // CTA wraps in <ShakeOnTrigger triggerKey={...}> so each bump
  // restarts the shake — no useEffect dance in the parent.
  const [conflictShake, setConflictShake] = useState(0);
  // In-flight flag for the "cancel the other registration" action
  // inside the conflict modal. Guards against double-tap and lets
  // every modal button render disabled while the cancel is pending.
  const [cancelOtherBusy, setCancelOtherBusy] = useState(false);
  // Hamburger bottom-sheet visibility.
  const [menuOpen, setMenuOpen] = useState(false);
  // Join celebration — a short confetti + flying-balls burst + success
  // haptic the moment the user actually lands IN the game (bucket
  // 'players'), OR right after they created the game. Self-clears.
  const [celebrate, setCelebrate] = useState(false);
  // Fire the creation celebration once, on arrival from GameCreate.
  useEffect(() => {
    if (!celebrateOnArrival) return;
    successHaptic();
    setCelebrate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime banners for joins, guests, teams-ready, goals, status
  // changes — fired by the shared listener so every device sees the
  // same signals regardless of who triggered the change. The
  // `onUpdate` callback feeds the latest snapshot back into local
  // state so the roster + counts stay live without an extra fetch.
  // Guarded against null because the screen renders a "not found"
  // state for deleted games, and an onUpdate landing after that
  // shouldn't resurrect a stale doc.
  useGameEvents(gameId, {
    onUpdate: React.useCallback(
      (g: Game) => {
        setGame((prev) => (prev ? g : prev));
        const uids = Array.from(
          new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      },
      [hydratePlayers],
    ),
  });

  // Clear stale state the instant `gameId` flips. React Navigation
  // doesn't unmount MatchDetails when navigating to a different
  // gameId via `nav.replace` (or even `nav.navigate` from a deep
  // link in the same stack) — the same component just receives new
  // params. Without this reset the previous game's data (community
  // name, players, organizer) bleeds through for the few hundred ms
  // it takes the next reload to land. The user-reported symptom
  // "match details shows the wrong community" walks straight back to
  // this race.
  useEffect(() => {
    setGame(null);
    setAccessBlocked(false);
    setNotFound(false);
    setLoading(true);
  }, [gameId]);

  const reload = React.useCallback(async (opts: { pullToRefresh?: boolean } = {}) => {
    // Defensive: if a navigation path mounts MatchDetails without
    // params (e.g. a tab-reset action that lands the user on the
    // stack root), bail out cleanly instead of crashing on a missing
    // id. The render below handles the null state.
    if (!gameId) {
      setGame(null);
      setLoading(false);
      if (nav.canGoBack()) nav.goBack();
      return;
    }
    if (opts.pullToRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const g = await gameService.getGameById(gameId);
      // null === doc genuinely doesn't exist (deleted / never was).
      // ACCESS_BLOCKED was thrown above and is handled in the catch
      // — it never reaches this branch, so null here is unambiguous.
      if (g === null) {
        // Game was deleted or never existed. Don't auto-goBack —
        // a deep-link entry has no back stack, and silently bouncing
        // out feels broken. Render the dedicated fallback screen
        // instead.
        setGame(null);
        setAccessBlocked(false);
        setNotFound(true);
        return;
      }
      setGame(g);
      setAccessBlocked(false);
      setNotFound(false);
      logEvent(AnalyticsEvent.GameViewed, { gameId: g.id, status: g.status });
      const uids = Array.from(
        new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
      );
      if (uids.length > 0) hydratePlayers(uids);
    } catch (err) {
      // Service surfaces a stable code for the rules-denied case; we
      // pivot the whole screen to the blocked-access render so no
      // game info ever mounts. Any other error stays opaque (logged
      // in dev) — we don't want to mistakenly show "blocked" for a
      // transient network failure.
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'ACCESS_BLOCKED') {
        setGame(null);
        setAccessBlocked(true);
        return;
      }
      logError('matchDetailsReload', err, {
        screen: 'MatchDetailsScreen',
        gameId,
        userId: user?.id,
      });
      if (__DEV__) console.warn('[matchDetails] reload failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [gameId, hydratePlayers, nav]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

  // Pre-check for a registration conflict so the join CTA can render
  // disabled with a helper text before the user even taps. Only runs
  // for users who are NOT already in the target game (no point telling
  // someone they "have a nearby game" if the nearby game IS this one
  // — handled by the helper itself excluding target.id, but we still
  // skip the call entirely when the user is already a participant).
  // Network errors leave preCheckConflict at null (we don't want a
  // transient failure to silently block joins — the in-flight join
  // will re-run the check authoritatively and surface the error).
  useEffect(() => {
    if (!game || !user) {
      setPreCheckConflict(null);
      return;
    }
    const alreadyIn = (game.participantIds ?? []).includes(user.id);
    if (alreadyIn || typeof game.startsAt !== 'number') {
      setPreCheckConflict(null);
      return;
    }
    let alive = true;
    gameService
      .findRegistrationConflict(user.id, {
        id: game.id,
        startsAt: game.startsAt,
      })
      .then((c) => {
        if (alive) setPreCheckConflict(c);
      })
      .catch((err) => {
        if (__DEV__) {
          console.warn('[matchDetails] pre-check conflict failed', err);
        }
        if (alive) setPreCheckConflict(null);
      });
    return () => {
      alive = false;
    };
  }, [game, user]);

  // Fetch the forecast once we know the field's coordinates and the
  // game's start time. We fall back to the parent community's lat/lng
  // when the game itself wasn't pinned to a precise location — most
  // real games today only carry a free-text fieldName, so without the
  // fallback the chip would never render.
  //
  // Open-Meteo only serves forecasts for "now or future, up to ~16
  // days"; the service returns null outside that window and the chip
  // below stays hidden.
  useEffect(() => {
    if (!game?.startsAt) return;
    const groupForGame = myCommunities.find((g) => g.id === game.groupId);
    const lat = game.fieldLat ?? groupForGame?.lat;
    const lng = game.fieldLng ?? groupForGame?.lng;
    const city = groupForGame?.city;
    // weatherService falls back to city geocoding when lat/lng is
    // missing. Both the top-level coords path and the city path are
    // memoised so the cost of repeated screen visits is one network
    // call max.
    if (
      (typeof lat !== 'number' || typeof lng !== 'number') &&
      (!city || city.trim().length === 0)
    ) {
      return;
    }
    let alive = true;
    getForecastFor({ lat, lng, city, startsAt: game.startsAt }).then((f) => {
      if (alive) setForecast(f);
    });
    return () => {
      alive = false;
    };
  }, [
    game?.fieldLat,
    game?.fieldLng,
    game?.startsAt,
    game?.groupId,
    myCommunities,
  ]);

  const isAdmin = useMemo(() => {
    if (!user || !game) return false;
    if (game.createdBy === user.id) return true;
    const grp = myCommunities.find((c) => c.id === game.groupId);
    return !!grp && grp.adminIds.includes(user.id);
  }, [user, game, myCommunities]);

  // Store-review trigger A: the organiser of this game is looking
  // at it and the roster has filled to capacity. That's the
  // emotional peak for an admin — their effort paid off — so we
  // ask for a rating. The service throttles cross-game (90d) and
  // dedups in-session per gameId, so we can fire on every render
  // without worrying about loops.
  useEffect(() => {
    if (!user || !game) return;
    if (game.createdBy !== user.id) return;
    if (game.status === 'finished' || game.status === 'cancelled') return;
    const totalSeats = game.maxPlayers ?? 0;
    if (totalSeats <= 0) return;
    const filled =
      (game.players?.length ?? 0) + (game.guests?.length ?? 0);
    if (filled < totalSeats) return;
    void maybeRequestStoreReview('gameFilled', game.id);
  }, [user, game]);

  const adminUids = useMemo(() => {
    if (!game) return new Set<string>();
    const ids = new Set<string>();
    if (game.createdBy) ids.add(game.createdBy);
    const grp = myCommunities.find((c) => c.id === game.groupId);
    grp?.adminIds.forEach((id) => ids.add(id));
    return ids;
  }, [game, myCommunities]);

  // Average community rating of the REGISTERED non-organizer players.
  // Hosts (createdBy + group admins, i.e. `adminUids`) are excluded —
  // organizers shouldn't count in the "what's the rating of the people
  // I'd play with" signal. Surfaces a single avg + count instead of
  // per-player stars. Hidden when fewer than 2 rated players to avoid
  // spotlighting one user. MUST live here, above the loading/notFound
  // early returns, so the hook order never changes between renders.
  const [registeredRatingAvg, setRegisteredRatingAvg] = useState<{
    average: number;
    ratedCount: number;
  } | null>(null);
  useEffect(() => {
    if (!game) {
      setRegisteredRatingAvg(null);
      return;
    }
    let alive = true;
    const eligible = (game.players ?? []).filter((uid) => !adminUids.has(uid));
    if (eligible.length === 0) {
      setRegisteredRatingAvg(null);
      return;
    }
    const groupId = game.groupId;
    (async () => {
      try {
        const summaries = await Promise.all(
          eligible.map((uid) =>
            ratingsService.getSummary(groupId, uid).catch(() => null),
          ),
        );
        if (!alive) return;
        const rated = summaries.filter(
          (s): s is NonNullable<typeof s> => !!s && s.count > 0,
        );
        if (rated.length < 2) {
          setRegisteredRatingAvg(null);
          return;
        }
        const sumOfAverages = rated.reduce((acc, s) => acc + s.average, 0);
        setRegisteredRatingAvg({
          average: sumOfAverages / rated.length,
          ratedCount: rated.length,
        });
      } catch {
        if (alive) setRegisteredRatingAvg(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [game, adminUids]);

  const handlePrimary = async () => {
    if (!user || !game) return;
    const status = statusForUser(game, user.id);
    // Lifecycle gate via the shared helper (mirrors the txn check
    // inside joinGameV2 and the firestore.rules clause). Cancel
    // doesn't go through canJoinGame — a player who's already in can
    // still bail until a round is actually running.
    const isJoinAction =
      status !== 'joined' && status !== 'waitlist' && status !== 'pending';
    if (isJoinAction) {
      if (!canJoinGame(game)) {
        if (isFinished(game)) toast.info(he.matchDetailsAlreadyFinished);
        else if (isCancelled(game)) toast.info(he.matchDetailsAlreadyCancelled);
        else if (isRoundRunning(game)) toast.info(he.matchDetailsAlreadyLive);
        else if (game.startsAt && game.startsAt < Date.now()) {
          toast.info(he.matchDetailsAlreadyStarted);
        } else if (isScheduled(game)) {
          // Recurring game whose registration window hasn't OPENED yet —
          // "closed" is misleading; tell the user when it opens.
          toast.info(
            game.registrationOpensAt
              ? he.matchDetailsRegistrationOpensAt(
                  formatDateLong(game.registrationOpensAt),
                )
              : he.communityNextGameLocked,
          );
        } else toast.info(he.matchDetailsClosedForRegistration);
        return;
      }
    } else if (!canCancelRegistration(game)) {
      // Mid-round cancel — block. Other terminal states already
      // hide the cancel CTA, but defensively guard the path.
      toast.info(he.matchDetailsAlreadyLive);
      return;
    }
    // Soft-confirm late cancellations. We allow them — the discipline
    // tracker already records the timestamp — but the user gets a
    // red prompt so they don't drop out by accident in the danger
    // window. Only triggers on the cancel path.
    if (!isJoinAction && isPastCancelDeadline(game)) {
      setLateCancelOpen(true);
      return;
    }
    setBusy(true);
    try {
      if (!isJoinAction) {
        await gameService.cancelGameV2(game.id, user.id);
        // Splice locally — same race avoidance as the guest-add
        // path: a getDoc round-trip after the transaction commit
        // sometimes returned the pre-commit snapshot, leaving the
        // UI showing stale state.
        setGame((prev) => {
          if (!prev) return prev;
          const wasPlayer = prev.players.includes(user.id);
          const players = prev.players.filter((id) => id !== user.id);
          let waitlist = prev.waitlist.filter((id) => id !== user.id);
          const pending = (prev.pending ?? []).filter((id) => id !== user.id);
          // Match the server-side promote-from-waitlist behaviour so
          // the UI stays consistent even before the next snapshot.
          let promotedPlayers = players;
          if (
            wasPlayer &&
            waitlist.length > 0 &&
            players.length < prev.maxPlayers
          ) {
            promotedPlayers = [...players, waitlist[0]];
            waitlist = waitlist.slice(1);
          }
          const participantIds = (prev.participantIds ?? []).filter(
            (id) => id !== user.id,
          );
          return {
            ...prev,
            players: promotedPlayers,
            waitlist,
            pending,
            participantIds,
          };
        });
      } else {
        const result = await gameService.joinGameV2(game.id, user.id);
        // Capture the post-join game state out of the optimistic-splice
        // updater so we can assert the silent-failure post-condition
        // below WITHOUT a second Firestore read. `joined` records the
        // result of the splice (or null if the game object disappeared).
        let joined: Game | null = null;
        setGame((prev) => {
          if (!prev) return prev;
          const next = { ...prev };
          if (result.bucket === 'players' && !prev.players.includes(user.id)) {
            next.players = [...prev.players, user.id];
          } else if (
            result.bucket === 'waitlist' &&
            !prev.waitlist.includes(user.id)
          ) {
            next.waitlist = [...prev.waitlist, user.id];
          } else if (
            result.bucket === 'pending' &&
            !(prev.pending ?? []).includes(user.id)
          ) {
            next.pending = [...(prev.pending ?? []), user.id];
          }
          next.participantIds = Array.from(
            new Set([...(prev.participantIds ?? []), user.id]),
          );
          joined = next;
          return next;
        });
        // Celebrate the win: a real seat in the game (not waitlist/
        // pending) gets a success haptic + a short confetti burst.
        if (result.bucket === 'players') {
          successHaptic();
          setCelebrate(true);
          setTimeout(() => setCelebrate(false), 1600);
        }
        // Silent-failure guard: a successful join MUST leave the user in
        // the roster the UI now holds (players ∪ waitlist ∪ pending ∪
        // participantIds). If the game object vanished, or the user is in
        // none of those buckets, nothing threw yet the expected UI state
        // didn't materialise — record it with full context. `joined` is
        // set synchronously by the updater above; a null means the game
        // disappeared (prev was null), which is itself a violation.
        const j = joined as Game | null;
        if (!j) {
          logUnexpected('joinNotReflectedInMatch', {
            screen: 'MatchDetailsScreen',
            gameId: game.id,
            userId: user.id,
            isOrphanContext: game.isOrphanContext ?? false,
            visibility: game.visibility,
            status: game.status,
            reason: 'gameDisappeared',
          });
        } else {
          const inRoster =
            j.players.includes(user.id) ||
            j.waitlist.includes(user.id) ||
            (j.pending ?? []).includes(user.id) ||
            (j.participantIds ?? []).includes(user.id);
          if (!inRoster) {
            logUnexpected('joinNotReflectedInMatch', {
              screen: 'MatchDetailsScreen',
              gameId: game.id,
              userId: user.id,
              isOrphanContext: game.isOrphanContext ?? false,
              visibility: game.visibility,
              status: game.status,
              bucket: result.bucket,
            });
          }
        }
      }
    } catch (err) {
      if (__DEV__) {
        const e = err as { code?: string; message?: string; original?: unknown };
        console.warn(
          `[matchDetails] primary failed code=${e.code ?? 'n/a'} ` +
            `msg=${e.message ?? ''}`,
          err,
        );
      }
      // Surface the typed error from the transaction.
      const msg = String((err as Error)?.message ?? '');
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'REGISTRATION_CONFLICT') {
        // Authoritative server-side conflict — show the modal so the
        // user can deep-link to the clashing game and resolve it.
        const conflict = (err as { conflict?: RegistrationConflict }).conflict;
        if (conflict) {
          setConflictModal(conflict);
          // Sync the pre-check state so the CTA flips to disabled
          // even if the in-screen pre-check hadn't completed yet.
          setPreCheckConflict(conflict);
        } else {
          // Defensive: error code without payload — fall back to a
          // toast so the user isn't left guessing.
          toast.error(he.registrationConflictTitle);
        }
      } else if (msg.includes('GAME_STARTED')) {
        toast.info(he.matchDetailsAlreadyStarted);
      } else if (msg.includes('GAME_LIVE')) {
        toast.info(he.matchDetailsAlreadyLive);
      } else if (msg.includes('GAME_NOT_OPEN')) {
        toast.info(
          isScheduled(game) && game.registrationOpensAt
            ? he.matchDetailsRegistrationOpensAt(
                formatDateLong(game.registrationOpensAt),
              )
            : he.matchDetailsClosedForRegistration,
        );
      } else if (__DEV__) {
        // Dev-only verbose toast so we can pinpoint which check the
        // transaction or rules are failing on. Production stays
        // generic.
        toast.error(`${he.error}: ${code || msg || 'unknown'}`);
      } else {
        toast.error(he.error);
      }
    } finally {
      setBusy(false);
    }
  };

  // Run an actual cancel + local splice. Called either from the
  // primary handler when the user is BEFORE the deadline, or from
  // the late-cancel confirmation modal. Splits out so the modal's
  // onConfirm can reuse the same splice logic without re-checking
  // the deadline.
  const runCancel = async () => {
    if (!user || !game) return;
    setBusy(true);
    try {
      await gameService.cancelGameV2(game.id, user.id);
      setGame((prev) => {
        if (!prev) return prev;
        const wasPlayer = prev.players.includes(user.id);
        const players = prev.players.filter((id) => id !== user.id);
        let waitlist = prev.waitlist.filter((id) => id !== user.id);
        const pending = (prev.pending ?? []).filter((id) => id !== user.id);
        let promotedPlayers = players;
        if (
          wasPlayer &&
          waitlist.length > 0 &&
          players.length < prev.maxPlayers
        ) {
          promotedPlayers = [...players, waitlist[0]];
          waitlist = waitlist.slice(1);
        }
        const participantIds = (prev.participantIds ?? []).filter(
          (id) => id !== user.id,
        );
        return {
          ...prev,
          players: promotedPlayers,
          waitlist,
          pending,
          participantIds,
        };
      });
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] late-cancel failed', err);
      toast.error(he.error);
    } finally {
      setBusy(false);
    }
  };

  // Cancel the user's registration on the OTHER (conflicting) game,
  // straight from the conflict modal — saves a navigate-out trip.
  // Behaviour:
  //   • Calls cancelGameV2 against the conflict's gameId.
  //   • On success: closes the modal, clears the pre-check flag (so
  //     the join CTA flips back to enabled), re-runs the conflict
  //     query to confirm, shows a success toast. The user still has
  //     to tap "הצטרף" themselves — we never auto-join, per spec.
  //   • On failure: keeps the modal open, shows an error toast so
  //     the user can retry without losing context.
  // Safety: callers (modal) are responsible for never invoking this
  // with the current game's id; we re-assert here as a defence in
  // depth so a future code path can't accidentally cancel the wrong
  // game.
  const handleCancelConflicting = async (otherGameId: string) => {
    if (!user || !game) return;
    if (!otherGameId || otherGameId === game.id) return;
    if (cancelOtherBusy) return;
    setCancelOtherBusy(true);
    try {
      await gameService.cancelGameV2(otherGameId, user.id);
      // Successful cancel — drop both the modal AND the pre-check
      // result so the join button immediately flips to enabled.
      // We then re-run the pre-check to be sure no OTHER game is
      // still inside the window (rare but possible: the user has
      // 3 games at the same hour). The re-check populates
      // preCheckConflict as needed; until it resolves the CTA is
      // enabled, which is correct — we trust the just-completed
      // cancel.
      setConflictModal(null);
      setPreCheckConflict(null);
      toast.success(he.registrationConflictCancelSuccess);
      if (typeof game.startsAt === 'number') {
        try {
          const next = await gameService.findRegistrationConflict(user.id, {
            id: game.id,
            startsAt: game.startsAt,
          });
          setPreCheckConflict(next);
        } catch {
          // Network hiccup on the post-check is non-blocking — the
          // authoritative re-check inside joinGameV2 will catch any
          // remaining clash when the user actually taps "הצטרף".
        }
      }
    } catch (err) {
      if (__DEV__) {
        console.warn('[matchDetails] cancel conflicting failed', err);
      }
      toast.error(he.registrationConflictCancelFailed);
    } finally {
      setCancelOtherBusy(false);
    }
  };

  // Not-found state — the game doc doesn't exist (deleted or never
  // was). Distinct from access-blocked: there's no privacy concern
  // here, just a friendly "this game is gone" + a button to leave
  // the dead screen for somewhere meaningful.
  if (notFound) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <Ionicons
            name="trash-outline"
            size={48}
            color={colors.textMuted}
          />
          <Text style={styles.blockedTitle}>
            {he.matchDetailsDeletedTitle}
          </Text>
          <Text style={styles.blockedSub}>
            {he.matchDetailsDeletedBody}
          </Text>
          <Button
            title={he.deletedTargetBackToMain}
            variant="primary"
            size="lg"
            onPress={() => {
              // Reset to the games list — no back stack relies on
              // this screen, so we navigate fresh.
              const navAny = nav as unknown as { navigate: (s: string, p?: unknown) => void };
              navAny.navigate('GameTab', { screen: 'GamesList' });
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Blocked-state render — non-member opened a community-only game
  // (rules denied the read). Render a self-contained "no access"
  // screen with NO private fields, NO group identity, NO loaded
  // playersMap reference. The header title is the generic screen
  // title so even that doesn't leak the game name.
  if (accessBlocked) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <Ionicons
            name="lock-closed-outline"
            size={48}
            color={colors.textMuted}
          />
          <Text style={styles.blockedTitle}>{he.communityOnlyGameTitle}</Text>
          <Text style={styles.blockedSub}>{he.communityOnlyGameSubtitle}</Text>
          <Button
            title={he.communityOnlyGameBack}
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => {
              if (nav.canGoBack()) nav.goBack();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (loading || !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={48} />
        </View>
      </SafeAreaView>
    );
  }

  const status = user ? statusForUser(game, user.id) : 'none';
  const fmt = formatLabel(game.format);
  // Capacity tracks BOTH registered uids and per-game guests — a guest
  // is a real seat at the match, just without a /users record.
  const guestCount = (game.guests ?? []).length;
  const totalParticipants = game.players.length + guestCount;
  const isFull = totalParticipants >= game.maxPlayers;

  const primaryDestructive =
    status === 'joined' || status === 'waitlist' || status === 'pending';

  const primaryLabel = (() => {
    if (primaryDestructive) return he.matchDetailsCancel;
    if (isFull && !game.requiresApproval) return he.gameStatusWaitlist;
    if (game.requiresApproval) return he.gameCardRequestJoin;
    return he.matchDetailsJoin;
  })();

  // ─── Session state machine ─────────────────────────────────────────────
  const sessionStatus = deriveSessionStatus(game, totalParticipants);
  const minPlayers = effectiveMinPlayers(game);

  /**
   * Admin tap on "הזמן שחקנים". Opens the native share sheet with a
   * pre-built invite text. Logs analytics so we can see how often
   * organizers reach for this when the roster is short.
   */
  const handleInvitePlayers = async () => {
    if (!game) return;
    // Community-only games never share through the public sheet —
    // the link would land on the rules-blocked landing for any
    // non-member who tapped it. The CTA is hidden for this case
    // upstream; this guard is defence-in-depth.
    if (game.visibility !== 'public') return;
    if (!isOpen(game)) return;
    if (game.startsAt <= Date.now()) return;
    try {
      const link = deepLinkService.buildInviteUrl({
        type: 'session',
        id: game.id,
        invitedBy: user?.id,
      });
      const result = await Share.share({
        title: game.title,
        message: he.sessionInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { gameId: game.id });
      }
    } catch (err) {
      logError('matchInviteShare', err, {
        screen: 'MatchDetailsScreen',
        gameId: game.id,
      });
      if (__DEV__) console.warn('[matchDetails] invite share failed', err);
    }
  };

  /**
   * Admin tap on the live-match CTA — just navigate. The game is
   * marked as "actually played" inside LiveMatch when the timer
   * fires for the first time (after the teams-full gate); no
   * separate "start evening" step exists anymore.
   */
  const handleGoLive = () => {
    if (!game) return;
    nav.navigate('LiveMatch', { gameId: game.id });
  };

  // ─── Render ───────────────────────────────────────────────────────────

  // Resolve the admin set for the game's parent group — used by
  // both the inline participant rows and the role badges.
  const groupAdminIds = new Set<string>(
    myCommunities.find((g) => g.id === game.groupId)?.adminIds ?? [],
  );


  // Compose the location string for the hero strip. Dedupe overlapping
  // parts — single-field govmap picks store the same full label in both
  // fieldName and fieldAddress (and the city is inside it), so a naive
  // join would repeat it. Legacy games (distinct venue/address/city) keep
  // all three parts.
  const locationStr =
    [game.fieldName, game.fieldAddress, game.city]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .reduce<string[]>((acc, p) => {
        if (!acc.some((s) => s.includes(p) || p.includes(s))) acc.push(p);
        return acc;
      }, [])
      .join(' · ') || undefined;

  // Waze handler. Earlier versions sent only `fieldName` (or whichever
  // string came first) as the query — Waze then searched its global
  // POI database and could land on a same-named field in a completely
  // different city. The query now starts with the most specific
  // address (fieldAddress), prepends the city, and falls back to the
  // field name only when nothing else is set, giving Waze enough
  // context to resolve the right location.
  const openWaze = () => {
    // PRECISE path: the location was picked from govmap, so the game has
    // exact coords — navigate straight to the pin with `ll=` (no text
    // search that could land on a same-named field in another city).
    const fLat = game.fieldLat;
    const fLng = game.fieldLng;
    if (typeof fLat === 'number' && typeof fLng === 'number') {
      Linking.openURL(`waze://?ll=${fLat},${fLng}&navigate=yes`)
        .catch(() =>
          Linking.openURL(
            `https://www.google.com/maps/search/?api=1&query=${fLat},${fLng}`,
          ),
        )
        .catch((err) => {
          logError('matchOpenNavigation', err, {
            screen: 'MatchDetailsScreen',
            gameId: game.id,
          });
        });
      return;
    }

    // FALLBACK (legacy games with no coords): a best-effort text query.
    const parts: string[] = [];
    const fieldAddress = (game.fieldAddress ?? '').trim();
    const city = (game.city ?? '').trim();
    const fieldName = (game.fieldName ?? '').trim();
    if (fieldAddress) parts.push(fieldAddress);
    // Only add city if it isn't already part of the address.
    if (city && !fieldAddress.toLowerCase().includes(city.toLowerCase())) {
      parts.push(city);
    }
    // Field name is the weakest signal — append only as a hint when
    // we have something more specific in front of it, or use alone
    // when nothing else exists.
    if (fieldName && parts.length === 0) parts.push(fieldName);
    const dest = parts.join(', ').trim();
    if (!dest) {
      toast.info(he.matchDetailsNoLocation);
      return;
    }
    const q = encodeURIComponent(dest);
    // Waze's `q` param + `navigate=yes` jumps straight to navigation
    // instead of dropping the user on the search results screen.
    Linking.openURL(`waze://?q=${q}&navigate=yes`)
      .catch(() =>
        Linking.openURL(
          `https://www.google.com/maps/search/?api=1&query=${q}`,
        ),
      )
      .catch((err) => {
        logError('matchOpenNavigation', err, {
          screen: 'MatchDetailsScreen',
          gameId: game.id,
        });
        toast.error(he.matchDetailsCannotOpenNavigation);
      });
  };

  // Share handler — community-only games still suppress the share
  // because the link would land on the rules-blocked screen for
  // non-members.
  const handleShare = async () => {
    if (game.visibility !== 'public') {
      toast.info(he.sessionActionInviteCommunityOnly);
      return;
    }
    if (!isOpen(game) || game.startsAt <= Date.now()) return;
    try {
      const link = deepLinkService.buildInviteUrl({
        type: 'session',
        id: game.id,
        invitedBy: user?.id,
      });
      const result = await Share.share({
        title: game.title,
        message: he.sessionInviteShareBody(link),
      });
      if (result.action !== 'dismissedAction') {
        logEvent(AnalyticsEvent.InviteShared, { gameId: game.id });
      }
    } catch (err) {
      logError('matchShare', err, {
        screen: 'MatchDetailsScreen',
        gameId: game.id,
      });
      if (__DEV__) console.warn('[matchDetails] share failed', err);
    }
  };

  // Visibility toggle — preserved from the previous design, now
  // hosted inside the collapsible MatchManageSection.
  const flipVisibility = async (next: boolean) => {
    const target: 'public' | 'community' = next ? 'public' : 'community';
    if (target === game.visibility) return;
    setBusy(true);
    try {
      await gameService.setVisibility(game.id, target);
      await reload();
    } catch (err) {
      logError('matchSetVisibility', err, {
        screen: 'MatchDetailsScreen',
        gameId: game.id,
        target,
      });
      if (__DEV__) console.warn('[matchDetails] setVisibility failed', err);
      toast.error(
        target === 'public'
          ? he.matchVisibilityErrorPublic
          : he.matchVisibilityErrorCommunity,
      );
    } finally {
      setBusy(false);
    }
  };

  // Primary CTA — POSITIVE actions only. Cancel-registration is
  // intentionally NOT a primary anymore: it's a subtle outline-red
  // link below the quick actions so a stray tap can't accidentally
  // bail the user out of a game they meant to play.
  const primary = (() => {
    if (isTerminalGame(game)) return null;
    if (isAdmin) {
      if (sessionStatus === 'waiting_for_players') {
        if (status === 'none') {
          return {
            title: he.matchDetailsJoin,
            onPress: handlePrimary,
            icon: 'person-add-outline' as const,
          };
        }
        return {
          title: he.sessionActionInvitePlayers,
          onPress: handleShare,
          icon: 'share-social-outline' as const,
        };
      }
      // Team-building was removed: the admin no longer creates "כוחות"
      // before going live. Once there are enough players, the single
      // positive action is "עבור ללייב" → the timer-only LiveMatch
      // screen. ready_to_create_teams / teams_invalid therefore fall
      // through to the same CTA as teams_ready below.
      return {
        title: he.sessionActionGoLive,
        onPress: handleGoLive,
        icon: 'play-circle-outline' as const,
      };
    }
    // Regular user — when the match is already active and they ARE
    // registered, surface a prominent "היכנס למשחק" CTA. Previously
    // this lived only as a buried menu entry, so participants had to
    // hunt for it. Only registered (players/waitlist) can enter
    // because the LiveMatchScreen now gates non-participants too.
    // NOTE: do NOT gate this on `!primaryDestructive`. A registered
    // participant is always `primaryDestructive` (status==='joined'),
    // so requiring `!primaryDestructive` here made the branch dead
    // code — participants got no "enter live" button at all once the
    // game went active (and cancel is closed by then, so the sticky
    // fell through to null). The players/waitlist check below is the
    // real "is registered" gate.
    if (
      sessionStatus === 'active' &&
      user &&
      (game.players.includes(user.id) || game.waitlist.includes(user.id))
    ) {
      return {
        title: he.sessionActionGoLive,
        onPress: handleGoLive,
        icon: 'play-circle-outline' as const,
      };
    }
    // Regular user — primary is "join" only when not already in.
    if (primaryDestructive) return null;
    return {
      title: primaryLabel,
      onPress: handlePrimary,
      icon: 'person-add-outline' as const,
    };
  })();

  // Conflict gate — only when the user is about to JOIN.
  const blockedByConflict =
    !!preCheckConflict && !!primary && status === 'none';

  // Single-section hamburger — no titles, ordered by frequency of
  // use. Destructive items sit at the bottom in the danger tone.
  //
  // "ניהול משחק" navigates to the LiveMatch surface — that's where
  // teams, scores and the on-pitch flow live, which is the original
  // semantics of "match management" in the app. The settings-style
  // MatchManageScreen we previously built was the wrong destination.
  const sections: HamburgerSection[] = [
    {
      id: 'main',
      items: [
        // Edit is hidden once the game starts (kickoff passed, or
        // status went 'active'/'finished'/'cancelled') so admins
        // don't accidentally rewrite history or shift a game that
        // people are already on the way to.
        ...(canEditGame(game, { isOrganizerOrAdmin: isAdmin })
          ? [
              {
                id: 'edit',
                label: he.matchMenuEdit,
                icon: 'create-outline' as const,
                onPress: () => nav.navigate('GameEdit', { gameId: game.id }),
              },
            ]
          : []),
        ...(canEnterLive(game, {
          isOrganizerOrAdmin: isAdmin,
          // Only registered participants (players or waitlist) — random
          // community members who didn't sign up have nothing to do on
          // the live screen and shouldn't be able to walk in.
          isParticipant:
            !!user &&
            (game.players.includes(user.id) ||
              game.waitlist.includes(user.id)),
        })
          ? [
              {
                id: 'manage',
                // Admins see "ניהול משחק" (full controls). Everyone
                // else sees "צפייה במשחק" — same screen, view-only.
                label: isAdmin ? he.matchMenuManage : he.matchMenuWatchLive,
                icon: 'settings-outline' as const,
                onPress: () => nav.navigate('LiveMatch', { gameId: game.id }),
              },
            ]
          : []),
        // Quick entry to the full players screen — surfaces pending
        // approvals + waitlist for admins without having to scroll
        // back to the inline "הצג הכל" link.
        ...(isAdmin
          ? [
              {
                id: 'players',
                label: he.matchMenuManagePlayers,
                icon: 'people-outline' as const,
                onPress: () =>
                  nav.navigate('MatchPlayers', { gameId: game.id }),
              },
            ]
          : []),
        // Visibility toggle — admin only, only when the game is
        // still in 'open' state (matches gameService.setVisibility
        // gating). Tap flips public ↔ community-only.
        ...(isAdmin && isOpen(game)
          ? [
              {
                id: 'visibility',
                // Label describes the CURRENT state so the menu reads
                // truthfully — toggle next to it flips the state.
                label:
                  game.visibility === 'public'
                    ? he.matchMenuMakePublic
                    : he.matchMenuMakeCommunity,
                icon: 'globe-outline' as const,
                toggle: {
                  value: game.visibility === 'public',
                  onChange: (next: boolean) => flipVisibility(next),
                  disabled: busy,
                },
                onPress: () => undefined,
              },
            ]
          : []),
        // Leave game — only when the user is registered and can
        // still cancel.
        ...(primaryDestructive && canCancelRegistration(game)
          ? [
              {
                id: 'leave',
                label: he.matchMenuLeave,
                icon: 'exit-outline' as const,
                onPress: handlePrimary,
                tone: 'danger' as const,
              },
            ]
          : []),
        // Organizer-only: find players whose availability matches this
        // game and invite them. Only useful while the game is still open
        // and has room. (This is the only entry point to the
        // AvailablePlayers screen — it was previously unreachable.)
        ...(isAdmin && game.status === 'open'
          ? [
              {
                id: 'inviteAvailable',
                label: he.matchInviteAvailable,
                icon: 'person-add-outline' as const,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'AvailablePlayers',
                    { gameId: game.id },
                  ),
              },
            ]
          : []),
        ...(isAdmin
          ? [
              {
                id: 'delete',
                label: he.deleteGameAction,
                icon: 'trash-outline' as const,
                onPress: () => setDeleteOpen(true),
                tone: 'danger' as const,
              },
            ]
          : []),
      ],
    },
  ];

  // A non-owner / non-admin viewer of someone else's game has no
  // applicable menu actions — every item above is gated. Opening the
  // hamburger would show an empty sheet, so hide the ⋯ trigger entirely
  // when there's nothing in it.
  const hasMenuItems = sections.some((s) => s.items.length > 0);

  // Resolve community name + organizer name from the local stores.
  // Orphan-context games belong to a hidden personal group with no
  // user-facing name — we render "משחק חד־פעמי" instead so the field
  // never displays the placeholder name nor a broken-looking blank.
  const communityName = game.isOrphanContext
    ? he.matchDetailsCommunityOrphan
    : myCommunities.find((g) => g.id === game.groupId)?.name;
  const organizerName = game.createdBy
    ? playersMap[game.createdBy]?.displayName ?? null
    : null;

  // Field-type label (אספלט / סינטטי / דשא) — null when unset.
  const fieldTypeLabel: string | null = game.fieldType
    ? game.fieldType === 'asphalt'
      ? he.fieldTypeAsphalt
      : game.fieldType === 'synthetic'
        ? he.fieldTypeSynthetic
        : he.fieldTypeGrass
    : null;

  // Build the participant list — only registered players (not
  // waitlist/pending) for the on-screen preview. The "הצג הכל"
  // link surfaces the rest in MatchPlayersScreen.
  const ballBringers = new Set(game.ballBringerIds ?? []);
  const participantEntries: ParticipantEntry[] = [
    ...(game.players ?? []).map((uid): ParticipantEntry => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: p?.displayName ?? '...',
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
        isAdmin: groupAdminIds.has(uid),
        isOrganizer: game.createdBy === uid,
        arrival: game.arrivals?.[uid],
        bucket: 'players' as const,
        isBringingBall: ballBringers.has(uid),
        // Flag the auth user's own row so the participants section
        // renders a tappable inline ball toggle on it (and only on
        // it). Keeps the "אני מביא כדור" affordance above the fold
        // without a separate section below the match details.
        isCurrentUser: user?.id === uid,
      };
    }),
    // Guests share the section with registered players, tagged "אורח"
    // so the roster reads as one list and matches the live capacity
    // counter (which already counts guests). Ball-bringer state is
    // looked up by the synthetic roster id so the icon stays in sync
    // when admin toggles a guest's "brings a ball" flag.
    ...(game.guests ?? []).map((g): ParticipantEntry => {
      const guestRosterId = toGuestRosterId(g.id);
      return {
        id: guestRosterId,
        name: g.name,
        isAdmin: false,
        isOrganizer: false,
        bucket: 'guest' as const,
        isBringingBall: ballBringers.has(guestRosterId),
      };
    }),
  ];

  // Primary CTA label flips with state: positive admin action when
  // applicable, then "join" for non-joined users, otherwise the
  // social default — "הזמן חברים לאפליקציה".
  // Sticky-CTA descriptor — what the floating bottom bar shows.
  // Priorities (highest first):
  //   1. Conflict block — user tried to join while already registered
  //      to an overlapping game. Re-tapping opens the conflict modal.
  //   2. Cancel registration — the user (or admin) is in the roster
  //      AND still inside the cancellation window. The button reads
  //      "בטל הרשמה" in destructive red and runs the cancel handler.
  //   3. Admin session action — anything from "צור קבוצות" to
  //      "התחל ערב". Share is excluded here because it lives in the
  //      header now (next to the hamburger).
  //   4. Join — primary action for a user who isn't in the roster yet.
  // Falls through to `null` when none apply (e.g. past-deadline
  // registered user / terminal game) — the bar is hidden in that case
  // since share already has a permanent home in the header.
  const ctaState: {
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    tone: 'primary' | 'destructive' | 'blocked';
  } | null = (() => {
    if (blockedByConflict) {
      return {
        label: he.matchPrimaryConflict,
        icon: 'lock-closed-outline',
        onPress: () => {
          setConflictShake((n) => n + 1);
          setConflictModal(preCheckConflict);
        },
        tone: 'blocked',
      };
    }
    // The admin's positive session action (צור כוחות / עבור ללייב) takes
    // the sticky even when the admin is ALSO registered to their own
    // game — otherwise it was buried behind the red "בטל הרשמה" and the
    // admin had no on-screen way to start the game. Cancel stays
    // reachable via the ☰ menu ("עזוב משחק").
    if (
      isAdmin &&
      primary &&
      primary.onPress !== handleShare &&
      primary.onPress !== handlePrimary
    ) {
      return {
        label: primary.title,
        icon: primary.icon ?? 'arrow-forward',
        onPress: primary.onPress,
        tone: 'primary',
      };
    }
    if (
      primaryDestructive &&
      canCancelRegistration(game) &&
      !isTerminalGame(game)
    ) {
      return {
        label: he.matchDetailsCancel,
        icon: 'close-circle-outline',
        onPress: handlePrimary,
        tone: 'destructive',
      };
    }
    if (primary && primary.onPress !== handleShare) {
      return {
        label: primary.title,
        icon: primary.icon ?? 'arrow-forward',
        onPress: primary.onPress,
        tone: 'primary',
      };
    }
    return null;
  })();

  return (
    <View style={styles.root}>
      {celebrate ? (
        <View pointerEvents="none" style={styles.confettiLayer}>
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
        <MatchStadiumHero
          startsAt={game.startsAt}
          onMenuPress={hasMenuItems ? () => setMenuOpen(true) : undefined}
          onBackPress={() => {
            if (nav.canGoBack()) nav.goBack();
          }}
          // Share lives in the header so the sticky CTA at the bottom
          // is free to surface the contextual action (join / cancel /
          // session-action). Hidden for terminal-state games where
          // there's nothing meaningful to share.
          onSharePress={!isTerminalGame(game) ? handleShare : undefined}
        />

        {/* Floating stats strip — pulled UP via negative margin so
            it overlaps the bottom of the stadium hero. The hero
            already leaves a small `bg.paddingBottom` so the photo
            extends below the floating time card; the strip sits in
            that overlap zone. */}
        <View style={styles.statsFloat}>
          <MatchStatsStrip
            registered={totalParticipants}
            capacity={game.maxPlayers}
            durationMinutes={game.matchDurationMinutes}
            startsAt={game.startsAt}
            weather={
              forecast
                ? { tempC: forecast.tempC, rainProb: forecast.rainProb }
                : undefined
            }
          />
        </View>

        <View style={styles.body}>

          {/* Admin-pinned announcement. Renders nothing for non-admins
              when there's no message; admins always see at least the
              empty "+ הוסף הודעה" tile. */}
          <PinnedAdminMessageCard
            message={game.pinnedMessage}
            isAdmin={isAdmin}
            onSave={async (text) => {
              try {
                await gameService.setPinnedMessage(game.id, text);
                // Optimistic local mirror so the new value renders
                // without waiting for the realtime subscription tick.
                setGame((prev) =>
                  prev ? { ...prev, pinnedMessage: text || undefined } : prev,
                );
              } catch (err) {
                logError('setPinnedMessage', err, {
                  screen: 'MatchDetailsScreen',
                  gameId: game.id,
                });
                if (__DEV__) {
                  console.warn('[matchDetails] setPinnedMessage failed', err);
                }
              }
            }}
          />

          {/* Rule chips — `ruleTags` (new) with a graceful fallback
              to the legacy hasReferee/Penalties/HalfTime booleans on
              not-yet-edited games. Component returns null if there's
              nothing to show. Format / duration are deliberately
              omitted here because MatchStatsStrip above already
              surfaces them. */}
          <MatchFactsRow
            ruleTags={game.ruleTags}
            hasReferee={game.hasReferee}
            hasPenalties={game.hasPenalties}
            hasHalfTime={game.hasHalfTime}
          />

          {/* Average rating of registered players — surfaces "what's
              the typical level of folks here". Hosts (creator +
              group admins) are excluded so the number reflects the
              players you'd actually be matched WITH. Hidden when
              there aren't at least 2 rated non-host players. */}
          {registeredRatingAvg ? (
            <View style={styles.avgRatingCard}>
              <Ionicons name="star" size={18} color="#F59E0B" />
              <Text style={styles.avgRatingValue}>
                {registeredRatingAvg.average.toFixed(1)}
              </Text>
              <Text style={styles.avgRatingLabel}>
                {he.matchDetailsAvgRatingLabel(registeredRatingAvg.ratedCount)}
              </Text>
            </View>
          ) : null}

          <MatchParticipantsSection
            total={totalParticipants}
            capacity={game.maxPlayers}
            // Show only the 3 LATEST registrants on the details page
            // — the full unified roster lives behind "הצג הכל" on
            // MatchPlayersScreen. `.slice(-3).reverse()` takes the
            // newest three (players array is append-on-join order)
            // and surfaces the most recent join first. Earlier we
            // rendered every entry inline, which buried the next-game
            // CTA below a long scrolling list of names.
            maxRows={3}
            members={[...participantEntries].reverse().slice(0, 3)}
            isAdminViewer={isAdmin}
            pendingCount={game.pending?.length ?? 0}
            onSeeAll={() => nav.navigate('MatchPlayers', { gameId: game.id })}
            // "הוסף אורח" lives as an inline text link next to the
            // section header — only for admins, and only while the
            // game is still in a state where guests can be added.
            onAddGuest={
              isAdmin && !isTerminalGame(game)
                ? () => setGuestModalOpen(true)
                : undefined
            }
            onPressMember={(uid) => {
              // Guests have no PlayerCard — their roster id is a
              // synthetic `guest:<id>` token, not a real userId.
              // For admins we open a short prompt to REMOVE the
              // guest (or edit, via the existing GuestModal). This
              // is the only entry point: tapping a guest row used to
              // silently no-op, so admins had no way to undo an
              // accidental "add guest" press.
              if (typeof uid === 'string' && uid.startsWith('guest:')) {
                if (!isAdmin || !user) return;
                const guestId = uid.replace(/^guest:/, '');
                const guest = (game.guests ?? []).find((g) => g.id === guestId);
                if (!guest) return;
                appAlert(
                  he.guestRowActionTitle(guest.name),
                  undefined,
                  [
                    { text: he.cancel, style: 'cancel' },
                    {
                      text: he.guestRowActionRemove,
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await gameService.removeGuest(
                            game.id,
                            user.id,
                            guestId,
                          );
                          // Optimistic local splice so the row
                          // disappears immediately — without it we'd
                          // wait for the Firestore listener tick (up
                          // to ~500 ms) and the user thinks the tap
                          // did nothing.
                          setGame((prev) => {
                            if (!prev) return prev;
                            return {
                              ...prev,
                              guests: (prev.guests ?? []).filter(
                                (g) => g.id !== guestId,
                              ),
                            };
                          });
                          toast.success(he.guestRowRemoveSuccess);
                        } catch (err) {
                          logError('removeGuest', err, {
                            screen: 'MatchDetailsScreen',
                            gameId: game.id,
                            guestId,
                          });
                          if (__DEV__) console.warn('[guests] remove failed', err);
                          toast.error(he.guestRowRemoveError);
                        }
                      },
                    },
                  ],
                );
                return;
              }
              nav.navigate('PlayerCard', {
                userId: uid,
                groupId: game.groupId,
              });
            }}
            onToggleBringingBall={(uid) => {
              // Two paths share this handler:
              //   1. The auth user toggling their OWN bring-ball state
              //      (uid === me.id). Always allowed.
              //   2. An admin toggling a GUEST's bring-ball state on
              //      their behalf (guests can't sign in). The roster
              //      id for a guest is `guest:<id>` — stored in the
              //      same `ballBringerIds` array as real uids.
              const isGuestId = typeof uid === 'string' && uid.startsWith('guest:');
              const isSelf = !!user && user.id === uid;
              if (!isSelf && !(isGuestId && isAdmin)) return;
              const isBringing =
                Array.isArray(game.ballBringerIds) &&
                game.ballBringerIds.includes(uid);
              const next = !isBringing;
              setGame((prev) => {
                if (!prev) return prev;
                const cur = new Set(prev.ballBringerIds ?? []);
                if (next) cur.add(uid);
                else cur.delete(uid);
                return { ...prev, ballBringerIds: Array.from(cur) };
              });
              gameService
                .setBringingBall(game.id, uid, next)
                .catch((err) => {
                  if (__DEV__) {
                    console.warn('[matchDetails] setBringingBall', err);
                  }
                });
            }}
          />

          {/* Waitlist preview — separate from the main participants
              section so the user understands "these aren't in yet,
              they're hoping for a spot". Hidden when the waitlist
              is empty. Tap = navigate to the full players screen. */}
          {(game.waitlist?.length ?? 0) > 0 ? (
            <View style={styles.waitlistSection}>
              <Pressable
                onPress={() =>
                  nav.navigate('MatchPlayers', { gameId: game.id })
                }
                style={styles.waitlistHeader}
              >
                <Text style={styles.waitlistTitle}>
                  {he.matchDetailsWaitlistTitle}{' '}
                  <Text style={styles.waitlistCount}>
                    ({game.waitlist.length})
                  </Text>
                </Text>
                <Ionicons
                  name="chevron-back"
                  size={18}
                  color={colors.textMuted}
                />
              </Pressable>
              <View style={styles.waitlistCard}>
                {game.waitlist.slice(0, 3).map((uid, i) => {
                  const p = playersMap[uid];
                  const name = p?.displayName ?? '…';
                  return (
                    <View
                      key={uid}
                      style={[
                        styles.waitlistRow,
                        i > 0 && styles.waitlistRowDivider,
                      ]}
                    >
                      <Text style={styles.waitlistOrder}>{i + 1}.</Text>
                      <Text style={styles.waitlistName} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Cross-community filler interests — visible only to the
              admin when the game has `acceptsFillers === true` AND
              there's at least one pending interest. The component
              hides itself in all other cases, so non-admins and
              "no fillers needed" games see no extra section. */}
          <FillerInterestsSection
            gameId={game.id}
            isAdmin={isAdmin}
            acceptsFillers={game.acceptsFillers === true}
          />

          {/* Prominent "navigate to field" CTA — surfaces the most
              common action a player takes from this screen (driving
              to the match) instead of hiding it as a small icon
              inside the details grid. Only renders when we have
              enough location to feed Waze. */}
          {locationStr ? (
            <Pressable
              onPress={openWaze}
              accessibilityRole="button"
              accessibilityLabel={he.matchDetailsNavigateWaze}
              style={({ pressed }) => [
                styles.navigateCta,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="navigate" size={20} color={colors.primary} />
              <Text style={styles.navigateCtaText}>
                {he.matchDetailsNavigateButton}
              </Text>
            </Pressable>
          ) : null}

          <MatchDetailsGrid
            title={he.matchDetailsCardTitle}
            items={[
              {
                icon: 'football-outline',
                label: he.matchDetailsLabelField,
                value: game.fieldName,
              },
              // Unified city + address row. The two fields conceptually
              // describe the same thing ("where do I drive?"), and the
              // Waze button belongs HERE — not on the field-name row
              // (which is just the venue's nickname). We join them as
              // "<city>, <address>" when both exist; otherwise show
              // whichever one we have.
              {
                icon: 'location-outline',
                label: he.matchDetailsLabelLocation,
                value:
                  game.city && game.fieldAddress
                    ? `${game.city}, ${game.fieldAddress}`
                    : game.city || game.fieldAddress || null,
                action: locationStr
                  ? {
                      icon: 'navigate',
                      onPress: openWaze,
                      accessibilityLabel: he.matchDetailsNavigateWaze,
                    }
                  : undefined,
              },
              {
                icon: 'leaf-outline',
                label: he.matchDetailsLabelFieldType,
                value: fieldTypeLabel,
              },
              {
                icon: 'grid-outline',
                label: he.matchDetailsLabelFormat,
                value: game.format
                  ? game.format === '5v5'
                    ? '5×5'
                    : game.format === '6v6'
                      ? '6×6'
                      : '7×7'
                  : null,
              },
              {
                icon: 'people-outline',
                label: he.matchDetailsLabelCommunity,
                value: communityName,
                action:
                  communityName && game.groupId && !game.isOrphanContext
                    ? {
                        icon: 'open-outline',
                        onPress: () =>
                          (
                            nav as {
                              navigate: (s: string, p: unknown) => void;
                            }
                          ).navigate('CommunityDetails', {
                            groupId: game.groupId,
                          }),
                        accessibilityLabel: 'פתח את עמוד המועדון',
                      }
                    : undefined,
              },
              {
                icon: 'person-outline',
                label: he.matchDetailsLabelOrganizer,
                value: organizerName,
                // Tap the organizer's row → open the creator's player card.
                action: game.createdBy
                  ? {
                      icon: 'open-outline',
                      onPress: () =>
                        (
                          nav as {
                            navigate: (s: string, p: unknown) => void;
                          }
                        ).navigate('PlayerCard', {
                          userId: game.createdBy,
                          groupId: game.groupId,
                        }),
                      accessibilityLabel: he.matchDetailsLabelOrganizer,
                    }
                  : undefined,
              },
              {
                icon: 'calendar-outline',
                label: he.matchDetailsLabelCreatedAt,
                value: game.createdAt
                  ? formatShortDate(game.createdAt)
                  : null,
              },
              {
                icon: 'reader-outline',
                label: he.matchDetailsLabelNotes,
                value: game.notes,
              },
            ]}
          />

        {isFinished(game) &&
        user &&
        (game.players ?? []).includes(user.id) &&
        !rateBannerDismissed &&
        (game.players ?? []).some((p) => p !== user.id) ? (
          <View style={styles.rateBanner}>
            <Ionicons name="star-outline" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rateBannerTitle}>{he.rateBannerTitle}</Text>
              <Text style={styles.rateBannerSub}>{he.rateBannerSub}</Text>
            </View>
            <Pressable
              onPress={() => {
                const firstTeammate = (game.players ?? []).find(
                  (p) => p !== user.id,
                );
                if (!firstTeammate) return;
                setRateBannerDismissed(true);
                nav.navigate('PlayerCard', {
                  userId: firstTeammate,
                  groupId: game.groupId,
                });
              }}
              style={({ pressed }) => [
                styles.rateBannerCta,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.rateBannerCtaText}>{he.rateBannerCta}</Text>
            </Pressable>
            <Pressable
              onPress={() => setRateBannerDismissed(true)}
              hitSlop={8}
              accessibilityLabel={he.rateBannerDismiss}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        </View>
      </ScrollView>

      {/* Sticky bottom CTA — pinned to the bottom of the screen so
          the contextual action (join / cancel / start session / etc.)
          is always within thumb reach without scrolling past the
          participants + match-details sections. Share lives in the
          header now, so this bar is hidden entirely when there's no
          meaningful contextual action — see `ctaState`. */}
      {ctaState ? (
        <View
          style={[
            styles.stickyCta,
            ctaState.tone === 'blocked' && styles.ctaBlocked,
          ]}
        >
          <Pressable
            onPress={ctaState.onPress}
            disabled={busy}
            style={({ pressed }) => [
              styles.inviteCta,
              ctaState.tone === 'destructive' && styles.inviteCtaDestructive,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={ctaState.label}
          >
            <Ionicons name={ctaState.icon} size={18} color="#FFFFFF" />
            <Text style={styles.inviteCtaText}>{ctaState.label}</Text>
          </Pressable>
          {ctaState.tone === 'blocked' ? (
            <Text style={styles.ctaHelper}>
              {he.registrationConflictHelper}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ─── Modals ──────────────────────────────────────────────────── */}

      <HamburgerMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sections={sections}
      />

      {user ? (
        <GuestModal
          visible={guestModalOpen}
          gameId={game.id}
          callerId={user.id}
          onClose={() => setGuestModalOpen(false)}
          onChanged={(action, saved) => {
            setGame((prev) => {
              if (!prev) return prev;
              const guests = prev.guests ?? [];
              if (action === 'added') {
                return { ...prev, guests: [...guests, saved] };
              }
              return {
                ...prev,
                guests: guests.map((g) => (g.id === saved.id ? saved : g)),
              };
            });
          }}
        />
      ) : null}

      <ConfirmDestructiveModal
        visible={deleteOpen}
        title={he.deleteGameTitle}
        body={he.deleteGameBody}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          try {
            await gameService.deleteGame(game.id);
            setDeleteOpen(false);
            toast.success(he.deleteGameSuccess);
            nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[matchDetails] delete failed', err);
            toast.error(he.error);
          }
        }}
      />

      <ConfirmDestructiveModal
        visible={lateCancelOpen}
        title={he.lateCancelTitle}
        body={he.lateCancelBody(game.cancelDeadlineHours ?? 0)}
        confirmLabel={he.lateCancelConfirm}
        onClose={() => setLateCancelOpen(false)}
        onConfirm={async () => {
          setLateCancelOpen(false);
          await runCancel();
        }}
      />

      <Modal
        visible={!!conflictModal}
        transparent
        animationType="fade"
        onRequestClose={() => setConflictModal(null)}
      >
        <Pressable
          style={styles.conflictBackdrop}
          onPress={() => setConflictModal(null)}
        >
          <Pressable
            style={styles.conflictCard}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.conflictIconWrap}>
              <Ionicons
                name="alert-circle-outline"
                size={28}
                color={colors.warning}
              />
            </View>
            {(() => {
              if (!conflictModal) return null;
              const conflictGroup = myCommunities.find(
                (g) => g.id === conflictModal.groupId,
              );
              const conflictGroupName =
                conflictGroup?.name ?? he.registrationConflictUnknownGroup;
              const isCrossGroup = conflictModal.groupId !== game.groupId;
              const title = isCrossGroup
                ? he.registrationConflictTitleOtherGroup
                : he.registrationConflictTitle;
              const isSameAsCurrent = conflictModal.gameId === game.id;
              const bothHaveTime =
                typeof game.startsAt === 'number' &&
                game.startsAt > 0 &&
                conflictModal.startsAt > 0;
              const diffMinutes = bothHaveTime
                ? Math.round(
                    Math.abs(conflictModal.startsAt - game.startsAt) / 60000,
                  )
                : null;
              const diffText =
                diffMinutes === null
                  ? null
                  : diffMinutes < 60
                    ? he.registrationConflictTimeDiffMinutes(diffMinutes)
                    : he.registrationConflictTimeDiffHoursMinutes(
                        Math.floor(diffMinutes / 60),
                        diffMinutes % 60,
                      );
              const canDirectCancel =
                !!conflictModal.gameId && !isSameAsCurrent && !!user;
              return (
                <>
                  <Text style={styles.conflictTitle}>{title}</Text>
                  <Text style={styles.conflictBody}>
                    {he.registrationConflictMessage}
                  </Text>
                  <View style={styles.conflictGameRow}>
                    <Text style={styles.conflictGameTitle} numberOfLines={2}>
                      {conflictModal.title}
                    </Text>
                    {conflictModal.startsAt > 0 ? (
                      <Text style={styles.conflictGameWhen}>
                        {formatDateLong(conflictModal.startsAt)}
                      </Text>
                    ) : null}
                    <Text style={styles.conflictGameGroup}>
                      {conflictGroupName}
                    </Text>
                  </View>
                  {diffText ? (
                    <Text style={styles.conflictDiff}>{diffText}</Text>
                  ) : null}
                  <View style={styles.conflictActions}>
                    {canDirectCancel ? (
                      <Button
                        title={he.registrationConflictCancelOther}
                        variant="primary"
                        size="lg"
                        fullWidth
                        loading={cancelOtherBusy}
                        disabled={cancelOtherBusy}
                        onPress={() =>
                          handleCancelConflicting(conflictModal.gameId)
                        }
                      />
                    ) : null}
                    {!isSameAsCurrent ? (
                      <Button
                        title={he.registrationConflictViewOther}
                        variant="outline"
                        size="lg"
                        fullWidth
                        disabled={cancelOtherBusy}
                        onPress={() => {
                          const target = conflictModal.gameId;
                          setConflictModal(null);
                          nav.replace('MatchDetails', { gameId: target });
                        }}
                      />
                    ) : null}
                    <Button
                      title={he.registrationConflictClose}
                      variant="outline"
                      size="sm"
                      fullWidth
                      disabled={cancelOtherBusy}
                      onPress={() => setConflictModal(null)}
                    />
                  </View>
                </>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

/**
 * Wrapper that fires a small horizontal shake every time `triggerKey`
 * changes. Used on the disabled-by-conflict join button so the user
 * gets immediate kinaesthetic feedback ("nope, blocked") on top of
 * the modal that opens. Keeping it on Reanimated keeps the JS thread
 * free during the bounce. The shake is intentionally subtle (±8 px,
 * 70 ms each leg) — this is feedback, not punishment.
 */
function ShakeOnTrigger({
  triggerKey,
  children,
  style,
}: {
  triggerKey: number;
  children: React.ReactNode;
  style?: import('react-native').ViewStyle;
}) {
  const tx = useSharedValue(0);
  useEffect(() => {
    if (triggerKey === 0) return;
    tx.value = withSequence(
      withTiming(-8, { duration: 70 }),
      withTiming(8, { duration: 70 }),
      withTiming(-6, { duration: 60 }),
      withTiming(0, { duration: 60 }),
    );
  }, [triggerKey, tx]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}

/** A single icon + text line in the clean top meta block. */
function MetaLine({
  icon,
  text,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={styles.metaLine}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={styles.metaLineText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/**
 * Visually-prominent state pill. Four-way colour split tracks the
 * SessionStatus enum: gray / amber-light-green / blue / green.
 * Counts (e.g. "2/24") live in the label itself for the waiting state.
 */
function SessionStatusPill({
  status,
  totalPlayers,
  maxPlayers,
}: {
  status: SessionStatus;
  totalPlayers: number;
  maxPlayers: number;
}) {
  const cfg = (() => {
    if (status === 'waiting_for_players') {
      return {
        bg: '#F1F5F9', // slate-100 — quiet, not alarming
        fg: '#334155', // slate-700
        dot: colors.textMuted,
        label: he.sessionStatusWaitingPlayers(totalPlayers, maxPlayers),
      };
    }
    if (status === 'ready_to_create_teams') {
      return {
        bg: '#DCFCE7', // green-100
        fg: '#15803D', // green-700
        dot: colors.primary,
        label: he.sessionStatusEnoughPlayers,
      };
    }
    if (status === 'teams_invalid') {
      return {
        bg: '#FEE2E2', // red-100
        fg: '#B91C1C', // red-700
        dot: colors.danger,
        label: he.sessionStatusTeamsInvalid,
      };
    }
    if (status === 'teams_ready') {
      return {
        bg: '#DBEAFE', // blue-100
        fg: '#1D4ED8', // blue-700
        dot: '#2563EB',
        label: he.sessionStatusTeamsReady,
      };
    }
    return {
      bg: '#DCFCE7',
      fg: '#15803D',
      dot: colors.primary,
      label: he.sessionStatusActive,
    };
  })();
  return (
    <View style={[styles.statusPill, { backgroundColor: cfg.bg }]}>
      <View style={[styles.statusDot, { backgroundColor: cfg.dot }]} />
      <Text style={[styles.statusText, { color: cfg.fg }]}>{cfg.label}</Text>
    </View>
  );
}

function HeroStatusBadge({ status, game }: { status: CardStatus; game: Game }) {
  if (status === 'joined')
    return <Badge label={he.matchStatusJoined} tone="primary" size="sm" />;
  if (status === 'waitlist')
    return <Badge label={he.matchStatusWaitlist} tone="warning" size="sm" />;
  if (status === 'pending')
    return <Badge label={he.matchStatusPending} tone="neutral" size="sm" />;
  if (game.players.length >= game.maxPlayers)
    return <Badge label={he.matchStatusFull} tone="neutral" size="sm" />;
  // No "open" badge — the primary button ("הצטרף למשחק" / "בקש להצטרף")
  // already conveys that the game is open to join.
  return null;
}

function InfoCell({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  // forceRTL flips `flexDirection: 'row'` to RTL flow, so the first
  // JSX child (the icon) ends up at the RIGHT edge of the cell. The
  // text block follows to its left and fills the remaining width
  // (flex:1). The 8px gap sits on the icon's physical LEFT — the
  // side facing the text — via `marginLeft`.
  return (
    <View style={styles.infoCell}>
      <Ionicons
        name={icon}
        size={18}
        color={colors.primary}
        style={styles.infoCellIcon}
      />
      <View style={styles.infoCellText}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Full-screen, centred, non-interactive layer for the join confetti
  // burst. zIndex keeps it above the scroll content + sticky CTA.
  confettiLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },

  // Average rating chip — small inline chip above the participants
  // list. Amber star + value (e.g. "4.2") + count caption.
  avgRatingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  avgRatingValue: {
    ...typography.h3,
    color: '#92400E',
    fontWeight: '800',
  },
  avgRatingLabel: {
    ...typography.caption,
    color: '#92400E',
    fontWeight: '600',
  },

  // Waitlist preview — sits below the main participants section so
  // the user reads "registered, then in queue". Tap the header to
  // navigate to the full players screen.
  waitlistSection: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  waitlistHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  waitlistTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '700',
  },
  waitlistCount: {
    ...typography.h3,
    color: colors.textMuted,
    fontWeight: '500',
  },
  waitlistCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  waitlistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  waitlistRowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  waitlistOrder: {
    ...typography.body,
    color: colors.textMuted,
    fontWeight: '700',
    minWidth: 22,
  },
  waitlistName: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },

  // Prominent "navigate to field" CTA. Outline-style so it doesn't
  // compete with the primary join/cancel button at the bottom; the
  // brand-tinted icon + label still makes it scannable as the
  // obvious "I'm driving there" affordance.
  navigateCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  navigateCtaText: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '700',
  },

  // ScrollView contentContainerStyle. The hero owns its own
  // top-padding (SafeAreaView edges=['top']); the bottom padding
  // leaves room for the sticky CTA bar that floats over the
  // ScrollView so the last inline content (rate banner / cancel
  // chip) doesn't get hidden behind it.
  scroll: {
    paddingBottom: 112,
  },

  // Sticky bottom CTA container — pinned over the ScrollView's
  // bottom edge. Light surface + top hairline + subtle shadow so it
  // reads as a separate plane from the scrolling content beneath.
  // Horizontal padding matches the body inset (`spacing.lg`) so the
  // CTA aligns with the cards above; the bottom padding clears
  // gesture bars on devices without a SafeAreaView.
  stickyCta: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },

  // Floating stats strip — negative top margin lifts the card so
  // its top half sits over the stadium hero's bottom edge. Padding
  // around it controls the horizontal inset off the screen edges.
  statsFloat: {
    paddingHorizontal: spacing.lg,
    marginTop: -36,
    // Add bottom margin so the next section doesn't kiss the
    // bottom of the floating card.
    marginBottom: spacing.lg,
  },
  // Body sits BELOW the floating stats. More vertical air between
  // sections to break "stacked white blocks" syndrome.
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },

  // Bottom CTA — bright royal blue with shadow. Hand-rolled so the
  // visual matches the Profile screen's invite CTA without going
  // through the brand-green Button.
  inviteCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: 999,
    backgroundColor: '#2563EB',
    shadowColor: '#1D4ED8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  // Destructive variant of the sticky CTA. Used when the action is
  // "ביטל הרשמה" so the visual weight matches the consequence — a
  // tap that REMOVES the user from the game shouldn't look identical
  // to the positive "הצטרף" / "התחל ערב" buttons.
  inviteCtaDestructive: {
    backgroundColor: '#DC2626',
    shadowColor: '#991B1B',
  },
  inviteCtaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  blockedTitle: {
    ...typography.h2,
    color: colors.text,
    textAlign: 'center',
  },
  blockedSub: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.md,
  },

  // ① Header
  header: {
    gap: spacing.sm,
  },
  // forceRTL flips `row` to RTL flow visually, so the first JSX child
  // (heroTitle) ends up on the RIGHT and the badge on the LEFT — that's
  // the correct Hebrew reading order. `row-reverse` in forceRTL would
  // flip BACK to LTR, which is the bug we were hitting.
  headerTopRow: {
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
    // `alignSelf:'stretch'` forces the Text box to fill the column's
    // width so `textAlign` actually has a wide canvas to anchor
    // glyphs on (without it, RN sizes Text to its content width and
    // textAlign has no effect — the title would visually clump at
    // the start of the row). `flexShrink:1` keeps long titles
    // truncating gracefully via `numberOfLines={2}`.
    alignSelf: 'stretch',
    flexShrink: 1,
  },
  headerSub: {
    gap: 4,
  },
  // Wrapper line: full width, space-between pushes the atom to the
  // RIGHT and the empty placeholder View to the LEFT.
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
  subIcon: {
    // RTL-aware gap to text: `marginEnd` resolves to physical LEFT
    // under forceRTL, which is the side facing the text.
    marginEnd: 8,
  },
  subText: {
    color: colors.textMuted,
    fontSize: 14,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginTop: spacing.sm,
  },

  // ① v2 — clean meta block (no cards, no borders, just spacing)
  topBlock: {
    gap: 6,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaLineText: {
    color: colors.textMuted,
    fontSize: 14,
    flexShrink: 1,
  },

  // ② Status pill — yellow / blue / green
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // ④ Teams block
  teamsBlock: {
    gap: spacing.sm,
  },
  teamsBlockTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    width: '100%',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  teamDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  teamName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 70,
  },
  teamAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
    flex: 1,
  },
  teamMoreText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '700',
    marginStart: 4,
  },

  // ② Helper text under status pill (waiting state only)
  statusHelper: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -spacing.sm + 2,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Empty placeholder shown in lieu of teams when teams aren't ready yet.
  teamsPlaceholder: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
    textAlign: RTL_LABEL_ALIGN,
  },

  // ④ Weather chip — slimmed-down. Reduced padding + smaller icon so
  // it sits as a low-key info row rather than a large hero card.
  weatherCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC', // slate-50 — quieter than the old blue card
  },
  weatherIcon: {
    fontSize: 20,
    lineHeight: 24,
  },
  weatherTextCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  weatherEyebrow: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  weatherStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  weatherStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  weatherStatValue: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  weatherStatDivider: {
    width: 1,
    height: 10,
    backgroundColor: colors.divider,
  },

  // ③ Info grid
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  infoCell: {
    // `justifyContent:'flex-start'` packs both the icon AND the
    // text-block to the row's start (= RIGHT edge of the cell)
    // under forceRTL — labels/values glue right next to the icon
    // instead of stretching to the LEFT edge.
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
    // `alignItems:'flex-start'` is the start of the cross-axis (horizontal
    // since the View defaults to column). Under forceRTL, start = RIGHT,
    // so each child Text packs to the RIGHT edge of the text block —
    // glued tight against the icon, not stranded center / left.
    alignItems: 'flex-start',
    flexShrink: 1,
  },
  infoCellIcon: {
    // RTL-aware gap to text block on icon's physical LEFT side.
    marginEnd: spacing.sm,
  },
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

  // ③ Players
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    // RTL stretch: a content-sized Text inside a row+space-between
    // lands at the visual LEFT under forceRTL (RN's space-between
    // implementation places lone children at flex-start without
    // flipping). `flex: 1` forces the title to fill the row so
    // `textAlign:'right'` actually puts the glyphs at the right edge.
    flex: 1,
  },
  sectionCount: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  addGuestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
  },
  addGuestText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  guestRemove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playersCard: {
    padding: 0,
    overflow: 'hidden',
  },
  playerRow: {
    // forceRTL auto-flips `row` → first JSX child (name) lands at the
    // RIGHT edge, last child (shirt) at the LEFT — proper Hebrew flow.
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  playerRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  playerName: {
    // Content-sized so the name + role badge cluster tight to the
    // shirt on the RIGHT. `flex:1` here was previously stretching the
    // name across the row and pushing the badge to the LEFT edge —
    // not what we want. `flexShrink:1` keeps long names truncatable.
    color: colors.text,
    fontSize: 15,
    fontWeight: '500',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  guestTrashAuto: {
    // `marginStart:'auto'` pushes the trash icon to the END of the
    // flex direction (= LEFT corner of the row under forceRTL). Used
    // only on the guest-row trash so registered-player rows stay tight.
    marginStart: 'auto',
  },
  ballHolder: {
    fontSize: 16,
  },
  emptyText: {
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    fontSize: 14,
  },

  // ④ Manage row (admin) — kept for legacy callers.
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  manageText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  manageIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },


  // Sticky CTA — single column. Stack secondary (outline) over the
  // green primary so a destructive / accidental tap on a green
  // button is unlikely. Old `ctaRow` (side-by-side greens) was
  // dropped in the structured-layout refactor.
  cta: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: spacing.sm,
  },
  ctaHelper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Wrapper applied to the join Button when a registration conflict
  // exists. We dim the visual but keep the onPress active so the tap
  // can open the conflict modal — see the call site for the rationale.
  ctaBlocked: { opacity: 0.55 },
  // Conflict modal — same shape as ConfirmDestructiveModal but a
  // warning palette (orange, not red) since this is an informative
  // block, not a destructive choice.
  conflictBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  conflictCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.md,
  },
  conflictIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  conflictTitle: {
    ...typography.h3,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  conflictBody: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 22,
    textAlign: RTL_LABEL_ALIGN,
  },
  conflictGameRow: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 4,
  },
  conflictGameTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
  },
  conflictGameWhen: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  conflictGameGroup: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    textAlign: RTL_LABEL_ALIGN,
  },
  conflictDiff: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    marginTop: -spacing.xs,
  },
  // Stacked action column — primary (cancel-other) is the most
  // common resolution path so it gets the top, full-width slot.
  // The view+close buttons follow as outline/sm so the dialog reads
  // top-down: "fix it · or · go look · or · close".
  conflictActions: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Legacy alias — the old "horizontal footer" usage was replaced
  // by `conflictActions` above. Keeping the key in case stragglers
  // reference it; the value is identical to `conflictActions` so
  // there's no visual surprise if someone re-introduces it.
  conflictFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // Read-only banner shown in place of the sticky CTA when the game
  // is finished or cancelled. Same docking behaviour as `cta` (sticks
  // to the bottom) but visually muted so it doesn't compete with
  // primary actions.
  terminalBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  terminalBannerTitle: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  terminalBannerSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },
  // Slim inline banner shown after a finished game to nudge the
  // user to rate teammates. Pulled into the redesign as a single
  // flex row instead of the old multi-line block.
  rateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primaryLight,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
  },
  rateBannerTitle: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '800',
    fontSize: 13,
    textAlign: RTL_LABEL_ALIGN,
  },
  rateBannerSub: {
    ...typography.caption,
    color: colors.primaryDark,
    textAlign: RTL_LABEL_ALIGN,
    opacity: 0.85,
  },
  rateBannerCta: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: 999,
  },
  rateBannerCtaText: {
    ...typography.caption,
    color: colors.textOnPrimary,
    fontWeight: '700',
  },
  visibilityLabel: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  visibilityHelper: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },

  // Section A — header + inline weather chip under date.
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  weatherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  // Tiny inline "navigate with Waze" pill rendered just under the
  // location row. Size matches the existing meta-line text so it
  // reads as a one-tap action attached to the address.
  wazeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
  wazeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  weatherChipIcon: {
    fontSize: 13,
    lineHeight: 16,
  },
  weatherChipText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '600',
  },

  // Section B — single status card.
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: '#F7F7F7',
  },
  statusCardTitle: {
    ...typography.bodyBold,
    color: colors.text,
    textAlign: RTL_LABEL_ALIGN,
  },
  statusCardSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: RTL_LABEL_ALIGN,
  },

  // ניהול משחק — admin-only at the bottom of the scroll content.
  manageSection: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  manageCard: {
    paddingVertical: spacing.sm,
  },
  manageRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    // Stretch so the entire row (label + Switch + spacer) is the
    // tap target, not just the content-sized text.
    alignSelf: 'stretch',
  },
  manageDeleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    // Same — fills the card horizontally so a tap anywhere on the
    // row triggers the delete confirmation.
    alignSelf: 'stretch',
  },
  manageDeleteText: {
    ...typography.bodyBold,
    color: colors.danger,
  },
});
