import { HeightReveal } from '@/components/anim/HeightReveal';
import { recordDiagnostic } from '@/services/diagnosticJournal';
import { ChangeMotion } from '@/components/anim/ChangeMotion';
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeModal as Modal } from '@/components/SafeModal';
import { appAlert } from '@/components/AppDialog';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { RichRulesText } from '@/components/community/RichRulesText';
import { CollapsibleContent } from '@/components/CollapsibleContent';
import { Button } from '@/components/Button';
import { goToGameChat } from '@/navigation/navigationRef';
import { Badge } from '@/components/Badge';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { GuestModal } from '@/components/GuestModal';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { PlayerCountBar } from '@/components/PlayerCountBar';
import { CelebrationOverlay } from '@/components/anim/CelebrationOverlay';
import {
  RegistrationSuccessAnimation,
  type RegistrationAnimationVariant,
} from '@/components/anim/game/RegistrationSuccessAnimation';
import { WaitlistPromotionAnimation } from '@/components/anim/game/WaitlistPromotionAnimation';
import { isWaitlistPromotion } from '@/components/anim/game/triggerLogic';
import { usePreviousValue } from '@/hooks/animations';
import { resolveSplitTeams, isSplitStale } from '@/utils/draftTeamsView';
import { successHaptic } from '@/utils/haptics';
import { toast } from '@/components/Toast';
import * as Clipboard from 'expo-clipboard';
import {
  HamburgerMenu,
  type HamburgerSection,
} from '@/components/profile/HamburgerMenu';
import { MatchStadiumHero } from '@/components/match/MatchStadiumHero';
import { DraftTeamCard } from '@/components/draft/DraftTeamCard';
import { MatchDetailsGrid } from '@/components/match/MatchDetailsGrid';
import { ClubTabs, type ClubTab } from '@/components/club/ClubTabs';
import { TabScroll, TabEmpty } from '@/components/match/tabs/MatchTabShell';
import { MatchStatsTab } from '@/components/match/tabs/MatchStatsTab';
import { MatchPlayerCounters } from '@/components/match/tabs/MatchPlayersTab';
import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { MatchRoundsScreen } from '@/screens/games/MatchRoundsScreen';
import { weatherKind } from '@/utils/heroAtmosphere';
import { roundSummaryService } from '@/services/roundSummaryService';
import { didEveningHappen } from '@/utils/eveningPlayed';
import type { RoundSummary } from '@/utils/roundSummary';
import { FillerInterestsSection } from '@/components/match/FillerInterestsSection';
import { PinnedAdminMessageCard } from '@/components/match/PinnedAdminMessageCard';
import { isFinalRoundOfSeason } from '@/utils/seasonFinalRound';
import { GameChampionship } from '@/components/match/GameChampionship';
import { RetroGoalsSheet } from '@/components/match/RetroGoalsSheet';
import { MatchFactsRow } from '@/components/match/MatchFactsRow';
import { gameService, type RegistrationConflict } from '@/services/gameService';
import { seriesService } from '@/services/seriesService';
import { logError, logUnexpected } from '@/services/errorLog';
import { handleFillerOpportunityAction } from '@/services/notificationActionService';
import { maybeRequestStoreReview } from '@/services/storeReviewService';
import { useGameEvents } from '@/services/useGameEvents';
import {
  canAddGuest,
  canCancelRegistration,
  canEditGame,
  canEnterLive,
  canJoinGame,
  canStartEvening,
  isCancelled,
  isFinished,
  isOpen,
  isRoundRunning,
  isScheduled,
  isTerminal as isTerminalGame,
  isActive as isActiveGame,
} from '@/services/gameLifecycle';
import { deepLinkService } from '@/services/deepLinkService';
import { createShortInviteUrl } from '@/services/inviteLinkService';
import { ensureNotGuest } from '@/utils/guestGate';
import { guestJoinGameRequest } from '@/services/guestJoin';
import { guestApplyFillerRequest } from '@/services/guestFiller';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import {
  getForecastFor,
  weatherIcon,
  type WeatherForecast,
} from '@/services/weatherService';
import {
  Game,
  FieldType,
  LiveMatchState,
  LiveMatchZone,
  UserId,
  toGuestRosterId,
  activeGuestCount, teamSizeFromFormat } from '@/types';
import { colors, radius, shadows, spacing, typography, RTL_LABEL_ALIGN } from '@/theme';
import { he } from '@/i18n/he';
import { formatDateShortYear, formatDayDate, formatTime,
  gameFormatLabel,
} from '@/utils/format';
import { teamName, teamDot, normalizeRating, NEUTRAL_RATING } from '@/utils/draft';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { communityEventsService } from '@/services/communityEventsService';
import { useGameStore } from '@/store/gameStore';
import { useChatStore } from '@/store/chatStore';
import { chatKeyFor } from '@/services/chatService';
import type { GameStackParamList } from '@/navigation/GameStack';
import { clubRouteFor } from '@/utils/clubRoute';

type Nav = NativeStackNavigationProp<GameStackParamList, 'MatchDetails'>;
type Params = RouteProp<GameStackParamList, 'MatchDetails'>;

/** The four tabs. `ClubTabs` is generic over this — one bar, two screens. */
type GameTabKey = 'info' | 'games' | 'stats' | 'players';

type CardStatus = 'joined' | 'waitlist' | 'pending' | 'none';

/**
 * How long the post-join audit waits before asking "am I in this game".
 *
 * Seating is done by the server reconciler off the request doc, and the result
 * comes back over the live snapshot. Long enough that a normal round-trip on a
 * slow phone has finished; short enough that the user is still on the screen
 * and the report is about the tap they just made.
 */
const JOIN_AUDIT_DELAY_MS = 6000;

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
  return teamSizeFromFormat(game.format) * 2;
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
    ...(game.guests ?? []).filter((g) => !g.waitlisted).map((g) => toGuestRosterId(g.id)),
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
  //
  // Suppressed once the מחזור is actually running: "חסרים עוד 3 שחקנים" is
  // simply false about an evening already being played, and non-registered
  // club members now reach this card (they get the "עבור ללייב" CTA), so the
  // stale recruiting line sat right under a live button.
  const live = isActiveGame(game);
  const missing = Math.max(0, minPlayers - totalParticipants);
  const waitingSubtitle =
    !live && missing > 0 ? he.matchStatusCardWaitingHelper(missing) : undefined;

  // Title selection — registered users see the personal "אתה רשום
  // למשחק" copy regardless of whether the game is still waiting or
  // teams are forming. Admin session-states override only when the
  // user is NOT yet in the roster (admin who hasn't joined sees the
  // session state directly).
  const userIsIn = status !== 'none';
  let title: string;
  if (userIsIn) {
    title = he.matchStatusCardYouRegistered;
  } else if (live) {
    // A live מחזור states that it is live. `sessionStatus` only reports
    // 'active' when team placements exist, and team-building was removed from
    // the flow — so for a modern game the chain below fell through to
    // "מוכנים להרכיב קבוצות" / "מחכים לשחקנים" while the evening was being
    // played. Harmless while only roster members saw this card; wrong now
    // that a club member off the roster sees it with a live CTA.
    title = he.matchStatusCardLive;
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
    // No positive primary action — usually waiting + already registered.
    // Cancel is intentionally NOT surfaced here (nor in the sticky bar):
    // the only exit is the ☰ menu's "יציאה מהמשחק" (user request — drop the
    // giant "בטל הרשמה" button, keep cancelling menu-only).
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

/** The sky, in one word, for the weather row in "פרטי המחזור".
 *  Classification comes from `weatherKind` — the same function the hero's
 *  atmosphere overlay and the animated glyph use, so the row can never
 *  disagree with the picture behind it. */
function skyLabel(code?: number): string {
  switch (weatherKind(code)) {
    case 'clear':
      return he.gdSkyClear;
    case 'clouds':
      return he.gdSkyClouds;
    case 'rain':
      return he.gdSkyRain;
    case 'storm':
      return he.gdSkyStorm;
    case 'snow':
      return he.gdSkySnow;
    case 'fog':
      return he.gdSkyFog;
    default:
      return he.gdSkyClear;
  }
}

/** The row's icon, matched to the same classification. A plain Ionicon, not the
 *  animated glyph: this is a line of metadata, and an animation in it would
 *  make it the loudest thing on a card of quiet rows. */
function weatherRowIcon(code?: number): keyof typeof Ionicons.glyphMap {
  switch (weatherKind(code)) {
    case 'clouds':
      return 'cloudy-outline';
    case 'rain':
      return 'rainy-outline';
    case 'storm':
      return 'thunderstorm-outline';
    case 'snow':
      return 'snow-outline';
    case 'fog':
      return 'cloud-outline';
    default:
      return 'sunny-outline';
  }
}

export function MatchDetailsScreen() {
  const [tab, setTab] = useState<GameTabKey>('info');
  const [seen, setSeen] = useState<Set<GameTabKey>>(
    () => new Set<GameTabKey>(['info']),
  );
  const showTab = (k: GameTabKey) => {
    recordDiagnostic('press','round_tab',{tab:k,gameId});
    setTab(k);
    setSeen((prev) => (prev.has(k) ? prev : new Set(prev).add(k)));
  };
  /** The sealed evening summary — the ONLY source the statistics tab reads. */
  const [roundSummary, setRoundSummary] = useState<RoundSummary | null>(null);

  const insets = useSafeAreaInsets();
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const gameId = route.params?.gameId;
  // Robust back: some entry paths (home hero, a push tap, a tab-switch that
  // resets the stack) land the user on MatchDetails with NO back-stack entry,
  // so `nav.goBack()` silently does nothing and the header "‹" looks dead
  // (user report). Fall back to the parent tab, then to the games list.
  const goBackSafe = React.useCallback(() => {
    if (nav.canGoBack()) {
      nav.goBack();
      return;
    }
    const parent = nav.getParent?.();
    if (parent?.canGoBack?.()) {
      parent.goBack();
      return;
    }
    nav.navigate('GamesList' as never);
  }, [nav]);
  // Set by GameCreate after a successful create → celebrate on arrival.
  const celebrateOnArrival =
    (route.params as { celebrate?: boolean } | undefined)?.celebrate === true;
  const user = useUserStore((s) => s.currentUser);
  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);
  // An active red card in this game's community blocks self-registration
  // (enforced server-side too). We check once so the join CTA can pre-empt it
  // with a clear message instead of a delayed rejection.
  const [redBlocked, setRedBlocked] = useState(false);
  // Unread count for THIS game's chat → drives the badge on the header
  // chat icon (mirrors the badge on the chats-list tab).
  const chatUnread = useChatStore(
    (s) => s.entries[chatKeyFor('game', gameId)]?.count ?? 0,
  );

  const [game, setGame] = useState<Game | null>(null);

  /**
   * Tonight is the season's last evening.
   *
   * Read from the club the game belongs to, and only for a member who has it
   * — a guest or an outsider has no club document and gets no banner, which
   * is right: the season is the club's, not the game's.
   */
  /** The club's season is in its correction window and cannot start evenings. */
  const seasonClosing = useMemo(() => {
    const sea = myCommunities.find((c) => c.id === game?.groupId)?.seasons;
    return !!sea?.enabled && !!sea.pendingClose?.closeAt;
  }, [myCommunities, game?.groupId]);

  /** "עונה 2" for the header, or undefined when the club runs no seasons. */
  const seasonLabelForGame = useMemo(() => {
    const grp = myCommunities.find((c) => c.id === game?.groupId);
    const sea = grp?.seasons;
    if (!sea?.enabled) return undefined;
    const stamped = (game as { seasonId?: string } | null)?.seasonId;
    // A stamped evening keeps its own season for ever, including after the
    // season closes — that is the whole point of the stamp. Only the number
    // is known from the id when it is the running one; an older stamp can
    // only be named by its id, so it falls back to the running label rather
    // than printing "s1" at a reader.
    if (stamped && stamped !== sea.currentId) return undefined;
    return he.seasonNumberLabel(sea.currentNo ?? 1);
  }, [myCommunities, game]);

  const finalRoundOfSeason = useMemo(
    () =>
      isFinalRoundOfSeason(
        myCommunities.find((c) => c.id === game?.groupId)?.seasons,
      ),
    [myCommunities, game?.groupId],
  );
  // Always-current mirror of `game`, for the post-join audit below. A React
  // state updater's side effects are NOT guaranteed to run at the call site
  // (see the audit comment), so the audit reads the COMMITTED state instead.
  const gameRef = useRef<Game | null>(null);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  /** Pending post-join audit timer — superseded by any newer join/cancel. */
  const joinAudit = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (joinAudit.current) clearTimeout(joinAudit.current);
    },
    [],
  );
  const [loading, setLoading] = useState(true);
  // Pull-to-refresh state — kept separate from `loading` so the
  // native RefreshControl spinner doesn't fire on top of our
  // SoccerBallLoader during initial load.
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [guestModalOpen, setGuestModalOpen] = useState(false);

  // Check the viewer's red-card status for this community once (self only).
  useEffect(() => {
    const gid = game?.groupId;
    if (!gid || !user) {
      setRedBlocked(false);
      return;
    }
    let alive = true;
    const grp = myCommunities.find((c) => c.id === gid);
    // The master switch suspends all card behaviour — skip the check (and the
    // Firestore read) entirely when the club's cards feature is off.
    communityEventsService
      .hasActiveRedCard(gid, user.id, grp?.redCardValidityDays, !!grp?.cardsEnabled)
      .then((blocked) => {
        if (alive) setRedBlocked(blocked);
      })
      .catch(() => {
        if (alive) setRedBlocked(false);
      });
    return () => {
      alive = false;
    };
  }, [game?.groupId, user, myCommunities]);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Open when the user taps "cancel" and we're already past the
  // cancel-deadline window. Soft-confirm — the cancellation is
  // allowed, but we ask once with a destructive-styled prompt.
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  // Local-only dismiss for the post-game "rate teammates" banner.
  // Intentionally not persisted — re-entering the screen is a fine
  // place to surface the prompt again if the user navigated away
  // without acting. If we ever want it sticky, switch to AsyncStorage
  // keyed by gameId.
  // Measured height of the sticky bottom CTA bar so the ScrollView can pad its
  // content by exactly that much. The bar grows to TWO stacked buttons (share +
  // cancel), which a fixed 112px pad didn't clear — the last detail rows
  // ("הערות"/"נוצר בתאריך") ended up hidden behind it (user report 2026-06-21).
  const [ctaHeight, setCtaHeight] = useState(0);
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
  // A transient load failure (network) that isn't ACCESS_BLOCKED or notFound.
  // Without this the screen kept `game` null while `loading` flipped false →
  // the SoccerBallLoader spun forever with no error/retry.
  const [loadError, setLoadError] = useState(false);
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
  // "Notify teams ready" in-flight guard. MUST live here with the other
  // hooks — above the notFound/accessBlocked early returns — or React throws
  // "Rendered more hooks than during the previous render" once the game loads.
  const [notifyingTeams, setNotifyingTeams] = useState(false);
  const [publishingTeams, setPublishingTeams] = useState(false);
  // Join celebration — a short confetti + flying-balls burst + success
  // haptic the moment the user actually lands IN the game (bucket
  // 'players'), OR right after they created the game. Self-clears.
  const [celebrate, setCelebrate] = useState(false);
  const [regAnim, setRegAnim] = useState<{
    variant: RegistrationAnimationVariant;
    isLastSpot: boolean;
  } | null>(null);
  // Anim 2 — detect a REAL waitlist→roster promotion from the live game state
  // (via useGameEvents' setGame). Computed at top level so the hooks below never
  // sit behind an early return. Dedup latch resets when the user leaves the
  // roster, so a Firestore snapshot can't replay it but a later promotion can.
  const myRegStatus: RegistrationAnimationVariant | null =
    game && user
      ? (() => {
          const st = statusForUser(game, user.id);
          return st === 'joined'
            ? 'registered'
            : st === 'waitlist'
              ? 'waitlisted'
              : st === 'pending'
                ? 'pendingApproval'
                : null;
        })()
      : null;
  const prevRegStatus = usePreviousValue(myRegStatus);
  const [showPromotion, setShowPromotion] = useState(false);
  const promoFired = useRef(false);
  useEffect(() => {
    if (isWaitlistPromotion(prevRegStatus, myRegStatus) && !promoFired.current) {
      promoFired.current = true;
      setShowPromotion(true);
    }
    if (myRegStatus !== 'registered') promoFired.current = false;
  }, [myRegStatus, prevRegStatus]);
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
        // Cancellations included: someone who dropped out is no longer in
        // `players`, so without this their name never resolves and the
        // "ביטלו השתתפות" rows all read the generic "שחקן".
        const uids = Array.from(
          new Set([
            ...g.players,
            ...g.waitlist,
            ...(g.pending ?? []),
            ...Object.keys(g.cancellations ?? {}),
          ]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      },
      [hydratePlayers],
    ),
    // Viewer lost access mid-view (removed from the community) → pivot live to
    // the blocked screen instead of waiting for the next focus-reload.
    onAccessBlocked: React.useCallback(() => {
      setGame(null);
      setAccessBlocked(true);
      setLoading(false);
    }, []),
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
    setLoadError(false);
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
      setLoadError(false);
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
        new Set([
          ...g.players,
          ...g.waitlist,
          ...(g.pending ?? []),
          ...Object.keys(g.cancellations ?? {}),
        ]),
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
      // Only trip the error screen when we have NOTHING to show. A failed
      // pull-to-refresh over an already-loaded game keeps the game visible.
      if (!game) setLoadError(true);
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

  // NOTE: the live game subscription lives in useGameEvents (above) — its
  // onUpdate already mirrors every server change (incl. the scheduled→open
  // registration flip) into setGame, so a user sitting on the screen sees the
  // join button unlock without leaving/re-entering. A second onSnapshot here
  // would just double the realtime read cost; the real "looks stale" symptom
  // was the focus-reload blanking the screen (fixed at the render gate below).

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

  // Retro-goals manager (admin-only, finished game): the "השלם גולים" sheet +
  // a key we bump to refetch the evening-scorers table after an add/undo.
  const [retroOpen, setRetroOpen] = useState(false);
  const [retroRefreshKey, setRetroRefreshKey] = useState(0);
  const retroRoster = useMemo(
    () =>
      (game?.players ?? []).map((id) => {
        const p = playersMap[id];
        return {
          id,
          name: (p?.displayName ?? '').trim() || he.genericUserName,
          avatarId: p?.avatarId,
          photoUrl: p?.photoUrl,
        };
      }),
    [game?.players, playersMap],
  );

  // ─── The four tabs ───────────────────────────────────────────────────
  //
  //  Which of them are open is a property of the EVENING, not of the viewer:
  //  משחקים and סטטיסטיקות only exist for a game created in advanced mode,
  //  because that is the mode that records mini-games at all. The flag is the
  //  game's own `advancedMode` — no new flag, and no per-club setting.
  //
  //  A locked tab stays visible and answers a tap with a toast, rather than
  //  disappearing: a tab that vanishes reads as a bug, while one that explains
  //  itself teaches the admin what the create-screen toggle buys them.
  // The club behind this evening, for the hero's cover. `isOrphanContext` is
  // the one-off marker; those keep the bundled stadium.
  const memberHeroClub =
    game && !game.isOrphanContext && game.groupId
      ? myCommunities.find((c) => c.id === game.groupId)
      : undefined;
  const [publicHeroCover, setPublicHeroCover] = useState<{groupId:string;ownerId:string;cover: {coverPhotoUrl?:string;coverImageId?:string}|null}|null>(null);
  const heroGroupId = game && !game.isOrphanContext ? game.groupId : undefined;
  useEffect(() => {
    if (!heroGroupId || memberHeroClub || !user?.id) return;
    let alive = true;
    import('@/services/groupService').then(m=>m.groupService.getPublic(heroGroupId)).then(cover=>{
      if(alive)setPublicHeroCover({groupId:heroGroupId,ownerId:user.id,cover});
    }).catch(()=>{if(alive)setPublicHeroCover({groupId:heroGroupId,ownerId:user.id,cover:null});});
    return()=>{alive=false;};
  },[heroGroupId,memberHeroClub,user?.id]);
  const publicCoverResolved = publicHeroCover?.groupId===heroGroupId && publicHeroCover?.ownerId===user?.id;
  const heroClub = memberHeroClub ?? (publicCoverResolved ? publicHeroCover?.cover : undefined);

  const advanced = game?.advancedMode === true;

  //  A tab can be locked for two different reasons, and the toast has to name
  //  the right one — "the mode is off" told to a stranger who simply is not in
  //  the club would be false.
  //
  //  The second reason is not new: the three buttons these tabs replace were
  //  gated on `viewerPlayedHere || viewerIsClubMember`, because the documents
  //  behind them (`roundSummaries`, `roundHistory`) are club-readable and a
  //  non-member's read is DENIED. Widening the gate would not show them more —
  //  it would show them an empty state that blames missing data for a
  //  permission error. So the old gate is carried over verbatim.
  const viewerInClub =
    !!user &&
    ((game?.players ?? []).includes(user.id) ||
      (!!game?.groupId && myCommunities.some((c) => c.id === game.groupId)));
  const dataTabsLocked = !advanced || !viewerInClub;
  // `initialTab` is honoured ONCE, and only after the game has loaded — which
  // is the only moment we know whether the requested tab is locked. Sending
  // someone straight to a locked tab would show them a pane the tab bar says
  // they cannot open; when that happens the request is dropped and they land
  // on מידע, the same place every other caller lands.
  const initialTabApplied = React.useRef(false);
  useEffect(() => {
    if (initialTabApplied.current || !game) return;
    const want = route.params?.initialTab;
    if (!want || want === 'info') {
      initialTabApplied.current = true;
      return;
    }
    initialTabApplied.current = true;
    if ((want === 'games' || want === 'stats') && dataTabsLocked) return;
    showTab(want);
    // `showTab` is a plain function over setState — stable enough for an effect
    // that runs once, and listing it would only re-arm the guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, dataTabsLocked, route.params?.initialTab]);

  const gameTabs = useMemo<ClubTab<GameTabKey>[]>(
    // Order is right-to-left on screen, so this array reads מידע · שחקנים ·
    // משחקים · סטטיסטיקות. The owner asked for שחקנים to sit beside מידע and
    // for the two data tabs to move left: the roster is what people open on a
    // game that has not been played, and the two locked-by-default tabs belong
    // at the far end rather than between the two everyone uses.
    () => [
      { key: 'info', label: he.gdTabInfo },
      { key: 'players', label: he.gdTabPlayers },
      { key: 'games', label: he.gdTabGames, locked: dataTabsLocked },
      { key: 'stats', label: he.gdTabStats, locked: dataTabsLocked },
    ],
    [dataTabsLocked],
  );

  // Did this evening actually happen? Asked of ONE module so the two tabs
  // below cannot answer it differently from the club screen or the season
  // close — see `src/utils/eveningPlayed.ts`. It decides which empty state
  // the tabs show: "עדיין לא שוחק" or "אין נתונים למחזור הזה".
  const eveningHasPlayed = useMemo(() => didEveningHappen(game), [game]);

  // The sealed summary for the statistics tab. Fetched once per game, and only
  // when that tab is first opened — an evening whose statistics nobody looks at
  // costs no read. A miss is a legitimate answer (the document only exists for
  // evenings closed since `roundSummaries` shipped), so a failure leaves it null
  // and the tab renders its no-coverage state.
  const summaryFetched = React.useRef<string | null>(null);
  useEffect(() => {
    if (!gameId || !seen.has('stats')) return;
    if (summaryFetched.current === gameId) return;
    summaryFetched.current = gameId;
    let alive = true;
    roundSummaryService
      .get(gameId)
      .then((s) => {
        if (!alive || !s) return;
        setRoundSummary(s);
        // Names and faces for the leaders, the pair and the event lines. The
        // same hydration the standalone summary screen does, for the same
        // reason: the summary stores uids only.
        const ids = new Set<string>();
        for (const l of Object.values(s.leaders)) {
          for (const u of (l as { userIds?: string[] } | null)?.userIds ?? []) ids.add(u);
        }
        for (const e of s.events) if ('userIds' in e) e.userIds.forEach((u) => ids.add(u));
        if (s.pairHighlight) s.pairHighlight.userIds.forEach((u) => ids.add(u));
        const real = Array.from(ids).filter((u) => !u.startsWith('guest:'));
        if (real.length > 0) hydratePlayers(real);
      })
      .catch(() => {
        // Left null on purpose — the tab's no-coverage state is the answer.
      });
    return () => {
      alive = false;
    };
  }, [gameId, seen, hydratePlayers]);

  const summaryNameOf = React.useCallback(
    (uid: string) => (playersMap[uid]?.displayName ?? '').trim(),
    [playersMap],
  );
  const summaryUserOf = React.useCallback(
    (uid: string) => {
      const p = playersMap[uid];
      return {
        id: uid,
        name: (p?.displayName ?? '').trim() || he.genericUserName,
        avatarId: p?.avatarId,
        photoUrl: p?.photoUrl,
      };
    },
    [playersMap],
  );

  // Filler candidate: a signed-in user who is NOT a member of this game's
  // community and NOT already in the roster, viewing a game that opted into
  // outside fillers. They can't join directly — they apply ("הגש מועמדות")
  // and the admin approves. (They reached this readable screen via the rules
  // exception for acceptsFillers games / a fillerOpportunity push.)
  const isFillerCandidate = useMemo(() => {
    if (!user || !game) return false;
    if (game.acceptsFillers !== true) return false;
    if (game.status !== 'open') return false;
    const isMember = myCommunities.some((c) => c.id === game.groupId);
    if (isMember) return false;
    const inRoster =
      (game.players ?? []).includes(user.id) ||
      (game.waitlist ?? []).includes(user.id) ||
      (game.pending ?? []).includes(user.id);
    return !inRoster;
  }, [user, game, myCommunities]);
  // Local-only state for the in-screen filler apply button.
  const [fillerState, setFillerState] = useState<'idle' | 'submitting' | 'sent'>('idle');
  const onApplyAsFiller = async () => {
    if (!game || fillerState !== 'idle') return;
    // A guest never reaches the callable. This CTA was the last write on the
    // screen that went straight to the server with an anonymous uid — the
    // join CTA above was gated three rounds ago and this one was missed, so
    // an anonymous session could put a real filler application in front of a
    // real admin. The sheet is already mounted for the join path; the intent
    // is stashed and finished by `apply_filler`'s resumer afterwards.
    if (isGuest) {
      void authAction.request(guestApplyFillerRequest(game.id));
      return;
    }
    setFillerState('submitting');
    try {
      await handleFillerOpportunityAction('EXPRESS_FILLER_INTEREST', game.id, 'screen');
      setFillerState('sent');
      toast.success(he.fillerApplySent);
    } catch (err) {
      // Reached at last: the helper used to swallow its own errors, so this
      // branch was dead and the screen said "נשלח" for applications the
      // server had refused.
      //
      // NOT logged here. `handleFillerOpportunityAction` already wrote this
      // exact failure to the error log — with more context than this call site
      // has — and then rethrew. Logging it again produced TWO fingerprints per
      // tap, which is why 30.09 reads as "x9 applyAsFiller + x9
      // handleFillerInterestAction" for what was one person tapping nine
      // times. One failure, one record.
      const code = String((err as { code?: unknown })?.code ?? '');
      setFillerState('idle');
      // `functions/internal` from the JS SDK is also what "could not reach the
      // server" looks like — it is not only a server crash. The server log for
      // that minute shows ONE request, answered 200 in 3.7s; the other eight
      // never arrived. Say so, instead of inviting a ninth tap.
      toast.error(
        code === 'functions/internal' || code === 'functions/unavailable'
          ? he.fillerApplyOffline
          : he.fillerApplyError,
      );
    }
  };

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
      (game.players?.length ?? 0) + activeGuestCount(game.guests);
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
    const eligible = (game.players ?? []).filter((uid) => !adminUids.has(uid));
    // Ratings are now the INTERNAL admin rating only (peer rating removed).
    // Admin-only, and only for internal-rating communities — never surfaced to
    // non-admins (it would leak the private ratings).
    const grp = myCommunities.find((c) => c.id === game.groupId);
    if (eligible.length === 0 || !grp?.internalRating || !isAdmin) {
      setRegisteredRatingAvg(null);
      return;
    }
    const vals = eligible
      .map((uid) => grp.adminRatings?.[uid])
      .filter((v): v is number => typeof v === 'number' && v > 0);
    if (vals.length < 2) {
      setRegisteredRatingAvg(null);
      return;
    }
    setRegisteredRatingAvg({
      average: vals.reduce((a, b) => a + b, 0) / vals.length,
      ratedCount: vals.length,
    });
  }, [game, adminUids, myCommunities, isAdmin]);

  const performPrimary = async () => {
    if (!user || !game) return;
    // A guest may browse this game; joining needs an identity. The coordinator
    // persists the intent and the sheet opens IN PLACE — the person never leaves
    // the game they were looking at, and when they come back the join runs
    // itself. `performPrimary` is re-entered for a full account, which is why
    // the whole body below is untouched.
    if (isGuest) {
      // Built by `guestJoinGameRequest` rather than inline, because the games
      // feed offers the same action and the two had already drifted — see that
      // file. The resumer re-asks the server afterwards; nothing about this
      // match's current state is captured here.
      void authAction.request(guestJoinGameRequest(game.id));
      return;
    }
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
      // Active red card in this community → blocked from self-registering
      // (the server rejects it too; this pre-empts with a clear message).
      if (redBlocked) {
        // The `redBlocked` flag comes from a ONE-SHOT read on mount — it does
        // NOT live-update. If an admin revokes the card while this screen stays
        // open, the stale flag would keep blocking until the user leaves and
        // re-enters (user report). Re-verify against the server at tap time:
        // only block if the card is STILL active; otherwise fall through and
        // let them register. On a read error keep the block (server is the
        // backstop) so we never wrongly let a carded player in.
        const gid = game.groupId;
        const grp = gid ? myCommunities.find((c) => c.id === gid) : undefined;
        const stillBlocked = gid
          ? await communityEventsService
              .hasActiveRedCard(
                gid,
                user.id,
                grp?.redCardValidityDays,
                !!grp?.cardsEnabled,
              )
              .catch(() => true)
          : false;
        setRedBlocked(stillBlocked);
        if (stillBlocked) {
          // A red card is a hard block on registering — show it in the red
          // error style, not the neutral blue info toast (user report).
          toast.error(he.redCardBlockToast);
          return;
        }
      }
    } else if (!canCancelRegistration(game)) {
      // Mid-round cancel — block. Other terminal states already
      // hide the cancel CTA, but defensively guard the path.
      toast.info(he.matchDetailsAlreadyLive);
      return;
    }
    // Late-cancel confirm popup removed 2026-06-21 (user report): the
    // reliability/"אמינות" feature it warned for was scrapped, so cancelling
    // now proceeds directly with no danger-window prompt.
    setBusy(true);
    try {
      if (!isJoinAction) {
        // A cancel makes any in-flight join audit meaningless — the user is
        // SUPPOSED to be out of the roster now.
        if (joinAudit.current) {
          clearTimeout(joinAudit.current);
          joinAudit.current = null;
        }
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
          // NOTE: do NOT optimistically promote waitlist[0] into players. The
          // server uses an OFFER model (cancelGameV2 sets pendingPromotion and
          // waits for the offered user to ACCEPT) — it never auto-seats them.
          // Faking the promotion showed a waitlisted user as a confirmed player
          // who hadn't accepted; the real offer/accept flow arrives by snapshot.
          const participantIds = (prev.participantIds ?? []).filter(
            (id) => id !== user.id,
          );
          return {
            ...prev,
            players,
            waitlist,
            pending,
            participantIds,
          };
        });
      } else {
        const result = await gameService.requestJoinGame(game.id, user.id, 'match_details');
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
          return next;
        });
        // Celebrate the win: a real seat in the game (not waitlist/
        // pending) gets a success haptic + a short confetti burst. A
        // waitlist/pending join was previously SILENT here (user just saw the
        // CTA flip) — surface the same bucket-aware toast the Games tab shows,
        // so someone who landed on the waitlist knows they aren't confirmed.
        // Product animation (Anim 1 / 3): flourish keyed to the confirmed
        // bucket. Last-spot celebration only when a self-join took the final
        // free seat. `freeBefore` is read from the pre-join game state.
        {
          const guestsActive = (game.guests ?? []).filter(
            (g) => !(g as { canceled?: boolean }).canceled,
          ).length;
          const occBefore =
            (game.players?.length ?? 0) +
            guestsActive +
            (game.pendingPromotion?.uid ? 1 : 0);
          const freeBefore = Math.max(0, (game.maxPlayers ?? 0) - occBefore);
          setRegAnim({
            variant:
              result.bucket === 'players'
                ? 'registered'
                : result.bucket === 'waitlist'
                  ? 'waitlisted'
                  : 'pendingApproval',
            isLastSpot: result.bucket === 'players' && freeBefore === 1,
          });
        }
        if (result.bucket === 'players') {
          successHaptic();
          setCelebrate(true);
          setTimeout(() => setCelebrate(false), 1600);
          toast.success(he.toastGameJoined);
        } else if (result.bucket === 'waitlist') {
          toast.info(he.toastGameJoinedWaitlist);
        } else {
          toast.info(he.toastGameJoinedPending);
        }
        // Silent-failure guard: a successful join MUST leave the user in
        // the roster the screen holds (players ∪ waitlist ∪ pending ∪
        // participantIds).
        //
        // This used to read `joined`, a variable the optimistic updater above
        // assigns — and it reported on `joined === null` as "the game
        // disappeared". That reasoning was wrong twice over. React only
        // evaluates a state updater at the call site when the fiber has no
        // work pending; the join itself makes the server reconciler write the
        // game, whose live snapshot queues its own setGame, so in exactly the
        // interesting moment the updater is DEFERRED and `joined` stays null
        // with nothing wrong. Every such report was noise, and the real join
        // had landed (verified in production against the joinRequests
        // receipts).
        //
        // Seating is asynchronous anyway: requestJoinGame files a request doc
        // and the server seats it. So the honest question is not "what did the
        // updater return" but "a few seconds on, does the screen show me in
        // this game" — read from the COMMITTED state, not from a closure. A
        // later cancel (or a newer join) supersedes the audit; leaving the
        // screen drops it.
        if (joinAudit.current) clearTimeout(joinAudit.current);
        const auditedGameId = game.id;
        const auditedBucket = result.bucket;
        joinAudit.current = setTimeout(() => {
          joinAudit.current = null;
          const g = gameRef.current;
          // Screen moved to another game, or unloaded it — nothing to assert.
          if (!g || g.id !== auditedGameId) return;
          const inRoster =
            g.players.includes(user.id) ||
            g.waitlist.includes(user.id) ||
            (g.pending ?? []).includes(user.id) ||
            (g.participantIds ?? []).includes(user.id);
          if (!inRoster) {
            logUnexpected('joinNotReflectedInMatch', {
              screen: 'MatchDetailsScreen',
              gameId: auditedGameId,
              userId: user.id,
              isOrphanContext: g.isOrphanContext ?? false,
              visibility: g.visibility,
              status: g.status,
              bucket: auditedBucket,
            });
          }
        }, JOIN_AUDIT_DELAY_MS);
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
      } else if (code === 'GAME_JOIN_REJECTED' || msg.includes('GAME_JOIN_REJECTED')) {
        toast.error(he.matchDetailsJoinRejected);
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
      // Any failure here usually means the LOCAL roster was stale (the
      // user already got approved / the spot filled / the game changed)
      // and the optimistic CTA fired against an out-of-date state. Pull
      // the authoritative doc so the CTA snaps to reality — this is what
      // breaks the "error → still shows 'בקש' → tap again → error" loop
      // (user report).
      void reload();
    } finally {
      setBusy(false);
    }
  };

  // Run an actual cancel + local splice. Called either from the
  // primary handler when the user is BEFORE the deadline, or from
  // the late-cancel confirmation modal. Splits out so the modal's
  // onConfirm can reuse the same splice logic without re-checking
  // the deadline.
  // (runCancel removed 2026-06-21 — it only served the late-cancel popup,
  //  which was removed with the scrapped reliability feature; the inline
  //  cancel path in the primary action handler covers all cancellations.)

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
            onPress={goBackSafe}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Network (or other non-blocked) failure with nothing to show — offer a
  // retry instead of an eternal spinner.
  if (loadError && !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <Ionicons
            name="cloud-offline-outline"
            size={48}
            color={colors.textMuted}
          />
          <Text style={styles.blockedTitle}>
            {he.matchDetailsLoadErrorTitle}
          </Text>
          <Text style={styles.blockedSub}>{he.matchDetailsLoadErrorBody}</Text>
          <Button
            title={he.gameRetry}
            variant="primary"
            size="lg"
            fullWidth
            onPress={() => {
              setLoadError(false);
              reload();
            }}
          />
        </View>
      </SafeAreaView>
    );
  }

  // Loader only on the INITIAL load (no data yet). A focus-reload while the
  // live subscription already holds `game` must NOT blank the screen to a
  // spinner (that flash was the real "looks stale until you re-enter" symptom).
  if (loading && !game) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScreenHeader title={he.matchDetailsTitle} />
        <View style={styles.center}>
          <SoccerBallLoader size={48} />
        </View>
      </SafeAreaView>
    );
  }

  // No error branch matched but `game` is momentarily null (e.g. mid-reload
  // right after a gameId switch) — show the loader rather than crash. Also
  // narrows `game` to non-null for the render below.
  if (!game) {
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
  // Organizer rejected this user on a prior request → they can't re-join.
  // Hide the join CTA proactively rather than letting them tap into a
  // toast (the service blocks it server-side regardless).
  const wasRejected =
    !!user && (game.rejectedPlayerIds ?? []).includes(user.id);
  const fmt = game.format ? gameFormatLabel(game.format) : null;
  // Capacity tracks BOTH registered uids and per-game guests — a guest
  // is a real seat at the match, just without a /users record.
  const guestCount = activeGuestCount(game.guests);
  const totalParticipants = game.players.length + guestCount;
  // Occupancy INCLUDING a pending-promotion reservation, for the hero "X/max"
  // counter only — so a full-but-awaiting-confirmation game reads e.g. 14/14
  // (matching MatchListCard) instead of 13/14, which looked like there was a
  // free spot while people were correctly waitlisted (user confusion).
  const heroOccupancy = Math.min(
    game.maxPlayers,
    totalParticipants + (game.pendingPromotion?.uid ? 1 : 0),
  );
  // A pending-promotion offer holds the last open seat for the offered user, so
  // a new joiner actually lands on the waitlist. Count that reservation so the
  // primary CTA says "בקש להצטרף/רשימת המתנה" instead of a misleading "הצטרף"
  // that silently waitlists them (mirrors requestJoinGame + MatchListCard).
  const isFull =
    totalParticipants + (game.pendingPromotion?.uid ? 1 : 0) >= game.maxPlayers;

  /**
   * Every "cancel my registration" entry point on this screen goes through
   * here, so none of them can ship without the confirmation: the ☰ menu item,
   * the red button at the bottom of the content, and the sticky CTA when it is
   * showing the destructive action. Putting the prompt inside the handler
   * rather than at each call site is what makes that guarantee hold when a
   * fourth entry point is added later.
   *
   * Joining is never confirmed — it is reversible and asking would just be in
   * the way. A cancel that is already blocked (mid-round) is passed straight
   * through so `performPrimary` can explain why, instead of asking the user to
   * confirm something that will then be refused.
   *
   * Not to be confused with the late-cancel warning removed on 2026-06-21:
   * that one warned about a reliability score that was scrapped. This is a
   * plain "are you sure", asked every time.
   */
  const handlePrimary = () => {
    if (!user || !game) {
      void performPrimary();
      return;
    }
    const status = statusForUser(game, user.id);
    const isCancelAction =
      status === 'joined' || status === 'waitlist' || status === 'pending';
    if (!isCancelAction || !canCancelRegistration(game)) {
      void performPrimary();
      return;
    }
    appAlert(he.leaveGameConfirmTitle, he.leaveGameConfirmBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.matchMenuLeave,
        style: 'destructive',
        onPress: () => void performPrimary(),
      },
    ]);
  };

  const primaryDestructive =
    status === 'joined' || status === 'waitlist' || status === 'pending';

  // The creator/admin and explicitly-invited users bypass approval (the
  // invite IS the approval — matches the server bucket logic), so they get a
  // direct "join", never "request to join" (user report: the creator + an
  // invited player both saw "בקש להצטרף" on a game they were invited to).
  const isInvitedToGame =
    !!user && (game.invitedUserIds ?? []).includes(user.id);
  const needsApproval = game.requiresApproval === true && !isAdmin && !isInvitedToGame;
  const primaryLabel = (() => {
    if (primaryDestructive) return he.matchDetailsCancel;
    if (isFull && !needsApproval) return he.gameStatusWaitlist;
    if (needsApproval) return he.gameCardRequestJoin;
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
      const link = await createShortInviteUrl({
        type: 'session',
        id: game.id,
        invitedBy: user?.id,
        fallbackLong: deepLinkService.buildInviteUrl({
          type: 'session',
          id: game.id,
          invitedBy: user?.id,
        }),
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
  // Claim a spot you've been OFFERED (head of waitlist). The accept lived
  // only on the players screen + the push, so an offered user on THIS screen
  // had no way to take it — a generic join no-oped (they're already on the
  // waitlist) and the count reverted (user report). confirmSpotOffer is the
  // real write (waitlist→players, offer cleared); we splice optimistically and
  // the realtime listener confirms.
  const handleConfirmSpotOffer = async () => {
    if (!game || !user) return;
    const me = user.id;
    try {
      await gameService.confirmSpotOffer(game.id, me);
      // Splice locally only AFTER the write commits — an in-flight snapshot
      // from useGameEvents would otherwise clobber a pre-await optimistic
      // update back to the pre-accept state (CTA flickered back, user report).
      setGame((prev) => {
        if (!prev || prev.players.includes(me)) return prev;
        return {
          ...prev,
          players: [...prev.players, me],
          waitlist: prev.waitlist.filter((id) => id !== me),
          pendingPromotion: null,
        };
      });
      toast.success(he.toastGameJoined);
    } catch (err) {
      logError('confirmSpotOffer', err, {
        screen: 'MatchDetailsScreen',
        gameId: game.id,
      });
      toast.error(he.error);
    }
  };

  const handleGoLive = () => {
    if (!game) return;
    logEvent(AnalyticsEvent.LiveMatchEntryTapped, {
      gameId: game.id,
      source: 'primary_cta',
      isAdmin,
    });
    nav.navigate('LiveMatch', { gameId: game.id });
  };

  // Who this viewer is, as far as entering the live evening is concerned.
  // Built once and handed to `canEnterLive` by BOTH entry points (the sticky
  // CTA and the hamburger item) so they can never disagree about who is
  // allowed in — they did, and a club member off a full roster was offered
  // the waitlist instead of the live screen.
  const liveEntryActor = {
    isOrganizerOrAdmin: isAdmin,
    isParticipant:
      !!user &&
      (game.players.includes(user.id) || game.waitlist.includes(user.id)),
    // Any member of the club may WATCH, roster or not — the evening is a
    // club event, and a member left off this week's roster could not open
    // the live screen at all (owner report). Controls remain admin-only, so
    // a member gets the read-only view.
    isClubMember:
      !!user && !!game.groupId && myCommunities.some((c) => c.id === game.groupId),
  };
  // Answered once — the sticky CTA, the conflict gate and the ☰ item all read
  // the same boolean, so they cannot disagree about who may enter.
  const canEnterLiveNow = canEnterLive(game, liveEntryActor);

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

  // Last resort, when nothing on the device can open a map at all.
  //
  // Showing a toast (below) stopped the button being silent, but it still
  // left the tap with nothing to show for it. Copy the destination first —
  // the coords for a govmap pin, the address text for a legacy game — so
  // the user can paste it into whatever maps app they do have, and say so
  // in the toast. If even the clipboard refuses, fall back to the plain
  // "couldn't open navigation" message rather than promising a copy that
  // never happened.
  const failNavigation = async (err: unknown, destination: string) => {
    logError('matchOpenNavigation', err, {
      screen: 'MatchDetailsScreen',
      gameId: game.id,
    });
    // ⚠️ `setStringAsync` RESOLVES `false` when the copy fails — it does not
    // throw — so a try/catch alone would announce "היעד הועתק" over an empty
    // clipboard. Only an explicit `false` counts as a failure — the native
    // modules resolve with nothing at all on success.
    let copied = false;
    try {
      copied = (await Clipboard.setStringAsync(destination)) !== false;
    } catch {
      copied = false;
    }
    toast.error(
      copied
        ? he.matchDetailsNavigationCopied
        : he.matchDetailsCannotOpenNavigation,
    );
  };

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
        // A third rung, and the one that actually catches this in the wild.
        //
        // Reported from production (Pulse vxyx0r): "Unable to open URL:
        // https://www.google.com/maps/search/?api=1&query=32.05,34.91". Waze
        // was not installed AND nothing claimed the https link — which is an
        // ordinary state on a device with no browser set as default, not a
        // bug. `geo:` is the Android intent every maps app registers for, so
        // it succeeds where a web URL has nobody to hand it to.
        .catch(() =>
          Linking.openURL(`geo:${fLat},${fLng}?q=${fLat},${fLng}`),
        )
        // …and TELL them. This path logged and returned, so the button did
        // nothing at all and said nothing about it — while the text-query
        // fallback thirty lines below has shown a toast all along. Same
        // failure, two behaviours, and the silent one was on the path most
        // games take.
        .catch((err) => failNavigation(err, `${fLat},${fLng}`));
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
      // Same third rung as the precise path above — a text query works as a
      // `geo:` intent too, via its `q` parameter.
      .catch(() => Linking.openURL(`geo:0,0?q=${q}`))
      .catch((err) => failNavigation(err, dest));
  };

  // The right invite link for THIS game: ALWAYS a direct session link to
  // this specific game (user report 3uc6 — the share button was producing a
  // community-join link instead of a link to the game itself). The recipient
  // lands straight on this game's details; members open it as usual, and the
  // link preview shows the game (not a generic "join community" card).
  const inviteLinkForGame = (): string =>
    deepLinkService.buildInviteUrl({
      type: 'session',
      id: game.id,
      invitedBy: user?.id,
    });

  // Share handler — works for ALL game types. Shares a direct link to THIS
  // game plus the rich recruitment text (what / when / where / how many
  // missing + join link), the same game-share style across the board.
  const handleShare = async () => {
    if (!isOpen(game) || game.startsAt <= Date.now()) return;
    try {
      const link = await createShortInviteUrl({
        type: 'session',
        id: game.id,
        invitedBy: user?.id,
        fallbackLong: inviteLinkForGame(),
      });
      // Use the RICH recruitment text (what / when / where / how many
      // missing + join link) — the same content the old bottom WhatsApp
      // button used. The header share icon is now the single share entry
      // point (user request: move the rich content up, drop the bottom
      // button). Missing-count line is auto-omitted when full.
      const missing = Math.max(
        0,
        game.maxPlayers - (game.players.length + activeGuestCount(game.guests)),
      );
      const message = he.sessionShareWhatsappBody({
        title: game.title,
        when: formatDateLong(game.startsAt),
        field: game.fieldName,
        missing,
        link,
      });
      const result = await Share.share({ title: game.title, message });
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

  // Approve / reject a pending join request RIGHT HERE on the match
  // details page (admins) — no longer forcing a trip to the full
  // players screen (user report). Mirrors MatchPlayersScreen's flow.
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

  // Stop the weekly fixture. Deliberately NOT a delete: every match that
  // already exists stays, only the series stops producing new ones.
  const handleStopSeries = () => {
    if (!game.seriesId) return;
    appAlert(he.stopSeriesTitle, he.stopSeriesBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.stopSeriesConfirm,
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await seriesService.stop(game.seriesId as string);
              toast.success(he.stopSeriesSuccess);
            } catch (err) {
              logError('stopSeries', err, {
                screen: 'MatchDetailsScreen',
                gameId: game.id,
                seriesId: game.seriesId,
              });
              toast.error(he.error);
            }
          })();
        },
      },
    ]);
  };

  // Delete tap — one plain confirm, recurring or not.
  //
  // "מחק רק את השבוע הזה" used to sit here. Keeping a series alive past a
  // deleted week means spawning the NEXT week up front (the weekly cron can't
  // clone from a game that no longer exists) — so deleting one match silently
  // created another. Eliran deleted 2.9 and got 9.9 for free. The owner's call:
  // the app never opens a match as a side effect, so deleting is now just
  // deleting, and it ends the weekly series with it.
  const handleDeletePress = () => {
    setDeleteOpen(true);
  };


  // Edit tap — for a match that belongs to a weekly SERIES, ask what the edit
  // applies to. Both answers are now side-effect free: the fixture's settings
  // live in their own `gameSeries` doc, so "this match only" touches the match
  // and "the series too" overwrites the template. Neither creates a match —
  // which is exactly what the old version of this dialog did.
  const handleEditPress = () => {
    if (!game.seriesId) {
      logEvent(AnalyticsEvent.GameEditOpened, {
        gameId: game.id,
        hasSeries: false,
        scope: 'single',
      });
      nav.navigate('GameEdit', { gameId: game.id });
      return;
    }
    appAlert(he.editSeriesTitle, he.editSeriesBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.editSeriesThisOnly,
        onPress: () => {
          logEvent(AnalyticsEvent.GameEditOpened, {
            gameId: game.id,
            hasSeries: true,
            scope: 'single',
          });
          nav.navigate('GameEdit', { gameId: game.id });
        },
      },
      {
        text: he.editSeriesAll,
        onPress: () => {
          logEvent(AnalyticsEvent.GameEditOpened, {
            gameId: game.id,
            hasSeries: true,
            scope: 'series',
          });
          nav.navigate('GameEdit', { gameId: game.id, applyToSeries: true });
        },
      },
    ]);
  };

  const handleSetTeamFeedback = async (value: 'like' | 'dislike') => {
    if (!user) return;
    // Toggle off if tapping the same reaction again.
    const current = game.draftTeamFeedback?.[user.id];
    const next = current === value ? null : value;
    // Optimistic local update — a full reload() here made the whole screen
    // visibly "refresh"/jump on every tap (user report). Splice locally and
    // only reload to recover if the write fails.
    setGame((prev) => {
      if (!prev) return prev;
      const fb = { ...(prev.draftTeamFeedback ?? {}) };
      if (next === null) delete fb[user.id];
      else fb[user.id] = next;
      return { ...prev, draftTeamFeedback: fb };
    });
    try {
      await gameService.setDraftTeamFeedback(game.id, user.id, next);
      logEvent(AnalyticsEvent.TeamFeedbackGiven, {
        gameId: game.id,
        value: next ?? 'cleared',
      });
    } catch (err) {
      logError('setDraftTeamFeedback', err, { gameId: game.id });
      toast.error(he.error);
      await reload();
    }
  };

  const handleNotifyTeams = async () => {
    if (notifyingTeams) return; // guard double-tap → duplicate pushes
    setNotifyingTeams(true);
    try {
      await gameService.notifyTeamsReady(game.id);
      logEvent(AnalyticsEvent.TeamsNotifySent, {
        gameId: game.id,
        numTeams: (draftTeams?.teams ?? []).length,
      });
      toast.success(he.autoBalanceNotifySent);
    } catch (err) {
      logError('notifyTeamsReady', err, { gameId: game.id });
      toast.error(he.error);
    } finally {
      setNotifyingTeams(false);
    }
  };

  // "פרסם כוחות" — reveal a draft split to every player + fire the teams-ready
  // push in one action. Confirmed first so a stray tap can't publish a half-
  // built split. Reuses notifyTeamsReady under the hood (publishDraftTeams).
  const handlePublishTeams = () => {
    if (publishingTeams) return;
    appAlert(he.draftPublishConfirmTitle, he.draftPublishConfirmBody, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.draftPublishConfirmCta,
        onPress: async () => {
          setPublishingTeams(true);
          try {
            await gameService.publishDraftTeams(game.id);
            logEvent(AnalyticsEvent.TeamsPublished, {
              gameId: game.id,
              numTeams: (draftTeams?.teams ?? []).length,
              stale: teamsStale,
            });
            toast.success(he.draftPublishedToast);
          } catch (err) {
            logError('publishDraftTeams', err, { gameId: game.id });
            toast.error(he.error);
          } finally {
            setPublishingTeams(false);
          }
        },
      },
    ]);
  };

  // Primary CTA — POSITIVE actions only. Cancel-registration is
  // intentionally NOT a primary anymore: it's a subtle outline-red
  // link below the quick actions so a stray tap can't accidentally
  // bail the user out of a game they meant to play.
  const primary = (() => {
    if (isTerminalGame(game)) return null;
    // You've been OFFERED an open spot (head of waitlist) — the primary action
    // is to CLAIM it, not a generic join. Takes priority over every other CTA
    // (admin or player) so the offered user can actually take the seat here.
    if (user && game.pendingPromotion?.uid === user.id) {
      return {
        title: he.matchDetailsAcceptOffer,
        onPress: handleConfirmSpotOffer,
        icon: 'checkmark-circle-outline' as const,
      };
    }
    if (isAdmin) {
      // An admin who isn't in the roster (left, or never joined) still gets a
      // JOIN button — same as a player (user report: "where did join go?").
      // Without this, once the game filled past the "waiting for players"
      // state the admin's CTA flipped to invite/go-live and there was no way
      // to rejoin. Invite stays reachable via the header share icon. Skipped
      // once the match is live (then the admin action is manage / go-live).
      if (status === 'none' && sessionStatus !== 'active') {
        return {
          title: primaryLabel,
          onPress: handlePrimary,
          icon: 'person-add-outline' as const,
        };
      }
      // A short roster hides the live CTA — UNTIL the evening is actually
      // about to start. Owner report: seven people at the pitch, a 4v4 game
      // whose format implies eight, and no way in at all. `waiting_for_players`
      // is a recruiting state, and thirty minutes before kickoff recruiting is
      // over: whoever turned up is who is playing, and they can play 4v3 or
      // change the format from the live screen.
      //
      // canStartEvening carries both bounds (not before the lead, not after
      // the evening has gone stale) and existed for exactly this — it simply
      // had no caller, which is why the hole was invisible.
      if (
        sessionStatus === 'waiting_for_players' &&
        !canStartEvening(game, { isOrganizerOrAdmin: isAdmin })
      ) {
        return {
          title: he.sessionActionInvitePlayers,
          onPress: handleShare,
          icon: 'share-social-outline' as const,
        };
      }
      // Don't surface "עבור ללייב" a day early (user report: game is
      // tomorrow but the live button already showed). Only from a few
      // hours before kickoff onward — before that the useful admin action
      // is still recruiting players, so fall through to the invite CTA.
      const LIVE_LEAD_MS = 4 * 60 * 60 * 1000;
      if (
        sessionStatus !== 'active' &&
        typeof game.startsAt === 'number' &&
        Date.now() < game.startsAt - LIVE_LEAD_MS
      ) {
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
    // Regular user — when the evening is already live and this viewer is
    // allowed in, surface a prominent "עבור ללייב" CTA. Previously it lived
    // only as a buried menu entry, so participants had to hunt for it.
    //
    // The gate is `canEnterLive`, the SAME predicate the hamburger entry
    // below uses — not a hand-rolled roster check. A club member left off a
    // full roster may watch the evening (gameLifecycle.canEnterLive), but
    // the sticky CTA kept offering "הצטרף לרשימת המתנה" and only flipped to
    // the live button once they had actually joined the waitlist (owner
    // report). Sharing one predicate keeps the two entry points from
    // drifting apart again.
    //
    // NOTE: do NOT gate this on `!primaryDestructive`. A registered
    // participant is always `primaryDestructive` (status==='joined'), so
    // requiring `!primaryDestructive` here made the branch dead code —
    // participants got no "enter live" button at all once the game went
    // active (and cancel is closed by then, so the sticky fell through to
    // null). `canEnterLive` is the real gate.
    if (canEnterLiveNow) {
      return {
        title: he.sessionActionGoLive,
        onPress: handleGoLive,
        icon: 'play-circle-outline' as const,
      };
    }
    // Regular user — primary is "join" only when not already in.
    if (primaryDestructive) return null;
    // Rejected users get no join CTA at all.
    if (wasRejected) return null;
    // A non-member filler candidate must NOT get the direct "בקש להצטרף"
    // sticky CTA — their only path is the "הגש מועמדות" banner above (the
    // admin approves the filler interest). Showing both created two parallel
    // request mechanisms for the same game.
    if (isFillerCandidate) return null;
    return {
      title: primaryLabel,
      onPress: handlePrimary,
      icon: 'person-add-outline' as const,
    };
  })();

  // Conflict gate — only when the user is about to JOIN.
  //
  // `canEnterLiveNow` excludes the watch path on purpose. The pre-check runs
  // for anyone who is NOT in this game's roster (see the effect above), so a
  // club member who is registered to a DIFFERENT game at the same hour still
  // carries a `preCheckConflict` — and once the sticky CTA started offering
  // "עבור ללייב" to that member, the gate turned their live button into the
  // locked "יש לך משחק אחר" tile. A clash is a reason not to REGISTER for two
  // evenings at once; it is no reason to stop someone watching one of them.
  const blockedByConflict =
    !!preCheckConflict && !!primary && status === 'none' && !canEnterLiveNow;

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
        // Edit stays VISIBLE for admins right up until the evening
        // actually starts — we no longer hide it once kickoff time
        // passes. If the admin pressed "התחל ערב" (active), the item
        // is still shown but tapping it explains why editing is
        // locked instead of silently disappearing. Terminal games
        // (finished/cancelled) drop it entirely — nothing to edit.
        ...(isAdmin && !isTerminalGame(game)
          ? [
              {
                id: 'edit',
                label: he.matchMenuEdit,
                icon: 'create-outline' as const,
                onPress: () => {
                  if (canEditGame(game, { isOrganizerOrAdmin: isAdmin })) {
                    handleEditPress();
                  } else {
                    appAlert(
                      he.matchEditBlockedTitle,
                      he.matchEditBlockedBody,
                    );
                  }
                },
              },
            ]
          : []),
        ...(canEnterLiveNow
          ? [
              {
                id: 'manage',
                // Admins see "ניהול משחק" (full controls). Everyone
                // else sees "צפייה במשחק" — same screen, view-only.
                label: isAdmin ? he.matchMenuManage : he.matchMenuWatchLive,
                icon: 'settings-outline' as const,
                onPress: () => {
                  logEvent(AnalyticsEvent.LiveMatchEntryTapped, {
                    gameId: game.id,
                    source: 'menu',
                    isAdmin,
                  });
                  nav.navigate('LiveMatch', { gameId: game.id });
                },
              },
            ]
          : []),
        // Quick entry to the full players screen — surfaces pending
        // approvals + waitlist for admins without having to scroll
        // back to the inline "הצג הכל" link. Hidden once the game is
        // terminal (finished / cancelled): there's nothing left to
        // manage on a read-only match.
        ...(isAdmin && !isTerminalGame(game)
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
        // Draft Teams (חלוקת כוחות). Manager: if a split already exists,
        // re-open on its SUMMARY (editable — revise, don't restart);
        // otherwise start the captain picker. Needs ≥2 participants
        // (players + guests are both draftable). Hidden on a terminal
        // (finished / cancelled) game — setting teams is a pre-match
        // action, and the match is now read-only.
        ...(isAdmin &&
        !isTerminalGame(game) &&
        game.players.length + activeGuestCount(game.guests) >= 2
          ? [
              {
                id: 'draftTeams',
                label: game.draftTeams ? he.draftEditMenu : he.draftTitle,
                icon: 'shuffle-outline' as const,
                onPress: () => {
                  logEvent(AnalyticsEvent.TeamsFlowOpened, {
                    gameId: game.id,
                    source: 'menu',
                    hasTeams: !!game.draftTeams,
                  });
                  const dt = game.draftTeams;
                  if (dt) {
                    nav.navigate('DraftBoard', {
                      gameId: game.id,
                      captainIds: [...dt.teams]
                        .sort((a, b) => a.index - b.index)
                        .map((t) => t.captainId),
                      method: dt.method,
                      resume: true,
                    });
                  } else {
                    nav.navigate('DraftSetup', { gameId: game.id });
                  }
                },
              },
            ]
          : []),
        // Non-manager: view the saved split read-only — but ONLY once it's
        // published (a draft is invisible to players until "פרסם כוחות").
        ...(!isAdmin && game.draftTeams && game.draftTeams.published !== false
          ? [
              {
                id: 'draftView',
                label: he.draftViewMenu,
                icon: 'people-outline' as const,
                onPress: () => {
                  logEvent(AnalyticsEvent.TeamsFlowOpened, {
                    gameId: game.id,
                    source: 'menu_view',
                    hasTeams: true,
                  });
                  const dt = game.draftTeams!;
                  nav.navigate('DraftBoard', {
                    gameId: game.id,
                    captainIds: [...dt.teams]
                      .sort((a, b) => a.index - b.index)
                      .map((t) => t.captainId),
                    method: dt.method,
                    resume: true,
                    readOnly: true,
                  });
                },
              },
            ]
          : []),
        // ── Regular actions first ──────────────────────────────────
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
        // Register members straight from the community into the game (admin
        // only). Distinct from "invite" — these are added to the roster
        // directly and get a push. ONE unified entry ("צרף חברים מהמועדון"),
        // always available while the game isn't finished/cancelled (the
        // adminAddPlayers callable allows every non-terminal status). When
        // registration hasn't opened yet the flow still reserves the spots
        // under the hood (`reserve`), it's just no longer a separate menu item.
        ...(isAdmin && !isFinished(game) && !isCancelled(game)
          ? [
              {
                id: 'addMembers',
                label: he.matchMenuAddMembers,
                icon: 'people-circle-outline' as const,
                onPress: () =>
                  (nav as { navigate: (s: string, p: unknown) => void }).navigate(
                    'AddMembers',
                    { gameId: game.id, reserve: isScheduled(game) },
                  ),
              },
            ]
          : []),
        // ── Setting ────────────────────────────────────────────────
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
        // ── Destructive actions, grouped at the bottom ─────────────
        // Leave game — only when the user is registered and can
        // still cancel.
        ...(primaryDestructive && canCancelRegistration(game)
          ? [
              {
                id: 'leave',
                label: he.matchMenuLeave,
                icon: 'exit-outline' as const,
                // The confirmation lives inside handlePrimary now, so every
                // cancel entry point gets it — this one included. Prompting
                // here as well would ask twice.
                onPress: handlePrimary,
                tone: 'danger' as const,
              },
            ]
          : []),
        // Stop the weekly fixture — admin only, and only for a match that
        // actually belongs to a series. Ends future occurrences WITHOUT
        // touching any match that already exists, which is the piece that was
        // missing once the recurring toggle left the editor.
        ...(isAdmin && game.seriesId && !isTerminalGame(game)
          ? [
              {
                id: 'stopSeries',
                label: he.stopSeriesAction,
                icon: 'repeat-outline' as const,
                onPress: handleStopSeries,
              },
            ]
          : []),
        // Delete game — admin only, and never on a terminal
        // (finished / cancelled) match: history is read-only, so the
        // destructive "מחק משחק" action disappears once the game ends.
        ...(isAdmin && !isTerminalGame(game)
          ? [
              {
                id: 'delete',
                label: he.deleteGameAction,
                icon: 'trash-outline' as const,
                onPress: handleDeletePress,
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
  // Community rules (free text set in the community form) — surfaced here
  // so every participant sees them before the game (no kickers, no late,
  // bring water, …). Only available for members (myCommunities).
  const communityRules = game.isOrphanContext
    ? undefined
    : myCommunities.find((g) => g.id === game.groupId)?.rules?.trim() ||
      undefined;
  const organizerName = game.createdBy
    ? (playersMap[game.createdBy]?.displayName ?? '').trim() || null
    : null;

  // Resolve a draft participant id (uid → store; guest id → game.guests)
  // to a name/avatar for the inline "הכוחות שחולקו" display.
  const resolveDraftUser = (id: string) => {
    const p = playersMap[id];
    if (p) {
      return { id, name: (p.displayName ?? '').trim() || he.fillerDefaultName, avatarId: p.avatarId, photoUrl: p.photoUrl };
    }
    // Team playerIds store guests PREFIXED (`guest:<id>`); strip it before
    // matching the raw guest id, otherwise the name renders as "…".
    const guestId = id.replace(/^guest:/, '');
    const g = (game.guests ?? []).find((x) => x.id === guestId);
    return { id, name: g?.name ?? '…' };
  };
  // hh:mm for the "went home" summary (Israel locale).
  const fmtHomeTime = (ms?: number) =>
    typeof ms === 'number'
      ? new Date(ms).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
      : '';
  // Remove a guest — triggered by the row's ✕ button (admin only), NOT
  // by tapping the row (tapping a player is reserved for opening their
  // card). `rosterId` is the synthetic `guest:<id>` token.
  const handleRemoveGuest = (rosterId: string) => {
    if (!isAdmin || !user) return;
    const guestId = rosterId.replace(/^guest:/, '');
    const guest = (game.guests ?? []).find((g) => g.id === guestId);
    if (!guest) return;
    appAlert(he.guestRowActionTitle(guest.name), undefined, [
      { text: he.cancel, style: 'cancel' },
      {
        text: he.guestRowActionRemove,
        style: 'destructive',
        onPress: async () => {
          try {
            await gameService.removeGuest(game.id, user.id, guestId);
            setGame((prev) =>
              prev
                ? {
                    ...prev,
                    guests: (prev.guests ?? []).filter((g) => g.id !== guestId),
                  }
                : prev,
            );
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
    ]);
  };

  const draftTeams = game.draftTeams;
  // Draft/publish gate. A fresh split is a DRAFT (`published:false`) the admin
  // is still preparing — visible ONLY to them until they tap "פרסם כוחות".
  // `published` absent/true = published (legacy games + server auto-teams stay
  // visible). So non-admins see NOTHING until the split is published.
  const teamsAreDraft = !!draftTeams && draftTeams.published === false;
  const teamsVisibleToViewer = !!draftTeams && (isAdmin || !teamsAreDraft);
  // "Was this game actually played?" — the live timer was started at least once
  // (set-once, never cleared) or the game is finished. Used to gate summary-only
  // UI (who went home) so it never shows on a game that hasn't kicked off — you
  // can't leave a game that never started.
  const gameWasPlayed =
    game.status === 'finished' || game.liveMatch?.startedAt != null;

  // The "הכוחות שחולקו" section is a RECORD of the starting split — it must NOT
  // change when a player goes home or is substituted mid-match (user request).
  // Once a rotation has started, `rotation.baseTeams` is the frozen snapshot of
  // the starting rosters (preserved across rounds in gameService); before that,
  // `draftTeams.teams` is the split as created. `draftTeams.teams` itself is the
  // LIVE/working roster (mutated by went-home + permanent-fill), so it is used
  // only by the live-match rotation panel, never for this fixed display.
  const splitTeams = resolveSplitTeams(draftTeams, game.rotation);

  // Teams go "stale" when someone registered AFTER the split was saved — i.e. a
  // registered player isn't assigned to any team. We surface a "!" on the
  // section so the admin knows to re-balance. Guests are draftable too, so they
  // count toward the assigned set.
  //
  // Read the SAME array the section renders (`splitTeams`), not `draftTeams.teams`.
  // `teams` is the live/working roster: go-home strips players out of it, so a
  // player who left mid-evening looked like someone who "joined after the split"
  // and the warning fired on a perfectly balanced night — 15/15, three teams of
  // five, and a red "someone joined after teams were divided" over the top
  // (report from Eliran, game 87n2y26N2nsHdMILkKzg: teams [4,5,4] vs original
  // [5,5,5]). A genuine late joiner is in neither array, so they're still caught.
  const teamsStale = isSplitStale(splitTeams, game.players, !!draftTeams);

  // Who may read the finished-evening shortcuts. Playing here is the obvious
  // case; club membership is the one that was missing — a member left off the
  // roster could not open the club's own evening.
  /**
   * The two summary CTAs, through one door.
   *
   * They were `nav.navigate(name, { gameId: game.id })` written twice. If
   * `game.id` is ever empty the navigation still "succeeds" — the destination
   * mounts, finds no id, loads nothing — and the report that reaches us is
   * "the button does nothing", with no error anywhere to look at. A button
   * that cannot do its job should say so out loud, not fail quietly.
   */
  //
  // A plain function, NOT a useCallback: everything down here sits below the
  // screen's early returns, and a hook past one of those changes the hook
  // count between renders — `tests/hooksAfterEarlyReturn` fails the build for
  // it, correctly. Nothing memoises this handler anyway.
  //
  // One destination now, not two: the evening's own summary became the
  // statistics TAB of this screen, so only the PERSONAL summary is still a
  // separate place to go.
  const openSummary = () => {
    const id = game?.id || gameId;
    if (!id) {
      logError('matchSummaryCta', new Error('missing gameId'), {
        screen: 'EveningSummary',
      });
      toast.error(he.summaryOpenFailed);
      return;
    }
    nav.navigate('EveningSummary', { gameId: id });
  };

  const viewerPlayedHere = !!user && (game.players ?? []).includes(user.id);
  const viewerIsClubMember =
    !!user && !!game.groupId && myCommunities.some((c) => c.id === game.groupId);

  // ── Team internal-rating (average) + WhatsApp export ──────────────────────
  const teamsGrp = myCommunities.find((c) => c.id === game.groupId);
  // Same visibility as the individual rating: internal rating on, and either
  // NOT hidden or the viewer is an admin (user request — when the internal
  // rating is hidden in the community settings, only admins see the team score).
  const teamRatingsVisible =
    !!teamsGrp?.internalRating && (!teamsGrp?.hideInternalRating || isAdmin);
  const ratingForRosterId = (id: string): number | undefined => {
    if (id.startsWith('guest:')) {
      const gid = id.slice('guest:'.length);
      return (game.guests ?? []).find((g) => g.id === gid)?.estimatedRating;
    }
    return teamsGrp?.adminRatings?.[id];
  };
  // The average shown must be the average the SPLIT was balanced on, or the
  // screen contradicts the algorithm: unrated players (and guests without an
  // estimate) count as the neutral middle here exactly as they do in
  // `balanceTeams`, and legacy 1–10 values are normalised the same way. Before
  // this, unrated members were simply dropped from the average — so a team the
  // balancer had made equal could still show a lower number.
  const teamAvgRating = (playerIds: string[]): number | undefined => {
    if (!teamRatingsVisible || playerIds.length === 0) return undefined;
    const raw = playerIds.map(ratingForRosterId);
    // Nobody on the team is rated at all → there is no meaningful number to
    // show (a flat "3.0" for every team would be noise, not information).
    if (!raw.some((v) => typeof v === 'number' && v > 0)) return undefined;
    const vals = raw.map((v) =>
      typeof v === 'number' && v > 0 ? normalizeRating(v) : NEUTRAL_RATING,
    );
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  // Export the split to WhatsApp as plain text — names only, NO team or
  // individual ratings (user request).
  const handleExportTeams = async () => {
    // Dot + name both come from the shared team identity, so an admin's chosen
    // colours travel into WhatsApp too — the hardcoded dot list here was one of
    // the places that kept saying red/blue/green after the colours changed.
    const body = [...splitTeams]
      .sort((a, b) => a.index - b.index)
      .map((t) => {
        const names = t.playerIds
          .map((id) => resolveDraftUser(id).name.trim().split(/\s+/)[0])
          .filter(Boolean)
          .join(', ');
        return `${teamDot(t.index, splitTeams)} ${teamName(t.index, splitTeams)}\n${names}`;
      })
      .join('\n\n');
    try {
      await Share.share({ message: `${game.title}\n\n${body}` });
      logEvent(AnalyticsEvent.TeamsExportShared, {
        gameId: game.id,
        numTeams: splitTeams.length,
      });
    } catch {
      /* user dismissed the share sheet */
    }
  };

  // "צרו כוחות" nudge: admin, no split yet, enough draftable people, and
  // kickoff is close (≤24h away, not yet started). Otherwise the only path
  // to create teams is buried in the ☰ menu — easy to miss (feedback).
  const draftablePeople =
    (game.players?.length ?? 0) + activeGuestCount(game.guests);
  const msToKickoff = game.startsAt - Date.now();
  const showCreateTeamsBanner =
    isAdmin &&
    !draftTeams &&
    !isTerminalGame(game) &&
    draftablePeople >= 2 &&
    msToKickoff > -2 * 60 * 60 * 1000 && // allow up to 2h after kickoff
    msToKickoff <= 24 * 60 * 60 * 1000;

  // Teams already exist → the admin manages them (edit / rebalance / redo)
  // from a "נהל כוחות" banner instead of "create".
  const showManageTeamsBanner =
    isAdmin && !!draftTeams && !isTerminalGame(game);

  const openDraftSetup = (source: 'create_banner' | 'manage_banner') => {
    logEvent(AnalyticsEvent.TeamsFlowOpened, {
      gameId: game.id,
      source,
      hasTeams: !!draftTeams,
    });
    nav.navigate('DraftSetup', { gameId: game.id });
  };

  // Tapping the teams section just VIEWS the split (read-only) — no stray
  // "סיים חלוקת כוחות" button on already-saved teams. Editing/rebalancing is
  // done from the "נהל כוחות" banner → DraftSetup.
  const openDraftView = () => {
    if (!draftTeams) return;
    logEvent(AnalyticsEvent.TeamsFlowOpened, {
      gameId: game.id,
      source: 'teams_section',
      hasTeams: true,
    });
    const captainIds = [...draftTeams.teams]
      .sort((a, b) => a.index - b.index)
      .map((t) => t.captainId);
    nav.navigate('DraftBoard', {
      gameId: game.id,
      captainIds,
      method: draftTeams.method,
      resume: true,
      readOnly: true,
    });
  };

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
  // Who currently holds the club's gear (from the group's end-evening handoff).
  // Shown as a read-only badge so everyone knows who should bring it.
  const equipmentGroup = myCommunities.find((g) => g.id === game.groupId);
  const ballHolders = new Set(equipmentGroup?.ballHolderIds ?? []);
  const jerseyHolders = new Set(equipmentGroup?.jerseysHolderIds ?? []);
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
    // Cancel/leave is intentionally NOT a sticky button anymore (user request):
    // the giant red "בטל הרשמה" is gone; the only exit is the ☰ menu's
    // "יציאה מהמשחק" (shown under the same primaryDestructive+canCancel gate).
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

  // The header, built once here and handed to every pane. It scrolls INSIDE a
  // pane rather than sitting fixed above all four — see the note at the top of
  // `MatchTabShell` for why. `heroNode` leaves the screen with the content;
  // `tabBarNode` is pinned by `stickyHeaderIndices` and always stays.
  //
  // `compact` reclaims the 56 points of photo the hero used to leave empty for
  // the old floating stats strip to overlap. Those three facts now live as
  // ordinary rows: two inside "פרטי המחזור", one on the שחקנים tab.
  const heroNode = (
    // The -22 overlap that tucks the tab bar under the hero's bottom now
    // lives HERE, as the hero's own negative bottom margin, instead of on
    // the bar. `stickyHeaderIndices` pins the bar's LAYOUT box at y=0, and
    // a box whose own top sits 22pt above that point loses those 22pt —
    // which is exactly the clipped tab labels the owner reported. Moving
    // the offset to the hero keeps the visual join identical and leaves
    // the sticky child's box starting at its true top.
    <View style={styles.heroWrap}>
        <MatchStadiumHero
          groupId={heroGroupId}
          coverLoading={!!heroGroupId && !memberHeroClub && !publicCoverResolved}
          startsAt={game.startsAt}
          title={game.title}
          // Which season this evening counts in. An evening already stamped
          // shows its own stamp; one that has not kicked off shows the season
          // it WILL land in, which is the club's running one — the stamp is
          // written on the transition to active, not at creation.
          seasonLabel={seasonLabelForGame}
          // The club's own cover, so an evening looks like the club it belongs
          // to (owner request). ONLY for a club game: a one-off has no club to
          // borrow from and keeps the bundled stadium. Read from the club the
          // viewer already has in the store — no extra fetch.
          coverUrl={heroClub?.coverPhotoUrl}
          coverImageId={heroClub?.coverImageId}
          onMenuPress={hasMenuItems ? () => setMenuOpen(true) : undefined}
          compact
          locationLine={locationStr || undefined}
          onBackPress={goBackSafe}
          // Share lives in the header so the sticky CTA at the bottom
          // is free to surface the contextual action (join / cancel /
          // session-action). Hidden for terminal-state games where
          // there's nothing meaningful to share.
          onSharePress={!isTerminalGame(game) ? handleShare : undefined}
          // A game that ended (or was cancelled, or already kicked off)
          // must not still be counting down to its own kickoff.
          countdownHidden={isTerminalGame(game) || isActiveGame(game)}
          // Kickoff behind us and the evening has not ended: say so, because
          // the countdown is gone and the hour alone reads like a future time.
          // A finished or cancelled evening says nothing (owner report).
          showStarted={
            typeof game.startsAt === 'number' &&
            game.startsAt <= Date.now() &&
            !isTerminalGame(game)
          }
          onChatPress={
            user && (game.players.includes(user.id) || user.id === game.createdBy)
              ? () => {
                  logEvent(AnalyticsEvent.ChatEntryPointTapped, {
                    source: 'game_details',
                    scope: 'game',
                    unread: chatUnread,
                  });
                  goToGameChat(game.id);
                }
              : undefined
          }
          chatUnread={chatUnread}
        />
    </View>
  );
  const tabBarNode = (
    // `flush`, NOT a wrapper that adds 22 back. The previous shape tried to
    // cancel `ClubTabs`' own -22 with a +22 on the wrapper, and margins on a
    // parent and its only child do not cancel — they stack: the wrapper moved
    // down 22, the bar moved up 22 inside it, and the bar ended up 22pt above
    // its own parent's top edge. Pinned, those 22pt fall off the top of the
    // viewport (the clipped labels) and on Android a child outside its
    // parent's bounds is never hit-tested, which is why the tabs stopped
    // responding once the hero had scrolled away. The hero's own
    // `marginBottom: -22` already makes the join.
    <ClubTabs<GameTabKey>
      tabs={gameTabs}
      active={tab}
      onChange={showTab}
      flush
      onLockedPress={() =>
        toast.info(!advanced ? he.gdTabLockedToast : he.gdTabMembersToast)
      }
    />
  );

  return (
    <View style={styles.root}>
      {/* The contextual auth sheet. Rendered here rather than over a modal so
          it cannot stack on top of another one — and it unmounts itself the
          moment the person cancels or authenticates, which is what keeps it
          from sitting on screen after the flow has moved on. */}
      {authAction.sheet}
      {/* Confetti host stays permanently mounted (pointerEvents:'none' → never
          hit-tested) and only its INNER overlay toggles. Mounting/unmounting a
          zIndex'd absoluteFill View over the ScrollView left a stale native
          touch region on Fabric — "no button works until I scroll". */}
      <View pointerEvents="none" style={styles.confettiLayer}>
        {celebrate ? (
          <CelebrationOverlay onDone={() => setCelebrate(false)} />
        ) : null}
        <RegistrationSuccessAnimation
          visible={!!regAnim}
          variant={regAnim?.variant ?? 'registered'}
          isLastSpot={regAnim?.isLastSpot}
          onComplete={() => setRegAnim(null)}
        />
        <WaitlistPromotionAnimation
          visible={showPromotion}
          onComplete={() => setShowPromotion(false)}
        />
      </View>
      {/* The status-bar strip. It belongs to the SCREEN, not to the hero:
          the tab bar pins to the top of each pane's scroll, and only a strip
          that sits above the scroll keeps it clear of the clock in both the
          scrolled and unscrolled state. Painted in the app's own dark ground,
          which is what the stadium photo fades into anyway. */}
      <View style={{ height: insets.top, backgroundColor: colors.bg }} />

      {/* Lazy, then kept: a pane is built the first time it is selected and
       *  hidden rather than destroyed afterwards, so switching back is free
       *  and each tab holds its own scroll position. */}
      {seen.has('info') ? (
        <View style={tab === 'info' ? styles.pane : styles.paneHidden}>
          {/* Pull-to-refresh lives on the two tabs built from the game
              document — this one and שחקנים — and refetches exactly that, the
              same `reload` the single scroll view used before the tabs. */}
          <TabScroll
            header={heroNode}
            stickyHeader={tabBarNode}
            bottomInset={ctaHeight}
            refreshing={refreshing}
            onRefresh={() => reload({ pullToRefresh: true })}
          >
            <HeightReveal visible={status === 'waitlist'}>
              {status === 'waitlist' ? <View style={[styles.teamsPointer, { backgroundColor: '#FFF3E6' }]}>
                <Ionicons name="hourglass-outline" size={24} color="#C2410C" />
                <View style={styles.teamsPointerText}>
                  <Text style={styles.teamsPointerTitle}>{user && game.waitlist.indexOf(user.id) >= 0 ? he.roundWaitlistPlace(game.waitlist.indexOf(user.id) + 1) : he.roundWaitlistNoPlace}</Text>
                  <Text style={styles.teamsPointerBody}>{he.roundWaitlistSub}</Text>
                </View>
              </View> : null}
            </HeightReveal>
            {/* The teams pointer.
                
                The teams UI moved to the שחקנים tab, where the roster it
                splits already is. This card is what keeps it findable from
                the first screen: it states the one fact that decides whether
                to split yet — how many are in — and hands over. It is not a
                second way to create teams; tapping it only changes tab. */}
            {showCreateTeamsBanner || showManageTeamsBanner ? (
              <View style={styles.teamsPointer}>
                <View style={styles.teamsPointerText}>
                  <View style={styles.teamsPointerHead}>
                    <Ionicons name="football" size={17} color="#B45309" />
                    <Text style={styles.teamsPointerTitle}>
                      {he.gdTeamsPointerTitle(totalParticipants)}
                    </Text>
                  </View>
                  <Text style={styles.teamsPointerBody}>
                    {showCreateTeamsBanner
                      ? he.gdTeamsPointerCreateBody
                      : he.gdTeamsPointerManageBody}
                  </Text>
                </View>
                <Pressable
                  onPress={() => showTab('players')}
                  style={({ pressed }) => [
                    styles.teamsPointerCta,
                    pressed && { opacity: 0.85 },
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={styles.teamsPointerCtaTx}>
                    {showCreateTeamsBanner
                      ? he.gdTeamsPointerCreateCta
                      : he.gdTeamsPointerManageCta}
                  </Text>
                  <Ionicons name="arrow-back" size={16} color={colors.primary} />
                </Pressable>
              </View>
            ) : null}

            {/* Filler-candidate banner — a non-member who reached this game via a
                fillerOpportunity push. They can't join directly; they apply and
                the admin approves. */}
            {isFillerCandidate ? (
              <View style={styles.fillerBanner}>
                {/* Vertical layout: the note gets the full width (no longer squeezed
                    by an inline button → no truncation), and the action is a normal
                    full-width "בקש להצטרף" button like every other join CTA (user
                    report). Underneath it still runs the filler application → admin
                    approval; only the label + shape changed. */}
                <View style={styles.fillerBannerHead}>
                  <Text style={styles.fillerBannerTitle}>{he.fillerApplyTitle}</Text>
                  <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
                </View>
                <Text style={styles.fillerBannerSub}>
                  {fillerState === 'sent' ? he.fillerApplySentSub : he.fillerApplySub}
                </Text>
                {fillerState === 'sent' ? (
                  <View style={styles.fillerSentChip}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                    <Text style={styles.fillerSentTxt}>{he.fillerApplySentChip}</Text>
                  </View>
                ) : (
                  <Button
                    title={he.gameCardRequestJoin}
                    variant="primary"
                    fullWidth
                    loading={fillerState === 'submitting'}
                    disabled={fillerState === 'submitting'}
                    onPress={onApplyAsFiller}
                  />
                )}
              </View>
            ) : null}

            {/* Tonight decides the season.
                Above the pinned note on purpose: it is not the admin talking,
                it is the state of the competition, and it should be the first
                thing read under the header. Only while the evening is still to
                come or under way — announcing a final round on a game that
                already finished is a fact about last week. */}
            {/* The season is inside its 24-hour correction window, so this
                evening cannot start yet. Said HERE rather than only in the
                dialog behind the start button: a club opened an evening, seven
                people registered, and they found out at kickoff. It clears
                itself — `pendingClose` is deleted by the close, so nothing has
                to remember to take this down. Above the final-round banner,
                because a blocker outranks encouragement. */}
            {seasonClosing && !isTerminalGame(game) ? (
              <View style={styles.seasonClosingBanner}>
                <Ionicons name="time-outline" size={16} color="#92400E" />
                <Text style={styles.seasonClosingText}>
                  {he.seasonClosingGameBanner}
                </Text>
              </View>
            ) : null}

            {finalRoundOfSeason && !isTerminalGame(game) ? (
              <View style={styles.finalRoundBanner}>
                <Ionicons name="flame" size={16} color={colors.danger} />
                <Text style={styles.finalRoundText}>{he.seasonFinalRoundBanner}</Text>
              </View>
            ) : null}

            {/* Admin-pinned announcement. Renders nothing for non-admins
                when there's no message; admins always see at least the
                empty "+ הוסף הודעה" tile. */}
            <PinnedAdminMessageCard
              message={game.pinnedMessage}
              // On a terminal (finished / cancelled) game the admin
              // controls disappear: no "+ הוסף הערה לכולם" tile and no
              // edit affordance. A non-admin viewer with an existing
              // pinned note still sees it read-only (PinnedAdminMessageCard
              // renders the message for everyone; isAdmin only gates the
              // add/edit UI).
              isAdmin={isAdmin && !isTerminalGame(game)}
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
                omitted here because the row above already
                surfaces them. */}
            <MatchFactsRow
              ruleTags={game.ruleTags}
              hasReferee={game.hasReferee}
              hasPenalties={game.hasPenalties}
              hasHalfTime={game.hasHalfTime}
            />

            {/* (Average-rating badge removed per owner request — the internal
                rating is admin-only and shouldn't surface a public average.) */}

            {/* Community rules — free text from the community form, shown
                to every participant. Amber tint = "behaviour expectations".
                Sits below the roster + waitlist (per user feedback). */}
            {communityRules ? (
              <View style={styles.rulesCard}>
                <View style={styles.rulesHeader}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={16}
                    color="#B45309"
                  />
                  <Text style={styles.rulesTitle}>{he.communityRulesTitle}</Text>
                </View>
                {/* Collapsible (קרא עוד / הצג פחות) — same behaviour as the rules
                    card on CommunityDetails, so a long rules block never fills
                    the whole screen. */}
                <CollapsibleContent>
                  <RichRulesText text={communityRules} baseStyle={styles.rulesBody} />
                </CollapsibleContent>
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

            {/* "Navigate to the field" — the most common thing a person does
                from this screen, so it sits ABOVE the details card where it is
                reachable without reading past six rows first (owner report; it
                was briefly moved below and moved straight back). The location
                row keeps its own small icon; this is the full-width version of
                the same action, and it renders only with enough for Waze. */}
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
                // What the organiser wrote about the evening leads the card —
                // it is the only row in free prose, and it is what a person
                // scans for first. Omitted entirely when there is none: the
                // grid prints an absent value as "—", and a row reading
                // "הערות —" is an empty section, not a fact.
                ...(typeof game.notes === 'string' && game.notes.trim()
                  ? [
                      {
                        icon: 'reader-outline' as const,
                        label: he.matchDetailsLabelNotes,
                        value: game.notes,
                        multiline: true, // show the full note, never clamp it
                      },
                    ]
                  : []),
                // Field-name row removed per user feedback (Pulse AbwW4G) — the
                // location row below already answers "where do I drive?", so the
                // venue nickname was a redundant extra line.
                // Unified city + address row. The two fields conceptually
                // describe the same thing ("where do I drive?"), and the
                // Waze button belongs HERE — not on the field-name row
                // (which is just the venue's nickname). We join them as
                // "<city>, <address>" when both exist; otherwise show
                // whichever one we have.
                {
                  icon: 'location-outline',
                  label: he.matchDetailsLabelLocation,
                  // Only prepend the city when the address doesn't already
                  // contain it — most free-text games store the full address
                  // ("עזריה 21, תל־אביב–יפו") so a naive join repeated the city.
                  value: (() => {
                    const addr = (game.fieldAddress ?? '').trim();
                    const city = (game.city ?? '').trim();
                    if (addr && city && !addr.toLowerCase().includes(city.toLowerCase())) {
                      return `${city}, ${addr}`;
                    }
                    return addr || city || null;
                  })(),
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
                    ? gameFormatLabel(game.format).replace(/ /g, '')
                    : null,
                },
                // One-time games (or any game with no real community to show)
                // OMIT the "מועדון" row entirely — the grid renders empty values
                // as "—", so a one-time game would otherwise read "מועדון —".
                // Keyed on the resolved name (not just isOrphanContext, which
                // older quick-created games may not have set). (Pulse odLGvyv.)
                ...(game.isOrphanContext || !communityName
                  ? []
                  : [
                      {
                        icon: 'people-outline' as const,
                        label: he.matchDetailsLabelCommunity,
                        value: communityName,
                        action:
                          communityName && game.groupId
                            ? {
                                icon: 'open-outline' as const,
                                onPress: () =>
                                  (
                                    nav as {
                                      navigate: (s: string, p: unknown) => void;
                                    }
                                  ).navigate(clubRouteFor(game.groupId), {
                                    groupId: game.groupId,
                                  }),
                                accessibilityLabel: 'פתח את עמוד המועדון',
                              }
                            : undefined,
                      },
                    ]),
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
                // Duration and weather: two facts that used to sit in a strip
                // of cards above this card. They are properties of the evening
                // like every other row here, and a row is all they need.
                ...(typeof game.matchDurationMinutes === 'number' &&
                game.matchDurationMinutes > 0
                  ? [
                      {
                        icon: 'time-outline' as const,
                        label: he.matchStatsDuration,
                        value: he.gdDetailDuration(game.matchDurationMinutes),
                      },
                    ]
                  : []),
                // No forecast, no row. The grid prints an absent value as "—",
                // and "מזג אוויר —" is worse than saying nothing: it reads as a
                // fact we are withholding rather than one we never had.
                ...(forecast
                  ? [
                      {
                        icon: weatherRowIcon(forecast.weatherCode),
                        label: he.matchStatsWeather,
                        value: he.gdDetailWeather(
                          forecast.tempC,
                          skyLabel(forecast.weatherCode),
                          // A rain chance is only worth the words when there is
                          // one. Below a fifth, it is noise on a dry evening.
                          forecast.rainProb >= 20 ? forecast.rainProb : null,
                        ),
                      },
                    ]
                  : []),
              ]}
            />

            {primaryDestructive && canCancelRegistration(game) ? (
              <Pressable
                onPress={handlePrimary}
                style={({ pressed }) => [
                  styles.cancelRegBtn,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={he.matchDetailsCancel}
              >
                <Ionicons name="close-circle-outline" size={18} color="#fff" />
                <Text style={styles.cancelRegBtnText}>{he.matchDetailsCancel}</Text>
              </Pressable>
            ) : null}
          </TabScroll>
        </View>
      ) : null}

      {seen.has('games') ? (
        <View style={tab === 'games' ? styles.pane : styles.paneHidden}>
          {/* The mini-games list, embedded rather than re-implemented. It owns
              the `roundHistory` query and its own empty state; all this tab
              adds is the colour filter and the reason the list is empty, which
              the list itself cannot know — it sees no rounds either way. */}
          <MatchRoundsScreen
            gameId={game.id}
            embedded
            showFilter
            hasPlayed={eveningHasPlayed}
            header={heroNode}
            stickyHeader={tabBarNode}
            bottomInset={ctaHeight}
          />
        </View>
      ) : null}

      {seen.has('stats') ? (
        <View style={tab === 'stats' ? styles.pane : styles.paneHidden}>
          <MatchStatsTab
            header={heroNode}
            stickyHeader={tabBarNode}
            game={game}
            summary={roundSummary}
            nameOf={summaryNameOf}
            userOf={summaryUserOf}
            hasPlayed={eveningHasPlayed}
            showPersonalSummary={isFinished(game) && viewerPlayedHere}
            onOpenPersonalSummary={openSummary}
            championshipRefreshKey={retroRefreshKey}
            bottomInset={ctaHeight}
            // Admin-only: complete a goal missed during the evening. It sits
            // directly above the scorers table, which is where the admin
            // notices the gap — the table moved into this tab, and the button
            // moved with it rather than being left behind on another one.
            adminExtras={
              isFinished(game) && isAdmin ? (
                <Pressable
                  style={({ pressed }) => [styles.retroBtn, pressed && { opacity: 0.85 }]}
                  onPress={() => {
                    logEvent(AnalyticsEvent.RetroGoalsOpened, {
                      gameId: game.id,
                      roster: (game.players ?? []).length,
                    });
                    setRetroOpen(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={he.retroEntryCta}
                >
                  <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.retroBtnText}>{he.retroEntryCta}</Text>
                </Pressable>
              ) : null
            }
          />
        </View>
      ) : null}

      {seen.has('players') ? (
        <View style={tab === 'players' ? styles.pane : styles.paneHidden}>
          {/* The REAL roster, not a preview. It used to be three rows behind a
              "הצג הכל" link into a separate screen; the owner asked for the
              full list here with the admin rating, the ⋮ menu and the join
              time, and for that link to go. Rather than rebuild any of it,
              `MatchPlayersScreen` renders embedded — one definition, two
              placements — so the waitlist, cancellations, admin removals,
              promote/demote and guest editing all come along unchanged.
              The two summary counters ride above it as `leading`. */}
          <MatchPlayersScreen
            gameId={game.id}
            embedded
            header={heroNode}
            stickyHeader={tabBarNode}
            bottomInset={ctaHeight}
            leading={
              <>
                {/* The teams section, moved here from מידע: it splits the
                    roster, and the roster is on this tab. */}
                {/* "צרו כוחות" nudge — kickoff is close and no split exists yet.
                    Without this, creating teams is buried in the ☰ menu. */}
                {showCreateTeamsBanner ? (
                  <Pressable
                    style={styles.createTeamsBanner}
                    onPress={() => openDraftSetup('create_banner')}
                    accessibilityRole="button"
                  >
                    <View style={styles.createTeamsIcon}>
                      <Ionicons name="shuffle" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.createTeamsTitle}>
                        {he.matchCreateTeamsBannerTitle}
                      </Text>
                      <Text style={styles.createTeamsSub}>
                        {he.matchCreateTeamsBannerSub}
                      </Text>
                      {/* If auto-teams is SCHEDULED, tell the admin exactly when it
                          will fire (Pulse request). */}
                      {game.autoTeamsAt && game.autoTeamsAt > Date.now() ? (
                        <Text style={styles.createTeamsAutoNote}>
                          {he.matchAutoTeamsScheduled(
                            `${formatDayDate(game.autoTeamsAt)} · ${formatTime(game.autoTeamsAt)}`,
                          )}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="chevron-back" size={20} color={colors.primary} />
                  </Pressable>
                ) : null}

                {showManageTeamsBanner ? (
                  <Pressable
                    style={styles.createTeamsBanner}
                    onPress={() => openDraftSetup('manage_banner')}
                    accessibilityRole="button"
                  >
                    <View style={styles.createTeamsIcon}>
                      <Ionicons name="options" size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.createTeamsTitle}>
                        {he.matchManageTeamsBannerTitle}
                      </Text>
                      <Text style={styles.createTeamsSub}>
                        {he.matchManageTeamsBannerSub}
                      </Text>
                    </View>
                    <Ionicons name="chevron-back" size={20} color={colors.primary} />
                  </Pressable>
                ) : null}
                {/* The drawn teams, with "פרסם כוחות" and "ייצא כוחות לוואטסאפ".
                
                This block was lost when the שחקנים tab stopped being a preview
                and became the embedded players screen: the pane it lived in
                was replaced wholesale, and the split, the publish button and
                the WhatsApp export went with it (owner: "כל החלק של הכוחות
                נעלם!"). It is back, unchanged, and now sits where it belongs —
                above the roster it divides, on the tab that owns the roster. */}
                {teamsVisibleToViewer ? (
                  <View style={styles.draftSection}>
                    <Pressable
                      style={styles.draftSectionHeader}
                      onPress={openDraftView}
                      accessibilityRole="button"
                    >
                      {/* RTL: title sits on the right (the leading edge), the
                          chevron affordance on the left (QA request). */}
                      <View style={styles.draftTitleRow}>
                        <Text style={styles.draftSectionTitle}>{he.draftTeamsSectionTitle}</Text>
                        {teamsAreDraft ? (
                          <View style={styles.draftBadge}>
                            <Ionicons name="eye-off-outline" size={12} color={colors.warning} />
                            <Text style={styles.draftBadgeText}>{he.draftTeamsDraftBadge}</Text>
                          </View>
                        ) : null}
                        {teamsStale ? (
                          <View style={styles.staleBadge}>
                            <Text style={styles.staleBadgeText}>!</Text>
                          </View>
                        ) : null}
                      </View>
                      <Ionicons name="chevron-back" size={18} color={colors.textMuted} />
                    </Pressable>
                    {teamsAreDraft ? (
                      <Text style={styles.draftHint}>{he.draftTeamsDraftHint}</Text>
                    ) : null}
                    {teamsStale ? (
                      <Text style={styles.staleHint}>{he.draftTeamsStaleHint}</Text>
                    ) : null}
                    <View style={styles.draftSectionList}>
                      {[...splitTeams]
                        .sort((a, b) => a.index - b.index)
                        .map((t) => (
                          <ChangeMotion key={t.index} triggerKey={`${game.id}:${teamsAreDraft}:${t.playerIds.join(',')}`} enter duration={300} delay={Math.min(t.index, 3) * 50}>
                          <DraftTeamCard
                            index={t.index}
                            colorKey={t.colorKey}
                            captain={resolveDraftUser(t.captainId)}
                            members={t.playerIds.slice(1).map(resolveDraftUser)}
                            teamRating={teamAvgRating(t.playerIds)}
                            onPressUser={(id) => {
                              if ((game.guests ?? []).some((g) => g.id === id)) return;
                              nav.navigate('PlayerCard', {
                                userId: id,
                                groupId: game.groupId,
                              });
                            }}
                          />
                          </ChangeMotion>
                        ))}
                    </View>
                    {isAdmin && teamsAreDraft ? (
                      <View style={styles.publishTeamsWrap}>
                        <Button
                          title={he.draftPublishCta}
                          onPress={handlePublishTeams}
                          loading={publishingTeams}
                          fullWidth
                          size="lg"
                          iconLeft="megaphone-outline"
                        />
                      </View>
                    ) : null}
                    <Pressable
                      onPress={handleExportTeams}
                      style={styles.exportTeamsBtn}
                      accessibilityRole="button"
                    >
                      {/* Icon AFTER text → visual-left under forceRTL (user request). */}
                      <Text style={styles.exportTeamsText}>
                        {he.draftExportWhatsapp}
                      </Text>
                      <Ionicons
                        name="share-social-outline"
                        size={16}
                        color={colors.primary}
                      />
                    </Pressable>
                    {/* "הלכו הביתה" summary — who left mid-evening and when, kept on
                        draftTeams.leftHome (with its timestamp) so it survives into
                        the finished-game recap. Shown ONLY for a game that was
                        actually played (live-started or finished) — never on a
                        pre-match/not-started game, where "went home" makes no sense. */}
                    {gameWasPlayed && (draftTeams.leftHome ?? []).length > 0 ? (
                      <View style={styles.leftHomeSummary}>
                        <Text style={styles.leftHomeSummaryTitle}>
                          {he.wentHomeSectionTitle}
                        </Text>
                        {[...(draftTeams.leftHome ?? [])]
                          .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
                          .map((l) => (
                            <View key={l.playerId} style={styles.leftHomeRow}>
                              <Text style={styles.leftHomeName} numberOfLines={1}>
                                {resolveDraftUser(l.playerId).name}
                              </Text>
                              {l.at ? (
                                <Text style={styles.leftHomeTime}>{fmtHomeTime(l.at)}</Text>
                              ) : null}
                            </View>
                          ))}
                      </View>
                    ) : null}
                    {/* Team feedback. Members react 👍/👎 to the PROPOSED teams BEFORE
                        the game — a pre-match "are these balanced?" reaction. Hidden
                        once the game is terminal (finished/cancelled): there's nothing
                        left to react to or re-send. Also hidden while the split is an
                        unpublished DRAFT — no player has seen it yet. */}
                    {!isTerminalGame(game) && !teamsAreDraft && (() => {
                      const fb = game.draftTeamFeedback ?? {};
                      const likes = Object.values(fb).filter((v) => v === 'like').length;
                      const dislikes = Object.values(fb).filter(
                        (v) => v === 'dislike',
                      ).length;
                      const mine = user ? fb[user.id] : undefined;
                      const isParticipant = !!user && game.players.includes(user.id);
                      return (
                        <View style={styles.teamFbWrap}>
                          {isParticipant ? (
                            <View style={styles.teamFbRow}>
                              <Text style={styles.teamFbPrompt}>
                                {he.teamFeedbackPrompt}
                              </Text>
                              <View style={styles.teamFbBtns}>
                                <Pressable
                                  onPress={() => void handleSetTeamFeedback('like')}
                                  style={[
                                    styles.teamFbBtn,
                                    mine === 'like' && styles.teamFbBtnLikeOn,
                                  ]}
                                  accessibilityRole="button"
                                >
                                  <Ionicons
                                    name={mine === 'like' ? 'thumbs-up' : 'thumbs-up-outline'}
                                    size={18}
                                    color={mine === 'like' ? colors.success : colors.textMuted}
                                  />
                                </Pressable>
                                <Pressable
                                  onPress={() => void handleSetTeamFeedback('dislike')}
                                  style={[
                                    styles.teamFbBtn,
                                    mine === 'dislike' && styles.teamFbBtnDislikeOn,
                                  ]}
                                  accessibilityRole="button"
                                >
                                  <Ionicons
                                    name={
                                      mine === 'dislike'
                                        ? 'thumbs-down'
                                        : 'thumbs-down-outline'
                                    }
                                    size={18}
                                    color={mine === 'dislike' ? colors.danger : colors.textMuted}
                                  />
                                </Pressable>
                              </View>
                            </View>
                          ) : null}
                          {isAdmin ? (
                            <View style={styles.teamFbAdminRow}>
                              <Text style={styles.teamFbAgg}>
                                {he.teamFeedbackAggregate(likes, dislikes)}
                              </Text>
                              <Pressable
                                onPress={() => void handleNotifyTeams()}
                                disabled={notifyingTeams}
                                style={[
                                  styles.teamFbNotify,
                                  notifyingTeams && styles.teamFbNotifyBusy,
                                ]}
                                accessibilityRole="button"
                              >
                                {/* Icon AFTER text → visual-left under forceRTL. */}
                                <Text style={styles.teamFbNotifyText}>
                                  {he.autoBalanceNotifyPlayers}
                                </Text>
                                <Ionicons
                                  name="notifications-outline"
                                  size={16}
                                  color={colors.primary}
                                />
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })()}
                  </View>
                ) : null}

                <MatchPlayerCounters
                  registered={`${totalParticipants}/${game.maxPlayers}`}
                  waiting={
                    (game.waitlist ?? []).length +
                    (game.guests ?? []).filter((g) => g.waitlisted).length
                  }
                />

                {/* "הוסף אורח". It used to hang off the roster preview's
                    header, and vanished with that preview when this tab became
                    the embedded players screen (owner: "תחזיר את ה'הוסף אורח'!
                    הוא נעלם!"). The modal and `canAddGuest` were never touched
                    — only the button that opens them went — so this is the
                    same gate and the same sheet, given a place to live.
                    Directly above the roster, which is what it adds to. */}
                {canAddGuest(game, {
                  isOrganizerOrAdmin: isAdmin,
                  isParticipant:
                    !!user &&
                    (game.players.includes(user.id) ||
                      (game.waitlist ?? []).includes(user.id)),
                }) ? (
                  <Pressable
                    onPress={() => setGuestModalOpen(true)}
                    style={({ pressed }) => [
                      styles.addGuestRow,
                      pressed && { opacity: 0.85 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={he.guestAddButton}
                  >
                    <Ionicons
                      name="person-add-outline"
                      size={17}
                      color={colors.primary}
                    />
                    <Text style={styles.addGuestRowText}>
                      {he.guestAddButton}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            }
          />
        </View>
      ) : null}

      {/* Sticky bottom CTA — pinned to the bottom of the screen so
          the contextual action (join / cancel / start session / etc.)
          is always within thumb reach without scrolling past the
          participants + match-details sections. Share lives in the
          header now, so this bar is hidden entirely when there's no
          meaningful contextual action — see `ctaState`. */}
      {ctaState ? (
        <View
          // box-none: the absolute bar itself isn't touchable (only its button
          // child), so its hit-rect can't swallow taps meant for the scroll.
          pointerEvents="box-none"
          onLayout={(e) => setCtaHeight(e.nativeEvent.layout.height)}
          style={[
            styles.stickyCta,
            ctaState?.tone === 'blocked' && styles.ctaBlocked,
          ]}
        >
          {ctaState ? (
            <>
              <Pressable
                onPress={ctaState.onPress}
                disabled={busy}
                style={({ pressed }) => [
                  styles.inviteCta,
                  ctaState.tone === 'destructive' &&
                    styles.inviteCtaDestructive,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={ctaState.label}
              >
                {/* Text first so the icon lands on the visual LEFT (forceRTL
                    flips `row`: last child → visual left). */}
                <Text style={styles.inviteCtaText}>{ctaState.label}</Text>
                <Ionicons name={ctaState.icon} size={18} color="#FFFFFF" />
              </Pressable>
              {ctaState.tone === 'blocked' ? (
                <Text style={styles.ctaHelper}>
                  {he.registrationConflictHelper}
                </Text>
              ) : null}
            </>
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
          // No club behind a quick game → no guest rating (see GuestModal).
          ratingEnabled={game.isOrphanContext !== true}
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
            await gameService.deleteGame(game.id, user?.id);
            setDeleteOpen(false);
            toast.success(he.deleteGameSuccess);
            nav.goBack();
          } catch (err) {
            if (__DEV__) console.warn('[matchDetails] delete failed', err);
            toast.error(he.error);
          }
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

      {game ? (
        <RetroGoalsSheet
          visible={retroOpen}
          gameId={game.id}
          roster={retroRoster}
          onClose={() => setRetroOpen(false)}
          onChanged={() => setRetroRefreshKey((k) => k + 1)}
        />
      ) : null}
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
  // A tab pane is hidden, not unmounted, so it keeps its scroll position and
  // its loaded data. `display:'none'` is what makes that free — the subtree
  // stays mounted but is skipped by layout entirely.
  // The teams pointer: the same amber the community-rules card uses, so the
  // two read as one family of "notes about this evening" rather than two
  // unrelated highlights. Row, so the CTA sits on the leading (left) edge
  // opposite the text — icon first in source order keeps it rightmost.
  teamsPointer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  teamsPointerText: { flex: 1, gap: 2 },
  teamsPointerHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  teamsPointerTitle: {
    ...typography.label,
    color: '#B45309',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  teamsPointerBody: {
    ...typography.caption,
    color: '#92400E',
    textAlign: RTL_LABEL_ALIGN,
  },
  teamsPointerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryLight,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  teamsPointerCtaTx: {
    ...typography.bodyBold,
    fontSize: 14,
    color: colors.primary,
  },
  // Full width, unlike the little pill the roster header used to carry: it is
  // its own row here rather than a corner of somebody else's heading.
  addGuestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  addGuestRowText: {
    ...typography.bodyBold,
    fontSize: 15,
    color: colors.primary,
  },
  heroWrap: { marginBottom: -22 },
  pane: { flex: 1 },
  paneHidden: { display: 'none' },
  root: { flex: 1, backgroundColor: colors.bg },
  // "סיכום הערב שלי" — shareable summary CTA below the finished-game table.
  summaryCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  // Same shape as the personal CTA below it, a shade darker: they are a pair,
  // and the club's evening is the one that leads.
  roundSummaryCta: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.primaryDark,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  summaryCtaTxt: { color: '#fff', fontSize: 15, fontWeight: '800' },
  // Same footprint as the two CTAs above it so the block keeps its rhythm, but
  // visibly inert — there is nothing to tap.
  summaryPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  summaryPlaceholderTxt: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    flexShrink: 1,
  },
  roundsCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  roundsCtaIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundsCtaText: { flex: 1 },
  roundsCtaTitle: {
    color: '#fff',
    fontSize: 15.5,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  roundsCtaSub: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    marginTop: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  cancelRegBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  cancelRegBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  // "השלם גול שהוחמץ" — admin action above the finished-game scorers table.
  retroBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
  },
  retroBtnText: { ...typography.body, color: colors.primary, fontWeight: '800' },
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
    // Waze icon on the LEFT of the label (QA request).
    flexDirection: 'row-reverse',
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
  /** The close window. Amber, not red — it is a wait, not a problem, and the
   *  final-round banner below it owns the red. */
  seasonClosingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  seasonClosingText: {
    ...typography.label,
    color: '#92400E',
    fontWeight: '800',
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
  },
  /** The season's last evening. Red, bold and right-aligned, with a flame —
   *  it is the one banner on this screen that is about the competition rather
   *  than about this game, so it is allowed to shout. */
  finalRoundBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    backgroundColor: '#FEE2E2',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  finalRoundText: {
    ...typography.label,
    color: colors.danger,
    fontWeight: '900',
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
  },
  body: {
    paddingHorizontal: spacing.lg,
    gap: spacing.xl,
  },

  // Inline pending-approval card (admins, on MatchDetails).
  pendingCard: { padding: spacing.md, gap: spacing.xs, marginBottom: spacing.md },
  pendingTitle: {
    ...typography.bodyBold,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
    marginBottom: spacing.xs,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pendingRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pendingWho: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pendingName: { flex: 1, minWidth: 0, ...typography.body, color: colors.text, fontWeight: '700', textAlign: RTL_LABEL_ALIGN },
  pendingApprove: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingReject: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
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
  fillerBanner: {
    flexDirection: 'column',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    // Clear the statsFloat's marginTop:-36 pull so it can't overlap/clip the
    // banner (the sub-text used to get cut off by the floating stats card).
    marginBottom: 44,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceMuted,
    zIndex: 2,
  },
  fillerBannerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fillerBannerTitle: {
    ...typography.bodyBold,
    color: colors.text,
    flex: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  fillerBannerSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  fillerSentChip: { flexDirection: 'row-reverse', alignItems: 'center', gap: 4 },
  fillerSentTxt: { ...typography.caption, color: colors.success, fontWeight: '700' },
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
  rulesCard: {
    backgroundColor: '#FEF3C7',
    borderRadius: 14,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    gap: 6,
  },
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rulesTitle: {
    ...typography.label,
    color: '#B45309',
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  rulesBody: {
    ...typography.body,
    color: '#78350F',
    textAlign: RTL_LABEL_ALIGN,
    lineHeight: 21,
  },
  draftSection: { marginTop: spacing.lg, gap: spacing.sm },
  draftSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  draftSectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  draftSectionList: { gap: spacing.sm },
  exportTeamsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  exportTeamsText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  leftHomeSummary: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.surfaceMuted,
    gap: 6,
  },
  leftHomeSummaryTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  leftHomeRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leftHomeName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, textAlign: RTL_LABEL_ALIGN },
  leftHomeTime: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  teamFbWrap: {
    marginTop: spacing.sm,
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  teamFbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamFbPrompt: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: RTL_LABEL_ALIGN,
  },
  teamFbBtns: { flexDirection: 'row', gap: spacing.sm },
  teamFbBtn: {
    width: 38,
    height: 34,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  teamFbBtnLikeOn: {
    borderColor: colors.success,
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  teamFbBtnDislikeOn: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(239,68,68,0.10)',
  },
  teamFbAdminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  teamFbAgg: { ...typography.caption, color: colors.text, fontWeight: '800' },
  teamFbNotify: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  teamFbNotifyText: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '800',
  },
  teamFbNotifyBusy: { opacity: 0.5 },
  draftTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  staleBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  staleBadgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  staleHint: {
    ...typography.caption,
    color: '#B45309',
    textAlign: RTL_LABEL_ALIGN,
    paddingHorizontal: spacing.xs,
  },
  draftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 20,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: `${colors.warning}22`,
  },
  draftBadgeText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: '800',
  },
  draftHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
    paddingHorizontal: spacing.xs,
    lineHeight: 18,
  },
  publishTeamsWrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  createTeamsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // No marginTop: the banner used to sit mid-list in "מידע" and needed its
    // own air. It now leads the שחקנים tab, whose container already spaces its
    // children — the margin only pushed it away from the top edge.
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: '#EAF1FF',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  createTeamsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  createTeamsTitle: {
    ...typography.body,
    color: colors.text,
    fontWeight: '800',
    textAlign: RTL_LABEL_ALIGN,
  },
  createTeamsSub: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: RTL_LABEL_ALIGN,
  },
  createTeamsAutoNote: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
    textAlign: RTL_LABEL_ALIGN,
    marginTop: 3,
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
