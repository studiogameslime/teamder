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
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { SoccerBallLoader } from '@/components/SoccerBallLoader';
import { PlayerIdentity } from '@/components/PlayerIdentity';
import { GuestModal } from '@/components/GuestModal';
import { ConfirmDestructiveModal } from '@/components/ConfirmDestructiveModal';
import { toast } from '@/components/Toast';
import { gameService } from '@/services/gameService';
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
import { colors, shadows, spacing, typography } from '@/theme';
import { he } from '@/i18n/he';
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

function formatDateLong(ms: number): string {
  const d = new Date(ms);
  const days = [
    'יום ראשון',
    'יום שני',
    'יום שלישי',
    'יום רביעי',
    'יום חמישי',
    'יום שישי',
    'שבת',
  ];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${day} · ${dd}/${mm} · ${hh}:${mn}`;
}

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
    return game.liveMatch?.phase === 'live' ? 'active' : 'teams_ready';
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
function buildShuffledLiveMatch(game: Game): LiveMatchState {
  const ids: UserId[] = [
    ...game.players,
    ...(game.guests ?? []).map((g) => toGuestRosterId(g.id)),
  ];
  // Fisher-Yates.
  const shuffled = ids.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const slotsPerTeam =
    game.format === '6v6' ? 6 : game.format === '7v7' ? 7 : 5;
  const buckets = Math.min(Math.max(game.numberOfTeams ?? 2, 2), 5);
  const letters: Array<'A' | 'B' | 'C' | 'D' | 'E'> = ['A', 'B', 'C', 'D', 'E'];

  const assignments: Record<UserId, LiveMatchZone> = {};
  const teamASlots: Record<UserId, number> = {};
  const teamBSlots: Record<UserId, number> = {};
  const benchOrder: UserId[] = [];
  let teamACounter = 0;
  let teamBCounter = 0;

  shuffled.forEach((uid, i) => {
    const bucketIdx = Math.floor(i / slotsPerTeam);
    const positionInBucket = i % slotsPerTeam;
    if (bucketIdx >= buckets) {
      assignments[uid] = 'bench';
      benchOrder.push(uid);
      return;
    }
    if (bucketIdx === 0) {
      if (positionInBucket === 0) {
        assignments[uid] = 'gkA';
      } else {
        assignments[uid] = 'teamA';
        teamASlots[uid] = teamACounter++;
      }
    } else if (bucketIdx === 1) {
      if (positionInBucket === 0) {
        assignments[uid] = 'gkB';
      } else {
        assignments[uid] = 'teamB';
        teamBSlots[uid] = teamBCounter++;
      }
    } else {
      const letter = letters[bucketIdx];
      assignments[uid] = `team${letter}` as LiveMatchZone;
    }
  });

  return {
    phase: 'organizing',
    assignments,
    benchOrder,
    scoreA: 0,
    scoreB: 0,
    scoreC: 0,
    scoreD: 0,
    scoreE: 0,
    teamASlots,
    teamBSlots,
    lateUserIds: [],
  };
}

export function MatchDetailsScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Params>();
  const gameId = route.params.gameId;
  const user = useUserStore((s) => s.currentUser);
  const myCommunities = useGroupStore((s) => s.groups);
  const hydratePlayers = useGameStore((s) => s.hydratePlayers);
  const playersMap = useGameStore((s) => s.players);

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [guestModalOpen, setGuestModalOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const g = await gameService.getGameById(gameId);
      setGame(g);
      if (g) {
        logEvent(AnalyticsEvent.GameViewed, { gameId: g.id, status: g.status });
        const uids = Array.from(
          new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
        );
        if (uids.length > 0) hydratePlayers(uids);
      }
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] reload failed', err);
    } finally {
      setLoading(false);
    }
  }, [gameId, hydratePlayers]);

  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    React.useCallback(() => {
      reload();
    }, [reload]),
  );

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

  const adminUids = useMemo(() => {
    if (!game) return new Set<string>();
    const ids = new Set<string>();
    if (game.createdBy) ids.add(game.createdBy);
    const grp = myCommunities.find((c) => c.id === game.groupId);
    grp?.adminIds.forEach((id) => ids.add(id));
    return ids;
  }, [game, myCommunities]);

  const handlePrimary = async () => {
    if (!user || !game) return;
    const status = statusForUser(game, user.id);
    setBusy(true);
    try {
      if (status === 'joined' || status === 'waitlist' || status === 'pending') {
        await gameService.cancelGameV2(game.id, user.id);
      } else {
        await gameService.joinGameV2(game.id, user.id);
      }
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] primary failed', err);
    } finally {
      setBusy(false);
    }
  };

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
  // Cleaned-on-render assignment map. Used by the teams renderer so a
  // stale uid (player removed after the team was set) never surfaces.
  const validity = teamsValidity(game);

  /**
   * Admin tap on "צור כוחות". Auto-shuffles the registered roster into
   * teams (using the game's format + numberOfTeams) and persists the
   * fresh liveMatch. After this the screen flips to `teams_ready`.
   */
  const handleCreateTeams = async () => {
    if (!game || !isAdmin) return;
    // Allow regenerate from `teams_invalid` so admins can fix stale
    // rosters in one tap. Other states (already ready / live) shouldn't
    // wipe the existing arrangement.
    if (
      sessionStatus !== 'ready_to_create_teams' &&
      sessionStatus !== 'teams_invalid'
    ) {
      return;
    }
    if (game.players.length === 0 && (game.guests ?? []).length === 0) return;
    setBusy(true);
    try {
      const next = buildShuffledLiveMatch(game);
      await gameService.setLiveMatch(game.id, next, {
        markTeamsEditedManually: true,
      });
      await reload();
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] create teams failed', err);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Admin tap on "הזמן שחקנים". Opens the native share sheet with a
   * pre-built invite text. Logs analytics so we can see how often
   * organizers reach for this when the roster is short.
   */
  const handleInvitePlayers = async () => {
    if (!game) return;
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
      if (__DEV__) console.warn('[matchDetails] invite share failed', err);
    }
  };

  /**
   * Admin tap on "התחל ערב". Flips `liveMatch.phase` to `'live'` and
   * jumps straight to the LiveMatch screen so the round can begin.
   */
  const handleStartSession = async () => {
    if (!game || !isAdmin || sessionStatus !== 'teams_ready') return;
    if (!game.liveMatch) return;
    setBusy(true);
    try {
      await gameService.setLiveMatch(
        game.id,
        { ...game.liveMatch, phase: 'live' },
        { markTeamsEditedManually: false },
      );
      logEvent(AnalyticsEvent.GameStarted, { gameId: game.id });
      nav.navigate('LiveMatch', { gameId: game.id });
    } catch (err) {
      if (__DEV__) console.warn('[matchDetails] start session failed', err);
    } finally {
      setBusy(false);
    }
  };

  /** Admin tap on "עבור ללייב" — already active, just navigate. */
  const handleGoLive = () => {
    if (!game) return;
    nav.navigate('LiveMatch', { gameId: game.id });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScreenHeader
        title={he.matchDetailsTitle}
        actions={
          isAdmin
            ? [
                {
                  icon: 'create-outline',
                  onPress: () => nav.navigate('GameEdit', { gameId: game.id }),
                  label: he.matchDetailsEdit,
                },
              ]
            : undefined
        }
      />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={reload}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ① TOP — clean meta block, no cards. Title → 3 meta lines. */}
        <View style={styles.topBlock}>
          <Text style={styles.heroTitle} numberOfLines={2}>
            {game.title}
          </Text>
          <MetaLine
            icon="calendar-outline"
            text={formatDateLong(game.startsAt)}
          />
          <MetaLine
            icon="location-outline"
            text={game.fieldName}
          />
          <MetaLine
            icon="people-outline"
            text={`${totalParticipants}/${game.maxPlayers} שחקנים${
              fmt ? ` · ${fmt}` : ''
            }`}
          />
        </View>

        {/* ② STATUS — context-aware pill + (when waiting) a one-line
            helper that explains the threshold for moving on. */}
        <SessionStatusPill
          status={sessionStatus}
          totalPlayers={totalParticipants}
          maxPlayers={game.maxPlayers}
        />
        {sessionStatus === 'waiting_for_players' ? (
          <Text style={styles.statusHelper}>
            {he.sessionWaitingHelper(minPlayers)}
          </Text>
        ) : null}
        {sessionStatus === 'teams_invalid' ? (
          <Text style={styles.statusHelper}>{he.sessionInvalidHelper}</Text>
        ) : null}

        {/* ③ TEAMS SECTION
            • teams_ready / active   → render the actual teams (using
              the cleaned-on-render assignment map so stale uids never
              show up)
            • teams_invalid → no teams shown; the helper above
              instructs the admin to rebuild
            • waiting / ready_to_create → quiet placeholder so the user
              doesn't think they've missed a step.
            Only admin sees the placeholder; for plain members it's
            redundant noise before kickoff. */}
        {(sessionStatus === 'teams_ready' || sessionStatus === 'active') &&
        game.liveMatch ? (
          <TeamsBlock
            game={game}
            assignments={validity.cleanedAssignments}
            playersMap={playersMap}
          />
        ) : sessionStatus === 'teams_invalid' ? null : isAdmin ? (
          <Text style={styles.teamsPlaceholder}>
            {he.sessionTeamsPlaceholder}
          </Text>
        ) : null}

        {/* ④ WEATHER CHIP — visual weight reduced (smaller padding/icon)
            so it sits BELOW the primary information rather than rivalling
            it. Hidden when no coords / past game / >14 days out. */}
        {forecast ? (
          <View style={styles.weatherCard}>
            <Text style={styles.weatherIcon}>
              {weatherIcon(forecast.weatherCode)}
            </Text>
            <View style={styles.weatherTextCol}>
              <Text style={styles.weatherEyebrow}>
                {he.weatherForecastFor}
              </Text>
              <View style={styles.weatherStatsRow}>
                <View style={styles.weatherStat}>
                  <Ionicons name="thermometer-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.weatherStatValue}>
                    {`${forecast.tempC}°`}
                  </Text>
                </View>
                <View style={styles.weatherStatDivider} />
                <View style={styles.weatherStat}>
                  <Ionicons name="rainy-outline" size={12} color={colors.textMuted} />
                  <Text style={styles.weatherStatValue}>
                    {`${forecast.rainProb}%`}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        ) : null}

        {/* ⑤ PLAYERS */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {he.matchDetailsPlayers}{' '}
            <Text style={styles.sectionCount}>
              ({totalParticipants}/{game.maxPlayers})
            </Text>
          </Text>
          {isAdmin &&
          (sessionStatus === 'waiting_for_players' ||
            sessionStatus === 'ready_to_create_teams' ||
            sessionStatus === 'teams_invalid') ? (
            <Pressable
              onPress={() => setGuestModalOpen(true)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.addGuestBtn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="add" size={16} color={colors.primary} />
              <Text style={styles.addGuestText}>{he.matchDetailsAddGuest}</Text>
            </Pressable>
          ) : null}
        </View>

        {game.players.length === 0 && (game.guests ?? []).length === 0 ? (
          <Text style={styles.emptyText}>{he.gameCardMissing(game.maxPlayers)}</Text>
        ) : (
          <Card style={styles.playersCard}>
            {game.players.map((uid, i) => {
              const p = playersMap[uid];
              const name = p?.displayName ?? '...';
              const isOrganizer = adminUids.has(uid);
              const isLast =
                i === game.players.length - 1 && (game.guests ?? []).length === 0;
              return (
                <View
                  key={uid}
                  style={[styles.playerRow, !isLast && styles.playerRowDivider]}
                >
                  {/* Player row — RTL order:
                      SHIRT (right) → ROLE BADGE → NAME → ⚽ ball.
                      Badge sits between shirt and name so the role
                      pill reads as a label on the shirt itself, not
                      a trailing afterthought. */}
                  <PlayerIdentity
                    user={{ id: uid, name, jersey: p?.jersey }}
                    size={32}
                  />
                  {isOrganizer ? (
                    <Badge label={he.matchDetailsRoleAdmin} tone="info" size="sm" />
                  ) : null}
                  <Text style={styles.playerName} numberOfLines={1}>
                    {name}
                  </Text>
                  {game.ballHolderUserId === uid ? (
                    <Text style={styles.ballHolder}>⚽</Text>
                  ) : null}
                </View>
              );
            })}
            {(game.guests ?? []).map((g, i, arr) => {
              const isLast = i === arr.length - 1;
              return (
                <View
                  key={`guest:${g.id}`}
                  style={[styles.playerRow, !isLast && styles.playerRowDivider]}
                >
                  {/* Same RTL order as registered rows: SHIRT (right)
                      → "אורח" badge → NAME → trash (LEFT, admin-only).
                      Badge clings to the shirt; trash stays in its
                      own corner via `marginStart:'auto'`. */}
                  <PlayerIdentity user={{ id: `guest:${g.id}`, name: g.name }} size={32} />
                  <Badge label={he.guestBadge} tone="warning" size="sm" />
                  <Text style={styles.playerName} numberOfLines={1}>
                    {g.name}
                  </Text>
                  {isAdmin ? (
                    <Pressable
                      onPress={() =>
                        user &&
                        gameService
                          .removeGuest(game.id, user.id, g.id)
                          .then(() => reload())
                          .catch((err) => {
                            if (__DEV__)
                              console.warn('[matchDetails] removeGuest failed', err);
                          })
                      }
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.guestRemove,
                        styles.guestTrashAuto,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Ionicons name="trash-outline" size={18} color="#DC2626" />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </Card>
        )}

      </ScrollView>

      {/* Guest modal — admin-only entry point. Reuses the same modal
          used by the LiveMatch screen so the form stays consistent. */}
      {user ? (
        <GuestModal
          visible={guestModalOpen}
          gameId={game.id}
          callerId={user.id}
          onClose={() => setGuestModalOpen(false)}
          onChanged={reload}
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

      {/* ⑥ STICKY CTA — single primary green driven by sessionStatus
          (admins) or by registration status (regular users). Delete
          stays on the same row for admins as a destructive secondary. */}
      <View style={[styles.cta, isAdmin && styles.ctaRow]}>
        <View style={{ flex: 1 }}>
          {isAdmin ? (
            (() => {
              // One CTA per state: invite → create teams → start → live.
              // Each transition is gated by the sessionStatus, so an
              // admin can never trigger a step out of order.
              const cfg = (() => {
                if (sessionStatus === 'waiting_for_players') {
                  return {
                    title: he.sessionActionInvitePlayers,
                    onPress: handleInvitePlayers,
                  };
                }
                if (sessionStatus === 'ready_to_create_teams') {
                  return {
                    title: he.sessionActionCreateTeams,
                    onPress: handleCreateTeams,
                  };
                }
                if (sessionStatus === 'teams_invalid') {
                  return {
                    title: he.sessionActionRecreateTeams,
                    onPress: handleCreateTeams,
                  };
                }
                if (sessionStatus === 'teams_ready') {
                  return {
                    title: he.sessionActionStart,
                    onPress: handleStartSession,
                  };
                }
                return {
                  title: he.sessionActionGoLive,
                  onPress: handleGoLive,
                };
              })();
              return (
                <Button
                  title={cfg.title}
                  variant="primary"
                  size="lg"
                  fullWidth
                  loading={busy}
                  onPress={cfg.onPress}
                />
              );
            })()
          ) : (
            <Button
              title={primaryLabel}
              variant={primaryDestructive ? 'danger' : 'primary'}
              size="lg"
              fullWidth
              loading={busy}
              onPress={handlePrimary}
            />
          )}
        </View>
        {isAdmin ? (
          <View style={{ flex: 1 }}>
            <Button
              title={he.deleteGameTitle}
              variant="danger"
              size="lg"
              fullWidth
              iconLeft="trash-outline"
              onPress={() => setDeleteOpen(true)}
            />
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

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

/**
 * Compact "teams" block — color dot + name + small player avatars.
 * Renders only the cleaned (stale-filtered) assignment map so a player
 * who was removed from the roster after teams were built doesn't
 * appear as a phantom shirt. The `playersMap` hydration ensures each
 * shirt shows the player's actual saved jersey (number + colors)
 * rather than a deterministic auto-jersey based on uid.
 */
function TeamsBlock({
  game,
  assignments,
  playersMap,
}: {
  game: Game;
  assignments: Record<UserId, LiveMatchZone>;
  playersMap: Record<string, { displayName: string; jersey?: import('@/types').Jersey }>;
}) {
  const teamCount = Math.min(Math.max(game.numberOfTeams ?? 2, 2), 5);
  const letters: Array<'A' | 'B' | 'C' | 'D' | 'E'> = ['A', 'B', 'C', 'D', 'E'];
  const letterTints = [
    colors.team1,
    colors.team2,
    colors.team3,
    colors.warning,
    colors.info,
  ];
  const rosterFor = (
    letter: 'A' | 'B' | 'C' | 'D' | 'E',
    idx: number,
  ): UserId[] => {
    const ids: UserId[] = [];
    for (const uid of Object.keys(assignments) as UserId[]) {
      const z = assignments[uid];
      if (z === `team${letter}`) ids.push(uid);
      if (idx === 0 && z === 'gkA') ids.push(uid);
      if (idx === 1 && z === 'gkB') ids.push(uid);
    }
    return ids;
  };
  return (
    <View style={styles.teamsBlock}>
      <Text style={styles.teamsBlockTitle}>{he.sessionTeamsHeading}</Text>
      {letters.slice(0, teamCount).map((letter, i) => {
        const tint = letterTints[i];
        const players = rosterFor(letter, i);
        return (
          <View key={letter} style={styles.teamRow}>
            <View style={[styles.teamDot, { backgroundColor: tint }]} />
            <Text style={styles.teamName}>{he.liveTeamLabel(i)}</Text>
            <View style={styles.teamAvatars}>
              {players.slice(0, 7).map((uid) => {
                const p = playersMap[uid];
                return (
                  <PlayerIdentity
                    key={uid}
                    user={{
                      id: uid,
                      name: p?.displayName ?? '',
                      jersey: p?.jersey,
                    }}
                    size={26}
                  />
                );
              })}
              {players.length > 7 ? (
                <Text style={styles.teamMoreText}>+{players.length - 7}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
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
  return <Badge label={he.matchStatusOpen} tone="primary" size="sm" />;
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

  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 110,
    gap: spacing.lg,
  },

  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    textAlign: 'right',
    // `flexShrink:1` (NOT flex:1) lets a long match name truncate
    // gracefully without stealing the badge's slot on the LEFT corner.
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
    textAlign: 'right',
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
  },

  // Empty placeholder shown in lieu of teams when teams aren't ready yet.
  teamsPlaceholder: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
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
    textAlign: 'right',
  },
  infoValue: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
    textAlign: 'right',
  },

  // ③ Players
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'right',
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
    backgroundColor: '#DCFCE7',
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
    textAlign: 'right',
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
    textAlign: 'right',
    flexShrink: 1,
  },
  manageIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },


  // ⑤ Sticky CTA
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
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
});
