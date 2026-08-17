// gameService — read/write of the active game for a group, plus past
// game-night history.
//
// Mock mode: returns a deep copy of mockGame on first read, then keeps the
// mutated copy in memory so reloads don't reset progress mid-session.
// Firebase mode:
//   - Active game = the most recent /games doc for the group with
//     status='open' OR (locked but in the future / today).
//   - Match rounds live in /rounds and are loaded alongside.
//   - saveGame() upserts the game doc and writes/updates rounds.
//
// IMPORTANT: We deliberately don't write `matches` into the game doc;
// rounds are their own collection. Security rules can then constrain
// registration writes (game) separately from round writes.

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrivalStatus,
  Game,
  GameFormat,
  GameGuest,
  GameStatus,
  GameSummary,
  GroupId,
  GUEST_ID_PREFIX,
  activeGuestCount,
  isGuestId,
  LiveMatchState,
  MatchRound,
  Player,
  RetroGoal,
  Team,
  DraftTeamsResult,
  TeamColor,
  toGuestRosterId,
  UserId,
} from '@/types';
import { mockGame, mockGamesV2, mockPlayers, mockRoundHistory } from '@/data/mockData';
import { mockHistory } from '@/data/mockUsers';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { waitForAuthRestore } from '@/firebase/auth';
import { isStaleAfterStart, LATE_REG_GRACE_MS } from '@/services/gameLifecycle';
import { col, docs, GameDoc } from '@/firebase/firestore';
import { geocodeAddress } from '@/services/geocodeService';
import { isAttendedGame } from '@/utils/playedGames';
import { HISTORY_GAMES, type PastSplit } from '@/utils/teamBalanceCore';
import type {
  RoundHistoryDoc,
  RoundGoalRec,
  RoundPenaltyRec,
} from '@/utils/eveningStats';
import {
  rankChampionshipRows,
  type ChampionshipRow,
} from '@/utils/championship';
import {
  startRotation as runStartRotation,
  recordWinner as runRecordWinner,
  recordTie as runRecordTie,
  startRotationSkeleton,
  recordWinnerSkeleton,
  recordTieSkeleton,
  rosterOf as effectiveRosterOf,
  type RotationTeam,
  type RotationFillState,
} from '@/services/rotationEngine';
import { stripUndefined } from '@/utils/stripUndefined';
import { failValidation, optionalString, requireInt, requireString } from '@/utils/validate';
import { he } from '@/i18n/he';
import { enforceRateLimit } from '@/services/rateLimitService';
import { serverNow } from '@/services/serverClock';
import { buildShootoutPenaltyPayload } from '@/utils/penaltyStats';
import { assignJoins, type RosterState } from '@/services/joinFairness';
import { seriesService, settingsFromGame } from '@/services/seriesService';
import { logError, logUnexpected } from '@/services/errorLog';
import { notificationsService } from './notificationsService';
import { achievementsService } from './achievementsService';
import { disciplineService } from './disciplineService';
import { AnalyticsEvent, logEvent } from './analyticsService';

let activeGame: Game | null = null;

/**
 * Registration-conflict window. A user can't be registered for two
 * games whose start times are within this many ms of each other.
 * 4h before + 4h after = 8h total no-overlap zone around any
 * existing registration. Tweakable in one place.
 */
const REG_CONFLICT_WINDOW_MS = 4 * 60 * 60 * 1000;

/**
 * Window used by the create-overlap guard. Two non-terminal games in
 * the same community within ±2h of each other are treated as an
 * "accidental duplicate" — the admin probably tapped twice or already
 * scheduled this slot manually. We surface a human-readable error
 * instead of letting both go live.
 */
const GAME_OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Defensive cap on the number of "games this user is participating
 * in" docs we'll fetch when checking conflicts. A typical user has
 * a handful of active games at most; this limit only kicks in for
 * pathological histories and prevents a runaway scan.
 */
const CONFLICT_QUERY_LIMIT = 50;

/**
 * The per-user game lists (getMyGames / getMyLiveOrUpcomingGames /
 * subscribeMyLiveOrUpcomingGames) only ever show open/live/upcoming games.
 * Without a floor, the `participantIds array-contains` query reads the user's
 * ENTIRE game history on every screen open — the single biggest Firestore-read
 * cost in the app. A `startsAt >= now - WINDOW` floor caps the read to recent +
 * future games. 48h is generous: it covers long-running live matches and games
 * scheduled far ahead (those have a future startsAt and always pass). Stale
 * past games are dropped by isStaleAfterStart anyway, so excluding them
 * server-side changes nothing the user sees.
 * Requires composite indexes: (participantIds CONTAINS, startsAt) and
 * (createdBy, startsAt).
 */
const MY_GAMES_WINDOW_MS = 48 * 60 * 60 * 1000;
const myGamesFloor = (): number => Date.now() - MY_GAMES_WINDOW_MS;

/**
 * Cold-start auth-race guard for Firestore reads.
 *
 * On a cold start (e.g. right after an app update restart) the persisted
 * session is restored — so `auth.currentUser` is already set — a few
 * milliseconds BEFORE the ID token has attached to the Firestore channel. A
 * query fired in that window reaches the rules with `request.auth == null`
 * and fails `permission-denied`, even though the query itself is valid. It
 * then self-recovers on the next read.
 *
 * This wraps a read: on `permission-denied` WHILE a user session exists, it
 * forces the token (which propagates it to the Firestore channel), waits a
 * beat, and retries ONCE. A genuine "not signed in", or any non-permission
 * error, rethrows immediately — so we never paper over a real rules bug.
 */
async function withAuthRaceRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const user = getFirebase().auth.currentUser;
    if (code === 'permission-denied' && user) {
      try {
        await user.getIdToken();
      } catch {
        /* ignore — the retry below surfaces any real failure */
      }
      await new Promise((r) => setTimeout(r, 300));
      return await run();
    }
    throw err;
  }
}

/**
 * Tiny per-user cache for the my-games lists. Absorbs repeated reads when the
 * user flips between the Games / Profile / Player-card tabs in quick
 * succession (each used to re-run the queries). Short TTL so it stays fresh;
 * any of the user's own game mutations clears it via clearMyGamesCache().
 */
const MY_GAMES_TTL_MS = 15 * 1000;
const myGamesCache = new Map<string, { at: number; data: Game[] }>();
function clearMyGamesCache(): void {
  myGamesCache.clear();
}
async function cachedMyGames(key: string, fn: () => Promise<Game[]>): Promise<Game[]> {
  const hit = myGamesCache.get(key);
  if (hit && Date.now() - hit.at < MY_GAMES_TTL_MS) return hit.data;
  const data = await fn();
  myGamesCache.set(key, { at: Date.now(), data });
  return data;
}

export interface RegistrationConflict {
  gameId: string;
  title: string;
  startsAt: number;
  groupId: string;
}

/**
 * Typed error the join flow throws when a registration would clash
 * with another game in the user's calendar. Carries the conflict
 * payload so the UI can deep-link to the offending game.
 *
 * Plain `Error` extension: we attach a stable `code` string ("plain
 * code-on-error" pattern used elsewhere in this service — e.g.
 * `getGameById` throws `{code:'ACCESS_BLOCKED'}`) plus the structured
 * conflict, which UI code reads via `(err as Error & {conflict}).conflict`.
 *
 * Side-effect: emits a `registration_conflict_blocked` analytics
 * event the moment the error is constructed. This is the central
 * point where both mock and Firebase paths surface a conflict, so
 * logging here guarantees zero-skew telemetry without each callsite
 * remembering to fire its own event.
 */
function makeRegistrationConflictError(
  target: { id: string; groupId?: string; startsAt?: number },
  conflict: RegistrationConflict,
): Error & { code: 'REGISTRATION_CONFLICT'; conflict: RegistrationConflict } {
  const timeDiffMinutes =
    typeof target.startsAt === 'number'
      ? Math.round(Math.abs(conflict.startsAt - target.startsAt) / 60000)
      : -1;
  const sameGroup = !!target.groupId && target.groupId === conflict.groupId;
  logEvent(AnalyticsEvent.RegistrationConflictBlocked, {
    targetGameId: target.id,
    conflictGameId: conflict.gameId,
    timeDiffMinutes,
    sameGroup,
  });
  const err = new Error('REGISTRATION_CONFLICT') as Error & {
    code: 'REGISTRATION_CONFLICT';
    conflict: RegistrationConflict;
  };
  err.code = 'REGISTRATION_CONFLICT';
  err.conflict = conflict;
  return err;
}

/**
 * Typed wrapper around `updateDoc` for the games collection. The
 * Firestore SDK's typed converter requires a full `Game` on partial
 * writes, but we only ever want to send the keys we changed — sending
 * a converted partial would re-emit nullable optionals (liveMatch,
 * fieldLat, …) and trigger permission-denied on the self-join rule
 * which whitelists ['players','waitlist','pending','participantIds',
 * 'updatedAt']. The single `any` cast lives here so the rest of the
 * service stays type-safe.
 *
 * Always run the patch through `stripUndefined` first — Firestore
 * rejects `undefined` field values with "Unsupported field value:
 * undefined" and the helper has zero cost in the happy path.
 */
/**
 * A Firestore `permission-denied` on a community READ is almost always an
 * EXPECTED outcome — the group/game was deleted, or the viewer isn't a member
 * — not a real bug. Callers use this to return an empty result quietly instead
 * of logging it to the error inbox (which spammed it with stale-reference
 * denials; see Pulse dev-inbox triage 2026-06-23).
 */
function isPermissionDenied(err: unknown): boolean {
  return (err as { code?: unknown })?.code === 'permission-denied';
}

async function updateGameDoc(
  gameId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docs.game(gameId), stripUndefined(patch) as any);
  } catch (err) {
    logError('updateGameDoc', err, { gameId, fields: Object.keys(patch) });
    if (__DEV__) console.warn('[gameService] updateGameDoc failed', err);
    throw err;
  }
}

/**
 * Read a game's current `status` + `liveMatch` for a timer mutation,
 * preferring Firestore's LOCAL cache (instant, offline-safe) and only
 * hitting the network if the doc isn't cached. The live-match screen keeps
 * an onSnapshot listener open, so during a match the cache is always warm
 * and current — this replaces the old read-half of a `runTransaction`
 * without its mandatory server round-trip, which is what let the timer
 * feel laggy on every press.
 */
async function readTimerState(
  gameId: string,
): Promise<{ status?: GameStatus; liveMatch?: LiveMatchState } | null> {
  const ref = docs.game(gameId);
  // Read FRESH from the server, never cache-first. This function feeds the
  // start/pause/reset accumulator math; a stale cached timerLastStartedAt /
  // timerAccumulatedMs (offline blip or listener lag on a second device) made
  // the shared clock jump forward or lose elapsed time. Timer presses are
  // infrequent, so the extra round-trip is worth the correctness.
  let data: Record<string, unknown> | null = null;
  const fresh = await getDoc(ref);
  if (!fresh.exists()) return null;
  data = fresh.data();
  return {
    status: data.status as GameStatus | undefined,
    liveMatch: data.liveMatch as LiveMatchState | undefined,
  };
}

function ensureMockGame(): Game {
  if (!activeGame) activeGame = JSON.parse(JSON.stringify(mockGame)) as Game;
  return activeGame;
}

function gameDocFromGame(g: Game): GameDoc {
  const { matches, ...rest } = g;
  return rest;
}

/** Lightweight GameSummary for a played game — no rounds fetch (timer-only
 *  games carry none), so matchCount is 0 and there's no per-round result.
 *  Accepts the structural subset shared by Game and the raw GameDoc. */
function playedGameSummary(g: {
  id: string;
  groupId: GroupId;
  startsAt: number;
  status?: string;
  title?: string;
  fieldName?: string;
  format?: GameFormat;
}): GameSummary {
  return {
    id: g.id,
    groupId: g.groupId,
    date: g.startsAt,
    matchCount: 0,
    status: g.status === 'cancelled' ? 'cancelled' : 'finished',
    title: g.title,
    fieldName: g.fieldName,
    format: g.format,
  };
}

async function loadRoundsFor(gameId: string): Promise<MatchRound[]> {
  const q = query(
    col.rounds(),
    where('gameId', '==', gameId),
    orderBy('index', 'asc')
  );
  let snap;
  try {
    snap = await getDocs(q);
  } catch (err) {
    logError('loadRoundsFor', err, { gameId });
    if (__DEV__) console.warn('[gameService] loadRoundsFor failed', err);
    throw err;
  }
  return snap.docs.map((d) => {
    const r = d.data();
    // Strip the storage-only fields back to MatchRound shape
    const { id, gameId: _gnId, ...rest } = r as MatchRound & {
      id: string;
      gameId: string;
    };
    return rest;
  });
}

/**
 * Look for an existing non-terminal game in the same community whose
 * `startsAt` is within ±GAME_OVERLAP_WINDOW_MS of the new one. Used
 * by `createGameV2` to block "two games at the same slot" mistakes,
 * and by `updateGameV2` to block moving an existing game's startsAt
 * onto another game's slot. Pass `excludeGameId` on the edit path so
 * the game being edited doesn't match itself.
 *
 * Returns the closest conflicting game's id/title/startsAt, or null
 * when nothing overlaps.
 */
async function findOverlappingGameInGroup(
  groupId: GroupId,
  startsAt: number,
  excludeGameId?: string,
): Promise<{ gameId: string; title: string; startsAt: number } | null> {
  const lower = startsAt - GAME_OVERLAP_WINDOW_MS;
  const upper = startsAt + GAME_OVERLAP_WINDOW_MS;
  // Read only games inside the ±window (range on startsAt), not the group's
  // whole history. Status is filtered client-side. Uses the (groupId,
  // startsAt) composite index.
  let snap;
  try {
    snap = await getDocs(
      query(
        col.games(),
        where('groupId', '==', groupId),
        where('startsAt', '>=', lower),
        where('startsAt', '<=', upper),
      ),
    );
  } catch (err) {
    logError('findOverlappingGameInGroup', err, { groupId, startsAt });
    if (__DEV__) {
      console.warn('[gameService] findOverlappingGameInGroup failed', err);
    }
    throw err;
  }
  const candidates = snap.docs
    .map((d) => d.data())
    .filter((g) => {
      if (excludeGameId && g.id === excludeGameId) return false;
      // Non-terminal only — finished/cancelled games don't block a
      // new creation. 'scheduled' DOES block (an admin shouldn't be
      // able to stack a manual game on top of a recurring slot).
      if (g.status === 'finished' || g.status === 'cancelled') return false;
      if (typeof g.startsAt !== 'number') return false;
      return g.startsAt >= lower && g.startsAt <= upper;
    });
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      Math.abs(a.startsAt - startsAt) - Math.abs(b.startsAt - startsAt),
  );
  const c = candidates[0];
  return {
    gameId: c.id,
    title: c.title ?? '',
    startsAt: c.startsAt,
  };
}

/** On-field players per team for a game format (the live-rotation target
 *  size each playing team is filled up to). Defaults to 5. */
function playersPerTeamFor(format: GameFormat | undefined): number {
  return format === '4v4' ? 4 : format === '6v6' ? 6 : format === '7v7' ? 7 : 5;
}

/**
 * Prune a departed player (self-cancel or admin-remove) out of the drawn
 * teams + live rotation so they don't linger as a "ghost" on a team and get
 * counted as on-field by the rotation / round-stat math. Returns ONLY the
 * fields that actually change, to merge into the same roster write (so the
 * removal is atomic with the players/waitlist filter). No-op fields absent.
 */
function pruneMemberFromTeams(
  data: Record<string, unknown>,
  uid: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const draft = data.draftTeams as DraftTeamsResult | undefined;
  if (draft?.teams) {
    const inTeams = draft.teams.some((t) => (t.playerIds ?? []).includes(uid));
    const inLeftHome = (draft.leftHome ?? []).some((l) => l.playerId === uid);
    if (inTeams || inLeftHome) {
      out.draftTeams = {
        ...draft,
        teams: draft.teams.map((t) => ({
          ...t,
          playerIds: (t.playerIds ?? []).filter((p) => p !== uid),
        })),
        ...(inLeftHome
          ? { leftHome: (draft.leftHome ?? []).filter((l) => l.playerId !== uid) }
          : {}),
      };
    }
  }
  const rotation = data.rotation as
    | import('@/types').MatchRotation
    | undefined;
  if (rotation) {
    const inLoans = (rotation.loans ?? []).some((l) => l.playerId === uid);
    const inBase = (rotation.baseTeams ?? []).some((t) =>
      (t.playerIds ?? []).includes(uid),
    );
    if (inLoans || inBase) {
      out.rotation = {
        ...rotation,
        ...(inLoans
          ? { loans: (rotation.loans ?? []).filter((l) => l.playerId !== uid) }
          : {}),
        ...(inBase
          ? {
              baseTeams: (rotation.baseTeams ?? []).map((t) => ({
                ...t,
                playerIds: (t.playerIds ?? []).filter((p) => p !== uid),
              })),
            }
          : {}),
        updatedAt: Date.now(),
      };
    }
  }
  return out;
}

/**
 * Effective fill mode for the rotation. The advanced-mode game setting
 * (`advancedFillMode`, chosen at creation) is the source of truth — the
 * manual draft never copies it onto `draftTeams.fillMode`, so without this the
 * engine always defaulted to 'temporary' and the "קבוע" option had no effect.
 */
function effFillMode(
  g: { advancedMode?: boolean; advancedFillMode?: 'temporary' | 'permanent' },
  draft: { fillMode?: 'temporary' | 'permanent' },
): 'temporary' | 'permanent' {
  if (g.advancedMode && g.advancedFillMode) return g.advancedFillMode;
  return draft.fillMode ?? 'temporary';
}

/**
 * Drafted teams with any id no longer ACTIVE removed — so neither a player who
 * CANCELLED after teams were drafted, NOR one who was marked "הלך הביתה", enters
 * the live rotation as a ghost. Excluding `leftHome` here is what makes their
 * team read as short so the next round offers a replacement from the bench
 * (user report: marking someone went home didn't let me pick a sub).
 */
function liveRosterTeams(
  g: { players?: string[]; guests?: { id: string; waitlisted?: boolean }[] },
  draft: {
    teams: { index: number; playerIds: string[] }[];
    leftHome?: { playerId: string }[];
  },
): { index: number; playerIds: string[] }[] {
  const players = new Set(g.players ?? []);
  const guests = new Set(
    (g.guests ?? [])
      .filter((gu) => !gu.waitlisted)
      .map((gu) => toGuestRosterId(gu.id)),
  );
  const leftHome = new Set((draft.leftHome ?? []).map((x) => x.playerId));
  const inRoster = (id: string) =>
    !leftHome.has(id) && (isGuestId(id) ? guests.has(id) : players.has(id));
  return draft.teams.map((t) => ({
    index: t.index,
    playerIds: t.playerIds.filter(inRoster),
  }));
}

export const gameService = {
  /**
   * Returns the active game for a group, or null if none exists yet.
   * Never auto-creates — that's `createGame()`'s job and is admin-only
   * (enforced both client-side via gameStore and server-side via rules).
   *
   * Mock mode always returns the canned game.
   */
  /**
   * Read one v2 game by id.
   *
   * Two distinct outcomes by design — callers must handle them
   * separately so users see the right message:
   *
   *   • returns `null` — doc genuinely doesn't exist (deleted /
   *     never existed). UI: "המשחק לא קיים".
   *
   *   • throws `{ code: 'ACCESS_BLOCKED' }` — Firestore rules
   *     denied the read. The doc exists but this viewer can't see
   *     it (typical: non-member opening a community-only game).
   *     UI: dedicated blocked-access screen, no info leak.
   *
   * We catch the raw FirebaseError here and re-throw with a stable
   * code so callers don't have to know about Firebase internals.
   * Any other error is re-thrown unchanged.
   *
   * Mock mode falls back to the in-memory store and only ever
   * returns null / found — there's no rules layer to deny.
   */
  async getGameById(gameId: string): Promise<Game | null> {
    if (!gameId) return null;
    if (USE_MOCK_DATA) {
      const found = mockGamesV2.find((g) => g.id === gameId);
      return found ? ({ ...found, matches: [] } as Game) : null;
    }
    try {
      const snap = await getDoc(docs.game(gameId));
      if (!snap.exists()) return null;
      return { ...snap.data(), matches: [] };
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === 'string'
          ? ((err as { code: string }).code)
          : '';
      if (code === 'permission-denied') {
        const blocked: Error & { code: string } = Object.assign(
          new Error('getGameById: access blocked by security rules'),
          { code: 'ACCESS_BLOCKED' as const },
        );
        throw blocked;
      }
      throw err;
    }
  },

  async getActiveGameForGroup(groupId: GroupId): Promise<Game | null> {
    if (USE_MOCK_DATA) return ensureMockGame();

    const { auth } = getFirebase();
    if (!auth.currentUser) throw new Error('getActiveGameForGroup: not signed in');

    // Active = the most recent night that's not yet finished. Once a night
    // is marked finished it falls into history (see getHistory). We pull
    // a small window (limit=3) and pick the first non-stale one — this
    // way a single zombie at the top of the order doesn't mask the real
    // upcoming game while the cleanup CF hasn't run yet.
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['open', 'locked']),
      orderBy('startsAt', 'desc'),
      limit(3)
    );
    try {
      const snap = await getDocs(q);
      if (snap.empty) return null;
      const docData = snap.docs
        .map((d) => d.data())
        .find((g) => !isStaleAfterStart({ ...g, matches: [] } as Game));
      if (!docData) return null;
      const matches = await loadRoundsFor(docData.id);
      return { ...docData, matches };
    } catch (err) {
      logError('getActiveGameForGroup', err, { groupId });
      if (__DEV__) {
        console.warn('[gameService] getActiveGameForGroup failed', err);
      }
      throw err;
    }
  },

  /**
   * Create tonight's game. Admin-only by intent — security rules require the
   * caller to be a group admin, but we also gate from the UI so non-admins
   * never see a permission error.
   *
   * In mock mode this is idempotent: the canned game already exists, so we
   * just return it. This keeps mock-mode behavior matching production.
   */
  async createGame(
    groupId: GroupId,
    fieldName: string = 'המגרש הקבוע'
  ): Promise<Game> {
    if (USE_MOCK_DATA) return ensureMockGame();

    const { auth } = getFirebase();
    if (!auth.currentUser) throw new Error('createGame: not signed in');

    try {
      const ref = await addDoc(col.games(), {
        id: '', // converter ignores; Firestore generates the real id
        groupId,
        title: 'משחק כדורגל',
        startsAt: nextThursdayAt(20, 0),
        fieldName,
        maxPlayers: 15,
        players: [],
        waitlist: [],
        status: 'open',
        locked: false,
        currentMatchIndex: 0,
        createdAt: Date.now(),
      } as GameDoc);
      const fresh = await getDoc(ref);
      // Defensive: a freshly-written doc *should* be readable on the same
      // region, but transient replication lag or a concurrent rule
      // rejection can return an empty snapshot. Fail with a clear error
      // instead of crashing on `.data()!`.
      if (!fresh.exists()) {
        throw new Error('createGame: freshly-created game not found');
      }
      const data = fresh.data();
      return { ...data, matches: [] };
    } catch (err) {
      logError('createGameLegacy', err, { groupId, fieldName });
      if (__DEV__) console.warn('[gameService] createGame failed', err);
      throw err;
    }
  },

  async listPlayers(): Promise<Player[]> {
    if (USE_MOCK_DATA) return mockPlayers;
    // In Firebase mode, "players" maps 1:1 to /users/{uid} for everyone in
    // the active group. The store hydrates this when needed; gameService
    // returns []. (The store uses currentUser + group.playerIds to resolve.)
    return [];
  },

  /**
   * Per-community player stats. For every uid in `userIds` returns:
   *   • gamesPlayed — finished games in this community where the user
   *     was in `players[]` (just registered + reached terminal state).
   *     Post timer-pivot the "team-assignment" gate is gone, so this
   *     is now the simpler "showed up to a finished game" count.
   *
   * Bounded by the most recent 50 terminal games in the community —
   * read cost is one query, no round subqueries.
   *
   * `wins` lived here originally; removed 2026-05-30 along with the
   * round-snapshot reads, since the live pivot to timer-only stopped
   * producing winners.
   *
   * Mock-mode returns zeros — no realistic stats backing in mock data.
   */
  async getCommunityPlayerStats(
    groupId: GroupId,
    userIds: UserId[],
  ): Promise<Record<UserId, { gamesPlayed: number }>> {
    const acc: Record<UserId, { gamesPlayed: number }> = {};
    for (const uid of userIds) acc[uid] = { gamesPlayed: 0 };
    if (USE_MOCK_DATA || userIds.length === 0) return acc;

    // Read the server `communityPlayerStats` rollup (same source as the
    // championship table + the player's Statistics screen). Its `games` field
    // is incremented per finished game with NO-SHOWS EXCLUDED and is unbounded
    // — so this chip now agrees with every other games-played surface (it used
    // to scan the last 50 finished games and count no-shows, which both
    // over-counted and saturated). One groupId query, cheaper than the scan.
    const db = getFirebase().db;
    let snap;
    try {
      snap = await getDocs(
        query(collection(db, 'communityPlayerStats'), where('groupId', '==', groupId)),
      );
    } catch (err) {
      if (isPermissionDenied(err)) return acc; // deleted group / non-member
      logError('getCommunityPlayerStats', err, {
        groupId,
        userCount: userIds.length,
      });
      if (__DEV__) {
        console.warn('[gameService] getCommunityPlayerStats failed', err);
      }
      return acc; // degrade to zeros rather than breaking the whole roster load
    }
    const requestedSet = new Set(userIds);
    for (const d of snap.docs) {
      const row = d.data() as { userId?: string; games?: number };
      if (row.userId && requestedSet.has(row.userId)) {
        acc[row.userId] = { gamesPlayed: Number(row.games ?? 0) };
      }
    }
    return acc;
  },

  /**
   * "אתה ו-X" stats for the player-card screen. Returns:
   *   • registeredTogether — finished games where both uids appear in `players[]`
   *   • attendedTogether   — registeredTogether minus games where either was a no-show
   *   • firstSharedAt / lastSharedAt — bounds of the games they actually shared
   *
   * Bounded query: scans finished games where the viewer (uidA) was a
   * participant. `array-contains` keeps it cheap.
   *
   * `sameTeamGames` / `sameTeamRounds` lived here originally — both
   * depended on `teams[]` and round snapshots, which the live-match
   * pivot to timer-only stopped producing (2026-05-27). Removed
   * 2026-05-29; the social signal that survives is "you played in the
   * same game N times". Future "regular teammate" stats (see audit doc
   * §5.1) can replace the dead "same team" metric.
   */
  async getPairStats(
    uidA: UserId,
    uidB: UserId,
    groupId?: GroupId,
  ): Promise<{
    registeredTogether: number;
    attendedTogether: number;
    firstSharedAt: number | null;
    lastSharedAt: number | null;
    /** id of the most-recent game the pair shared — for the "open game" jump on
     *  the player card's last-shared row. */
    lastSharedGameId: string | null;
    /** Rounds the pair played on the SAME team (from the live rotation). */
    sameTeam: number;
    winsTogether: number;
    lossesTogether: number;
    /** Rounds the pair played AGAINST each other (opposing sides). */
    against: number;
    /** Directional vs the VIEWER (uidA): times uidA's side beat uidB's. */
    winsAgainst: number;
    lossesAgainst: number;
    /** Directional assists vs the VIEWER (uidA). */
    assistedThem: number;
    assistedMe: number;
  }> {
    const zero = {
      registeredTogether: 0,
      attendedTogether: 0,
      firstSharedAt: null as number | null,
      lastSharedAt: null as number | null,
      lastSharedGameId: null as string | null,
      sameTeam: 0,
      winsTogether: 0,
      lossesTogether: 0,
      against: 0,
      winsAgainst: 0,
      lossesAgainst: 0,
      assistedThem: 0,
      assistedMe: 0,
    };
    if (USE_MOCK_DATA || !uidA || !uidB || uidA === uidB) return zero;
    // array-contains(uidA) + status=='finished' — pairs only form in played
    // games, so filtering finished SERVER-SIDE trims open/scheduled/cancelled
    // games from the read. Uses the (participantIds CONTAINS, status, startsAt)
    // composite index (which now exists — an earlier version dropped this
    // filter because the index was missing). group / second-uid stay
    // client-side.
    const q = query(
      col.games(),
      where('participantIds', 'array-contains', uidA),
      where('status', '==', 'finished'),
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      logError('getPairStats', err, { uidA, uidB, groupId });
      if (__DEV__) console.warn('[gameService] getPairStats failed', err);
      throw err;
    }
    const acc = { ...zero };
    const nowMs = Date.now();
    for (const doc of snap.docs) {
      const g = doc.data();
      if (g.status !== 'finished') continue;
      // Guard against a 'finished'-but-future game (same rule as the canonical
      // isAttendedGame) so the pair card can't drift from the Statistics screen.
      if (typeof g.startsAt === 'number' && g.startsAt >= nowMs) continue;
      if (groupId && g.groupId !== groupId) continue;
      const players = (g.players ?? []) as UserId[];
      if (!players.includes(uidA) || !players.includes(uidB)) continue;
      acc.registeredTogether += 1;
      const arrivals = (g.arrivals ?? {}) as Record<UserId, ArrivalStatus>;
      const aShowed = arrivals[uidA] !== 'no_show';
      const bShowed = arrivals[uidB] !== 'no_show';
      if (!aShowed || !bShowed) continue;
      acc.attendedTogether += 1;
      // Track time bounds — first / last evening they actually
      // shared a pitch. Useful for the "playing together since X"
      // line in the player-card UI.
      const ts = typeof g.startsAt === 'number' ? g.startsAt : 0;
      if (ts > 0) {
        if (acc.firstSharedAt == null || ts < acc.firstSharedAt) {
          acc.firstSharedAt = ts;
        }
        if (acc.lastSharedAt == null || ts > acc.lastSharedAt) {
          acc.lastSharedAt = ts;
          acc.lastSharedGameId = doc.id;
        }
      }
    }
    // Same-team / together W-L come from the live rotation, accumulated
    // server-side at pairStats/{a__b} (sorted key). Best-effort read.
    try {
      const key = [uidA, uidB].sort().join('__');
      const psnap = await getDoc(doc(getFirebase().db, 'pairStats', key));
      if (psnap.exists()) {
        const d = psnap.data() as {
          sameTeam?: number;
          winsTogether?: number;
          lossesTogether?: number;
          against?: number;
          winsA?: number;
          winsB?: number;
          assistsAToB?: number;
          assistsBToA?: number;
        };
        acc.sameTeam = typeof d.sameTeam === 'number' ? d.sameTeam : 0;
        acc.winsTogether = typeof d.winsTogether === 'number' ? d.winsTogether : 0;
        acc.lossesTogether =
          typeof d.lossesTogether === 'number' ? d.lossesTogether : 0;
        acc.against = typeof d.against === 'number' ? d.against : 0;
        // winsA = the sorted-FIRST uid's against-wins. Map to the viewer (uidA).
        const aIsFirst = [uidA, uidB].sort()[0] === uidA;
        const winsA = typeof d.winsA === 'number' ? d.winsA : 0;
        const winsB = typeof d.winsB === 'number' ? d.winsB : 0;
        acc.winsAgainst = aIsFirst ? winsA : winsB;
        acc.lossesAgainst = aIsFirst ? winsB : winsA;
        // assistsAToB = sorted-FIRST assisted sorted-SECOND. Map to the viewer:
        // assistedThem = times uidA assisted uidB; assistedMe = the reverse.
        const aToB = typeof d.assistsAToB === 'number' ? d.assistsAToB : 0;
        const bToA = typeof d.assistsBToA === 'number' ? d.assistsBToA : 0;
        acc.assistedThem = aIsFirst ? aToB : bToA;
        acc.assistedMe = aIsFirst ? bToA : aToB;
      }
    } catch (err) {
      if (__DEV__) console.warn('[gameService] pairStats read failed', err);
    }
    return acc;
  },

  /**
   * Community-level aggregate stats for the CommunityDetails screen.
   *
   * NOTE: all figures are computed over the most-recent 200 terminal
   * (finished|cancelled) game docs — NOT strictly all-time. For clubs with
   * ≤200 terminal games this equals all-time; beyond that it's a recent
   * window. Kept bounded deliberately to cap read cost.
   *   • totalFinished      — finished games in the 200-doc window
   *   • totalCancelled     — cancelled games in the window
   *   • organizationRate   — finished / (finished + cancelled). Captures
   *     "what % of attempts actually happened?" over the window.
   *   • avgAttendance      — average # of arrived players per finished game
   *   • thisMonthFinished  — games finished in the last 30 days
   *   • topPlayers         — uid + attended count, sorted desc, top 5
   */
  async getCommunityStats(groupId: GroupId): Promise<{
    totalFinished: number;
    totalCancelled: number;
    organizationRate: number;
    avgAttendance: number;
    thisMonthFinished: number;
    activeThisMonth: number;
    activeThisYear: number;
    topPlayers: Array<{ uid: UserId; attended: number }>;
    /** SOURCE OF TRUTH for "הופעות" (evenings attended) per player — counted
     *  from the finished-games scan (distinct finished nights the player was on
     *  the roster and NOT a no-show). The `communityPlayerStats.games` rollup
     *  can drift (missed increments on historical/edge games); this scan is
     *  authoritative and is what the champions table + compare card read. */
    attendedByUser: Record<UserId, number>;
    /** Longest run of consecutive game-nights attended by a single player. */
    longestStreak: number;
    longestStreakUid: UserId | null;
    /** Each player's CURRENT run of consecutive attended nights. */
    currentStreakByUser: Record<UserId, number>;
  }> {
    const empty = {
      totalFinished: 0,
      totalCancelled: 0,
      organizationRate: 0,
      avgAttendance: 0,
      thisMonthFinished: 0,
      activeThisMonth: 0,
      activeThisYear: 0,
      topPlayers: [] as Array<{ uid: UserId; attended: number }>,
      attendedByUser: {} as Record<UserId, number>,
      longestStreak: 0,
      longestStreakUid: null as UserId | null,
      currentStreakByUser: {} as Record<UserId, number>,
    };
    if (!groupId) return empty;
    if (USE_MOCK_DATA) {
      // Demo numbers so the community stats + club-achievements UI render.
      return {
        totalFinished: 42,
        totalCancelled: 3,
        organizationRate: 0.93,
        avgAttendance: 11,
        thisMonthFinished: 4,
        activeThisMonth: 14,
        activeThisYear: 28,
        topPlayers: mockPlayers
          .slice(0, 5)
          .map((p, i) => ({ uid: p.id, attended: 40 - i * 4 })),
        attendedByUser: Object.fromEntries(
          mockPlayers.slice(0, 8).map((p, i) => [p.id, 40 - i * 4]),
        ),
        longestStreak: 9,
        longestStreakUid: mockPlayers[0].id,
        currentStreakByUser: Object.fromEntries(
          mockPlayers.slice(0, 8).map((p, i) => [p.id, Math.max(0, 7 - i)]),
        ),
      };
    }
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['finished', 'cancelled']),
      orderBy('startsAt', 'desc'),
      limit(200),
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      if (isPermissionDenied(err)) return empty; // deleted group / non-member
      logError('getCommunityStats', err, { groupId });
      if (__DEV__) console.warn('[gameService] getCommunityStats failed', err);
      throw err;
    }
    let totalFinished = 0;
    let totalCancelled = 0;
    let attendanceSum = 0;
    const now = Date.now();
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
    const yearAgo = now - 365 * 24 * 60 * 60 * 1000;
    let thisMonthFinished = 0;
    const attendedTally: Record<UserId, number> = {};
    // Distinct uids who actually showed up to a game in each window.
    // The "vitality" signal — a group with 50 members where only 4
    // attended this month is on its way out, regardless of size.
    const activeMonth = new Set<UserId>();
    const activeYear = new Set<UserId>();
    // Per finished night, the set of attendees — collected so we can compute
    // the longest consecutive-attendance streak (the club's "most loyal" run).
    const nights: Array<{ startsAt: number; attended: Set<UserId> }> = [];
    for (const doc of snap.docs) {
      const g = doc.data();
      if (g.status === 'cancelled') {
        totalCancelled += 1;
        continue;
      }
      totalFinished += 1;
      if (typeof g.startsAt === 'number' && g.startsAt >= monthAgo) {
        thisMonthFinished += 1;
      }
      const arrivals = (g.arrivals ?? {}) as Record<UserId, ArrivalStatus>;
      const players = (g.players ?? []) as UserId[];
      let attendedHere = 0;
      const within30 =
        typeof g.startsAt === 'number' && g.startsAt >= monthAgo;
      const within365 =
        typeof g.startsAt === 'number' && g.startsAt >= yearAgo;
      const attendedSet = new Set<UserId>();
      for (const uid of players) {
        if (arrivals[uid] === 'no_show') continue;
        attendedHere += 1;
        attendedTally[uid] = (attendedTally[uid] ?? 0) + 1;
        attendedSet.add(uid);
        if (within30) activeMonth.add(uid);
        if (within365) activeYear.add(uid);
      }
      attendanceSum += attendedHere;
      nights.push({ startsAt: (g.startsAt as number) ?? 0, attended: attendedSet });
    }
    // Longest consecutive-night attendance streak. Walk nights oldest→newest;
    // for each player a run of attended nights grows, a missed night resets it.
    nights.sort((a, b) => a.startsAt - b.startsAt);
    const run: Record<UserId, number> = {};
    let longestStreak = 0;
    let longestStreakUid: UserId | null = null;
    for (const night of nights) {
      // Reset anyone who didn't attend this night.
      for (const uid of Object.keys(run)) {
        if (!night.attended.has(uid)) run[uid] = 0;
      }
      for (const uid of night.attended) {
        run[uid] = (run[uid] ?? 0) + 1;
        if (run[uid] > longestStreak) {
          longestStreak = run[uid];
          longestStreakUid = uid;
        }
      }
    }
    const organizationRate =
      totalFinished + totalCancelled > 0
        ? totalFinished / (totalFinished + totalCancelled)
        : 0;
    const avgAttendance =
      totalFinished > 0 ? attendanceSum / totalFinished : 0;
    const topPlayers = Object.entries(attendedTally)
      .map(([uid, attended]) => ({ uid, attended }))
      .sort((a, b) => b.attended - a.attended)
      .slice(0, 5);
    return {
      totalFinished,
      totalCancelled,
      organizationRate,
      avgAttendance,
      thisMonthFinished,
      activeThisMonth: activeMonth.size,
      activeThisYear: activeYear.size,
      topPlayers,
      // The full per-player finished-nights count — the authoritative "הופעות".
      attendedByUser: attendedTally,
      longestStreak,
      longestStreakUid,
      // Each player's CURRENT run of consecutive attended nights — which is
      // exactly what `run` holds once the walk reaches the latest night (a
      // missed night has already zeroed it). Free: the loop above computed it
      // to find the record. Drives the coach's "you're on a 7-night streak".
      currentStreakByUser: run,
    };
  },

  /**
   * Community goals championship — the club's scorers ranked by goals scored
   * THROUGH this club's games only (the `communityPlayerStats` rollup), NOT a
   * player's global `stats.goals`. Plus the club totals: total goals + total
   * mini-games (`communityStats/{groupId}`).
   */
  async getCommunityChampionship(
    groupId: GroupId,
    // When given, EVERY member appears in the table — members with no stats yet
    // get a zero row (user request: show everyone, not just who has data).
    memberIds?: string[],
  ): Promise<{
    totalGoals: number;
    totalRounds: number;
    /** Mini-games that ended in a tie (for the draw-rate fun fact). */
    tiedRounds: number;
    /** Mini-games decided by a penalty shootout (for the "% by penalties" fact). */
    shootoutRounds: number;
    /** Mini-games that ended 0:0 in regulation (for the "% ended 0:0" fact). */
    scorelessRounds: number;
    /** Goals scored by guests across the club (for the "גולים ע"י אורחים" fact). */
    guestGoals: number;
    /** Own goals across the club (for the "שערים עצמיים" fact). */
    ownGoals: number;
    players: ChampionshipRow[];
  }> {
    const empty = { totalGoals: 0, totalRounds: 0, tiedRounds: 0, shootoutRounds: 0, scorelessRounds: 0, guestGoals: 0, ownGoals: 0, players: [] as ChampionshipRow[] };
    if (!groupId) return empty;
    if (USE_MOCK_DATA) {
      const players: ChampionshipRow[] = mockPlayers.slice(0, 8).map((p, i) => {
        const games = 38 - i;
        const wins = Math.max(0, 22 - i * 2);
        // Demo penalty stats — a non-monotonic spread so the kicker king and
        // keeper king aren't just "player 0" (exercises the tie-break/derivation).
        const penTaken = Math.max(0, 9 - i);
        const penScored = Math.max(0, [7, 8, 4, 5, 2, 3, 1, 0][i] ?? 0);
        const penFaced = Math.max(0, 8 - i);
        const penSaved = Math.max(0, [2, 3, 6, 1, 4, 0, 1, 0][i] ?? 0);
        return {
          uid: p.id,
          goals: Math.max(0, 58 - i * 7),
          assists: Math.max(0, 26 - i * 3),
          rounds: 150 - i * 12,
          wins,
          losses: Math.max(0, games - wins),
          games,
          penTaken,
          penScored: Math.min(penScored, penTaken),
          penFaced,
          penSaved: Math.min(penSaved, penFaced),
          // Demo own goals — a couple of players carry one for the fun fact.
          ownGoals: [1, 0, 2, 0, 0, 1, 0, 0][i] ?? 0,
          // Demo clean sheets — bounded by rounds, spread so the column reads
          // as a real distribution in the emulator rather than a ladder.
          cleanSheets: Math.max(0, [61, 44, 52, 30, 38, 21, 27, 12][i] ?? 0),
        };
      });
      // Show every club member: the first 8 carry stats, the rest get a zero
      // row (mirrors the prod merge so the emulator demo lists everyone too).
      const withZeros = [...players];
      if (memberIds && memberIds.length) {
        const have = new Set(players.map((p) => p.uid));
        for (const uid of memberIds) {
          if (uid && !have.has(uid)) {
            withZeros.push({ uid, goals: 0, assists: 0, rounds: 0, wins: 0, losses: 0, games: 0, penTaken: 0, penScored: 0, penFaced: 0, penSaved: 0, ownGoals: 0, cleanSheets: 0 });
            have.add(uid);
          }
        }
      }
      return {
        totalGoals: players.reduce((a, p) => a + p.goals, 0),
        totalRounds: 210,
        tiedRounds: 34,
        shootoutRounds: 11,
        scorelessRounds: 6,
        guestGoals: 7,
        ownGoals: 4,
        players: withZeros,
      };
    }
    const db = getFirebase().db;
    try {
      const [psSnap, csSnap] = await Promise.all([
        getDocs(query(collection(db, 'communityPlayerStats'), where('groupId', '==', groupId))),
        getDoc(doc(db, 'communityStats', groupId)),
      ]);
      // Community table ranks by cumulative goals (not per-game efficiency).
      // Merge in every club member so the table lists ALL of them, not just
      // those who already have a stat doc — members with no games yet get a
      // zero row (kept via keepAll, sorted last).
      const statRows = psSnap.docs.map((d) => d.data() as { userId?: string });
      if (memberIds && memberIds.length) {
        const have = new Set(statRows.map((r) => r.userId));
        for (const uid of memberIds) {
          if (uid && !have.has(uid)) {
            statRows.push({ userId: uid } as { userId?: string });
          }
        }
      }
      const players = rankChampionshipRows(statRows, 'points', !!(memberIds && memberIds.length));
      const totalGoals = players.reduce((a, s) => a + s.goals, 0);
      const cs = csSnap.exists()
        ? (csSnap.data() as {
            rounds?: number;
            tiedRounds?: number;
            shootoutRounds?: number;
            scorelessRounds?: number;
            guestGoals?: number;
            ownGoals?: number;
          })
        : null;
      const totalRounds = cs?.rounds ?? 0;
      const tiedRounds = cs?.tiedRounds ?? 0;
      const shootoutRounds = cs?.shootoutRounds ?? 0;
      const scorelessRounds = cs?.scorelessRounds ?? 0;
      // Goals scored by GUESTS across the club (separate from totalGoals, which
      // is real ranked players only). Drives the "X גולים ע"י אורחים" fun fact.
      const guestGoals = cs?.guestGoals ?? 0;
      // Own goals across the club → the "X שערים עצמיים" fun fact.
      const ownGoals = cs?.ownGoals ?? 0;
      return { totalGoals, totalRounds, tiedRounds, shootoutRounds, scorelessRounds, guestGoals, ownGoals, players };
    } catch (err) {
      logError('getCommunityChampionship', err, { groupId });
      if (__DEV__) console.warn('[gameService] getCommunityChampionship failed', err);
      return empty;
    }
  },

  /**
   * The club's "deadly duo" — the assister→scorer pair with the most assists
   * between them, across this club's games (`communityPairStats/{groupId}__*`).
   * Direction is collapsed: we just surface the two players + their shared
   * assist count. Returns null when no assist pairs exist yet.
   */
  async getCommunityDeadlyDuo(groupId: GroupId): Promise<{
    uidA: UserId;
    uidB: UserId;
    assists: number;
  } | null> {
    if (!groupId) return null;
    if (USE_MOCK_DATA) {
      return { uidA: mockPlayers[0].id, uidB: mockPlayers[2].id, assists: 17 };
    }
    const db = getFirebase().db;
    try {
      // Only the single top pair is needed — let Firestore find it with
      // orderBy+limit(1) instead of reading EVERY pair doc (communityPairStats
      // grows ~O(members²)) and maxing client-side. Needs composite index
      // (groupId ASC, assists DESC).
      const snap = await getDocs(
        query(
          collection(db, 'communityPairStats'),
          where('groupId', '==', groupId),
          orderBy('assists', 'desc'),
          limit(1),
        ),
      );
      const d = snap.docs[0];
      if (!d) return null;
      const data = d.data() as { a?: string; b?: string; assists?: number };
      const assists = data.assists ?? 0;
      if (!data.a || !data.b || assists <= 0) return null;
      return { uidA: data.a, uidB: data.b, assists };
    } catch (err) {
      logError('getCommunityDeadlyDuo', err, { groupId });
      if (__DEV__) console.warn('[gameService] getCommunityDeadlyDuo failed', err);
      return null;
    }
  },

  /**
   * Per-GAME championship — goals + assists each player tallied IN THIS game
   * (gamePlayerStats/{gameId}__{uid}, written by commitRoundStats). Ranked by
   * score = goals×2 + assists×1. Shown on MatchDetails once the game is
   * finished. Games that finished before this collection existed return [].
   */
  async getGameChampionship(
    gameId: string,
    // Players who were in the evening (attended). Anyone here without a stat row
    // is merged in as a zero-row so the table lists EVERYONE who was there, not
    // only those who scored/won (user report [cetR]: show attendees who "were in
    // the evening" even with no stats).
    attendedUids?: string[],
  ): Promise<{ players: ChampionshipRow[] }> {
    if (USE_MOCK_DATA || !gameId) return { players: [] };
    const db = getFirebase().db;
    try {
      const snap = await getDocs(
        query(collection(db, 'gamePlayerStats'), where('gameId', '==', gameId)),
      );
      const statRows = snap.docs.map(
        (d) => d.data() as { userId?: string; isGuest?: boolean },
      );
      // Merge attendees as zero-rows ONLY for games that actually have stats —
      // a legacy pre-stats game (no docs at all) should stay empty (return null
      // in the component) rather than render an all-zero table. Guests among the
      // attendees are marked isGuest so the table resolves their name from
      // game.guests (they have no /users doc).
      if (statRows.length > 0 && attendedUids && attendedUids.length) {
        const have = new Set(statRows.map((r) => r.userId));
        for (const uid of attendedUids) {
          if (uid && !have.has(uid)) {
            statRows.push(isGuestId(uid) ? { userId: uid, isGuest: true } : { userId: uid });
            have.add(uid);
          }
        }
      }
      // 'points' + keepAll: rank the game table the SAME way as the community
      // table (wins → goals → assists), keeping every attendee (keepAll, so an
      // all-zero row isn't dropped).
      return {
        players: rankChampionshipRows(statRows, 'points', true),
      };
    } catch (err) {
      logError('getGameChampionship', err, { gameId });
      if (__DEV__) console.warn('[gameService] getGameChampionship failed', err);
      return { players: [] };
    }
  },

  // ── Retro goals (admin-only, after a game is finished) ───────────────────
  // Credit a missed goal to a player's totals WITHOUT touching any mini-game
  // score/winner. All writes to the stat stores happen server-side in the
  // addRetroGoal / removeRetroGoal callables (mirroring commitRoundStats); the
  // client only invokes them + reads the audit list for the manage sheet.

  /** List the retro goals recorded for a finished game (newest first). */
  async getRetroGoals(gameId: string): Promise<RetroGoal[]> {
    if (USE_MOCK_DATA || !gameId) return [];
    try {
      const snap = await getDocs(collection(docs.game(gameId), 'retroGoals'));
      return snap.docs
        .map((d) => {
          const x = d.data();
          return {
            id: d.id,
            scorerId: x.scorerId as string,
            assisterId: (x.assisterId ?? null) as string | null,
            addedBy: x.addedBy as string,
            at: Number(x.at ?? 0),
          };
        })
        .sort((a, b) => b.at - a.at);
    } catch (err) {
      logError('getRetroGoals', err, { gameId });
      if (__DEV__) console.warn('[gameService] getRetroGoals failed', err);
      return [];
    }
  },

  /**
   * Read the per-mini-game history for a finished game (one doc per committed
   * round under games/{id}/roundHistory). Returns them in CHRONOLOGICAL order
   * (earliest mini-game first) for the "היסטוריית המשחקונים" screen. Each doc
   * holds both rosters, the score, the winner, the goal log (scorer + assister
   * + own-goal) and the shootout kicks (when the round was decided on penalties).
   * Best-effort data — old games predating this feature return []. Reads are
   * gated by rules to game participants (mirrors the evening-summary read).
   */
  async getRoundHistory(gameId: string): Promise<RoundHistoryDoc[]> {
    if (!gameId) return [];
    if (USE_MOCK_DATA) return mockRoundHistory[gameId] ?? [];
    try {
      const snap = await getDocs(collection(docs.game(gameId), 'roundHistory'));
      const arr = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const goals = Array.isArray(x.goals) ? (x.goals as RoundGoalRec[]) : [];
        const penalties = Array.isArray(x.penalties)
          ? (x.penalties as RoundPenaltyRec[])
          : undefined;
        return {
          roundId: String(x.roundId ?? d.id),
          teamA: Array.isArray(x.teamA) ? (x.teamA as string[]) : [],
          teamB: Array.isArray(x.teamB) ? (x.teamB as string[]) : [],
          teamAIndex: typeof x.teamAIndex === 'number' ? x.teamAIndex : -1,
          teamBIndex: typeof x.teamBIndex === 'number' ? x.teamBIndex : -1,
          scoreA: Number(x.scoreA ?? 0),
          scoreB: Number(x.scoreB ?? 0),
          winnerSide: (x.winnerSide ?? 'tie') as RoundHistoryDoc['winnerSide'],
          goals,
          penalties,
          at: Number(x.at ?? 0),
        } as RoundHistoryDoc;
      });
      // Chronological (mini-game 1 → N). `at` is the commit time; fall back to a
      // numeric roundId when timestamps tie or are missing on legacy docs.
      return arr.sort(
        (a, b) => a.at - b.at || Number(a.roundId) - Number(b.roundId),
      );
    } catch (err) {
      logError('getRoundHistory', err, { gameId });
      if (__DEV__) console.warn('[gameService] getRoundHistory failed', err);
      return [];
    }
  },

  /** Add a retro goal. `retroGoalId` is client-generated → idempotency key. */
  async addRetroGoal(
    gameId: string,
    scorerId: string,
    assisterId: string | null,
    retroGoalId: string,
  ): Promise<void> {
    if (USE_MOCK_DATA) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    await httpsCallable(getFirebase().functions, 'addRetroGoal')({
      gameId,
      scorerId,
      assisterId,
      retroGoalId,
    });
  },

  /** Undo a retro goal (decrements the same stats it credited). */
  async removeRetroGoal(gameId: string, retroGoalId: string): Promise<void> {
    if (USE_MOCK_DATA) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    await httpsCallable(getFirebase().functions, 'removeRetroGoal')({
      gameId,
      retroGoalId,
    });
  },

  /**
   * The club's recent stored team splits, for the auto-balance variety model
   * ("don't put the same people together again"). One read per game-night, off
   * the game document itself — the alternative source, `roundHistory`, is a
   * subcollection and would cost a read per mini-game.
   *
   * `originalTeams` is the split as first drawn and `teams` is what it became
   * by the end of the night (went-home strips players out of it), so the frozen
   * one wins whenever it's there. Older games have none — they fall back to
   * `teams`, which under-reports pairs whose player left early. That is a known
   * gap in old data, not something to paper over.
   *
   * Games with no split at all are dropped rather than returned empty: a night
   * we know nothing about must not consume a slot in a pair's history window.
   */
  async getRecentSplits(
    groupId: GroupId,
    opts?: { limit?: number; excludeGameId?: string },
  ): Promise<PastSplit[]> {
    const max = opts?.limit ?? HISTORY_GAMES;
    if (!groupId) return [];
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.groupId === groupId &&
            g.id !== opts?.excludeGameId &&
            g.status === 'finished' &&
            g.draftTeams,
        )
        .sort((a, b) => b.startsAt - a.startsAt)
        .slice(0, max)
        .map((g) => ({
          startsAt: g.startsAt,
          teams: (g.draftTeams?.originalTeams ?? g.draftTeams?.teams ?? []).map(
            (t) => [...t.playerIds],
          ),
        }))
        .filter((s) => s.teams.length > 0);
    }
    try {
      // Same (groupId, status, startsAt desc) index the history screen uses.
      // Fetch a couple more than needed — some will have no split and drop out.
      const snap = await getDocs(
        query(
          col.games(),
          where('groupId', '==', groupId),
          where('status', '==', 'finished'),
          orderBy('startsAt', 'desc'),
          limit(max + 4),
        ),
      );
      const out: PastSplit[] = [];
      for (const d of snap.docs) {
        if (out.length >= max) break;
        if (d.id === opts?.excludeGameId) continue;
        const g = d.data();
        const teams = (g.draftTeams?.originalTeams ?? g.draftTeams?.teams ?? [])
          .map((t) => [...t.playerIds])
          .filter((ids) => ids.length > 0);
        if (teams.length === 0) continue;
        out.push({ startsAt: g.startsAt, teams });
      }
      return out;
    } catch (err) {
      // History is an enhancement, never a blocker: a failure here just means
      // the split is decided on rating alone, exactly as it was before.
      logError('getRecentSplits', err, { groupId });
      return [];
    }
  },

  async getHistory(groupId: GroupId): Promise<GameSummary[]> {
    if (USE_MOCK_DATA) return mockHistory;

    // Stage 2 lifecycle: history = terminal evenings only. 'locked' is
    // a mid-flow state (registration frozen, game not started) and
    // does NOT belong here — the previous filter accidentally surfaced
    // unfinished games as "history".
    // Community history should list ALL of the club's past games, not just
    // the most recent 20 (the old cap silently truncated active clubs — see
    // the count mismatch noted in CommunityDetailsScreen). 100 covers ~2
    // years of weekly play; we keep a bound because each game also costs a
    // rounds-subcollection read, and an unbounded query on a busy club would
    // multiply reads on every page open.
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['finished', 'cancelled']),
      orderBy('startsAt', 'desc'),
      limit(100)
    );
    let snap;
    try {
      snap = await getDocs(q);
    } catch (err) {
      if (isPermissionDenied(err)) return []; // deleted group / non-member
      logError('getHistory', err, { groupId });
      if (__DEV__) console.warn('[gameService] getHistory failed', err);
      throw err;
    }
    return Promise.all(
      snap.docs.map(async (d) => {
        const g = d.data();
        const rounds = await loadRoundsFor(g.id);
        const last = rounds[rounds.length - 1];
        return {
          id: g.id,
          groupId: g.groupId,
          date: g.startsAt,
          matchCount: rounds.length,
          status: g.status === 'cancelled' ? 'cancelled' : 'finished',
          // Hand the title + field + format up to History so the row
          // can show what the game was without a second fetch.
          title: g.title,
          fieldName: g.fieldName,
          format: g.format,
          lastResult:
            last && last.winner
              ? { teamA: last.teamA, teamB: last.teamB, winner: last.winner }
              : undefined,
        };
      })
    );
  },

  /**
   * Games a user actually PLAYED — the personal "games played" feed that
   * powers the Profile count, History, and Stats.
   *
   * Definition (unified 2026-06-21): a game counts as played iff it is a
   * FINISHED, PAST game where the user is in the final `players[]` and was not
   * marked `no_show` — `isAttendedGame`, the SAME predicate the Statistics
   * screen and achievements use, so the "משחקים" count agrees everywhere.
   * (Previously this used a stricter `draftTeams`-membership gate, which
   * disagreed with the stats screen for any game where teams weren't drawn.)
   *
   * Query is the single-field `participantIds array-contains` (no composite
   * index needed); the time + attendance filtering happens client-side.
   */
  async getPlayedGames(userId: UserId, max = 50): Promise<GameSummary[]> {
    if (!userId) return [];
    if (USE_MOCK_DATA) {
      const now = Date.now();
      return mockGamesV2
        .filter((g) => isAttendedGame(g, userId, now))
        .sort((a, b) => b.startsAt - a.startsAt)
        .slice(0, max)
        .map((g) => playedGameSummary(g));
    }

    const now = Date.now();
    let snap;
    try {
      // Played games are in the PAST (startsAt < now). Read only the `max` most
      // recent past games the user was in — ordered + limited server-side —
      // instead of scanning their whole history and slicing client-side.
      // Uses the (participantIds CONTAINS, startsAt) composite index.
      snap = await getDocs(
        query(
          col.games(),
          where('participantIds', 'array-contains', userId),
          where('startsAt', '<', now),
          orderBy('startsAt', 'desc'),
          limit(max),
        ),
      );
    } catch (err) {
      logError('getPlayedGames', err, { userId });
      if (__DEV__) console.warn('[gameService] getPlayedGames failed', err);
      throw err;
    }
    return snap.docs
      .map((d) => d.data())
      .filter((g) => isAttendedGame(g, userId, now))
      .sort((a, b) => b.startsAt - a.startsAt)
      .slice(0, max)
      .map((g) => playedGameSummary(g));
  },

  /**
   * Exact count of games the user played — the headline number on the
   * Profile. Uses an UNBOUNDED `participantIds array-contains` scan (the same
   * single-field index playerStatsService uses) and the canonical
   * `isAttendedGame` predicate, so it equals the Statistics screen's "משחקים"
   * tile precisely (no 50-row cap, no model drift). Best-effort: returns null
   * on failure so callers can keep the previous value.
   */
  async getPlayedGamesCount(userId: UserId): Promise<number | null> {
    if (!userId) return 0;
    const now = Date.now();
    if (USE_MOCK_DATA) {
      return mockGamesV2.filter((g) => isAttendedGame(g, userId, now)).length;
    }
    try {
      const snap = await getDocs(
        query(col.games(), where('participantIds', 'array-contains', userId)),
      );
      return snap.docs.reduce(
        (n, d) => (isAttendedGame(d.data(), userId, now) ? n + 1 : n),
        0,
      );
    } catch (err) {
      if (isPermissionDenied(err)) return null; // deleted game / no access — quiet
      logError('getPlayedGamesCount', err, { userId });
      if (__DEV__) console.warn('[gameService] getPlayedGamesCount failed', err);
      return null;
    }
  },

  /**
   * Persist a mutated game.
   * Mock: keep in memory.
   * Firebase: write the game doc + diff the rounds.
   */
  async saveGame(next: Game): Promise<void> {
    if (USE_MOCK_DATA) {
      activeGame = next;
      return;
    }
    const { db } = getFirebase();
    const ref = docs.game(next.id);
    const batch = writeBatch(db);
    batch.set(ref, gameDocFromGame(next), { merge: true });

    // Sync rounds: easiest correct strategy is to upsert rounds we have and
    // leave older ones alone. With ~6 rounds per night this is fine.
    next.matches.forEach((m) => {
      // Deterministic id = `${gameId}_${index}` so re-saves overwrite
      // rather than create duplicate round docs.
      const rDoc = doc(col.rounds(), `${next.id}_${m.index}`);
      // Pass the optional fields through as-is — the converter's
      // toFirestore translates undefined → null on the wire.
      batch.set(rDoc, {
        id: rDoc.id,
        gameId: next.id,
        index: m.index,
        teamA: m.teamA,
        teamB: m.teamB,
        waiting: m.waiting,
        goalkeeperA: m.goalkeeperA,
        goalkeeperB: m.goalkeeperB,
        startedAt: m.startedAt,
        endedAt: m.endedAt,
        winner: m.winner,
        teamAPlayerIds: m.teamAPlayerIds,
        teamBPlayerIds: m.teamBPlayerIds,
        scoreA: m.scoreA,
        scoreB: m.scoreB,
      });
    });

    try {
      await batch.commit();
    } catch (err) {
      logError('saveGame', err, {
        gameId: next.id,
        roundCount: next.matches.length,
      });
      if (__DEV__) console.warn('[gameService] saveGame failed', err);
      throw err;
    }
  },

  // ── Phase 4: multi-game queries + actions ───────────────────────────────

  /**
   * Games the user is involved in across all communities — registered,
   * waitlisted, or pending approval. Status: open only (history lives in
   * getHistory). Sorted by startsAt asc so "next up" is on top.
   */
  async getMyGames(userId: UserId): Promise<Game[]> {
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.status === 'open' &&
            (g.participantIds ?? [
              ...g.players,
              ...g.waitlist,
              ...(g.pending ?? []),
            ]).includes(userId)
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    return cachedMyGames(`open:${userId}`, async () => {
    // Firebase: two parallel queries — games I'm a participant in
    // (`participantIds` array-contains me) AND games I created
    // (`createdBy == me`). Both are floored at `startsAt >= now-48h` so we
    // read only recent/upcoming games, not the user's whole history — see
    // MY_GAMES_WINDOW_MS. Needs the (participantIds CONTAINS, startsAt) and
    // (createdBy, startsAt) composite indexes. The creator union closes G-09 —
    // admins who create a game without registering still see it.
    //
    // `allSettled` (not `all`) on purpose: if ONE query trips a rules
    // edge case (e.g. a stale created-by row in a community the user
    // was removed from), we still want the other half to land. With
    // `all`, a single PERMISSION_DENIED would blank the entire list.
    const floor = myGamesFloor();
    const [participatingResult, createdResult] = await Promise.allSettled([
      withAuthRaceRetry(() =>
        getDocs(
          query(
            col.games(),
            where('participantIds', 'array-contains', userId),
            where('startsAt', '>=', floor),
          ),
        ),
      ),
      withAuthRaceRetry(() =>
        getDocs(
          query(
            col.games(),
            where('createdBy', '==', userId),
            where('startsAt', '>=', floor),
          ),
        ),
      ),
    ]);
    const seen = new Set<string>();
    const all: Game[] = [];
    if (participatingResult.status === 'fulfilled') {
      for (const d of participatingResult.value.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        all.push({ ...d.data(), matches: [] });
      }
    } else {
      logError('getMyGames', participatingResult.reason, {
        userId,
        query: 'participantIds',
      });
      if (__DEV__) {
        console.warn(
          '[gameService] getMyGames: participantIds query failed',
          participatingResult.reason,
        );
      }
    }
    if (createdResult.status === 'fulfilled') {
      for (const d of createdResult.value.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        all.push({ ...d.data(), matches: [] });
      }
    } else {
      logError('getMyGames', createdResult.reason, {
        userId,
        query: 'createdBy',
      });
      if (__DEV__) {
        console.warn(
          '[gameService] getMyGames: createdBy query failed',
          createdResult.reason,
        );
      }
    }
    return all
      .filter((g) => g.status === 'open')
      .filter((g) => !isStaleAfterStart(g))
      .sort((a, b) => a.startsAt - b.startsAt);
    });
  },

  /**
   * Like getMyGames, but keeps games at every non-terminal lifecycle
   * point — `scheduled | open | locked | active`. The watch relay /
   * phone widgets need ALL of these:
   *   • scheduled → "המשחק יפתח להרשמה ב…" (pre-registration UI)
   *   • open/locked → upcoming-game card
   *   • active → live stopwatch
   * The `open`-only getMyGames dropped live games (status flipped to
   * 'active'), and didn't surface scheduled games at all. Terminal /
   * stale games are still excluded.
   */
  async getMyLiveOrUpcomingGames(userId: UserId): Promise<Game[]> {
    const LIVE_STATUSES: readonly GameStatus[] = [
      'scheduled',
      'open',
      'locked',
      'active',
    ];
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            LIVE_STATUSES.includes(g.status) &&
            ((g.participantIds ?? [
              ...g.players,
              ...g.waitlist,
              ...(g.pending ?? []),
            ]).includes(userId) ||
              g.createdBy === userId),
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    return cachedMyGames(`live:${userId}`, async () => {
    // Two-query union (participating + created) — same G-09 rationale
    // as getMyGames above. Both floored at `startsAt >= now-48h` so we read
    // only recent/upcoming games, never the whole history. `allSettled`
    // mirrors getMyGames — a single failing query never blanks the result.
    const floor = myGamesFloor();
    const [participatingResult, createdResult] = await Promise.allSettled([
      withAuthRaceRetry(() =>
        getDocs(
          query(
            col.games(),
            where('participantIds', 'array-contains', userId),
            where('startsAt', '>=', floor),
          ),
        ),
      ),
      withAuthRaceRetry(() =>
        getDocs(
          query(
            col.games(),
            where('createdBy', '==', userId),
            where('startsAt', '>=', floor),
          ),
        ),
      ),
    ]);
    const seen = new Set<string>();
    const all: Game[] = [];
    if (participatingResult.status === 'fulfilled') {
      for (const d of participatingResult.value.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        all.push({ ...d.data(), matches: [] });
      }
    } else {
      logError('getMyLiveOrUpcomingGames', participatingResult.reason, {
        userId,
        query: 'participantIds',
      });
      if (__DEV__) {
        console.warn(
          '[gameService] getMyLiveOrUpcomingGames: participantIds query failed',
          participatingResult.reason,
        );
      }
    }
    if (createdResult.status === 'fulfilled') {
      for (const d of createdResult.value.docs) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        all.push({ ...d.data(), matches: [] });
      }
    } else {
      logError('getMyLiveOrUpcomingGames', createdResult.reason, {
        userId,
        query: 'createdBy',
      });
      if (__DEV__) {
        console.warn(
          '[gameService] getMyLiveOrUpcomingGames: createdBy query failed',
          createdResult.reason,
        );
      }
    }
    return all
      .filter((g) => LIVE_STATUSES.includes(g.status))
      .filter((g) => !isStaleAfterStart(g))
      .sort((a, b) => a.startsAt - b.startsAt);
    });
  },

  /**
   * Realtime subscription variant of [getMyLiveOrUpcomingGames] — fires
   * `cb` on the initial snapshot AND on every subsequent change to ANY
   * game the user participates in (`participantIds array-contains uid`).
   * Used by the watch/widget sync to push updates within ~1s when other
   * users register, cancel, or start the timer — instead of polling
   * every 20s. Returns an unsubscribe handle.
   */
  subscribeMyLiveOrUpcomingGames(
    userId: UserId,
    cb: (games: Game[]) => void,
  ): () => void {
    const LIVE_STATUSES: readonly GameStatus[] = [
      'scheduled',
      'open',
      'locked',
      'active',
    ];
    if (USE_MOCK_DATA) {
      // Mock mode has no live subscription — fire once with current
      // filtered data and return a no-op unsubscribe.
      const games = mockGamesV2
        .filter(
          (g) =>
            LIVE_STATUSES.includes(g.status) &&
            ((g.participantIds ?? [
              ...g.players,
              ...g.waitlist,
              ...(g.pending ?? []),
            ]).includes(userId) ||
              g.createdBy === userId),
        )
        .sort((a, b) => a.startsAt - b.startsAt);
      cb(games);
      return () => undefined;
    }
    // Two parallel onSnapshot listeners — participating + created.
    // Merged client-side on every emission. Closes G-09 for the
    // realtime path (widget / watch / live-screen banners) too: a
    // creator-only game shows up in widgets and syncs on changes.
    let participatingDocs = new Map<string, Game>();
    let createdDocs = new Map<string, Game>();
    const emit = () => {
      const merged: Game[] = [];
      const seen = new Set<string>();
      for (const g of [
        ...participatingDocs.values(),
        ...createdDocs.values(),
      ]) {
        if (seen.has(g.id)) continue;
        seen.add(g.id);
        merged.push(g);
      }
      cb(
        merged
          .filter((g) => LIVE_STATUSES.includes(g.status))
          // Drop games long past kickoff — EXCEPT one with a still-running live
          // match. Otherwise a match that runs past the stale window (or whose
          // kickoff was hours ago) would vanish from the watch/widget mid-game.
          .filter(
            (g) =>
              !isStaleAfterStart(g) ||
              (g.liveMatch != null && g.liveMatch.phase !== 'finished'),
          )
          .sort((a, b) => a.startsAt - b.startsAt),
      );
    };
    const onErr = (err: unknown) => {
      logError('subscribeMyLiveOrUpcomingGames', err, { userId });
      if (__DEV__) {
        console.warn(
          '[gameService] subscribeMyLiveOrUpcomingGames error',
          err,
        );
      }
    };
    // Floored at `startsAt >= now-48h` so the listener tracks only recent/
    // upcoming games, not the user's entire history (which would re-read every
    // historical game on attach and on any change). See MY_GAMES_WINDOW_MS.
    const floor = myGamesFloor();
    const unsubA = onSnapshot(
      query(
        col.games(),
        where('participantIds', 'array-contains', userId),
        where('startsAt', '>=', floor),
      ),
      (snap) => {
        participatingDocs = new Map(
          snap.docs.map((d) => [d.id, { ...d.data(), matches: [] } as Game]),
        );
        emit();
      },
      onErr,
    );
    const unsubB = onSnapshot(
      query(
        col.games(),
        where('createdBy', '==', userId),
        where('startsAt', '>=', floor),
      ),
      (snap) => {
        createdDocs = new Map(
          snap.docs.map((d) => [d.id, { ...d.data(), matches: [] } as Game]),
        );
        emit();
      },
      onErr,
    );
    return () => {
      unsubA();
      unsubB();
    };
  },

  /**
   * Games scheduled in communities the user belongs to, excluding ones
   * already surfaced in getMyGames (so a single game doesn't appear twice).
   */
  async getCommunityGames(
    userId: UserId,
    communityIds: string[]
  ): Promise<Game[]> {
    if (communityIds.length === 0) return [];
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.status === 'open' &&
            communityIds.includes(g.groupId) &&
            !g.players.includes(userId) &&
            !g.waitlist.includes(userId) &&
            !(g.pending ?? []).includes(userId)
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    // Firebase: chunk communityIds in groups of 30 for the `in`
    // operator. We filter `status == 'open'` SERVER-SIDE (uses the existing
    // (groupId, status, startsAt) composite index) so we read only open games
    // per community — not the whole all-time history of every community, which
    // was a major read sink on the games tab. Remaining checks + sort are
    // client-side.
    const chunks: string[][] = [];
    for (let i = 0; i < communityIds.length; i += 30) {
      chunks.push(communityIds.slice(i, i + 30));
    }
    // Per-chunk, fail-soft. The games read rule allows a doc only when the
    // user is a group member / participant / creator / it's public. A LIST
    // query fails ENTIRELY if any matched doc fails the rule — which happens
    // transiently when `communityIds` is briefly out of sync with the actual
    // membership (join/leave, token refresh). Catch per chunk and return a
    // PARTIAL result instead of throwing up and breaking the whole games list.
    // 'permission-denied' is expected here, so it is NOT logged to /errors.
    const snaps = (
      await Promise.all(
        chunks.map((c) =>
          withAuthRaceRetry(() =>
            getDocs(
              query(col.games(), where('groupId', 'in', c), where('status', '==', 'open')),
            ),
          ).catch(
            (err: { code?: string }) => {
              if (err?.code !== 'permission-denied') {
                logError('getCommunityGames', err, {
                  userId,
                  communityCount: communityIds.length,
                });
              } else if (__DEV__) {
                console.warn('[gameService] getCommunityGames chunk denied (transient)');
              }
              return null;
            },
          ),
        ),
      )
    ).filter((s): s is NonNullable<typeof s> => s != null);
    const out: Game[] = [];
    const seen = new Set<string>();
    snaps.forEach((s) =>
      s.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const data = d.data();
        if (data.status !== 'open') return;
        if (isStaleAfterStart({ ...data, matches: [] } as Game)) return;
        if (
          data.players.includes(userId) ||
          data.waitlist.includes(userId) ||
          (data.pending ?? []).includes(userId)
        )
          return;
        out.push({ ...data, matches: [] });
      })
    );
    return out.sort((a, b) => a.startsAt - b.startsAt);
  },

  /**
   * Scheduled games (registration not yet open) in communities the user
   * belongs to. Powers the read-only "בקרוב" teasers on the home no-game
   * state + the games-feed "coming soon" section, so a member sees a game
   * is on the way and when it opens — without having to drill into each
   * community page. Registration is still blocked until `flipScheduledGames`
   * flips status to 'open'; these cards route to the community page, never a
   * join. Server-filters `status == 'scheduled'` (reuses the
   * (groupId, status, startsAt) index), drops any whose kickoff already
   * passed, and sorts soonest-to-open first.
   */
  async getMyUpcomingScheduledGames(
    userId: UserId,
    communityIds: string[],
  ): Promise<Game[]> {
    if (communityIds.length === 0) return [];
    const now = Date.now();
    // "Still a pre-open teaser": scheduled + kickoff in the future. (A
    // scheduled game whose kickoff somehow passed is stale, not upcoming.)
    const stillUpcoming = (g: {
      status?: string;
      startsAt?: number;
    }) => g.status === 'scheduled' && (g.startsAt ?? 0) > now;
    const openKey = (g: Game) => g.registrationOpensAt ?? g.startsAt;
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter((g) => communityIds.includes(g.groupId) && stillUpcoming(g))
        .sort((a, b) => openKey(a) - openKey(b));
    }
    // Chunk in 30s for the `in` operator; fail-soft per chunk (mirrors
    // getCommunityGames — a LIST query fails entirely if any matched doc
    // fails the read rule, which happens transiently when communityIds is
    // briefly out of sync with membership). 'permission-denied' is expected,
    // so it's NOT logged to /errors.
    const chunks: string[][] = [];
    for (let i = 0; i < communityIds.length; i += 30) {
      chunks.push(communityIds.slice(i, i + 30));
    }
    const snaps = (
      await Promise.all(
        chunks.map((c) =>
          withAuthRaceRetry(() =>
            getDocs(
              query(
                col.games(),
                where('groupId', 'in', c),
                where('status', '==', 'scheduled'),
              ),
            ),
          ).catch((err: { code?: string }) => {
            if (err?.code !== 'permission-denied') {
              logError('getMyUpcomingScheduledGames', err, {
                userId,
                communityCount: communityIds.length,
              });
            } else if (__DEV__) {
              console.warn(
                '[gameService] getMyUpcomingScheduledGames chunk denied (transient)',
              );
            }
            return null;
          }),
        ),
      )
    ).filter((s): s is NonNullable<typeof s> => s != null);
    const out: Game[] = [];
    const seen = new Set<string>();
    snaps.forEach((s) =>
      s.docs.forEach((d) => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const data = d.data();
        if (!stillUpcoming(data)) return;
        out.push({ ...data, matches: [] });
      }),
    );
    return out.sort((a, b) => openKey(a) - openKey(b));
  },

  /**
   * All upcoming games of a single community whose registration is or
   * will be open — regardless of the caller's membership in any
   * individual game.
   *
   * Includes both `status === 'open'` (joinable now) AND
   * `status === 'scheduled'` (deferred-open: registration hasn't
   * started yet). Scheduled games surface on the community page as
   * "registration opens at HH:MM" so members and admins can see what's
   * coming, but the UI should NOT route a tap on them to MatchDetails
   * — joins are blocked until the CF flips status to 'open'.
   *
   * Distinct from `getCommunityGames` (discovery) which deliberately
   * excludes games the user is already in.
   */
  /**
   * Public-only variant of `getUpcomingGamesForGroup` for the
   * non-member-facing community page. Filters server-side by
   * `visibility === 'public'` so the read rule never trips on a
   * community-only game (which non-members can't read), and at the
   * same time keeps the result useful for deriving the community's
   * day/hour pattern from real upcoming activity instead of from the
   * legacy `preferredDays`/`preferredHour` fields on the group doc.
   */
  async getUpcomingPublicGamesForGroup(groupId: GroupId): Promise<Game[]> {
    const now = Date.now();
    const isUpcomingStatus = (s: string | undefined) =>
      s === 'open' || s === 'scheduled';
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.groupId === groupId &&
            g.visibility === 'public' &&
            isUpcomingStatus(g.status) &&
            g.startsAt > now,
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    let snap;
    try {
      snap = await getDocs(
        query(
          col.games(),
          where('groupId', '==', groupId),
          where('visibility', '==', 'public'),
        ),
      );
    } catch (err) {
      logError('getUpcomingPublicGamesForGroup', err, { groupId });
      if (__DEV__) {
        console.warn(
          '[gameService] getUpcomingPublicGamesForGroup failed',
          err,
        );
      }
      throw err;
    }
    const out: Game[] = [];
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!isUpcomingStatus(data.status)) return;
      if (data.startsAt <= now) return;
      out.push({ ...data, matches: [] });
    });
    return out.sort((a, b) => a.startsAt - b.startsAt);
  },

  async getUpcomingGamesForGroup(groupId: GroupId): Promise<Game[]> {
    const now = Date.now();
    const isUpcomingStatus = (s: string | undefined) =>
      s === 'open' || s === 'scheduled';
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.groupId === groupId &&
            isUpcomingStatus(g.status) &&
            g.startsAt > now,
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    let snap;
    try {
      // Only future games (range on startsAt) — not the group's whole history.
      // Status filtered client-side. Uses the (groupId, startsAt) index.
      snap = await getDocs(
        query(
          col.games(),
          where('groupId', '==', groupId),
          where('startsAt', '>', now),
        ),
      );
    } catch (err) {
      if (isPermissionDenied(err)) return []; // deleted group / non-member
      logError('getUpcomingGamesForGroup', err, { groupId });
      if (__DEV__) {
        console.warn('[gameService] getUpcomingGamesForGroup failed', err);
      }
      throw err;
    }
    const out: Game[] = [];
    snap.docs.forEach((d) => {
      const data = d.data();
      if (!isUpcomingStatus(data.status)) return;
      if (data.startsAt <= now) return;
      if (isStaleAfterStart({ ...data, matches: [] } as Game)) return;
      out.push({ ...data, matches: [] });
    });
    return out.sort((a, b) => a.startsAt - b.startsAt);
  },

  /**
   * Public games the user is not a community member of AND not already
   * involved in. Surfaces the "discover" half of the Games tab.
   *
   * Visibility gate: only games with `visibility === 'public'` AND
   * `status === 'open'` AND `startsAt > now`. Anything else is hidden
   * — community-only games never surface here regardless of who is
   * looking, past games are excluded by definition.
   */
  async getOpenGames(
    userId: UserId,
    excludeCommunityIds: string[]
  ): Promise<Game[]> {
    const now = Date.now();
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.status === 'open' &&
            g.visibility === 'public' &&
            g.startsAt > now &&
            !excludeCommunityIds.includes(g.groupId) &&
            !g.players.includes(userId) &&
            !g.waitlist.includes(userId) &&
            !(g.pending ?? []).includes(userId)
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    // Public, open, future games only — filtered server-side so the public
    // discovery feed reads only live listings, not every public game ever.
    // Participation filters stay client-side. Uses the
    // (visibility, status, startsAt) composite index.
    let snap;
    try {
      // Wrapped so a cold-start auth race (token not yet attached →
      // permission-denied on the very first read after an update restart)
      // retries once instead of surfacing a failed load.
      snap = await withAuthRaceRetry(() =>
        getDocs(
          query(
            col.games(),
            where('visibility', '==', 'public'),
            where('status', '==', 'open'),
            where('startsAt', '>', now),
          ),
        ),
      );
    } catch (err) {
      logError('getOpenGames', err, {
        userId,
        excludeCount: excludeCommunityIds.length,
      });
      if (__DEV__) console.warn('[gameService] getOpenGames failed', err);
      throw err;
    }
    return snap.docs
      .map((d) => ({ ...d.data(), matches: [] }))
      .filter(
        (g) =>
          g.status === 'open' &&
          g.startsAt > now &&
          !isStaleAfterStart(g) &&
          !excludeCommunityIds.includes(g.groupId) &&
          !g.players.includes(userId) &&
          !g.waitlist.includes(userId) &&
          !(g.pending ?? []).includes(userId),
      )
      .sort((a, b) => a.startsAt - b.startsAt);
  },

  /**
   * Create a fresh game. Mock mode pushes to mockGamesV2 so the new card
   * shows up in the list. Firebase mode writes the doc and returns the
   * hydrated `Game` (with `matches: []`).
   */
  async createGameV2(input: {
    groupId: GroupId;
    title: string;
    startsAt: number;
    fieldName: string;
    maxPlayers: number;
    minPlayers?: number;
    format?: GameFormat;
    numberOfTeams?: number;
    cancelDeadlineHours?: number;
    fieldType?: import('@/types').FieldType;
    matchDurationMinutes?: number;
    autoTeamGenerationMinutesBeforeStart?: number;
    autoTeamsAt?: number;
    autoTeamsMethod?: 'rating' | 'random';
    visibility: 'public' | 'community';
    requiresApproval: boolean;
    waitlistApprovalRequired?: boolean;
    waitlistApprovalTimeoutMinutes?: number;
    bringBall: boolean;
    bringShirts: boolean;
    notes?: string;
    city?: string;
    fieldAddress?: string;
    /** Exact coords from the location picker. When present they're
     *  written straight onto the doc (no post-create geocode), so the
     *  game always has a real pin for Waze + the "near me" matcher. */
    fieldLat?: number;
    fieldLng?: number;
    /** @deprecated See `ruleTags`. Kept for legacy callers. */
    hasReferee?: boolean;
    /** @deprecated See `ruleTags`. */
    hasPenalties?: boolean;
    /** @deprecated See `ruleTags`. */
    hasHalfTime?: boolean;
    /** @deprecated See `ruleTags`. */
    extraTimeMinutes?: number;
    /** Free-text rule chips. Replaces the old hasReferee/Penalties/
     *  HalfTime/extraTime fields. */
    ruleTags?: string[];
    /**
     * Optional ms-epoch deferred-open timestamp. When present and in
     * the future, the game is created with `status: 'scheduled'` and
     * stays hidden + closed for joins until a CF flips it to 'open'
     * (`flipScheduledGames`, every 5 min). Used by the recurring-game
     * wizard. Past / undefined → game opens immediately.
     */
    registrationOpensAt?: number;
    /** Recurring weekly fixture — the clone-on-completion CF re-creates
     *  it for next week ~3h after kickoff. */
    recurring?: boolean;
    /** Set when this match is an occurrence OF an existing series (the weekly
     *  creator passes it). Suppresses creating a second series. */
    seriesId?: string;
    /** ms-epoch when the game flips community→public (CF-driven). */
    publicOpenAt?: number;
    /** ms-epoch before which non-admins can't add guests. */
    guestsOpenAt?: number;
    /** When true, this game is open to receiving filler push to
     *  non-members. Default: false (admin must opt in). */
    acceptsFillers?: boolean;
    /** Minimum trust score (0-100) for a filler candidate to receive
     *  the push. Ignored when `acceptsFillers !== true`. */
    fillerMinTrust?: number;
    /** Advanced game mode + its sub-options (see Game type). */
    advancedMode?: boolean;
    advancedFillMode?: 'permanent' | 'temporary';
    advancedTieMode?: 'bothOut' | 'veteranOut';
    createdBy: UserId;
    /**
     * Set when the game was created via the "ללא קבוצה — משחק
     * חד־פעמי" wizard path. The game still belongs to a real group
     * (the user's hidden personal community) but the UI renders it
     * as orphan-context: title shown as "משחק חד־פעמי", no
     * community link. After the game finishes the
     * `sendPromotePrompts` cron picks it up and pushes the creator
     * with the "צור קבוצה" CTA.
     */
    isOrphanContext?: boolean;
  }): Promise<Game> {
    clearMyGamesCache(); // a new game changes the creator's my-games list
    // Defensive: callers come from a TS-typed wizard but the field is
    // user-controlled, so reject anything that isn't one of the two
    // valid values rather than letting a typo land in Firestore.
    if (input.visibility !== 'public' && input.visibility !== 'community') {
      throw new Error('createGameV2: invalid visibility');
    }
    // Spam guard: 10 games / hour / user. Tight enough to stop
    // automated abuse; loose enough that an admin running a busy
    // weekend can still create morning + evening games.
    await enforceRateLimit(input.createdBy, 'createGame');
    // Pre-flight validation — surfaces a clear Hebrew error before
    // we hit Firestore (rules will block the same shapes anyway,
    // but a "permission denied" toast is useless to the user).
    const title = requireString('title', input.title, {
      max: 120,
      label: 'שם המשחק',
      sanitize: true,
    });
    const fieldName = requireString('fieldName', input.fieldName, {
      max: 200,
      label: 'שם המגרש',
    });
    const fieldAddress = optionalString('fieldAddress', input.fieldAddress, {
      max: 300,
      label: 'כתובת המגרש',
    });
    const notes = optionalString('notes', input.notes, {
      max: 1000,
      label: 'הערות',
    });
    const maxPlayers = requireInt('maxPlayers', input.maxPlayers, {
      min: 2,
      max: 50,
      label: 'מספר שחקנים',
    });
    // Mutate the input view so the rest of the function sees the
    // sanitized values without sprinkling them through every assignment.
    input.title = title;
    input.fieldName = fieldName;
    input.fieldAddress = fieldAddress;
    input.notes = notes;
    input.maxPlayers = maxPlayers;
    const now = Date.now();

    // Invariant: when both fields are set, registration must open
    // strictly BEFORE the kickoff time. Without this guard, a deferred
    // game whose `registrationOpensAt` lands AFTER `startsAt` would
    // sit in 'scheduled' forever; the cron flip-CF would still flip
    // it, but past the moment players could realistically join.
    // Mirrors the same check on `updateGameV2`.
    if (
      typeof input.registrationOpensAt === 'number' &&
      input.registrationOpensAt > 0 &&
      input.startsAt <= input.registrationOpensAt
    ) {
      const err = new Error('GAME_REG_AFTER_KICKOFF') as Error & {
        code: 'GAME_REG_AFTER_KICKOFF';
      };
      err.code = 'GAME_REG_AFTER_KICKOFF';
      throw err;
    }
    // Same invariant for the public-open flip / guests-open gate: both must
    // fall before kickoff or they're meaningless.
    if (typeof input.publicOpenAt === 'number' && input.publicOpenAt > 0 && input.publicOpenAt >= input.startsAt) {
      failValidation('publicOpenAt', he.gameOpenAfterKickoff);
    }
    if (typeof input.guestsOpenAt === 'number' && input.guestsOpenAt > 0 && input.guestsOpenAt >= input.startsAt) {
      failValidation('guestsOpenAt', he.gameOpenAfterKickoff);
    }
    // A game must not go app-wide PUBLIC before its own community registration
    // even opens — the flip cron (visibility=='community' && publicOpenAt<=now)
    // would surface a still-'scheduled', hidden-from-members game to strangers.
    if (
      typeof input.registrationOpensAt === 'number' && input.registrationOpensAt > 0 &&
      typeof input.publicOpenAt === 'number' && input.publicOpenAt > 0 &&
      input.publicOpenAt < input.registrationOpensAt
    ) {
      failValidation('publicOpenAt', he.gamePublicBeforeReg);
    }

    // Overlap guard — block creating a second game in the same
    // community within ±OVERLAP_WINDOW_MS of an existing one. Catches
    // the "admin pressed 'recurring' twice" / "admin already scheduled
    // manually" mistakes BEFORE the doc is written. Skipped in mock
    // mode where there's no risk of mis-clicks. The error carries the
    // conflicting game's title + start time so the UI can show a
    // human-readable explanation.
    if (!USE_MOCK_DATA) {
      const overlap = await findOverlappingGameInGroup(
        input.groupId,
        input.startsAt,
      );
      if (overlap) {
        const err = new Error('GAME_OVERLAP') as Error & {
          code: 'GAME_OVERLAP';
          conflict: {
            gameId: string;
            title: string;
            startsAt: number;
          };
        };
        err.code = 'GAME_OVERLAP';
        err.conflict = overlap;
        throw err;
      }
    }

    // Deferred-open mode: stays in 'scheduled' until the CF flips it.
    // The push is intentionally NOT dispatched here — the CF that
    // performs the flip dispatches `newGameInCommunity` so the
    // notification arrives at the moment registration actually opens.
    const isDeferred =
      typeof input.registrationOpensAt === 'number' &&
      input.registrationOpensAt > now;
    const initialStatus: Game['status'] = isDeferred ? 'scheduled' : 'open';
    // Quick games ('orphan context') are created by a user who wants to
    // PLAY them — the wizard never asks whether to self-register, because
    // it's implicit. Auto-add the creator to players + participantIds so
    // the game shows up as a real registered match instead of a ghost
    // with 0 players sitting in 'המשחקים שלי'. For community games we
    // keep the previous behaviour (creator may want to set things up
    // without joining themselves, e.g. an admin scheduling on behalf
    // of the group).
    const autoSelfRegister = input.isOrphanContext === true && !isDeferred;
    const initialPlayers = autoSelfRegister ? [input.createdBy] : [];
    const initialParticipantIds = autoSelfRegister ? [input.createdBy] : [];
    const base: Omit<Game, 'id'> = {
      groupId: input.groupId,
      title: input.title,
      startsAt: input.startsAt,
      fieldName: input.fieldName,
      maxPlayers: input.maxPlayers,
      minPlayers: input.minPlayers,
      players: initialPlayers,
      waitlist: [],
      pending: [],
      participantIds: initialParticipantIds,
      status: initialStatus,
      locked: false,
      currentMatchIndex: 0,
      matches: [],
      createdBy: input.createdBy,
      visibility: input.visibility,
      requiresApproval: input.requiresApproval,
      // Default = manual (the head confirms) — preserves the app's existing
      // offer behaviour; only an explicit `false` switches a game to auto.
      waitlistApprovalRequired: input.waitlistApprovalRequired ?? true,
      waitlistApprovalTimeoutMinutes:
        input.waitlistApprovalTimeoutMinutes ?? 20,
      format: input.format,
      numberOfTeams: input.numberOfTeams,
      cancelDeadlineHours: input.cancelDeadlineHours,
      fieldType: input.fieldType,
      matchDurationMinutes: input.matchDurationMinutes,
      autoTeamGenerationMinutesBeforeStart:
        input.autoTeamGenerationMinutesBeforeStart,
      autoTeamsAt: input.autoTeamsAt,
      autoTeamsMethod: input.autoTeamsMethod,
      bringBall: input.bringBall,
      bringShirts: input.bringShirts,
      notes: input.notes,
      city: input.city,
      fieldAddress: input.fieldAddress,
      // Pin coords from the picker, when supplied (else the async
      // geocode below fills them best-effort).
      fieldLat:
        typeof input.fieldLat === 'number' ? input.fieldLat : undefined,
      fieldLng:
        typeof input.fieldLng === 'number' ? input.fieldLng : undefined,
      hasReferee: input.hasReferee,
      hasPenalties: input.hasPenalties,
      hasHalfTime: input.hasHalfTime,
      extraTimeMinutes: input.extraTimeMinutes,
      ruleTags: Array.isArray(input.ruleTags)
        ? input.ruleTags
            .filter((t) => typeof t === 'string' && t.trim().length > 0)
            .map((t) => t.trim().slice(0, 30))
            .slice(0, 12)
        : undefined,
      registrationOpensAt: input.registrationOpensAt,
      recurring: input.recurring === true ? true : undefined,
      publicOpenAt:
        typeof input.publicOpenAt === 'number' ? input.publicOpenAt : undefined,
      guestsOpenAt:
        typeof input.guestsOpenAt === 'number' ? input.guestsOpenAt : undefined,
      acceptsFillers: input.acceptsFillers === true,
      fillerMinTrust:
        input.acceptsFillers === true &&
        typeof input.fillerMinTrust === 'number'
          ? input.fillerMinTrust
          : undefined,
      advancedMode: input.advancedMode === true ? true : undefined,
      advancedFillMode:
        input.advancedMode === true && input.numberOfTeams === 3
          ? input.advancedFillMode
          : undefined,
      advancedTieMode:
        input.advancedMode === true && input.numberOfTeams === 4
          ? input.advancedTieMode
          : undefined,
      isOrphanContext: input.isOrphanContext === true ? true : undefined,
      createdAt: now,
      updatedAt: now,
    };
    // Silent-failure guard: when the creator is supposed to be
    // auto-registered (quick / orphan-context games), the in-memory
    // doc we're about to write MUST list them in both players and
    // participantIds. If a future refactor of `base` drops that, the
    // game would be born as a ghost with the creator missing — surface
    // it in the admin panel rather than letting it pass silently.
    if (
      autoSelfRegister &&
      (!initialPlayers.includes(input.createdBy) ||
        !initialParticipantIds.includes(input.createdBy))
    ) {
      logUnexpected('createGameCreatorNotRegistered', {
        gameId: '',
        createdBy: input.createdBy,
        groupId: input.groupId,
      });
    }
    let createdId: string;
    if (USE_MOCK_DATA) {
      const game: Game = { id: `gv2-${now}`, ...base };
      mockGamesV2.unshift(game);
      createdId = game.id;
    } else {
      if (__DEV__) {
        // Temporary diagnostic — see what we're handing to addDoc so
        // we can pinpoint which rule field is failing if the create
        // permission-denieds.
        console.log('[createGameV2] payload', {
          createdBy: base.createdBy,
          status: base.status,
          visibility: base.visibility,
          groupId: base.groupId,
        });
      }
      try {
        const ref = await addDoc(col.games(), { id: '', ...base });
        createdId = ref.id;
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (
          ![
            'GAME_OVERLAP',
            'REGISTRATION_CONFLICT',
            'GAME_NOT_OPEN',
            'GAME_STARTED',
            'GAME_LIVE',
            'GROUP_FULL',
            'STALE_OFFER',
            'resource-exhausted',
            'functions/resource-exhausted',
          ].includes(code as string)
        ) {
          logError('createGame', e, {
            groupId: input.groupId,
            title: input.title,
            startsAt: input.startsAt,
            maxPlayers: input.maxPlayers,
            format: input.format,
            code,
          });
        }
        throw e;
      }
    }

    // ── Weekly series ────────────────────────────────────────────────────
    // A recurring fixture gets its own SERIES doc, and this first match
    // becomes its first occurrence. From here on the cron builds each week
    // from the series — never by copying the previous match — so deleting an
    // occurrence can't break the chain.
    //
    // Best-effort: a failure here leaves a perfectly good one-off match rather
    // than failing the create. The match simply isn't part of a series.
    if (input.recurring === true && !input.seriesId) {
      try {
        const series = await seriesService.create({
          groupId: input.groupId,
          createdBy: input.createdBy,
          firstOccurrenceAt: input.startsAt,
          settings: settingsFromGame({ ...input, startsAt: input.startsAt }),
        });
        await updateDoc(docs.game(createdId), {
          seriesId: series.id,
        } as Partial<GameDoc>);
      } catch (err) {
        logError('createGameSeries', err, {
          gameId: createdId,
          groupId: input.groupId,
        });
      }
    } else if (input.seriesId) {
      // Created BY a series (the weekly occurrence) — just stamp the link.
      await updateDoc(docs.game(createdId), {
        seriesId: input.seriesId,
      } as Partial<GameDoc>).catch(() => undefined);
    }

    // Best-effort geocoding so the new game shows on the games map. Fire-
    // and-forget: never blocks or fails the create, and runs only in real
    // mode (mock games already carry fieldLat/fieldLng). The pin lands on
    // the field address, degrading to the city when the address can't be
    // resolved.
    const hasPickedCoords =
      typeof input.fieldLat === 'number' && typeof input.fieldLng === 'number';
    if (
      !USE_MOCK_DATA &&
      !hasPickedCoords &&
      (input.fieldName || input.fieldAddress || input.city)
    ) {
      void geocodeAddress(input.fieldAddress, input.city, input.fieldName)
        .then((coords) => {
          if (coords) {
            return updateDoc(docs.game(createdId), {
              fieldLat: coords.lat,
              fieldLng: coords.lng,
            } as Partial<GameDoc>);
          }
          return undefined;
        })
        .catch((err) => {
          logError('createGameGeocode', err, {
            gameId: createdId,
            groupId: input.groupId,
            fieldAddress: input.fieldAddress,
            city: input.city,
          });
          if (__DEV__) console.warn('[createGameV2] geocode failed', err);
        });
    }

    // Phase E.2: dispatch a "new game in community" notification. We use
    // `recipientId = groupId` as a fan-out marker — the Cloud Function
    // recognises this notification type and resolves recipients by
    // querying users where `newGameSubscriptions` array-contains the
    // groupId. Best-effort; failure here doesn't roll back the create.
    //
    // Skip when the game is deferred-open (`status: 'scheduled'`) —
    // the `flipScheduledGames` CF dispatches the same notification at
    // the moment registration actually opens. Sending it now would
    // notify users about a game they can't yet see / join.
    if (!isDeferred) {
      notificationsService.dispatch({
        type: 'newGameInCommunity',
        recipientId: input.groupId,
        payload: {
          groupId: input.groupId,
          gameId: createdId,
          title: input.title,
          startsAt: input.startsAt,
          fieldName: input.fieldName,
          // Carry the creator's uid so the CF can exclude self from
          // the fan-out — admins shouldn't get pinged about their
          // own game.
          createdBy: input.createdBy,
        },
      });
    }

    logEvent(AnalyticsEvent.GameCreated, {
      gameId: createdId,
      groupId: input.groupId,
      format: input.format ?? '',
      visibility: input.visibility,
      requiresApproval: String(!!input.requiresApproval),
      isRecurring: isDeferred,
    });
    if (isDeferred) {
      logEvent(AnalyticsEvent.RecurringGameCreated, {
        gameId: createdId,
        groupId: input.groupId,
        registrationOpensAt: input.registrationOpensAt ?? 0,
        startsAt: input.startsAt,
      });
    }

    return { ...base, id: createdId };
  },

  /**
   * Edit an existing game's metadata. Caller must be the organizer
   * (createdBy) — server-side rules enforce this; we don't double-check
   * here. Only the editable fields below are accepted; player rosters,
   * status, and live match state are out of scope.
   *
   * Notes participants of the change so subscribers' UIs refresh and an
   * (eventual) push notification can be wired through.
   */
  async updateGameV2(
    gameId: string,
    patch: Partial<{
      title: string;
      startsAt: number;
      fieldName: string;
      maxPlayers: number;
      minPlayers: number;
      format: GameFormat;
      numberOfTeams: number;
      cancelDeadlineHours: number;
      fieldType: import('@/types').FieldType;
      matchDurationMinutes: number;
      visibility: 'public' | 'community';
      requiresApproval: boolean;
      waitlistApprovalRequired: boolean;
      waitlistApprovalTimeoutMinutes: number;
      bringBall: boolean;
      bringShirts: boolean;
      notes: string;
      city: string;
      fieldAddress: string;
      /** Pin coords from the location picker. Written through so an
       *  edited location refreshes the map pin + Waze target. */
      fieldLat: number;
      fieldLng: number;
      hasReferee: boolean;
      hasPenalties: boolean;
      hasHalfTime: boolean;
      extraTimeMinutes: number;
      ruleTags: string[];
      /** Editable on a `status:'scheduled'` game so an admin can
       *  shift the open-time before the CF flips it. The CF's
       *  `openedNotificationSent` latch ensures this never fires a
       *  second push if the original time already passed. */
      registrationOpensAt: number;
      /** Recurring weekly fixture toggle. */
      recurring: boolean;
      /** ms-epoch community→public flip time. null clears the schedule
       *  (turned off in the edit form — undefined would be stripped and
       *  leave the stale value, so callers must pass null to clear). */
      publicOpenAt: number | null;
      /** ms-epoch before which non-admins can't add guests. null clears. */
      guestsOpenAt: number | null;
      /** Toggle whether this game receives cross-community filler
       *  matching. Editable any time before the game starts. */
      acceptsFillers: boolean;
      /** Minimum trust score required for filler push. */
      fillerMinTrust: number;
      /** Advanced game mode + sub-options (see Game type). */
      advancedMode: boolean;
      advancedFillMode: 'permanent' | 'temporary';
      advancedTieMode: 'bothOut' | 'veteranOut';
      /** ms-epoch wall-clock time to auto-generate balanced teams.
       *  null clears the schedule (turned off in the edit form). */
      autoTeamsAt: number | null;
      /** Scheduled split method: 'rating' | 'random'. */
      autoTeamsMethod: 'rating' | 'random';
    }>,
  ): Promise<void> {
    clearMyGamesCache(); // status/startsAt edits can change the my-games lists
    // Visibility is access-control. Don't accept it through the
    // generic edit path — there are extra checks (admin, status,
    // enum) that only `setVisibility` enforces. Callers should
    // route visibility flips through that handler instead.
    if ('visibility' in patch) {
      throw new Error('updateGameV2: use setVisibility() to change visibility');
    }
    // Pre-flight shape validation (mirrors createGameV2) — the edit path
    // previously spread the patch straight to Firestore, so an over-long
    // title/notes or an out-of-range maxPlayers was only caught by rules
    // and surfaced as a useless "permission denied". Validate the fields
    // that are actually present in this patch and surface a Hebrew error.
    if (typeof patch.title === 'string') {
      patch.title = requireString('title', patch.title, { max: 120, label: 'שם המשחק', sanitize: true });
    }
    if (typeof patch.fieldName === 'string') {
      patch.fieldName = requireString('fieldName', patch.fieldName, { max: 200, label: 'שם המגרש' });
    }
    if (patch.fieldAddress != null) {
      patch.fieldAddress = optionalString('fieldAddress', patch.fieldAddress, { max: 300, label: 'כתובת המגרש' });
    }
    if (patch.notes != null) {
      patch.notes = optionalString('notes', patch.notes, { max: 1000, label: 'הערות' });
    }
    if (patch.maxPlayers != null) {
      patch.maxPlayers = requireInt('maxPlayers', patch.maxPlayers, { min: 2, max: 50, label: 'מספר שחקנים' });
    }
    // Pre-flight validation that needs the current doc — the overlap
    // check and the startsAt-vs-registrationOpensAt invariant. We
    // read once and reuse the snapshot for both. Mock mode reads
    // from the in-memory list. We only need a tiny slice of fields,
    // so type loosely instead of forcing GameDoc → Game.
    type GameSlice = {
      startsAt: number;
      registrationOpensAt?: number;
      groupId: GroupId;
      status: string;
    };
    let existing: GameSlice | null;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      existing = m
        ? {
            startsAt: m.startsAt,
            registrationOpensAt: m.registrationOpensAt,
            groupId: m.groupId,
            status: m.status,
          }
        : null;
    } else {
      let snap;
      try {
        snap = await getDoc(docs.game(gameId));
      } catch (err) {
        logError('updateGameV2', err, { gameId, fields: Object.keys(patch) });
        if (__DEV__) console.warn('[gameService] updateGameV2 read failed', err);
        throw err;
      }
      const d = snap.exists() ? snap.data() : null;
      existing = d
        ? {
            startsAt: d.startsAt,
            registrationOpensAt: d.registrationOpensAt,
            groupId: d.groupId,
            status: d.status,
          }
        : null;
    }
    if (!existing) {
      throw new Error('updateGameV2: game not found');
    }
    // Edits are blocked only once the evening has actually begun —
    // the status flipped to active (admin pressed "התחל ערב") or the
    // game is terminal (finished/cancelled). The kickoff *time*
    // passing does NOT lock editing: a late-starting game is still
    // editable until it goes live. Defense-in-depth mirror of
    // canEditGame(); the typed code lets the screen show a clean
    // "הערב כבר התחיל" message instead of a generic permission error.
    const startedByStatus =
      existing.status === 'active' ||
      existing.status === 'finished' ||
      existing.status === 'cancelled';
    if (startedByStatus) {
      const err = new Error('GAME_ALREADY_STARTED') as Error & {
        code: 'GAME_ALREADY_STARTED';
      };
      err.code = 'GAME_ALREADY_STARTED';
      throw err;
    }
    const nextStartsAt =
      typeof patch.startsAt === 'number' ? patch.startsAt : existing.startsAt;
    const nextRegOpensAt =
      typeof patch.registrationOpensAt === 'number'
        ? patch.registrationOpensAt
        : existing.registrationOpensAt ?? 0;
    // Invariant: registration must open BEFORE the game itself
    // kicks off. Only enforce when both are positive — a
    // registrationOpensAt of 0 means "registration already open".
    if (nextRegOpensAt > 0 && nextStartsAt <= nextRegOpensAt) {
      const err = new Error('GAME_REG_AFTER_KICKOFF') as Error & {
        code: 'GAME_REG_AFTER_KICKOFF';
      };
      err.code = 'GAME_REG_AFTER_KICKOFF';
      throw err;
    }
    // Invariant: a public-open flip / guests-open gate scheduled AFTER
    // kickoff is meaningless (the game has already started). Only a
    // positive number is a real schedule — null/0 means "cleared".
    if (typeof patch.publicOpenAt === 'number' && patch.publicOpenAt > 0 && patch.publicOpenAt >= nextStartsAt) {
      failValidation('publicOpenAt', he.gameOpenAfterKickoff);
    }
    if (typeof patch.guestsOpenAt === 'number' && patch.guestsOpenAt > 0 && patch.guestsOpenAt >= nextStartsAt) {
      failValidation('guestsOpenAt', he.gameOpenAfterKickoff);
    }
    // registration must open before public (see createGameV2) — guard when both
    // are set in this edit.
    if (
      typeof patch.registrationOpensAt === 'number' && patch.registrationOpensAt > 0 &&
      typeof patch.publicOpenAt === 'number' && patch.publicOpenAt > 0 &&
      patch.publicOpenAt < patch.registrationOpensAt
    ) {
      failValidation('publicOpenAt', he.gamePublicBeforeReg);
    }
    // Overlap check: only if startsAt is actually being moved AND
    // the game is non-terminal (no point blocking edits to historical
    // docs). Pass the current gameId so the game doesn't conflict
    // with itself.
    if (
      typeof patch.startsAt === 'number' &&
      patch.startsAt !== existing.startsAt &&
      existing.status !== 'finished' &&
      existing.status !== 'cancelled'
    ) {
      const overlap = await findOverlappingGameInGroup(
        existing.groupId,
        patch.startsAt,
        gameId,
      );
      if (overlap) {
        const err = new Error('GAME_OVERLAP') as Error & {
          code: 'GAME_OVERLAP';
          conflict: { gameId: string; title: string; startsAt: number };
        };
        err.code = 'GAME_OVERLAP';
        err.conflict = overlap;
        throw err;
      }
    }
    const updates: Record<string, unknown> = {
      ...patch,
      updatedAt: Date.now(),
    };
    // A reschedule invalidates the "reminder already sent" latch — otherwise a
    // game moved to a NEW time after its ~1h reminder already fired would never
    // remind for the new kickoff (the server's reminder guard early-returns on
    // reminderSent). Clearing it lets the newly-enqueued task fire.
    if (typeof patch.startsAt === 'number' && patch.startsAt !== existing.startsAt) {
      updates.reminderSent = false;
    }
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) Object.assign(m, updates);
    } else {
      await updateGameDoc(gameId, updates);
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId,
      // editorUid lets the CF self-exclude the admin from the fan-out
      // (organisers usually also play, and they don't need a "המשחק
      // עודכן" push for an action they themselves just took).
      payload: {
        gameId,
        action: 'updated',
        editorUid: USE_MOCK_DATA
          ? ''
          : getFirebase().auth.currentUser?.uid ?? '',
      },
    });
    logEvent(AnalyticsEvent.GameEdited, {
      gameId,
      fields: Object.keys(patch).join(','),
    });
  },

  /**
   * Set or clear the admin-pinned announcement on a game. Empty string
   * clears the message (renders nothing for non-admins). Capped at 280
   * chars on the rules side; we trim here so a stray newline at the
   * end doesn't write a stale-looking value.
   *
   * Deliberately does NOT dispatch a `gameCanceledOrUpdated` push —
   * the pinned message is shown in-app on the next time the user
   * opens the game. We don't want every typo correction by the admin
   * to fire a fan-out push.
   */
  async setPinnedMessage(
    gameId: string,
    message: string,
  ): Promise<void> {
    if (!gameId) return;
    const trimmed = (message || '').trim().slice(0, 280);
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) m.pinnedMessage = trimmed.length > 0 ? trimmed : undefined;
      return;
    }
    await updateGameDoc(gameId, {
      pinnedMessage: trimmed.length > 0 ? trimmed : null,
      updatedAt: Date.now(),
    });
  },

  /**
   * Persist a captain-draft team split (חלוקת כוחות). Overwrites any
   * previous draft — a re-draft replaces the stored result. Pass `null`
   * to clear it. Self-contained: no push, no live-match side effects.
   */
  async saveDraftTeams(
    gameId: string,
    draft: DraftTeamsResult | null,
    /** Diagnostics for an AUTO split (gap / band / repeat / fallback), so the
     *  parameters can later be calibrated from real weeks. Omitted for a manual
     *  captain draft — there is no algorithm to measure there. */
    meta?: Game['teamBalanceMeta'],
  ): Promise<void> {
    if (!gameId) return;
    // Freeze the split as first drawn so the post-game "הכוחות שחולקו" record
    // survives go-home / removals. Preserve an existing snapshot if the incoming
    // draft already carries one (edits/re-saves keep the original); a fresh
    // draft (new split / re-balance) captures the current teams as the original.
    const withOriginal: DraftTeamsResult | null = draft
      ? {
          ...draft,
          originalTeams:
            draft.originalTeams ??
            draft.teams.map((t) => ({ ...t, playerIds: [...(t.playerIds ?? [])] })),
        }
      : null;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.draftTeams = withOriginal ?? undefined;
        m.teamsEditedManually = !!draft;
        if (meta) m.teamBalanceMeta = meta;
      }
      return;
    }
    await updateGameDoc(gameId, {
      draftTeams: withOriginal ?? null,
      ...(meta ? { teamBalanceMeta: meta } : {}),
      // Any client-side save is a deliberate human split (manual draft or the
      // admin's auto-balance button) → mark it so the scheduled auto-generator
      // never clobbers it (B05/B16). Clearing the draft (null) lifts the flag
      // so a later scheduled generation can run again.
      teamsEditedManually: draft ? true : false,
      updatedAt: Date.now(),
    });
  },

  /**
   * Publish a DRAFT team split: flips `draftTeams.published` → true so every
   * player can see the teams, then fires the personalized "teams ready" push.
   * While a split is a draft (`published:false`) only the organiser sees it
   * (client-side gate in MatchDetails). Field-path update so it touches ONLY
   * the flag — never races with a concurrent rotation write. No-op push in mock.
   */
  async publishDraftTeams(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m?.draftTeams) m.draftTeams = { ...m.draftTeams, published: true };
      return;
    }
    await updateGameDoc(gameId, {
      'draftTeams.published': true,
      updatedAt: Date.now(),
    });
    // Publishing is allowed after the evening is over — a split left as a draft
    // is invisible to the players forever otherwise. The PUSH is not: "הכוחות
    // מוכנים" landing after the final whistle is noise, not news. So reveal the
    // teams either way, and only announce them while the game is still ahead.
    const g = await this.getGameById(gameId);
    const alreadyPlayed =
      g?.status === 'finished' ||
      g?.status === 'cancelled' ||
      g?.liveMatch?.startedAt != null;
    if (!alreadyPlayed) await this.notifyTeamsReady(gameId);
  },

  /**
   * A member's 👍/👎 reaction to the current team split. Writes ONLY the
   * caller's own key via a field-path update (`draftTeamFeedback.<uid>`) so
   * Firestore rules can permit members to react without touching anyone
   * else's vote. Pass `null` to clear the reaction.
   */
  async setDraftTeamFeedback(
    gameId: string,
    userId: string,
    value: 'like' | 'dislike' | null,
  ): Promise<void> {
    if (!gameId || !userId) return;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        const fb = { ...(m.draftTeamFeedback ?? {}) };
        if (value) fb[userId] = value;
        else delete fb[userId];
        m.draftTeamFeedback = fb;
      }
      return;
    }
    const { deleteField } = require('firebase/firestore');
    await updateDoc(docs.game(gameId), {
      [`draftTeamFeedback.${userId}`]: value ?? deleteField(),
      updatedAt: Date.now(),
    });
  },

  /**
   * Admin-trigger: notify every registered player of their team via a
   * personalized push ("אתה בקבוצה עם …"). Server computes the teammates
   * per player and fans out one notification doc each. No-op in mock mode.
   */
  async notifyTeamsReady(gameId: string): Promise<void> {
    if (!gameId || USE_MOCK_DATA) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    await httpsCallable(getFirebase().functions, 'notifyTeamsReady')({
      gameId,
    });
  },

  /**
   * Manual "send to everyone available, in pulses" — an admin kicks off the
   * filler-pulse engine for a game on demand (from the invite screen). The
   * server sends fillerOpportunity pushes to nearby opted-in available players
   * in batches of 10 every 2 minutes until the game fills / the pool runs out /
   * 30 min before kickoff. Each player gets ONE push (fillerPushHistory dedupe)
   * + a 3/day cap. Returns a structured result the UI maps to a message.
   */
  async startFillerPulse(
    gameId: string,
  ): Promise<{ started: boolean; reason?: string; alreadyRunning?: boolean }> {
    if (USE_MOCK_DATA) return { started: true };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const res = await httpsCallable(
      getFirebase().functions,
      'startGameFillerPulse',
    )({ gameId });
    return (res.data ?? { started: false }) as {
      started: boolean;
      reason?: string;
      alreadyRunning?: boolean;
    };
  },

  /**
   * Admin registers community members straight into a game (server-side
   * `adminAddPlayers` callable → `players`, overflowing to `waitlist` when the
   * game is full). Each added member gets an `addedToGame` push. Returns how
   * many landed in each bucket. Admin-only (enforced server-side + by rules).
   */
  async adminAddMembers(
    gameId: string,
    userIds: string[],
  ): Promise<{ addedToPlayers: number; addedToWaitlist: number }> {
    if (!gameId || userIds.length === 0) {
      return { addedToPlayers: 0, addedToWaitlist: 0 };
    }
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      let added = 0;
      let waited = 0;
      if (m) {
        const cap = m.maxPlayers && m.maxPlayers > 0 ? m.maxPlayers : Infinity;
        const inRoster = new Set([
          ...(m.players ?? []),
          ...(m.waitlist ?? []),
          ...(m.pending ?? []),
        ]);
        for (const uid of userIds) {
          if (inRoster.has(uid)) continue;
          inRoster.add(uid);
          if ((m.players?.length ?? 0) < cap) {
            m.players = [...(m.players ?? []), uid];
            added += 1;
          } else {
            m.waitlist = [...(m.waitlist ?? []), uid];
            waited += 1;
          }
        }
        m.participantIds = Array.from(
          new Set([...(m.players ?? []), ...(m.waitlist ?? []), ...(m.pending ?? [])]),
        );
      }
      return { addedToPlayers: added, addedToWaitlist: waited };
    }
    // Make sure auth is actually ready before calling — right after an app
    // UPDATE the persisted session is still restoring, so currentUser can be
    // null for a beat. Calling the callable then sends NO token and the server
    // rejects with `unauthenticated` (real report, 1.0.39). Wait for restore,
    // then force a fresh token so it's attached to the call.
    let user = getFirebase().auth.currentUser;
    if (!user) user = await waitForAuthRestore();
    if (!user) throw new Error('adminAddMembers: not signed in');
    await user.getIdToken();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const call = () =>
      httpsCallable(getFirebase().functions, 'adminAddPlayers')({ gameId, userIds });
    let res;
    try {
      res = await call();
    } catch (err) {
      // The callable sometimes reaches the server with NO auth token even
      // though we're signed in (recurring `functions/unauthenticated`, real
      // report on 1.0.40) — the SDK attached a stale/expired token. Force a
      // FRESH token and retry ONCE before surfacing the failure.
      const code = (err as { code?: string } | undefined)?.code;
      if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
        await user.getIdToken(true);
        res = await call();
      } else {
        throw err;
      }
    }
    const d = (res?.data ?? {}) as { addedToPlayers?: number; addedToWaitlist?: number };
    return {
      addedToPlayers: d.addedToPlayers ?? 0,
      addedToWaitlist: d.addedToWaitlist ?? 0,
    };
  },

  /**
   * Admin reorder / move players between roster and waitlist. The caller passes
   * the DESIRED full players[] + waitlist[] (after a move/reorder); the server
   * validates it's the same participant set (no add/remove) + capacity, then
   * writes. Reordering the waitlist controls who's offered a freed spot next.
   */
  async adminReorderRoster(
    gameId: string,
    players: string[],
    waitlist: string[],
  ): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.players = [...players];
        m.waitlist = [...waitlist];
        m.participantIds = Array.from(
          new Set([...players, ...waitlist, ...(m.pending ?? [])]),
        );
      }
      return;
    }
    let user = getFirebase().auth.currentUser;
    if (!user) user = await waitForAuthRestore();
    if (!user) throw new Error('adminReorderRoster: not signed in');
    await user.getIdToken();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const call = () =>
      httpsCallable(getFirebase().functions, 'adminReorderRoster')({
        gameId,
        players,
        waitlist,
      });
    try {
      await call();
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === 'functions/unauthenticated' || code === 'unauthenticated') {
        await user.getIdToken(true);
        await call();
      } else {
        throw err;
      }
    }
  },

  // ─── Live "winner stays" rotation ──────────────────────────────────────
  // Sits on top of draftTeams. All math is in the pure rotationEngine; these
  // methods just load the game, run the engine, and persist rotation (+ the
  // teams, which change under 'permanent' fill mode).

  /** Begin the rotation: first two teams play (filled to full), rest wait.
   *  No-op when there aren't two teams or not enough players for two full. */
  async startRotation(gameId: string, _userId: string): Promise<void> {
    if (!gameId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!g || !draft || draft.teams.length < 2) return;
    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams = liveRosterTeams(g, draft);
    const res = runStartRotation(teams, perTeam, fillMode);
    if (!res) return; // gate: not enough players for two full teams
    // Snapshot the (roster-filtered) drafted rosters before any permanent-fill
    // reassignment, so stopRotation restores them on reset — without resurrecting
    // a player who cancelled before the evening started.
    res.rotation.baseTeams = teams.map((t) => ({
      index: t.index,
      playerIds: [...t.playerIds],
    }));
    await this._persistRotation(gameId, draft, res);
  },

  /** Record the round result and rotate (winner stays, loser out, next in,
   *  short incoming team auto-filled from the loser). `winner` is a team
   *  index that's currently playing. */
  async recordWinner(gameId: string, _userId: string, winner: number): Promise<void> {
    if (!gameId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!g || !draft || !g.rotation) return;
    if (!g.rotation.playing.includes(winner)) return;
    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams = liveRosterTeams(g, draft);
    const res = runRecordWinner(winner, teams, g.rotation, perTeam, fillMode);
    // Carry the original-roster snapshot forward (the engine builds a fresh
    // rotation object each round and doesn't know about baseTeams).
    res.rotation.baseTeams = g.rotation.baseTeams;
    await this._persistRotation(gameId, draft, res);
  },

  /** Record a TIE and rotate per the game's 4-team tie rule (advancedTieMode).
   *  No-op unless a rotation is live. Used by finalizeRoundAndRotate. */
  async recordTie(gameId: string, mode: 'bothOut' | 'veteranOut'): Promise<void> {
    if (!gameId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!g || !draft || !g.rotation) return;
    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams = liveRosterTeams(g, draft);
    const res = runRecordTie(teams, g.rotation, perTeam, fillMode, mode);
    res.rotation.baseTeams = g.rotation.baseTeams;
    await this._persistRotation(gameId, draft, res);
  },

  // ─── Advanced-mode goal entry (live scoreboard) ────────────────────────
  // Goals accumulate on `liveMatch.goals` for the current round and bump
  // `liveMatch.scoreA/scoreB`. Admin-only is enforced by the UI + rules.
  // An own goal counts for the OPPONENT side and credits no scorer.

  /** Log one goal for the running round. `team` is the side it COUNTS FOR. */
  async recordGoal(
    gameId: string,
    opts: {
      team: 'A' | 'B';
      scorerId: UserId | null;
      assisterId?: UserId | null;
      ownGoal?: boolean;
      minute: number;
    },
  ): Promise<void> {
    if (!gameId) return;
    // Collision-proof id: `g_<ms>_<n>` collided when two goals landed in the
    // same ms at the same array length (two rapid taps / two devices), which
    // then made removeGoal delete EVERY goal sharing that id. A random suffix
    // guarantees uniqueness.
    // Own goals now CARRY their scorer (the player who put it into their own
    // net, on the conceding team) — used for the "שערים עצמיים" stat + history
    // attribution. They still credit no striker tally (see tallyId below).
    const scorerId = opts.scorerId ?? null;
    // An assist only makes sense for a real, attributed scorer (never on an own
    // goal / unknown scorer, and never the scorer assisting themselves).
    const assisterId =
      !opts.ownGoal && scorerId && opts.assisterId && opts.assisterId !== scorerId
        ? opts.assisterId
        : undefined;
    const goal: import('@/types').RoundGoal = {
      id: `g_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}`,
      team: opts.team,
      scorerId,
      ...(assisterId ? { assisterId } : {}),
      ownGoal: opts.ownGoal ? true : undefined,
      minute: Math.max(0, Math.floor(opts.minute)),
      // serverNow() (not Date.now()) so goal ordering matches the synced match
      // clock even on a device whose wall clock is skewed.
      at: serverNow(),
    };
    // Whom to credit on the evening-long goal tally (badge): any attributed
    // scorer — real OR guest (a guest is a full player in the cycle and now
    // earns a per-game scorer row too). Own goals / unknown scorers credit no
    // one (null scorer).
    const tallyId = !opts.ownGoal && scorerId ? scorerId : null;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch) {
        m.liveMatch.goals = [...(m.liveMatch.goals ?? []), goal];
        if (opts.team === 'A') m.liveMatch.scoreA += 1; else m.liveMatch.scoreB += 1;
        if (tallyId) {
          const t = { ...(m.liveMatch.goalTally ?? {}) };
          t[tallyId] = (t[tallyId] ?? 0) + 1;
          m.liveMatch.goalTally = t;
        }
      }
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch) return;
    // Don't record a goal onto a closed evening — mirrors the timer guards.
    // Without this, a second admin tapping "+goal" right after another admin
    // ended the evening writes a phantom goal + tally onto a finished game.
    if (cur.status === 'finished' || cur.status === 'cancelled') return;
    // arrayUnion + increment so two near-simultaneous goal entries don't clobber
    // each other (the old read-modify-write replaced the whole array and could
    // drop a concurrent goal). The goal log is the source of truth for stats.
    await updateDoc(docs.game(gameId), {
      'liveMatch.goals': arrayUnion(goal),
      'liveMatch.scoreA': increment(opts.team === 'A' ? 1 : 0),
      'liveMatch.scoreB': increment(opts.team === 'B' ? 1 : 0),
      // Evening-long per-player tally (drives the badge); survives round-end.
      ...(tallyId ? { [`liveMatch.goalTally.${tallyId}`]: increment(1) } : {}),
      updatedAt: Date.now(),
    });
  },

  /** Remove one goal from the running round by id (decrements its side). */
  async removeGoal(gameId: string, goalId: string): Promise<void> {
    if (!gameId || !goalId) return;
    const apply = (lm: import('@/types').LiveMatchState) => {
      const gone = (lm.goals ?? []).find((x) => x.id === goalId);
      if (!gone) return null;
      const goals = (lm.goals ?? []).filter((x) => x.id !== goalId);
      return {
        goals,
        scoreA: Math.max(0, lm.scoreA - (gone.team === 'A' ? 1 : 0)),
        scoreB: Math.max(0, lm.scoreB - (gone.team === 'B' ? 1 : 0)),
      };
    };
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch) {
        const goneM = (m.liveMatch.goals ?? []).find((x) => x.id === goalId);
        const r = apply(m.liveMatch);
        if (r) { m.liveMatch.goals = r.goals; m.liveMatch.scoreA = r.scoreA; m.liveMatch.scoreB = r.scoreB; }
        // Roll back the evening tally for the undone goal's scorer — real OR
        // guest (both are tallied now; keep symmetric with recordGoal).
        if (goneM && !goneM.ownGoal && goneM.scorerId && m.liveMatch.goalTally) {
          const t = { ...m.liveMatch.goalTally };
          t[goneM.scorerId] = Math.max(0, (t[goneM.scorerId] ?? 0) - 1);
          m.liveMatch.goalTally = t;
        }
      }
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch) return;
    // Don't mutate goals on a closed evening (symmetric with recordGoal).
    if (cur.status === 'finished' || cur.status === 'cancelled') return;
    const gone = (cur.liveMatch.goals ?? []).find((x) => x.id === goalId);
    if (!gone) return;
    // Roll back the evening tally for the undone goal's scorer — real OR guest
    // (both are tallied now). Own goals / unknown scorers credit no one, so
    // there's nothing to roll back for them. Keep symmetric with recordGoal.
    const untally = !gone.ownGoal && gone.scorerId ? gone.scorerId : null;
    // arrayRemove + increment(-1) compose ATOMICALLY at the field level with a
    // concurrent recordGoal (arrayUnion + increment(+1)) — unlike the old
    // read-modify-write, which overwrote the whole `goals` array and could drop
    // a concurrent goal, leaving the score and the goal log permanently out of
    // sync. arrayRemove matches by value, so a double-remove of the same goal
    // is a no-op on the array. NOTE: the score increment has no server-side
    // floor — only the `if (!gone) return` pre-read above prevents a re-decrement
    // (sequential undo of an already-removed goal is a no-op). The live match is
    // admin-only / single-actor, so two devices removing the SAME goal in the
    // exact same read window (the only path to a negative score) isn't reachable
    // in practice; a reset/commit recomputes the score from the goal log anyway.
    await updateDoc(docs.game(gameId), {
      'liveMatch.goals': arrayRemove(gone),
      'liveMatch.scoreA': increment(gone.team === 'A' ? -1 : 0),
      'liveMatch.scoreB': increment(gone.team === 'B' ? -1 : 0),
      ...(untally ? { [`liveMatch.goalTally.${untally}`]: increment(-1) } : {}),
      updatedAt: Date.now(),
    });
  },

  /** Undo the most recent goal of the running round. */
  async undoLastGoal(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      const last = m?.liveMatch?.goals?.[m.liveMatch.goals.length - 1];
      if (m?.liveMatch && last) return this.removeGoal(gameId, last.id);
      return;
    }
    const cur = await readTimerState(gameId);
    const last = cur?.liveMatch?.goals?.[cur.liveMatch.goals.length - 1];
    if (last) await this.removeGoal(gameId, last.id);
  },

  /**
   * End the running round: derive the winner from the score (a tie is resolved
   * by the manual `manualWinnerSide` the caller passes — that side is recorded
   * as the winner), write goal + pair + community stats, clear the live
   * scoreboard, and rotate (winner stays). Returns the winning side, or null
   * if it can't finalize (e.g. tie with no manual pick).
   *
   * NOTE: writes one pairStats doc per player-pair per round (~C(n,2)). Fine
   * behind the flag for now; a server-side aggregation is the eventual home.
   */
  async finalizeRoundAndRotate(
    gameId: string,
    userId: string,
    manualWinnerSide?: 'A' | 'B',
  ): Promise<'A' | 'B' | 'tie' | null> {
    if (!gameId) return null;
    const g = await this.getGameById(gameId);
    const lm = g?.liveMatch;
    const rot = g?.rotation;
    const draft = g?.draftTeams;
    if (!g || !lm || !rot || !draft) return null;
    const [idxA, idxB] = rot.playing;
    const winnerSide: 'A' | 'B' | null =
      lm.scoreA > lm.scoreB ? 'A' : lm.scoreB > lm.scoreA ? 'B' : manualWinnerSide ?? null;

    // 4-team advanced games resolve a tie automatically via advancedTieMode
    // (bothOut / veteranOut). Other team counts fall back to the manual picker
    // (caller opens it when we return null).
    const tieMode =
      g.numberOfTeams === 4 && g.advancedMode ? g.advancedTieMode ?? 'bothOut' : undefined;
    const isTie = !winnerSide;
    if (isTie && !tieMode) return null; // 2–3 teams: caller must supply a winner

    await this._commitRoundStatsAndClear(gameId, lm, rot, draft, winnerSide);

    // Rotate. A tie in a 4-team game follows the tie rule; otherwise winner
    // stays, loser out, next in.
    if (isTie && tieMode) {
      await this.recordTie(gameId, tieMode);
      return 'tie';
    }
    await this.recordWinner(gameId, userId, winnerSide === 'A' ? idxA : idxB);
    return winnerSide;
  },

  // ── Penalty shootout (drawn-round tiebreaker) ────────────────────────────
  // A drawn mini-game can be decided by penalties instead of a manual pick.
  // State lives on `liveMatch.shootout` and is cleared at round-end alongside
  // the goal log (see _commitRoundStatsAndClear). Each kick is an independent
  // unit; the winner (more scored) flows through prepareRoundResult like a
  // manual pick, so the shootout kicks credit penalty stats via that commit.

  /** Begin a shootout for the drawn round. `firstTeam` = who kicks first. */
  async startShootout(gameId: string, firstTeam: 'A' | 'B'): Promise<void> {
    if (!gameId) return;
    const shootout = { firstTeam, keeperA: null, keeperB: null, kicks: [] };
    if (USE_MOCK_DATA) {
      const m =
        mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch) m.liveMatch.shootout = shootout;
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch) return;
    if (cur.status === 'finished' || cur.status === 'cancelled') return;
    await updateDoc(docs.game(gameId), {
      'liveMatch.shootout': shootout,
      updatedAt: Date.now(),
    });
  },

  /** Set (or replace) a team's sticky keeper for the shootout. */
  async setShootoutKeeper(gameId: string, side: 'A' | 'B', uid: UserId): Promise<void> {
    if (!gameId || !uid) return;
    const field = side === 'A' ? 'keeperA' : 'keeperB';
    if (USE_MOCK_DATA) {
      const m =
        mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch?.shootout) m.liveMatch.shootout[field] = uid;
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch?.shootout) return;
    if (cur.status === 'finished' || cur.status === 'cancelled') return;
    await updateDoc(docs.game(gameId), {
      [`liveMatch.shootout.${field}`]: uid,
      updatedAt: Date.now(),
    });
  },

  /** Record one shootout kick (kicker + keeper + scored). Appended in order. */
  async recordShootoutKick(
    gameId: string,
    opts: { team: 'A' | 'B'; kickerId: UserId; keeperId: UserId; scored: boolean },
  ): Promise<void> {
    if (!gameId || !opts.kickerId) return;
    const kick = {
      id: `pk_${Date.now()}_${Math.floor(Math.random() * 1e9).toString(36)}`,
      kickerId: opts.kickerId,
      keeperId: opts.keeperId,
      team: opts.team,
      scored: !!opts.scored,
      at: serverNow(),
    };
    if (USE_MOCK_DATA) {
      const m =
        mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch?.shootout) {
        m.liveMatch.shootout.kicks = [...(m.liveMatch.shootout.kicks ?? []), kick];
      }
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch?.shootout) return;
    if (cur.status === 'finished' || cur.status === 'cancelled') return;
    await updateDoc(docs.game(gameId), {
      'liveMatch.shootout.kicks': arrayUnion(kick),
      updatedAt: Date.now(),
    });
  },

  /** Abandon a shootout without deciding (e.g. admin backs all the way out).
   *  Clears the state; the round stays drawn and can be decided another way. */
  async clearShootout(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const m =
        mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch) m.liveMatch.shootout = undefined;
      return;
    }
    const cur = await readTimerState(gameId);
    if (!cur?.liveMatch) return;
    await updateDoc(docs.game(gameId), {
      'liveMatch.shootout': deleteField(),
      updatedAt: Date.now(),
    });
  },

  /** Commit the just-finished round's stats (goals + pairs + community) and
   *  clear the live scoreboard. Shared by the auto path
   *  (finalizeRoundAndRotate) and the interactive-fill path
   *  (prepareRoundResult). Idempotent server-side via `roundId`. */
  async _commitRoundStatsAndClear(
    gameId: string,
    lm: import('@/types').LiveMatchState,
    rot: import('@/types').MatchRotation,
    draft: DraftTeamsResult,
    winnerSide: 'A' | 'B' | null,
  ): Promise<void> {
    const [idxA, idxB] = rot.playing;
    // On-field rosters — the EFFECTIVE lineup (loan-adjusted), guests INCLUDED.
    // A guest is a full player in the cycle, so they must appear in the
    // round-history "מי שיחק" roster. The server re-filters to real uids
    // (isReal) for stat crediting, but stores these full rosters for display.
    const rosterFor = (idx: number) =>
      effectiveRosterOf(idx, draft.teams, rot.loans ?? []);
    const sideA = rosterFor(idxA);
    const sideB = rosterFor(idxB);

    if (!USE_MOCK_DATA) {
      const now = Date.now();
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { httpsCallable } = require('firebase/functions');
        await httpsCallable(getFirebase().functions, 'commitRoundStats')({
          gameId,
          // Idempotency key for the server's double-commit latch. Combine the
          // monotonic round number WITH the rotation's updatedAt: identical on
          // an SDK retry of the same round (so the create() collides and dedupes),
          // distinct across rounds (round increments each finalize). Never null
          // and can't collide two different rounds the way a bare `updatedAt`
          // fallback could — so the latch always applies and never silently
          // drops or double-credits a round.
          roundId: `${rot.round ?? 'r'}:${rot.updatedAt ?? 0}`,
          sideA,
          sideB,
          // Team indices (0=red,1=blue,2=green,…) → the round-history screen shows
          // the real bib colours ("אדומה נגד כחולה") instead of a generic א׳/ב׳.
          teamAIndex: idxA,
          teamBIndex: idxB,
          winnerSide: winnerSide ?? 'tie',
          goals: (lm.goals ?? []).map((gl) => ({
            scorerId: gl.scorerId ?? null,
            assisterId: gl.assisterId ?? null,
            ownGoal: !!gl.ownGoal,
            // The side that got the point (mirrors the live score). Forwarded so
            // the server can attribute own goals (null scorer) and guest goals to
            // a team + store them + count them in the round score.
            team: gl.team,
            // Minute the goal went in — shown on the round-history goal line.
            minute: Math.max(0, Math.floor((gl as { minute?: number }).minute ?? 0)),
          })),
          // Penalty-shootout kicks (tiebreaker). Feed ONLY the penalty stat
          // fields — never goals/score. A round with no shootout sends [].
          penalties: buildShootoutPenaltyPayload(lm.shootout),
        });
        // Clear the scoreboard ONLY after the stats commit succeeded. Doing it
        // unconditionally (as before) meant a failed/​swallowed commit — an
        // offline blip or App Check hiccup at round/evening end — still wiped
        // liveMatch.goals, so that round's goals/assists/wins were aggregated
        // nowhere and lost for good. Now the goal log survives a failed commit
        // and the round can be retried (the server's roundId latch dedupes).
        await updateDoc(docs.game(gameId), {
          'liveMatch.scoreA': 0,
          'liveMatch.scoreB': 0,
          'liveMatch.goals': [],
          // Clear the shootout too — it's a per-round tiebreaker, so like the
          // goal log it must not survive into the next round.
          'liveMatch.shootout': deleteField(),
          updatedAt: now,
        });
      } catch (err) {
        logError('commitRoundStats', err, { gameId });
        if (__DEV__) console.warn('[gameService] commitRoundStats failed', err);
        // Rethrow so the caller keeps the goal log intact instead of clearing
        // it on top of a failed commit.
        throw err;
      }
    } else {
      const m =
        mockGamesV2.find((x) => x.id === gameId) ?? (gameId === mockGame.id ? mockGame : undefined);
      if (m?.liveMatch) {
        m.liveMatch.scoreA = 0;
        m.liveMatch.scoreB = 0;
        m.liveMatch.goals = [];
        m.liveMatch.shootout = undefined;
      }
    }
  },

  // ── Interactive fill (admin chooses who completes a short team) ──────────
  // The engine builds the rotation SKELETON (which teams play, who's the
  // donor) without filling; the UI then loops nextFillNeeded + applyChosenFill,
  // asking the admin per short team, and finally calls commitFilledRotation.
  // These methods do the I/O around that pure flow.

  /** START skeleton, no persist. Null when a rotation can't start.
   *  `startOrder` (optional) is the admin's chosen / randomised opening order
   *  of team indices — the first two play, the rest wait in that order. */
  async prepareStartRotation(
    gameId: string,
    startOrder?: number[],
  ): Promise<{
    skeleton: RotationFillState;
    draft: DraftTeamsResult;
    baseTeams: { index: number; playerIds: string[] }[];
  } | null> {
    if (!gameId) return null;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!g || !draft || draft.teams.length < 2) return null;
    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams: RotationTeam[] = draft.teams.map((t) => ({
      index: t.index,
      playerIds: [...t.playerIds],
    }));
    const skeleton = startRotationSkeleton(teams, perTeam, fillMode, startOrder);
    if (!skeleton) return null;
    const baseTeams = draft.teams.map((t) => ({
      index: t.index,
      playerIds: [...t.playerIds],
    }));
    return { skeleton, draft, baseTeams };
  },

  /** A player on a CURRENTLY-PLAYING team left mid-evening ("הלך הביתה") and
   *  the team is now short. Build a fill skeleton for the two playing teams
   *  using the CURRENT rotation (not a fresh start) so the admin can borrow a
   *  replacement from the bench / waiting teams — reusing the same fill flow as
   *  a round transition. Returns null when there's no active rotation or neither
   *  playing team is short (e.g. a waiting-team player left, or the team was
   *  over-full) — in which case no picker is needed. */
  async prepareRefillPlaying(
    gameId: string,
  ): Promise<{ skeleton: RotationFillState; draft: DraftTeamsResult } | null> {
    if (!gameId) return null;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    const rot = g?.rotation;
    if (!g || !draft || !rot) return null;
    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams: RotationTeam[] = draft.teams.map((t) => ({
      index: t.index,
      playerIds: [...t.playerIds],
    }));
    const [a, b] = rot.playing;
    const loans = rot.loans ?? [];
    const shortA = perTeam - effectiveRosterOf(a, teams, loans).length > 0;
    const shortB = perTeam - effectiveRosterOf(b, teams, loans).length > 0;
    if (!shortA && !shortB) return null; // no playing team needs filling
    const skeleton: RotationFillState = {
      teams,
      playing: rot.playing,
      perTeam,
      fillMode,
      loserFirst: null,
      rotation: rot,
    };
    return { skeleton, draft };
  },

  /** Commit round stats + clear scoreboard, then return the post-round
   *  skeleton (no persist). `{ outcome: null }` → a 2–3 team tie needs a
   *  manual winner; caller opens the picker and calls again with it. */
  async prepareRoundResult(
    gameId: string,
    _userId: string,
    manualWinnerSide?: 'A' | 'B',
  ): Promise<
    | { outcome: 'A' | 'B' | 'tie'; skeleton: RotationFillState; draft: DraftTeamsResult }
    | { outcome: null }
    | null
  > {
    if (!gameId) return null;
    const g = await this.getGameById(gameId);
    const lm = g?.liveMatch;
    const rot = g?.rotation;
    const draft = g?.draftTeams;
    if (!g || !lm || !rot || !draft) return null;
    const [idxA, idxB] = rot.playing;
    const winnerSide: 'A' | 'B' | null =
      lm.scoreA > lm.scoreB ? 'A' : lm.scoreB > lm.scoreA ? 'B' : manualWinnerSide ?? null;
    const tieMode =
      g.numberOfTeams === 4 && g.advancedMode ? g.advancedTieMode ?? 'bothOut' : undefined;
    const isTie = !winnerSide;
    if (isTie && !tieMode) return { outcome: null };

    await this._commitRoundStatsAndClear(gameId, lm, rot, draft, winnerSide);

    const perTeam = playersPerTeamFor(g.format);
    const fillMode = effFillMode(g, draft);
    const teams: RotationTeam[] = draft.teams.map((t) => ({
      index: t.index,
      playerIds: [...t.playerIds],
    }));
    if (isTie && tieMode) {
      return { outcome: 'tie', skeleton: recordTieSkeleton(teams, rot, perTeam, fillMode, tieMode), draft };
    }
    const winnerIdx = winnerSide === 'A' ? idxA : idxB;
    return {
      outcome: winnerSide as 'A' | 'B',
      skeleton: recordWinnerSkeleton(winnerIdx, teams, rot, perTeam, fillMode),
      draft,
    };
  },

  /** Persist a fully-filled rotation. For a START rotation pass baseTeams so a
   *  later reset can restore the original drafted rosters. */
  async commitFilledRotation(
    gameId: string,
    draft: DraftTeamsResult,
    result: { rotation: import('@/types').MatchRotation; teams: RotationTeam[] },
    baseTeams?: { index: number; playerIds: string[] }[],
    // When set, the new round's clock is zeroed in the SAME write as the
    // rotation commit — so a concurrent admin's timer-start can't slip in
    // between two separate writes and get clobbered (or lost).
    resetTimerBy?: { userId: string; userName: string },
  ): Promise<void> {
    if (!gameId) return;
    const rotation = baseTeams
      ? { ...result.rotation, baseTeams }
      : result.rotation;
    await this._persistRotation(gameId, draft, { rotation, teams: result.teams }, resetTimerBy);
  },

  /** Clear the rotation (back to "not started"). In 'permanent' fill mode the
   *  drafted rosters were rewritten round-by-round, so we also restore them
   *  from the snapshot taken at start — otherwise a reset leaves scrambled
   *  teams and a restart begins from the reassigned (wrong) rosters. */
  async stopRotation(gameId: string): Promise<void> {
    if (!gameId) return;
    const g = await this.getGameById(gameId);
    const base = g?.rotation?.baseTeams;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.rotation = undefined;
        if (m.liveMatch) m.liveMatch = { ...m.liveMatch, goalTally: {} };
      }
      return;
    }
    // Resetting the rotation restarts the evening → clear the evening goal tally
    // too (the per-round `resetTimer` deliberately keeps it; this full reset
    // doesn't).
    const patch: Record<string, unknown> = {
      rotation: null,
      'liveMatch.goalTally': {},
      updatedAt: Date.now(),
    };
    if (g?.draftTeams && base && base.length > 0) {
      patch.draftTeams = {
        ...g.draftTeams,
        teams: g.draftTeams.teams.map((t) => {
          const snap = base.find((s) => s.index === t.index);
          return snap ? { ...t, playerIds: [...snap.playerIds] } : t;
        }),
        // Reset restores the original rosters, so anyone marked "went home"
        // is back on the field — clear the list.
        leftHome: [],
      };
    }
    await updateGameDoc(gameId, patch);
  },

  /** Internal: write the engine result back (rotation + reassigned teams). */
  async _persistRotation(
    gameId: string,
    draft: DraftTeamsResult,
    res: { rotation: import('@/types').MatchRotation; teams: RotationTeam[] },
    resetTimerBy?: { userId: string; userName: string },
  ): Promise<void> {
    const newDraft: DraftTeamsResult = {
      ...draft,
      teams: res.teams.map((rt) => {
        const orig = draft.teams.find((t) => t.index === rt.index);
        // Spread the ORIGINAL team first so per-team fields we don't touch —
        // notably the admin-chosen `colorKey` ("האדומים"/"השחורים") — survive
        // the rotation rewrite. Building a fresh {index,captainId,playerIds}
        // dropped colorKey, so after the first round the names/tints reset to
        // the generic palette (B08). Only index/captain/roster are overwritten.
        return {
          ...(orig ?? {}),
          index: rt.index,
          captainId: orig?.captainId ?? rt.playerIds[0] ?? '',
          playerIds: rt.playerIds,
        };
      }),
    };
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.rotation = res.rotation;
        m.draftTeams = newDraft;
        if (resetTimerBy && m.liveMatch) {
          m.liveMatch = {
            ...m.liveMatch,
            timerRunning: false,
            timerLastStartedAt: null,
            timerAccumulatedMs: 0,
            timerEvents: [],
            scoreA: 0,
            scoreB: 0,
          };
        }
      }
      return;
    }
    const patch: Record<string, unknown> = {
      rotation: res.rotation,
      draftTeams: newDraft,
      updatedAt: Date.now(),
    };
    if (resetTimerBy) {
      // Zero the new round's clock + score atomically with the rotation.
      // (Goals are kept — the per-player badge survives, same as resetTimer.)
      patch['liveMatch.timerRunning'] = false;
      patch['liveMatch.timerLastStartedAt'] = null;
      patch['liveMatch.timerAccumulatedMs'] = 0;
      patch['liveMatch.timerControlledBy'] = resetTimerBy.userId;
      patch['liveMatch.timerControlledByName'] = resetTimerBy.userName;
      patch['liveMatch.timerEvents'] = [];
      patch['liveMatch.scoreA'] = 0;
      patch['liveMatch.scoreB'] = 0;
    }
    await updateGameDoc(gameId, patch);
  },

  /** Mark a player as having left for the evening ("הלך הביתה"). Removes them
   *  from whichever team currently holds them (so the rotation no longer counts
   *  or borrows them) and records their home team in `draftTeams.leftHome` so an
   *  admin can restore them later. Any active loan referencing them is dropped.
   *  Caller gates this to BETWEEN rounds (timer not running). */
  /** Swap two players between their teams (or reorder within one team) — a live
   *  "החלפה". Exchanges them in draftTeams.teams[].playerIds, keeps captains
   *  valid, and drops any loan referencing either player so rosterOf resolves
   *  cleanly to their new home. Mirrors markPlayerWentHome's write shape. */
  async swapPlayers(gameId: string, aId: string, bId: string): Promise<void> {
    if (!gameId || !aId || !bId || aId === bId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!draft) return;
    const teams = draft.teams.map((t) => ({ ...t, playerIds: [...t.playerIds] }));
    const ta = teams.find((t) => t.playerIds.includes(aId));
    const tb = teams.find((t) => t.playerIds.includes(bId));
    if (!ta || !tb) return;
    // Exchange (also handles same-team: swaps the two list positions).
    ta.playerIds[ta.playerIds.indexOf(aId)] = bId;
    tb.playerIds[tb.playerIds.indexOf(bId)] = aId;
    // Keep every captain a member of their own team.
    for (const t of teams) {
      if (t.captainId && !t.playerIds.includes(t.captainId)) {
        t.captainId = t.playerIds[0] ?? t.captainId;
      }
    }
    const newDraft = { ...draft, teams, teamsEditedManually: true };
    const patch: Record<string, unknown> = {
      draftTeams: newDraft,
      updatedAt: Date.now(),
    };
    if (g?.rotation?.loans?.some((l) => l.playerId === aId || l.playerId === bId)) {
      patch.rotation = {
        ...g.rotation,
        loans: g.rotation.loans.filter((l) => l.playerId !== aId && l.playerId !== bId),
        updatedAt: Date.now(),
      };
    }
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.draftTeams = newDraft;
        if (patch.rotation) m.rotation = patch.rotation as import('@/types').MatchRotation;
      }
      return;
    }
    await updateGameDoc(gameId, patch);
  },

  async markPlayerWentHome(gameId: string, playerId: string): Promise<void> {
    if (!gameId || !playerId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!draft) return;
    const team = draft.teams.find((t) => t.playerIds.includes(playerId));
    const homeTeam = team?.index ?? draft.teams[0]?.index ?? 0;
    const teams = draft.teams.map((t) => ({
      ...t,
      playerIds: t.playerIds.filter((p) => p !== playerId),
    }));
    const leftHome = [
      ...(draft.leftHome ?? []).filter((l) => l.playerId !== playerId),
      { playerId, homeTeam, at: Date.now() },
    ];
    const newDraft = { ...draft, teams, leftHome };
    const patch: Record<string, unknown> = {
      draftTeams: newDraft,
      updatedAt: Date.now(),
    };
    // Drop any loan that referenced the departing player.
    if (g?.rotation?.loans?.some((l) => l.playerId === playerId)) {
      patch.rotation = {
        ...g.rotation,
        loans: g.rotation.loans.filter((l) => l.playerId !== playerId),
        updatedAt: Date.now(),
      };
    }
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.draftTeams = newDraft;
        if (patch.rotation) m.rotation = patch.rotation as import('@/types').MatchRotation;
      }
      return;
    }
    await updateGameDoc(gameId, patch);
  },

  /** Restore a player who had gone home: put them back on their original team
   *  and clear them from `draftTeams.leftHome`. They rejoin the next round.
   *
   *  CRITICAL: if their spot was filled while they were gone, bringing them
   *  back must UNDO that fill — otherwise the team ends up permanently
   *  over-full (e.g. 6 in a 5-a-side), which corrupts every round's stats
   *  (B01). Two fill shapes are reversed:
   *   • temporary fill → a loan into the home team; drop one such loan so the
   *     borrowed player returns to their own team.
   *   • permanent fill → a donor was physically absorbed into the home team;
   *     if the team is still over size after the restore, send the most-
   *     recently-absorbed non-original member back to their base team.
   */
  async restorePlayer(gameId: string, playerId: string): Promise<void> {
    if (!gameId || !playerId) return;
    const g = await this.getGameById(gameId);
    const draft = g?.draftTeams;
    if (!draft) return;
    // Only restore someone who was actually marked "went home" — guards against
    // a stray/double call silently dropping the player onto team 0 (B32).
    const entry = (draft.leftHome ?? []).find((l) => l.playerId === playerId);
    if (!entry) return;
    const homeTeam = entry.homeTeam ?? draft.teams[0]?.index ?? 0;
    const hasHome = draft.teams.some((t) => t.index === homeTeam);
    const targetIdx = hasHome ? homeTeam : draft.teams[0]?.index ?? 0;
    let teams = draft.teams.map((t) => {
      const target = t.index === targetIdx;
      return target && !t.playerIds.includes(playerId)
        ? { ...t, playerIds: [...t.playerIds, playerId] }
        : t;
    });

    const rot = g?.rotation;
    let loans = rot?.loans ?? [];
    const perTeam = playersPerTeamFor(g!.format);

    // Undo the fill that covered this player's vacated spot.
    let loansChanged = false;
    const coverIdx = loans.findIndex((l) => l.filledTeam === targetIdx);
    if (coverIdx >= 0) {
      // Temporary fill: drop one covering loan; that borrowed player is now
      // back on their own team (rosterOf stops counting the loan).
      loans = loans.filter((_, i) => i !== coverIdx);
      loansChanged = true;
    } else if (rot?.baseTeams && rot.baseTeams.length > 0) {
      // Permanent fill: no loan to drop. If the team is now over size, an
      // absorbed donor is the excess — return them to their base team. Count
      // EVERYONE on the field (guests included) against perTeam so a guest
      // filler also trips the check.
      const effective = effectiveRosterOf(targetIdx, teams, loans);
      if (effective.length > perTeam) {
        const baseHere = new Set(
          rot.baseTeams.find((b) => b.index === targetIdx)?.playerIds ?? [],
        );
        const tgt = teams.find((t) => t.index === targetIdx);
        // An absorbed donor is a current member not in this team's base roster
        // (and not the player we're restoring). Only act on one we can send
        // HOME — never strip a player off the field with nowhere to put them
        // (fail-safe: keeping size slightly high beats dropping a real player).
        const filler = [...(tgt?.playerIds ?? [])]
          .reverse()
          .find(
            (p) =>
              !baseHere.has(p) &&
              p !== playerId &&
              !isGuestId(p) &&
              rot.baseTeams!.some((b) => b.playerIds.includes(p)),
          );
        const fillerHome =
          filler != null
            ? rot.baseTeams.find((b) => b.playerIds.includes(filler))?.index
            : undefined;
        if (filler != null && fillerHome != null) {
          teams = teams.map((t) => {
            if (t.index === targetIdx)
              return { ...t, playerIds: t.playerIds.filter((p) => p !== filler) };
            if (t.index === fillerHome && !t.playerIds.includes(filler))
              return { ...t, playerIds: [...t.playerIds, filler] };
            return t;
          });
        }
      }
    }

    const leftHome = (draft.leftHome ?? []).filter((l) => l.playerId !== playerId);
    const newDraft = { ...draft, teams, leftHome };
    const newRotation =
      loansChanged && rot ? { ...rot, loans, updatedAt: Date.now() } : undefined;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) {
        m.draftTeams = newDraft;
        if (newRotation) m.rotation = newRotation;
      }
      return;
    }
    const patch: Record<string, unknown> = {
      draftTeams: newDraft,
      updatedAt: Date.now(),
    };
    if (newRotation) patch.rotation = newRotation;
    await updateGameDoc(gameId, patch);
  },

  /**
   * After a round's stats were committed but the fill picker was then CANCELLED
   * (so the rotation never advanced), the same two teams may play another
   * mini-game. Their next round-commit would reuse the SAME idempotency key
   * (`round:updatedAt`, both frozen) and be rejected as a duplicate — silently
   * dropping that round's goals/assists/wins (B03), and the same for a later
   * `endEvening` (B04). Advancing `rotation.updatedAt` gives the next commit a
   * fresh key. `rotation.round` is deliberately untouched, so the same-team
   * pair-stats trigger (which latches on `round`) does NOT re-fire.
   */
  async nudgeRotationAfterFillCancel(gameId: string): Promise<void> {
    if (!gameId) return;
    const g = await this.getGameById(gameId);
    const rot = g?.rotation;
    if (!rot) return;
    const newRotation = { ...rot, updatedAt: Date.now() };
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (m) m.rotation = newRotation;
      return;
    }
    await updateGameDoc(gameId, { rotation: newRotation, updatedAt: Date.now() });
  },

  /**
   * Self-toggle "אני מביא כדור" — adds/removes the caller's uid to
   * `ballBringerIds`. Multiple bringers allowed. Side-effect-free
   * by design: no push, no notification dispatched. The MatchDetails
   * roster row reads the array and renders a ball icon next to
   * names that appear in it.
   */
  async setBringingBall(
    gameId: string,
    userId: UserId,
    bringing: boolean,
  ): Promise<void> {
    if (!gameId || !userId) return;
    if (USE_MOCK_DATA) {
      const m = mockGamesV2.find((x) => x.id === gameId);
      if (!m) return;
      const cur = new Set(m.ballBringerIds ?? []);
      if (bringing) cur.add(userId);
      else cur.delete(userId);
      m.ballBringerIds = Array.from(cur);
      return;
    }
    // Atomic add/remove via Firestore array transforms — keeps the
    // write small and avoids a read-modify-write race when two
    // players toggle simultaneously.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { arrayUnion, arrayRemove } = require('firebase/firestore');
    await updateGameDoc(gameId, {
      ballBringerIds: bringing
        ? arrayUnion(userId)
        : arrayRemove(userId),
      updatedAt: Date.now(),
    });
  },



  /**
   * Permanently remove a game. Caller must be the creator or a community
   * admin — Firestore rules enforce this; we don't double-check here.
   * Notifies participants so subscribed UIs can navigate away.
   */
  async deleteGame(gameId: string, deletedBy?: UserId): Promise<void> {
    if (!gameId) return;
    clearMyGamesCache();
    // Capture the roster + title BEFORE deleting. The Cloud Function fans
    // the "המשחק בוטל" push out by reading the game doc — which no longer
    // exists once we delete it (so previously NO registered player was
    // notified). We stash the roster + title on the notification payload;
    // the function falls back to them when the game is already gone.
    let recipientUids: string[] = [];
    let gameTitle = '';
    let capturedGroupId = '';
    let capturedCreatedBy = '';
    const captureRoster = (g?: {
      players?: string[];
      waitlist?: string[];
      pending?: string[];
      title?: string;
      groupId?: string;
      createdBy?: string;
    }) => {
      if (!g) return;
      recipientUids = Array.from(
        new Set([
          ...(g.players ?? []),
          ...(g.waitlist ?? []),
          ...(g.pending ?? []),
        ]),
      );
      gameTitle = g.title ?? '';
      // Stash groupId so the fan-out CF can authorise the sender (community
      // admin) even after the game doc is deleted below.
      if (g.groupId) capturedGroupId = g.groupId;
      if (g.createdBy) capturedCreatedBy = g.createdBy;
    };
    if (USE_MOCK_DATA) {
      const idx = mockGamesV2.findIndex((x) => x.id === gameId);
      if (idx >= 0) {
        captureRoster(mockGamesV2[idx]);
        mockGamesV2.splice(idx, 1);
      }
    } else {
      try {
        captureRoster((await getDoc(docs.game(gameId))).data());
      } catch (err) {
        logError('deleteGameCaptureRoster', err, { gameId });
        /* best-effort — still delete + dispatch with whatever we captured */
      }
      // Audit trail — stamp WHO deleted the game (the exact actor) BEFORE the
      // doc is removed. The server trigger also records a best-guess, but our
      // create lands first so the accurate deleter wins (create-once). Rules
      // require deletedBy == the caller, so nobody can frame someone else.
      if (deletedBy) {
        try {
          await setDoc(doc(getFirebase().db, 'gameDeletions', gameId), {
            gameId,
            deletedBy,
            deletedByApprox: false,
            source: 'manual',
            gameTitle,
            groupId: capturedGroupId,
            createdBy: capturedCreatedBy,
            rosterCount: recipientUids.length,
            deletedAt: Date.now(),
          });
        } catch (err) {
          logError('gameDeletionAudit', err, { gameId });
          /* best-effort — the server trigger still records a fallback */
        }
      }
      try {
        await deleteDoc(docs.game(gameId));
      } catch (err) {
        logError('deleteGame', err, { gameId });
        if (__DEV__) console.warn('[gameService] deleteGame failed', err);
        throw err;
      }
    }
    // The "game deleted" push is minted SERVER-SIDE (onGameRosterChanged's
    // delete branch, srv:true) from the real last-known roster — a client
    // dispatch here can't be authorised once the doc is gone AND would win the
    // dedup race, blocking the server's authorised mint (audit #9). Mock mode
    // has no server trigger, so it still dispatches locally.
    if (USE_MOCK_DATA) {
      notificationsService.dispatch({
        type: 'gameCanceledOrUpdated',
        recipientId: gameId,
        payload: {
          gameId,
          groupId: capturedGroupId,
          action: 'deleted',
          gameTitle,
          recipientUids,
          editorUid: '',
        },
      });
    }
    logEvent(AnalyticsEvent.GameFinished, { gameId, deleted: true });
  },

  /**
   * Look for a registration conflict — another active game the user is
   * already registered to whose start time is within ±REG_CONFLICT_WINDOW_MS
   * of the target game. Used to block "double-booking" the same evening.
   *
   * Returns null when there's no conflict (caller should proceed). When
   * a conflict exists, returns a compact summary of the closest one so
   * the UI can surface a deep-link to it.
   *
   * Conflict counts:
   *   • players / waitlist / pending — all real registration buckets
   *   • participantIds — the denormalised union (queried directly).
   *     Defensive fallback (post-filter): also accept a doc if user is
   *     in players[]/waitlist[]/pending[] but missing from participantIds
   *     (covers stale denormalisation from older writes).
   *
   * Conflict ignores:
   *   • finished / cancelled / scheduled (status not in active set)
   *   • the target game itself (excluded by id)
   *
   * Special case — `status === 'active'` (round in progress):
   *   ALWAYS counts as a conflict regardless of startsAt comparison.
   *   A live game IS the user's "now"; you can't be in two places at
   *   once even if the active game's startsAt is missing or outside
   *   the ±4h window. This handles legacy/edge-case games without a
   *   startsAt that have already been marked active.
   *
   * Edge cases:
   *   • target.startsAt missing → window comparison disabled, but an
   *     `active` candidate still blocks. Other candidates pass through
   *     (no time anchor → can't compute distance).
   *   • exact same startsAt → `>= && <=` (inclusive) → blocks.
   *   • multiple conflicts → returns the one whose start time is
   *     CLOSEST to the target's start (smallest |Δstart|), so the UI
   *     can deep-link to the most relevant clash. `active` candidates
   *     are pinned to distance 0 so they win ties (most urgent).
   *   • performance — capped to CONFLICT_QUERY_LIMIT docs per fetch
   *     so a pathological participation history can't blow up the
   *     read. Most users will have <10 active games at any time.
   */
  async findRegistrationConflict(
    userId: UserId,
    targetGame: { id: string; startsAt?: number },
  ): Promise<{
    gameId: string;
    title: string;
    startsAt: number;
    groupId: string;
  } | null> {
    const hasStart = typeof targetGame?.startsAt === 'number';
    const windowStart = hasStart
      ? (targetGame.startsAt as number) - REG_CONFLICT_WINDOW_MS
      : 0;
    const windowEnd = hasStart
      ? (targetGame.startsAt as number) + REG_CONFLICT_WINDOW_MS
      : 0;
    const ACTIVE_STATUSES: readonly string[] = ['open', 'locked', 'active'];

    const candidates: Game[] = await (async () => {
      if (USE_MOCK_DATA) {
        return mockGamesV2
          .filter((g) =>
            (g.participantIds ?? [
              ...g.players,
              ...g.waitlist,
              ...(g.pending ?? []),
            ]).includes(userId),
          )
          .map((g) => ({ ...g, matches: [] } as Game));
      }
      // Single array-contains query — Firestore supports only one
      // per request. Status + window filters run client-side. The
      // same index already exists for `getMyGames`
      // (`participantIds` auto-index), so this adds zero infra cost.
      // limit() bounds worst-case scan; a typical user is in < 10
      // active games so this rarely truncates real data.
      let snap;
      try {
        snap = await getDocs(
          query(
            col.games(),
            where('participantIds', 'array-contains', userId),
            limit(CONFLICT_QUERY_LIMIT),
          ),
        );
      } catch (err) {
        logError('findRegistrationConflict', err, {
          userId,
          targetGameId: targetGame.id,
        });
        if (__DEV__) {
          console.warn('[gameService] findRegistrationConflict failed', err);
        }
        throw err;
      }
      return snap.docs.map((d) => ({ ...d.data(), matches: [] } as Game));
    })();

    // A user "blocks" further joins only when they're in `players`
    // of the conflicting game — the bucket that represents an
    // actually-confirmed slot. Sitting on someone else's waitlist or
    // a pending approval doesn't burn the slot yet, so the user
    // should be free to stack waitlists/pendings across overlapping
    // games (more chances to actually play). Live games still block
    // unconditionally regardless of bucket — see the caller filter.
    const userParticipates = (g: Game): boolean => {
      return g.players?.includes(userId) ?? false;
    };

    const conflicts = candidates.filter((g) => {
      if (g.id === targetGame.id) return false;
      if (!ACTIVE_STATUSES.includes(g.status)) return false;
      if (!userParticipates(g)) return false;
      // A genuinely-CURRENT live game conflicts (the user is presently
      // committed there). But a STALE 'active' game — one whose evening
      // the admin never ended — must NOT block a join days later. Without
      // this, yesterday's forgotten-active game blocked tomorrow's game
      // with a nonsensical "34-hour overlap" (user report). Treat an
      // active game as current only if it started within the last 12h.
      if (g.status === 'active') {
        const ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;
        return typeof g.startsAt === 'number'
          ? Date.now() - g.startsAt < ACTIVE_STALE_MS
          : true;
      }
      // Otherwise we need both sides of the window to evaluate.
      if (!hasStart) return false;
      if (typeof g.startsAt !== 'number') return false;
      return g.startsAt >= windowStart && g.startsAt <= windowEnd;
    });
    if (conflicts.length === 0) return null;

    // Sort: active games first (distance 0), then by absolute time
    // distance to target. If target has no startsAt, fall back to
    // "earliest first" so the user sees the most imminent clash.
    conflicts.sort((a, b) => {
      const da =
        a.status === 'active'
          ? 0
          : hasStart && typeof a.startsAt === 'number'
            ? Math.abs(a.startsAt - (targetGame.startsAt as number))
            : a.startsAt ?? Number.MAX_SAFE_INTEGER;
      const db =
        b.status === 'active'
          ? 0
          : hasStart && typeof b.startsAt === 'number'
            ? Math.abs(b.startsAt - (targetGame.startsAt as number))
            : b.startsAt ?? Number.MAX_SAFE_INTEGER;
      return da - db;
    });
    const c = conflicts[0];
    return {
      gameId: c.id,
      title: c.title,
      // startsAt may legitimately be 0/missing for an active game with
      // no scheduled time. The UI guards on this when formatting.
      startsAt: typeof c.startsAt === 'number' ? c.startsAt : 0,
      groupId: c.groupId,
    };
  },

  /**
   * Add the current user to a game, choosing the right bucket based on
   * the game's rules:
   *   - requiresApproval=true → pending[] (organizer must approve)
   *   - players.length < maxPlayers → players[]
   *   - else → waitlist[]
   */
  /**
   * FAIR registration. Captures `tappedAt = serverNow()` at the tap instant
   * (network-independent), then writes a contention-free per-user request doc
   * (`games/{id}/joinRequests/{uid}`). A server reconciler collects the opening
   * burst over a ~2s settle window and assigns seats strictly by tap time, so
   * the spot goes to whoever tapped first — not whoever's network was fastest.
   *
   * Returns an OPTIMISTIC bucket (predicted from the roster snapshot) so the UI
   * gives instant feedback; the live game subscription corrects it if the
   * server's fair assignment differs in a contested boundary case. Same return
   * shape + thrown errors as joinGameV2, so callers swap in 1:1.
   */
  async requestJoinGame(
    gameId: string,
    userId: UserId,
  ): Promise<{ bucket: 'players' | 'waitlist' | 'pending' }> {
    // Capture the tap timestamp FIRST — before any await — so network latency
    // on the pre-checks below never shifts a user's place in line.
    const tappedAt = serverNow();
    clearMyGamesCache();

    const predictBucket = (g: {
      players?: string[];
      waitlist?: string[];
      pending?: string[];
      guests?: { id: string; waitlisted?: boolean }[];
      maxPlayers?: number;
      requiresApproval?: boolean;
      createdBy?: string;
      pendingPromotion?: { uid?: string } | null;
    }): 'players' | 'waitlist' | 'pending' => {
      const state: RosterState = {
        players: g.players ?? [],
        waitlist: g.waitlist ?? [],
        pending: g.pending ?? [],
        guestsCount: activeGuestCount(g.guests),
        maxPlayers: g.maxPlayers ?? 15,
        // The game's creator/manager joins their OWN game without approval —
        // requiring them to approve themselves is nonsense.
        requiresApproval: g.requiresApproval === true && g.createdBy !== userId,
        pendingOfferReservation: !!g.pendingPromotion?.uid,
      };
      const res = assignJoins(state, [
        { uid: userId, tappedAt, requestedAt: tappedAt },
      ]);
      return res.assignments[0]?.bucket ?? 'waitlist';
    };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('requestJoinGame: game not found');
      if (g.status === 'scheduled') {
        throw new Error('requestJoinGame: registration not yet open');
      }
      if ((g.rejectedPlayerIds ?? []).includes(userId)) {
        const e = new Error('GAME_JOIN_REJECTED') as Error & { code?: string };
        e.code = 'GAME_JOIN_REJECTED';
        throw e;
      }
      const already =
        g.players.includes(userId) ||
        g.waitlist.includes(userId) ||
        (g.pending ?? []).includes(userId);
      if (already) {
        return {
          bucket: g.players.includes(userId)
            ? 'players'
            : g.waitlist.includes(userId)
              ? 'waitlist'
              : 'pending',
        };
      }
      const conflict = await gameService.findRegistrationConflict(userId, {
        id: g.id,
        startsAt: g.startsAt,
      });
      if (conflict) {
        throw makeRegistrationConflictError(
          { id: g.id, groupId: g.groupId, startsAt: g.startsAt },
          conflict,
        );
      }
      // Mock has no server reconciler → apply the fair assignment locally.
      const res = assignJoins(
        {
          players: g.players,
          waitlist: g.waitlist,
          pending: g.pending ?? [],
          guestsCount: activeGuestCount(g.guests),
          maxPlayers: g.maxPlayers,
          requiresApproval: g.requiresApproval === true && g.createdBy !== userId,
          pendingOfferReservation: !!g.pendingPromotion?.uid,
        },
        [{ uid: userId, tappedAt, requestedAt: tappedAt }],
      );
      g.players = res.players;
      g.waitlist = res.waitlist;
      g.pending = res.pending;
      g.participantIds = Array.from(
        new Set([...res.players, ...res.waitlist, ...res.pending]),
      );
      return { bucket: res.assignments[0]?.bucket ?? 'waitlist' };
    }

    // Real Firestore. Lifecycle + conflict pre-check (fast, friendly errors);
    // tappedAt is already locked so this latency can't reorder anyone.
    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('requestJoinGame: game not found');
    const data = snap.data();
    if (data.status !== 'open') throw new Error('GAME_NOT_OPEN');
    // Honor the SAME 1h post-kickoff grace the UI (canJoinGame) offers — else
    // "אני מגיע" is enabled for an hour after kickoff but every write here
    // rejects, making the late-join feature unreachable. Live games are still
    // blocked by the GAME_LIVE check below.
    if (data.startsAt && data.startsAt + LATE_REG_GRACE_MS < Date.now()) {
      throw new Error('GAME_STARTED');
    }
    if (data.liveMatch?.phase === 'live') throw new Error('GAME_LIVE');
    if ((data.rejectedPlayerIds ?? []).includes(userId)) {
      const e = new Error('GAME_JOIN_REJECTED') as Error & { code?: string };
      e.code = 'GAME_JOIN_REJECTED';
      throw e;
    }
    const inRoster =
      (data.players ?? []).includes(userId) ||
      (data.waitlist ?? []).includes(userId) ||
      (data.pending ?? []).includes(userId);
    if (inRoster) {
      return {
        bucket: (data.players ?? []).includes(userId)
          ? 'players'
          : (data.waitlist ?? []).includes(userId)
            ? 'waitlist'
            : 'pending',
      };
    }
    const conflict = await gameService.findRegistrationConflict(userId, {
      id: gameId,
      startsAt: data.startsAt,
    });
    if (conflict) {
      throw makeRegistrationConflictError(
        { id: gameId, groupId: data.groupId, startsAt: data.startsAt },
        conflict,
      );
    }
    // Contention-free write: each user owns their own request doc, so all
    // concurrent taps land immediately in parallel — no transaction retries,
    // no delay. The server reconciler does the authoritative fair seating.
    const { db } = getFirebase();
    const reqRef = doc(db, 'games', gameId, 'joinRequests', userId);
    // After the reconciler seats a user it leaves their request doc behind in
    // state 'assigned'. If that user later LEAVES and re-joins, a plain setDoc
    // would be an UPDATE of the existing doc — which the rules forbid
    // (`allow update: if false`; the reconciler owns transitions), so the
    // re-join failed with permission-denied. Delete any stale doc first so the
    // setDoc below is always a fresh CREATE (self-delete + self-create are both
    // allowed). No-op when there's nothing to delete.
    await deleteDoc(reqRef).catch(() => undefined);
    await setDoc(reqRef, {
      uid: userId,
      tappedAt,
      requestedAt: serverTimestamp(),
      state: 'queued',
    });
    logEvent(AnalyticsEvent.GameJoined, { gameId, fair: true });
    return { bucket: predictBucket(data) };
  },

  async joinGameV2(
    gameId: string,
    userId: UserId
  ): Promise<{ bucket: 'players' | 'waitlist' | 'pending' }> {
    clearMyGamesCache(); // joining adds the game to the user's my-games list
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('joinGameV2: game not found');
      // Defense-in-depth — the UI should hide scheduled games from
      // every feed, but if a stale deep-link or cached doc lets a
      // user attempt a join before the game's registrationOpensAt
      // we reject loudly rather than silently let them in.
      if (g.status === 'scheduled') {
        throw new Error('joinGameV2: registration not yet open');
      }
      if ((g.rejectedPlayerIds ?? []).includes(userId)) {
        const e = new Error('GAME_JOIN_REJECTED') as Error & { code?: string };
        e.code = 'GAME_JOIN_REJECTED';
        throw e;
      }
      const already =
        g.players.includes(userId) ||
        g.waitlist.includes(userId) ||
        (g.pending ?? []).includes(userId);
      if (already) {
        const where: 'players' | 'waitlist' | 'pending' = g.players.includes(
          userId
        )
          ? 'players'
          : g.waitlist.includes(userId)
            ? 'waitlist'
            : 'pending';
        return { bucket: where };
      }
      // Conflict guard — same rule as the Firebase path. Skipped when
      // the user is already in this game (handled by the idempotent
      // check above). For mocks we just reuse the helper.
      const conflict = await gameService.findRegistrationConflict(userId, {
        id: g.id,
        startsAt: g.startsAt,
      });
      if (conflict) {
        throw makeRegistrationConflictError(
          { id: g.id, groupId: g.groupId, startsAt: g.startsAt },
          conflict,
        );
      }
      let bucket: 'players' | 'waitlist' | 'pending';
      // Capacity is shared between real players and guests — guests are
      // first-class participants per the spec.
      const occupancy = g.players.length + activeGuestCount(g.guests);
      if (g.requiresApproval && g.createdBy !== userId) {
        g.pending = [...(g.pending ?? []), userId];
        bucket = 'pending';
      } else if (occupancy < g.maxPlayers) {
        g.players = [...g.players, userId];
        bucket = 'players';
      } else {
        g.waitlist = [...g.waitlist, userId];
        bucket = 'waitlist';
      }
      g.participantIds = Array.from(
        new Set([...(g.participantIds ?? []), userId])
      );
      // Clear any prior cancellation timestamp — re-joining means
      // the user reversed their decision, and a stale timestamp
      // would otherwise still count as a "late cancellation" in
      // the discipline snapshot.
      if (g.cancellations && g.cancellations[userId] !== undefined) {
        const { [userId]: _drop, ...rest } = g.cancellations;
        g.cancellations = Object.keys(rest).length > 0 ? rest : undefined;
      }
      // Stamp the current registration time (mirrors the live tx path) — a
      // re-join overwrites any stale timestamp from a cancelled registration.
      g.joinedAt = { ...(g.joinedAt ?? {}), [userId]: Date.now() };
      g.updatedAt = Date.now();
      // Silent-failure guard: the join must have placed the user in
      // exactly one bucket. None → no-op join, surface it.
      if (
        !g.players.includes(userId) &&
        !g.waitlist.includes(userId) &&
        !(g.pending ?? []).includes(userId)
      ) {
        logUnexpected('joinDidNotAddUser', {
          gameId,
          userId,
          requiresApproval: g.requiresApproval,
          occupancy,
          maxPlayers: g.maxPlayers,
        });
      }
      // Phase 3: count this as a "game joined" for achievements. Pending
      // bucket is excluded — those joins haven't actually been admitted.
      if (bucket !== 'pending') {
        achievementsService.bump(userId, 'gamesJoined', 1);
      }
      logEvent(
        bucket === 'waitlist' ? AnalyticsEvent.WaitlistJoined : AnalyticsEvent.GameJoined,
        { gameId, bucket },
      );
      return { bucket };
    }
    // Firebase: atomic join via runTransaction. The previous read-then-
    // write pattern lost updates under concurrent joins (two users
    // hitting the last spot both observed `players.length<max`, both
    // appended themselves, second write overwrote the first → roster
    // overflow or silent drop). Inside the transaction we re-read the
    // current snapshot, re-validate capacity AND lifecycle, then commit
    // — the SDK retries on contention.
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    // Authoritative pre-transaction conflict check. Per spec the
    // check fires BEFORE any write — so we don't need to roll back
    // state if the user is double-booking. We pull the target with
    // a single getDoc; the conflict helper does its own
    // array-contains query (one extra read at most).
    //
    // Even when target.startsAt is missing we still call the helper
    // — an `active` registration always blocks regardless of time
    // anchor (the user is currently playing somewhere else).
    //
    // Skipped only when the user is already a participant in this
    // game — re-joining your own game shouldn't be blocked by
    // yourself.
    //
    // The check sits as close as possible to runTransaction(): the
    // race window between the helper resolving and the txn opening
    // is just the JS scheduler tick between two sequential awaits,
    // which is the smallest gap we can give without doing a query
    // inside the transaction (Firestore web SDK forbids queries in
    // transactions).
    //
    // Network errors here propagate up so the caller can surface a
    // generic error rather than silently allowing the join.
    const targetSnap = await getDoc(ref);
    if (!targetSnap.exists()) throw new Error('joinGameV2: game not found');
    const targetData = targetSnap.data();
    const alreadyInTarget = (targetData.participantIds ?? []).includes(userId);
    if (!alreadyInTarget) {
      const conflict = await gameService.findRegistrationConflict(userId, {
        id: gameId,
        startsAt: targetData.startsAt,
      });
      if (conflict) {
        throw makeRegistrationConflictError(
          {
            id: gameId,
            groupId: targetData.groupId,
            startsAt: targetData.startsAt,
          },
          conflict,
        );
      }
    }
    let lastDebugSnapshot: Record<string, unknown> | null = null;
    let lastUpdates: Record<string, unknown> | null = null;
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('joinGameV2: game not found');
      const data = snap.data();

      // Lifecycle gate (mirrors firestore.rules — fail fast client-side
      // with a typed error so the UI can show a friendly message).
      if (data.status !== 'open') throw new Error('GAME_NOT_OPEN');
      // Same 1h grace as canJoinGame / requestJoinGame (see note there). Only
      // truly past-grace (or live) joins are rejected.
      if (data.startsAt && data.startsAt + LATE_REG_GRACE_MS < Date.now()) {
        // Track the rare-but-interesting case of a stale UI letting
        // a user attempt to join well after kickoff — usually a deep link
        // or stale list cache.
        logEvent(AnalyticsEvent.GameStartedJoinAttempt, {
          gameId,
          startsAt: data.startsAt,
          status: data.status,
        });
        throw new Error('GAME_STARTED');
      }
      if (data.liveMatch?.phase === 'live') throw new Error('GAME_LIVE');

      const players = data.players ?? [];
      const waitlist = data.waitlist ?? [];
      const pending = data.pending ?? [];
      // Rejected by the organizer on a previous request → can't re-request
      // this game. Checked before idempotency so a rejected user is always
      // bounced (mirrors declined friends / rejected community joins).
      const rejected = (data.rejectedPlayerIds ?? []) as string[];
      if (rejected.includes(userId)) {
        const e = new Error('GAME_JOIN_REJECTED') as Error & { code?: string };
        e.code = 'GAME_JOIN_REJECTED';
        throw e;
      }
      // Idempotency — already joined? Return the detected bucket
      // without writing. Important: must be inside the txn so the
      // observation is consistent with the eventual write decision.
      if (players.includes(userId)) {
        return { bucket: 'players' as const };
      }
      if (waitlist.includes(userId)) {
        return { bucket: 'waitlist' as const };
      }
      if (pending.includes(userId)) {
        return { bucket: 'pending' as const };
      }

      // Guests count toward capacity. A coach who pre-fills the roster
      // with two guests on a 12-cap game leaves 10 slots for real users.
      // A pending promotion offer also reserves a slot — the offered
      // user hasn't confirmed yet, but the spot is held for them.
      const pendingOffer = data.pendingPromotion as
        | { uid?: string }
        | null
        | undefined;
      const offerReservation = pendingOffer && pendingOffer.uid ? 1 : 0;
      const occupancy =
        players.length + activeGuestCount(data.guests) + offerReservation;
      // The rules engine reads
      // `request.resource.data.{players,waitlist,pending}.size()` for
      // the participantIds invariant. On a legacy doc where one of
      // those is undefined, `.size()` errors and Firestore reports
      // "Missing or insufficient permissions". Backfill any missing
      // array with [] so the rule has well-defined fields to read.
      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      if (!Array.isArray(data.players)) updates.players = [];
      if (!Array.isArray(data.waitlist)) updates.waitlist = [];
      if (!Array.isArray(data.pending)) updates.pending = [];
      let bucket: 'players' | 'waitlist' | 'pending';
      // The creator/manager joins their OWN game without approval.
      if (data.requiresApproval && data.createdBy !== userId) {
        updates.pending = [...pending, userId];
        bucket = 'pending';
      } else if (occupancy < (data.maxPlayers ?? 15)) {
        updates.players = [...players, userId];
        bucket = 'players';
      } else {
        updates.waitlist = [...waitlist, userId];
        bucket = 'waitlist';
      }
      // Rules enforce participantIds.size == players + waitlist +
      // pending. Rebuild the union from POST-update arrays — falling
      // back to the locally-read array when this bucket isn't being
      // touched (otherwise `updates[bucket]` would be undefined and
      // we'd spread `undefined`).
      const nextPlayers = (updates.players as string[] | undefined) ?? players;
      const nextWaitlist =
        (updates.waitlist as string[] | undefined) ?? waitlist;
      const nextPending =
        (updates.pending as string[] | undefined) ?? pending;
      updates.participantIds = Array.from(
        new Set([...nextPlayers, ...nextWaitlist, ...nextPending]),
      );
      // Record WHEN this user joined (uid→ms map) so the admin panel can
      // show an accurate "joined X ago" instead of falling back to the
      // game's creation time. Read-modify-write is safe inside the txn.
      const joinedMap: Record<string, number> =
        data.joinedAt && typeof data.joinedAt === 'object'
          ? { ...(data.joinedAt as Record<string, number>) }
          : {};
      // Always (re)stamp the CURRENT registration time. Reaching here means a
      // genuine (re)join — the idempotency guard above already returned for
      // anyone still registered — so a leftover timestamp from a
      // since-cancelled registration is stale and must be overwritten (user
      // report: after cancel + re-join the roster still showed the FIRST join
      // date instead of the new one).
      joinedMap[userId] = Date.now();
      updates.joinedAt = joinedMap;
      // Clear any prior cancellation timestamp on re-join — see the
      // mock branch comment for the rationale (stale timestamps
      // would otherwise leak into the discipline snapshot).
      const existingCancellations: Record<string, number> | undefined =
        data.cancellations && typeof data.cancellations === 'object'
          ? (data.cancellations as Record<string, number>)
          : undefined;
      if (existingCancellations && existingCancellations[userId] !== undefined) {
        const { [userId]: _drop, ...rest } = existingCancellations;
        updates.cancellations = Object.keys(rest).length > 0 ? rest : null;
      }
      const nextP = (updates.players as string[] | undefined) ?? players;
      const nextW = (updates.waitlist as string[] | undefined) ?? waitlist;
      const nextPe = (updates.pending as string[] | undefined) ?? pending;
      const pids = updates.participantIds as string[];
      // Capture the pre-commit snapshot so the catch below can include
      // it in the warning surfaced to the redbox. Firestore itself
      // never tells us which rule clause denied; the snapshot lets us
      // recompute what would have failed.
      lastDebugSnapshot = {
        gameId,
        userId,
        bucket,
        status: data.status,
        visibility: data.visibility,
        groupId: data.groupId,
        requiresApproval: data.requiresApproval,
        startsAt: data.startsAt,
        startsAtFuture:
          typeof data.startsAt === 'number'
            ? data.startsAt > Date.now()
            : 'no-startsAt',
        // Direct reflection of liveMatch state — null vs undefined vs
        // map matters for the rule's null-deref guard.
        liveMatchType: data.liveMatch === null
          ? 'null'
          : data.liveMatch === undefined
            ? 'undefined'
            : typeof data.liveMatch,
        liveMatchHasPhase:
          data.liveMatch && typeof data.liveMatch === 'object'
            ? 'phase' in data.liveMatch
            : false,
        livePhase: (data.liveMatch as { phase?: string } | undefined | null)
          ?.phase,
        oldPlayersSize: players.length,
        oldWaitlistSize: waitlist.length,
        oldPendingSize: pending.length,
        newPlayersSize: nextP.length,
        newWaitlistSize: nextW.length,
        newPendingSize: nextPe.length,
        newParticipantIdsSize: pids.length,
        sumOfArrays: nextP.length + nextW.length + nextPe.length,
        invariantHolds:
          pids.length === nextP.length + nextW.length + nextPe.length,
        dataPlayersIsArray: Array.isArray(data.players),
        dataWaitlistIsArray: Array.isArray(data.waitlist),
        dataPendingIsArray: Array.isArray(data.pending),
        dataParticipantIdsIsArray: Array.isArray(data.participantIds),
        dataPendingPromotion: data.pendingPromotion ?? null,
        dataMaxPlayers: data.maxPlayers,
        userInOldPlayers: players.includes(userId),
        userInOldWaitlist: waitlist.includes(userId),
        userInOldPending: pending.includes(userId),
        allDocKeys: Object.keys(data),
      };
      lastUpdates = { ...updates, fields: Object.keys(updates) };
      // Silent-failure guard: a join must land the user in exactly one
      // bucket. If the in-memory post-write arrays contain them in NONE,
      // the write would be a no-op join — log it (we still commit `updates`
      // so behaviour is unchanged).
      if (
        !nextP.includes(userId) &&
        !nextW.includes(userId) &&
        !nextPe.includes(userId)
      ) {
        logUnexpected('joinDidNotAddUser', {
          gameId,
          userId,
          requiresApproval: data.requiresApproval,
          occupancy,
          maxPlayers: data.maxPlayers,
        });
      }
      // tx.update bypasses the converter so only the keys we changed
      // land in affectedKeys() — critical for the self-join rule which
      // whitelists ['players','waitlist','pending','participantIds',
      // 'cancellations','updatedAt']. The cast mirrors `updateGameDoc`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, updates as any);
      return { bucket };
    }).catch((err) => {
      // Re-throw with full debug context attached. The catch in
      // MatchDetailsScreen logs the message; this guarantees the
      // user sees actionable detail in the redbox.
      const e = err as { code?: string; name?: string; message?: string };
      // Only log UNEXPECTED failures — the lifecycle gates above throw
      // business codes the UI handles as normal validation results.
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GAME_JOIN_REJECTED',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(e.code as string)
      ) {
        const snap = (lastDebugSnapshot ?? {}) as Record<string, unknown>;
        logError('joinGame', err, {
          gameId,
          userId,
          status: snap.status,
          visibility: snap.visibility,
          groupId: snap.groupId,
          requiresApproval: snap.requiresApproval,
          startsAt: snap.startsAt,
          code: e.code,
        });
      }
      const enriched = new Error(
        `joinGameV2 failed: code=${e.code ?? 'n/a'} name=${e.name ?? 'n/a'} ` +
          `msg="${e.message ?? ''}" snapshot=${JSON.stringify(lastDebugSnapshot)} ` +
          `updates=${JSON.stringify(lastUpdates)}`,
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (enriched as any).code = e.code;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (enriched as any).original = err;
      throw enriched;
    });

    if (result.bucket !== 'pending') {
      achievementsService.bump(userId, 'gamesJoined', 1);
    }
    logEvent(
      result.bucket === 'waitlist'
        ? AnalyticsEvent.WaitlistJoined
        : AnalyticsEvent.GameJoined,
      { gameId, bucket: result.bucket },
    );
    return result;
  },

  /**
   * Admin-only: approve a pending join. Moves the user from `pending[]`
   * into `players[]` (if there's room) or `waitlist[]` (if the cap is
   * already filled by other approved players + guests).
   *
   * Idempotent: if the user is no longer in `pending[]` (already
   * approved, rejected, or removed) the call returns the current
   * bucket without writing.
   */
  async approveGameJoin(
    gameId: string,
    userId: UserId,
  ): Promise<{ bucket: 'players' | 'waitlist' | 'noop' }> {
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('approveGameJoin: game not found');
      const wasPending = (g.pending ?? []).includes(userId);
      if (!wasPending) return { bucket: 'noop' };
      g.pending = (g.pending ?? []).filter((id) => id !== userId);
      // Defensive: a concurrent cancel-promote could have already
      // landed the user on players/waitlist; don't push them in
      // twice.
      if (g.players.includes(userId)) {
        g.updatedAt = Date.now();
        return { bucket: 'players' };
      }
      if (g.waitlist.includes(userId)) {
        g.updatedAt = Date.now();
        return { bucket: 'waitlist' };
      }
      const occupancy = g.players.length + activeGuestCount(g.guests);
      let bucket: 'players' | 'waitlist';
      if (occupancy < g.maxPlayers) {
        g.players = [...g.players, userId];
        bucket = 'players';
      } else {
        g.waitlist = [...g.waitlist, userId];
        bucket = 'waitlist';
      }
      g.participantIds = Array.from(
        new Set([...(g.participantIds ?? []), userId]),
      );
      g.updatedAt = Date.now();
      achievementsService.bump(userId, 'gamesJoined', 1);
      notificationsService.dispatch({
        type: 'approved',
        recipientId: userId,
        payload: { gameId, gameTitle: g.title, bucket },
      });
      logEvent(AnalyticsEvent.GameApprovalDecided, {
        gameId,
        decision: 'approved',
        bucket,
      });
      logEvent(AnalyticsEvent.GameJoined, {
        gameId,
        groupId: g.groupId,
        bucket,
        viaApproval: true,
      });
      return { bucket };
    }
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('approveGameJoin: game not found');
      const data = snap.data();
      const pending = (data.pending ?? []) as string[];
      if (!pending.includes(userId)) {
        return { bucket: 'noop' as const, title: data.title ?? '' };
      }
      const players = (data.players ?? []) as string[];
      const waitlist = (data.waitlist ?? []) as string[];
      // A pending-promotion offer to ANOTHER user holds a seat — count it so an
      // admin approving a pending request while an offer is outstanding lands
      // the approved user on the WAITLIST instead of pushing past maxPlayers.
      // (Mirrors joinGameV2/requestJoinGame's offerReservation.)
      const pp = data.pendingPromotion as { uid?: string } | undefined;
      const offerReservation = pp?.uid && pp.uid !== userId ? 1 : 0;
      const occupancy =
        players.length + activeGuestCount(data.guests) + offerReservation;
      const nextPending = pending.filter((id) => id !== userId);
      let bucket: 'players' | 'waitlist';
      const updates: Record<string, unknown> = {
        pending: nextPending,
        updatedAt: Date.now(),
      };
      // Defensive: in a rare race (admin approves while a different
      // player's cancellation is mid-transaction promoting waitlist
      // head), the user could already be on players or waitlist.
      // Skip the duplicate push.
      if (players.includes(userId)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx.update(ref, updates as any);
        return { bucket: 'players' as const, title: data.title ?? '', groupId: typeof data.groupId === 'string' ? data.groupId : '' };
      }
      if (waitlist.includes(userId)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx.update(ref, updates as any);
        return { bucket: 'waitlist' as const, title: data.title ?? '', groupId: typeof data.groupId === 'string' ? data.groupId : '' };
      }
      if (occupancy < (data.maxPlayers ?? 15)) {
        updates.players = [...players, userId];
        bucket = 'players';
      } else {
        updates.waitlist = [...waitlist, userId];
        bucket = 'waitlist';
      }
      // Rules require participantIds.size == players + waitlist +
      // pending. Rebuild from POST-update arrays so a stale union
      // doesn't trip the invariant. (See joinGameV2 for the same.)
      const nextPlayers = (updates.players as string[] | undefined) ?? players;
      const nextWaitlist =
        (updates.waitlist as string[] | undefined) ?? waitlist;
      updates.participantIds = Array.from(
        new Set([...nextPlayers, ...nextWaitlist, ...nextPending]),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, updates as any);
      return {
        bucket,
        title: data.title ?? '',
        groupId: typeof data.groupId === 'string' ? data.groupId : '',
      };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(code as string)
      ) {
        logError('approveGameJoin', e, { gameId, userId });
      }
      throw e;
    }

    if (result.bucket === 'noop') return { bucket: 'noop' };
    achievementsService.bump(userId, 'gamesJoined', 1);
    notificationsService.dispatch({
      type: 'approved',
      recipientId: userId,
      payload: {
        gameId,
        gameTitle: result.title,
        bucket: result.bucket,
      },
    });
    logEvent(AnalyticsEvent.GameApprovalDecided, {
      gameId,
      decision: 'approved',
      bucket: result.bucket,
    });
    logEvent(AnalyticsEvent.GameJoined, {
      gameId,
      groupId: result.groupId,
      bucket: result.bucket,
      viaApproval: true,
    });
    return { bucket: result.bucket };
  },

  /**
   * Admin-only: deny a pending join. Removes the user from `pending[]`
   * with no other state change. Idempotent: a no-op if the user is
   * already gone from pending.
   */
  async rejectGameJoin(gameId: string, userId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      const before = (g.pending ?? []).length;
      g.pending = (g.pending ?? []).filter((id) => id !== userId);
      if (g.pending.length === before) return;
      // Remember the rejection so the user can't immediately re-request.
      g.rejectedPlayerIds = Array.from(
        new Set([...(g.rejectedPlayerIds ?? []), userId]),
      );
      // Rebuild from post-update arrays — same shape as the Firebase
      // path. Keeps mock state consistent with what the rules-checked
      // production write would produce.
      g.participantIds = Array.from(
        new Set([...(g.players ?? []), ...(g.waitlist ?? []), ...g.pending]),
      );
      g.updatedAt = Date.now();
      notificationsService.dispatch({
        type: 'rejected',
        recipientId: userId,
        payload: { gameId, gameTitle: g.title },
      });
      logEvent(AnalyticsEvent.GameApprovalDecided, {
        gameId,
        decision: 'rejected',
      });
      return;
    }
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { changed: false, title: '' };
      const data = snap.data();
      const pending = ((data.pending ?? []) as string[]).filter(
        (id) => id !== userId,
      );
      if (pending.length === ((data.pending ?? []) as string[]).length) {
        return { changed: false, title: data.title ?? '' };
      }
      const players = (data.players ?? []) as string[];
      const waitlist = (data.waitlist ?? []) as string[];
      // Remember the rejection (bounded) so the user can't immediately
      // re-request — joinGameV2 reads this back to block a re-join.
      const rejectedPlayerIds = Array.from(
        new Set([...((data.rejectedPlayerIds ?? []) as string[]), userId]),
      ).slice(-200);
      // Rebuild from post-update arrays — same reason as joinGameV2:
      // an empty/stale `participantIds` would trip the rule's
      // `participantIds.size == players + waitlist + pending`
      // invariant.
      const participantIds = Array.from(
        new Set([...players, ...waitlist, ...pending]),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, {
        pending,
        participantIds,
        rejectedPlayerIds,
        updatedAt: Date.now(),
      } as any);
      return { changed: true, title: data.title ?? '' };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(code as string)
      ) {
        logError('rejectGameJoin', e, { gameId, userId });
      }
      throw e;
    }

    if (!result.changed) return;
    notificationsService.dispatch({
      type: 'rejected',
      recipientId: userId,
      payload: { gameId, gameTitle: result.title },
    });
    logEvent(AnalyticsEvent.GameApprovalDecided, {
      gameId,
      decision: 'rejected',
    });
  },

  /**
   * Remove the current user from any of the three buckets. If they
   * were in `players[]` and the waitlist has anyone (and no offer is
   * already pending), generate a `pendingPromotion` offer to the head
   * of the waitlist — they have to explicitly tap "מאשר" via the
   * push (or in-app) before the slot is theirs. Until they do, the
   * slot is reserved-but-empty.
   */
  async cancelGameV2(gameId: string, userId: UserId): Promise<void> {
    clearMyGamesCache(); // leaving removes the game from the user's list
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      const isLate =
        typeof g.cancelDeadlineHours === 'number' &&
        g.cancelDeadlineHours > 0 &&
        typeof g.startsAt === 'number' &&
        Date.now() > g.startsAt - g.cancelDeadlineHours * 60 * 60 * 1000;
      const wasInPlayers = g.players.includes(userId);
      g.players = g.players.filter((id) => id !== userId);
      g.waitlist = g.waitlist.filter((id) => id !== userId);
      g.pending = (g.pending ?? []).filter((id) => id !== userId);
      // OFFER model: a freed player slot is OFFERED to the head of the
      // waitlist (push + confirm), NOT auto-filled. If the cancelling user
      // was the one we'd offered, clear it so a fresh offer can go out.
      if (g.pendingPromotion?.uid === userId) {
        g.pendingPromotion = null;
      }
      // Generate a new offer when: a real player slot opened (wasInPlayers),
      // no offer is pending, the waitlist is non-empty, and there's room.
      const occupancy =
        g.players.length + activeGuestCount(g.guests) + (g.pendingPromotion ? 1 : 0);
      let offeredUid: string | null = null;
      if (
        wasInPlayers &&
        !g.pendingPromotion &&
        g.waitlist.length > 0 &&
        occupancy < g.maxPlayers
      ) {
        if (g.waitlistApprovalRequired === false) {
          // AUTO: admit the waitlist head straight in.
          const promoted = g.waitlist.shift();
          if (promoted) g.players.push(promoted);
        } else {
          // MANUAL/default: offer to the head (push + confirm).
          offeredUid = g.waitlist[0];
          g.pendingPromotion = { uid: offeredUid, offeredAt: Date.now() };
        }
      }
      g.participantIds = Array.from(
        new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
      );
      g.cancellations = { ...(g.cancellations ?? {}), [userId]: Date.now() };
      g.updatedAt = Date.now();
      // Silent-failure guard: a cancel must REMOVE the user from every
      // roster array. If they linger in any, the cancel didn't take.
      const cancelStillIn = g.players.includes(userId)
        ? 'players'
        : g.waitlist.includes(userId)
          ? 'waitlist'
          : (g.pending ?? []).includes(userId)
            ? 'pending'
            : null;
      if (cancelStillIn) {
        logUnexpected('cancelDidNotRemoveUser', {
          gameId,
          userId,
          where: cancelStillIn,
        });
      }
      if (offeredUid) {
        notificationsService.dispatch({
          type: 'spotOffered',
          recipientId: offeredUid,
          payload: { gameId, gameTitle: g.title, startsAt: g.startsAt },
        });
      }
      if (wasInPlayers && g.createdBy && g.createdBy !== userId) {
        // Routed through the server callable so multiple cancellations
        // on the same game aggregate into one unread admin
        // notification (count + names) instead of producing N pushes.
        notificationsService.notifyPlayerCancelled({ gameId });
      }
      logEvent(AnalyticsEvent.GameCancelled, {
        gameId,
        promoted: false,
        offered: !!offeredUid,
      });
      if (isLate && wasInPlayers) {
        const hoursToKickoff = (g.startsAt - Date.now()) / (60 * 60 * 1000);
        logEvent(AnalyticsEvent.LateCancel, {
          gameId,
          hoursToKickoff,
          deadlineHours: g.cancelDeadlineHours ?? 0,
        });
      }
      return;
    }
    // Atomic cancel via runTransaction. Fixes the lost-update bug
    // where two concurrent cancels promoted the same waitlist head
    // (both wrote `players: [...players, waitlist[0]]` from the same
    // pre-cancel snapshot, leaving the promoted user in BOTH arrays).
    // The transaction also re-reads the game so the cancel-deadline
    // gate is evaluated against canonical state, not a stale snapshot.
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists())
        return {
          offeredUid: null as string | null,
          title: '',
          startsAt: 0,
          createdBy: '',
          wasInPlayers: false,
        };
      const data = snap.data();
      const wasInPlayers = (data.players ?? []).includes(userId);
      const players = (data.players ?? []).filter(
        (id: string) => id !== userId,
      );
      const waitlist = (data.waitlist ?? []).filter(
        (id: string) => id !== userId,
      );
      const pending = (data.pending ?? []).filter(
        (id: string) => id !== userId,
      );
      // OFFER model: a freed player slot is OFFERED to the waitlist head
      // (push + confirm). The spotOffered push is sent SERVER-SIDE by
      // onGameRosterChanged when this pendingPromotion lands (reliable —
      // a cross-user client write can hit the notifications read-rule and
      // silently no-op). Clear an offer naming the canceller first, then
      // pick a new head if a real seat opened and there's room.
      let pendingPromotion =
        data.pendingPromotion &&
        typeof data.pendingPromotion === 'object' &&
        (data.pendingPromotion as { uid?: string }).uid === userId
          ? null
          : (data.pendingPromotion ?? null);
      // NOTE: waitlist promotion (auto-admit or offer) and team-pruning are NOT
      // done here. A self-cancel writes as the cancelling user, whose Firestore
      // rule permits changing ONLY their own roster membership — it may not move
      // a waitlisted stranger into players[] (audit #5) nor touch
      // draftTeams/rotation (audit #4), so doing either here would make the
      // whole withdrawal permission-denied. The `onGameRosterChanged` server
      // trigger now owns both — idempotently, on every roster shrink. Here we
      // only remove the caller and clear an offer that named them (above).

      // Rebuild from post-cancel arrays so the rule invariant holds
      // even when the stored union was stale (a stale union can happen
      // after a legacy doc, an admin edit, or a half-applied write).
      const participantIds = Array.from(
        new Set([...players, ...waitlist, ...pending]),
      );
      // Only stamp a cancellation if the user actually HAD a registration
      // (player / waitlist / pending). Otherwise — e.g. an RSVP-nudge recipient
      // who was never registered tapping "לא בא" — we'd fabricate a cancellation
      // for a slot that never existed, polluting the "ביטלו השתתפות" list.
      const wasParticipant =
        wasInPlayers ||
        (data.waitlist ?? []).includes(userId) ||
        (data.pending ?? []).includes(userId);
      const cancellations = wasParticipant
        ? {
            ...((data.cancellations as Record<string, number> | undefined) ?? {}),
            [userId]: Date.now(),
          }
        : ((data.cancellations as Record<string, number> | undefined) ?? {});
      // Only include pendingPromotion in the diff if it actually
      // changed — Firestore rules whitelist `affectedKeys()` and a
      // no-op `null → null` write would still register as a change
      // and trip the rule until the new whitelist is deployed.
      const update: Record<string, unknown> = {
        players,
        waitlist,
        pending,
        participantIds,
        cancellations,
        updatedAt: Date.now(),
        // Team-pruning moved to the server (onGameRosterChanged): the self-cancel
        // rule whitelist forbids draftTeams/rotation keys (audit #4).
      };
      const offerChanged =
        JSON.stringify(data.pendingPromotion ?? null) !==
        JSON.stringify(pendingPromotion ?? null);
      if (offerChanged) {
        update.pendingPromotion = pendingPromotion;
      }
      // Silent-failure guard: a cancel must REMOVE the user from every
      // roster array. `players/waitlist/pending` here are the post-filter
      // arrays we're about to write; if the user still appears in any,
      // the cancel didn't take. We still commit `update` (behaviour
      // unchanged) and surface the anomaly to the admin panel.
      const cancelStillIn = players.includes(userId)
        ? 'players'
        : waitlist.includes(userId)
          ? 'waitlist'
          : pending.includes(userId)
            ? 'pending'
            : null;
      if (cancelStillIn) {
        logUnexpected('cancelDidNotRemoveUser', {
          gameId,
          userId,
          where: cancelStillIn,
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, update as any);
      const isLate =
        typeof data.cancelDeadlineHours === 'number' &&
        data.cancelDeadlineHours > 0 &&
        typeof data.startsAt === 'number' &&
        Date.now() >
          data.startsAt - data.cancelDeadlineHours * 60 * 60 * 1000;
      return {
        title: data.title ?? '',
        createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
        wasInPlayers,
        isLate,
        startsAt: typeof data.startsAt === 'number' ? data.startsAt : 0,
        deadlineHours:
          typeof data.cancelDeadlineHours === 'number'
            ? data.cancelDeadlineHours
            : 0,
      };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(code as string)
      ) {
        logError('cancelGame', e, { gameId, userId });
      }
      throw e;
    }

    // Waitlist promotion (auto-admit or offer) + its spotOpened/spotOffered push
    // are now emitted server-side by onGameRosterChanged when the freed seat is
    // detected — a cross-user roster write isn't permitted from the canceller's
    // client (audit #4/#5).
    if (result.wasInPlayers && result.createdBy && result.createdBy !== userId) {
      notificationsService.notifyPlayerCancelled({ gameId });
    }
    logEvent(AnalyticsEvent.GameCancelled, {
      gameId,
      promoted: false,
      offered: false,
    });
    if (result.isLate && result.wasInPlayers) {
      const hoursToKickoff = (result.startsAt - Date.now()) / (60 * 60 * 1000);
      logEvent(AnalyticsEvent.LateCancel, {
        gameId,
        hoursToKickoff,
        deadlineHours: result.deadlineHours,
      });
    }
  },

  /**
   * Admin removes (kicks) a registered player from the game. Distinct
   * from `cancelGameV2` (a self-cancel): the caller is the organizer /
   * a group admin acting on SOMEONE ELSE, so we gate on
   * `assertGuestPermission` (same gate the guest-mutation paths use)
   * and notify the removed player via `gameCanceledOrUpdated`.
   *
   * Behaviour mirrors a self-cancel for everything roster-shaped —
   * the player is pulled from players/waitlist/pending, the live-match
   * assignments are stripped, participantIds is rebuilt, and a
   * waitlist head is offered the freed slot when a real player seat
   * opened. We intentionally do NOT stamp `cancellations[uid]`: that
   * map drives the player's own discipline / late-cancel tracking, and
   * an admin removal isn't the player's no-show.
   */
  async removePlayer(
    gameId: string,
    callerId: UserId,
    targetUserId: UserId,
  ): Promise<void> {
    const stripFromLive = (
      live: LiveMatchState | undefined,
    ): LiveMatchState | undefined => {
      if (!live) return live;
      if (
        !live.assignments?.[targetUserId] &&
        !(live.benchOrder ?? []).includes(targetUserId)
      ) {
        return live;
      }
      const { [targetUserId]: _gone, ...rest } = live.assignments ?? {};
      void _gone;
      return {
        ...live,
        assignments: rest,
        benchOrder: (live.benchOrder ?? []).filter((id) => id !== targetUserId),
      };
    };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      await assertGuestPermission(g.createdBy, g.groupId, callerId);
      const wasInPlayers = g.players.includes(targetUserId);
      g.players = g.players.filter((id) => id !== targetUserId);
      g.waitlist = g.waitlist.filter((id) => id !== targetUserId);
      g.pending = (g.pending ?? []).filter((id) => id !== targetUserId);
      if (g.pendingPromotion?.uid === targetUserId) {
        g.pendingPromotion = null;
      }
      const occupancy =
        g.players.length +
        activeGuestCount(g.guests) +
        (g.pendingPromotion ? 1 : 0);
      let offeredUid: string | null = null;
      if (
        wasInPlayers &&
        !g.pendingPromotion &&
        g.waitlist.length > 0 &&
        occupancy < g.maxPlayers
      ) {
        if (g.waitlistApprovalRequired === false) {
          const promoted = g.waitlist.shift();
          if (promoted) g.players.push(promoted);
        } else {
          offeredUid = g.waitlist[0];
          g.pendingPromotion = { uid: offeredUid, offeredAt: Date.now() };
        }
      }
      g.participantIds = Array.from(
        new Set([...g.players, ...g.waitlist, ...(g.pending ?? [])]),
      );
      // Record the admin removal (separate from `cancellations` — see the
      // Game.adminRemovals doc) so the removed player surfaces in the
      // "הוסרו ע״י מנהל" section instead of silently vanishing.
      if (wasInPlayers) {
        g.adminRemovals = { ...(g.adminRemovals ?? {}), [targetUserId]: Date.now() };
        g.adminRemovedBy = { ...(g.adminRemovedBy ?? {}), [targetUserId]: callerId };
      }
      g.liveMatch = stripFromLive(g.liveMatch);
      g.updatedAt = Date.now();
      if (offeredUid) {
        notificationsService.dispatch({
          type: 'spotOffered',
          recipientId: offeredUid,
          payload: { gameId, gameTitle: g.title, startsAt: g.startsAt },
        });
      }
      notificationsService.dispatch({
        type: 'gameCanceledOrUpdated',
        recipientId: targetUserId,
        payload: { gameId, gameTitle: g.title },
      });
      logEvent(AnalyticsEvent.GameCancelled, {
        gameId,
        promoted: false,
        offered: !!offeredUid,
      });
      return;
    }

    const ref = docs.game(gameId);
    const { db } = getFirebase();
    // Permission gate up front so we fail fast with a clear error
    // before the transaction — mirrors removeGuest.
    const snapForPerm = await getDoc(ref);
    if (!snapForPerm.exists()) return;
    const permData = snapForPerm.data();
    await assertGuestPermission(permData.createdBy, permData.groupId, callerId);

    let result;
    try {
      result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          return { offeredUid: null as string | null, title: '', startsAt: 0 };
        }
        const data = snap.data();
        const wasInPlayers = (data.players ?? []).includes(targetUserId);
        const players = (data.players ?? []).filter(
          (id: string) => id !== targetUserId,
        );
        const waitlist = (data.waitlist ?? []).filter(
          (id: string) => id !== targetUserId,
        );
        const pending = (data.pending ?? []).filter(
          (id: string) => id !== targetUserId,
        );
        let pendingPromotion =
          data.pendingPromotion &&
          typeof data.pendingPromotion === 'object' &&
          (data.pendingPromotion as { uid?: string }).uid === targetUserId
            ? null
            : (data.pendingPromotion ?? null);

        const guests = Array.isArray(data.guests) ? data.guests : [];
        const occupancy =
          players.length + activeGuestCount(guests) + (pendingPromotion ? 1 : 0);
        let offeredUid: string | null = null;
        let autoPromotedUid: string | null = null;
        if (
          wasInPlayers &&
          !pendingPromotion &&
          waitlist.length > 0 &&
          occupancy < (data.maxPlayers ?? 15)
        ) {
          if (data.waitlistApprovalRequired === false) {
            autoPromotedUid = waitlist.shift() ?? null; // AUTO: admit straight in
            if (autoPromotedUid) players.push(autoPromotedUid);
          } else {
            offeredUid = waitlist[0]; // MANUAL/default: offer + confirm
            pendingPromotion = { uid: offeredUid, offeredAt: Date.now() };
          }
        }

        const participantIds = Array.from(
          new Set([...players, ...waitlist, ...pending]),
        );
        const nextLive = stripFromLive(data.liveMatch);
        const update: Record<string, unknown> = {
          players,
          waitlist,
          pending,
          participantIds,
          ...(nextLive ? { liveMatch: nextLive } : {}),
          // stripFromLive only cleans the LEGACY live model; prune the
          // advanced-mode drawn teams + rotation too so an admin-removed
          // player doesn't stay a ghost on their team.
          ...pruneMemberFromTeams(data, targetUserId),
          updatedAt: Date.now(),
        };
        // Record the admin removal (separate from `cancellations` — see the
        // Game.adminRemovals doc) so the removed player surfaces in the
        // "הוסרו ע״י מנהל" section instead of silently vanishing. Only stamp
        // when they were an actual player; a waitlist/pending prune isn't a
        // removal worth surfacing.
        if (wasInPlayers) {
          const existingRemovals =
            data.adminRemovals && typeof data.adminRemovals === 'object'
              ? (data.adminRemovals as Record<string, number>)
              : {};
          update.adminRemovals = { ...existingRemovals, [targetUserId]: Date.now() };
          const existingRemovedBy =
            data.adminRemovedBy && typeof data.adminRemovedBy === 'object'
              ? (data.adminRemovedBy as Record<string, string>)
              : {};
          update.adminRemovedBy = { ...existingRemovedBy, [targetUserId]: callerId };
        }
        const offerChanged =
          JSON.stringify(data.pendingPromotion ?? null) !==
          JSON.stringify(pendingPromotion ?? null);
        if (offerChanged) {
          update.pendingPromotion = pendingPromotion;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tx.update(ref, update as any);
        return {
          offeredUid,
          autoPromotedUid,
          title: data.title ?? '',
          startsAt: typeof data.startsAt === 'number' ? data.startsAt : 0,
        };
      });
    } catch (err) {
      logError('removePlayer', err, { gameId, callerId, targetUserId });
      if (__DEV__) console.warn('[gameService] removePlayer failed', err);
      throw err;
    }

    if (result.offeredUid) {
      notificationsService.dispatch({
        type: 'spotOffered',
        recipientId: result.offeredUid,
        payload: {
          gameId,
          gameTitle: result.title,
          startsAt: result.startsAt,
        },
      });
    }
    if (result.autoPromotedUid) {
      notificationsService.dispatch({
        type: 'spotOpened',
        recipientId: result.autoPromotedUid,
        payload: {
          gameId,
          gameTitle: result.title,
          startsAt: result.startsAt,
        },
      });
    }
    // DIRECTED "you were removed" push — to the kicked player ONLY. Without
    // `directedTo` this fan-out type notified the whole remaining roster and
    // told the removed player nothing (audit #12).
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: targetUserId,
      payload: { gameId, gameTitle: result.title, directedTo: targetUserId },
    });
    logEvent(AnalyticsEvent.GameCancelled, {
      gameId,
      promoted: false,
      offered: !!result.offeredUid,
    });
  },

  /**
   * Head of waitlist taps "אישור" on the spotOffered push (or the
   * in-app row). Validates the offer is still theirs (an admin may
   * have advanced past them), moves them from waitlist → players,
   * clears the offer, and chains a fresh offer to the new head if
   * there's still capacity and people waiting.
   */
  async confirmSpotOffer(gameId: string, userId: UserId): Promise<void> {
    const { db } = getFirebase();
    const ref = docs.game(gameId);
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false as const };
      const data = snap.data();
      const offer = data.pendingPromotion as
        | { uid?: string; offeredAt?: number }
        | null
        | undefined;
      // Idempotency: if the user is already in players, treat as ok.
      if ((data.players ?? []).includes(userId)) {
        return { ok: true as const, alreadyIn: true };
      }
      if (!offer || offer.uid !== userId) {
        return { ok: false as const, reason: 'STALE_OFFER' as const };
      }
      if (data.status !== 'open' && data.status !== 'locked') {
        return { ok: false as const, reason: 'GAME_NOT_OPEN' as const };
      }
      const players = [...(data.players ?? []), userId];
      const waitlist = (data.waitlist ?? []).filter(
        (id: string) => id !== userId,
      );
      // Chain: if more capacity AND waitlist still has people, offer
      // the next head — keeps the queue moving without admin work.
      const guests = Array.isArray(data.guests) ? data.guests : [];
      let nextOffer: { uid: string; offeredAt: number } | null = null;
      if (
        waitlist.length > 0 &&
        players.length + activeGuestCount(guests) < (data.maxPlayers ?? 15)
      ) {
        nextOffer = { uid: waitlist[0], offeredAt: Date.now() };
      }
      // Rebuild union from post-update arrays so the rule invariant
      // holds even if the stored participantIds was stale.
      const pendingArr = (data.pending ?? []) as string[];
      const participantIds = Array.from(
        new Set([...players, ...waitlist, ...pendingArr]),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, {
        players,
        waitlist,
        participantIds,
        pendingPromotion: nextOffer,
        updatedAt: Date.now(),
      } as any);
      return {
        ok: true as const,
        title: typeof data.title === 'string' ? data.title : '',
        startsAt: typeof data.startsAt === 'number' ? data.startsAt : 0,
        nextOfferUid: nextOffer?.uid ?? null,
      };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(code as string)
      ) {
        logError('confirmSpotOffer', e, { gameId, userId });
      }
      throw e;
    }
    if (!result.ok) {
      throw new Error(result.reason ?? 'CONFIRM_FAILED');
    }
    if ('alreadyIn' in result && result.alreadyIn) return;
    if (result.nextOfferUid) {
      notificationsService.dispatch({
        type: 'spotOffered',
        recipientId: result.nextOfferUid,
        payload: {
          gameId,
          gameTitle: result.title ?? '',
          startsAt: result.startsAt ?? 0,
        },
      });
    }
    logEvent(AnalyticsEvent.WaitlistPromoted, {
      gameId,
      promotedUserId: userId,
      viaOfferConfirm: true,
    });
  },

  /**
   * Head of waitlist taps "ויתור". Removes them from the waitlist
   * entirely (they explicitly opted out — re-joining means tapping
   * "אני בא" again), clears the offer, and chains the next offer to
   * whoever is now at the head.
   */
  async passSpotOffer(gameId: string, userId: UserId): Promise<void> {
    const { db } = getFirebase();
    const ref = docs.game(gameId);
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false as const };
      const data = snap.data();
      const offer = data.pendingPromotion as
        | { uid?: string }
        | null
        | undefined;
      // Idempotency: if there's no offer for this user, just no-op.
      if (!offer || offer.uid !== userId) {
        return { ok: true as const, alreadyResolved: true };
      }
      const waitlist = (data.waitlist ?? []).filter(
        (id: string) => id !== userId,
      );
      const guests = Array.isArray(data.guests) ? data.guests : [];
      const players = (data.players ?? []) as string[];
      let nextOffer: { uid: string; offeredAt: number } | null = null;
      if (
        waitlist.length > 0 &&
        players.length + activeGuestCount(guests) < (data.maxPlayers ?? 15)
      ) {
        nextOffer = { uid: waitlist[0], offeredAt: Date.now() };
      }
      const pendingArr = (data.pending ?? []) as string[];
      const participantIds = Array.from(
        new Set([...players, ...waitlist, ...pendingArr]),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, {
        waitlist,
        participantIds,
        pendingPromotion: nextOffer,
        updatedAt: Date.now(),
      } as any);
      return {
        ok: true as const,
        title: typeof data.title === 'string' ? data.title : '',
        startsAt: typeof data.startsAt === 'number' ? data.startsAt : 0,
        nextOfferUid: nextOffer?.uid ?? null,
      };
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (
        ![
          'GAME_OVERLAP',
          'REGISTRATION_CONFLICT',
          'GAME_NOT_OPEN',
          'GAME_STARTED',
          'GAME_LIVE',
          'GROUP_FULL',
          'STALE_OFFER',
          'resource-exhausted',
          'functions/resource-exhausted',
        ].includes(code as string)
      ) {
        logError('passSpotOffer', e, { gameId, userId });
      }
      throw e;
    }
    if (!result.ok) return;
    if ('alreadyResolved' in result && result.alreadyResolved) return;
    if (result.nextOfferUid) {
      notificationsService.dispatch({
        type: 'spotOffered',
        recipientId: result.nextOfferUid,
        payload: {
          gameId,
          gameTitle: result.title ?? '',
          startsAt: result.startsAt ?? 0,
        },
      });
    }
  },

  /**
   * Admin variant of pass — used when an offered user hasn't
   * responded for a long time and the admin wants to skip them. The
   * offered user is moved to the BACK of the waitlist (not removed)
   * so they don't permanently lose their place; they just lose the
   * priority claim on the current open spot.
   */
  async adminAdvanceOffer(gameId: string): Promise<void> {
    const { db } = getFirebase();
    const ref = docs.game(gameId);
    let result;
    try {
      result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { ok: false as const };
      const data = snap.data();
      const offer = data.pendingPromotion as
        | { uid?: string }
        | null
        | undefined;
      if (!offer?.uid) return { ok: false as const, reason: 'NO_OFFER' as const };
      const offeredUid = offer.uid;
      // Move offered uid to back of waitlist (preserve their place
      // overall, just drop priority on this round).
      const waitlist = (data.waitlist ?? []).filter(
        (id: string) => id !== offeredUid,
      );
      waitlist.push(offeredUid);
      const guests = Array.isArray(data.guests) ? data.guests : [];
      const players = (data.players ?? []) as string[];
      let nextOffer: { uid: string; offeredAt: number } | null = null;
      // The new head is whoever is now at index 0 (the previous
      // index 1, if any). Skip if it's the same person we just
      // pushed back (i.e., they were the only one in waitlist).
      if (
        waitlist.length > 0 &&
        waitlist[0] !== offeredUid &&
        players.length + activeGuestCount(guests) < (data.maxPlayers ?? 15)
      ) {
        nextOffer = { uid: waitlist[0], offeredAt: Date.now() };
      }
      tx.update(ref, {
        waitlist,
        pendingPromotion: nextOffer,
        updatedAt: Date.now(),
      });
      return {
        ok: true as const,
        title: typeof data.title === 'string' ? data.title : '',
        startsAt: typeof data.startsAt === 'number' ? data.startsAt : 0,
        nextOfferUid: nextOffer?.uid ?? null,
      };
      });
    } catch (err) {
      logError('adminAdvanceOffer', err, { gameId });
      if (__DEV__) console.warn('[gameService] adminAdvanceOffer failed', err);
      throw err;
    }
    if (!result.ok) return; // no-op when there's nothing to advance
    if (result.nextOfferUid) {
      notificationsService.dispatch({
        type: 'spotOffered',
        recipientId: result.nextOfferUid,
        payload: {
          gameId,
          gameTitle: result.title ?? '',
          startsAt: result.startsAt ?? 0,
        },
      });
    }
  },

  /**
   * Account-deletion sweep: remove `userId` from every non-terminal
   * game they're registered to (players / waitlist / pending) and
   * notify each game's organizer. Mirrors `cancelGameV2`'s waitlist-
   * promotion + admin-notify behaviour, but BYPASSES the
   * cancel-deadline gate — the user is leaving the platform; there's
   * no realistic way for them to "show up" anyway.
   *
   * Best-effort: a per-game transaction failure is logged (in dev)
   * and the sweep continues to the next game so deleteOwnAccount
   * doesn't end up half-applied.
   */
  async leaveAllGamesForAccountDeletion(
    userId: UserId,
    opts?: { suppressNotifications?: boolean },
  ): Promise<void> {
    if (!userId) return;
    const suppressNotifications = !!opts?.suppressNotifications;
    // Per-admin tally — collected during the sweep, dispatched once
    // at the end. A user who's in 5 games run by the same admin
    // would otherwise spam the admin with 5 separate pushes; this
    // path consolidates them into a single "X deleted account, left
    // games A, B, C" notification. Skipped on a deleteOwnAccount
    // retry — the first run already notified everyone, and we don't
    // want to spam admins twice.
    const adminTitles = new Map<string, string[]>();
    const noteAdmin = (createdBy: string, title: string): void => {
      if (!createdBy || createdBy === userId) return;
      const cur = adminTitles.get(createdBy) ?? [];
      cur.push(title || '');
      adminTitles.set(createdBy, cur);
    };

    if (USE_MOCK_DATA) {
      for (const g of mockGamesV2) {
        if (g.status === 'finished' || g.status === 'cancelled') continue;
        const wasInPlayers = g.players.includes(userId);
        const touched =
          wasInPlayers ||
          g.waitlist.includes(userId) ||
          (g.pending ?? []).includes(userId);
        if (!touched) continue;
        g.players = g.players.filter((id) => id !== userId);
        g.waitlist = g.waitlist.filter((id) => id !== userId);
        g.pending = (g.pending ?? []).filter((id) => id !== userId);
        let promotedUid: string | null = null;
        if (
          wasInPlayers &&
          g.waitlist.length > 0 &&
          g.players.length < g.maxPlayers
        ) {
          promotedUid = g.waitlist[0];
          g.waitlist = g.waitlist.slice(1);
          g.players = [...g.players, promotedUid];
        }
        g.participantIds = (g.participantIds ?? []).filter(
          (id) => id !== userId,
        );
        g.updatedAt = Date.now();
        // Silent-failure guard: this sweep must REMOVE the leaving user
        // from every roster array. If they linger, the removal didn't take.
        const leaveStillIn = g.players.includes(userId)
          ? 'players'
          : g.waitlist.includes(userId)
            ? 'waitlist'
            : (g.pending ?? []).includes(userId)
              ? 'pending'
              : null;
        if (leaveStillIn) {
          logUnexpected('cancelDidNotRemoveUser', {
            gameId: g.id,
            userId,
            where: leaveStillIn,
          });
        }
        if (promotedUid) {
          notificationsService.dispatch({
            type: 'spotOpened',
            recipientId: promotedUid,
            payload: { gameId: g.id, gameTitle: g.title },
          });
        }
        if (wasInPlayers) noteAdmin(g.createdBy ?? '', g.title);
      }
      // Fan out one consolidated push per admin. Falls under the
      // existing `playerCancelled` type so the admin's pref toggle
      // covers it; the CF discriminates on payload.reason +
      // payload.gameTitles.
      if (!suppressNotifications) {
        for (const [adminId, titles] of adminTitles) {
          notificationsService.dispatch({
            type: 'playerCancelled',
            recipientId: adminId,
            payload: {
              cancellingUserId: userId,
              gameTitles: titles,
              reason: 'accountDeleted',
            },
          });
        }
      }
      return;
    }
    // Find all games the user is in via the denormalised participantIds
    // index. We filter status client-side to avoid a composite index.
    let snap;
    try {
      snap = await getDocs(
        query(col.games(), where('participantIds', 'array-contains', userId)),
      );
    } catch (err) {
      logError('leaveGame', err, { userId });
      if (__DEV__) console.warn('[leaveAll] query failed', err);
      return;
    }
    for (const gd of snap.docs) {
      const data = gd.data();
      if (data.status === 'finished' || data.status === 'cancelled') continue;
      const ref = docs.game(gd.id);
      const { db } = getFirebase();
      try {
        const result = await runTransaction(db, async (tx) => {
          const fresh = await tx.get(ref);
          if (!fresh.exists())
            return {
              promotedUid: null as string | null,
              title: '',
              createdBy: '',
              wasInPlayers: false,
            };
          const d = fresh.data();
          const wasInPlayers = (d.players ?? []).includes(userId);
          let players = (d.players ?? []).filter(
            (id: string) => id !== userId,
          );
          let waitlist = (d.waitlist ?? []).filter(
            (id: string) => id !== userId,
          );
          const pending = (d.pending ?? []).filter(
            (id: string) => id !== userId,
          );
          let promotedUid: string | null = null;
          if (
            wasInPlayers &&
            waitlist.length > 0 &&
            players.length < (d.maxPlayers ?? 15)
          ) {
            promotedUid = waitlist[0];
            waitlist = waitlist.slice(1);
            players = [...players, promotedUid];
          }
          // Rebuild from post-update arrays — see joinGameV2 / cancel
          // for the same invariant rationale.
          const participantIds = Array.from(
            new Set([...players, ...waitlist, ...pending]),
          );
          const cancellations = {
            ...((d.cancellations as Record<string, number> | undefined) ?? {}),
            [userId]: Date.now(),
          };
          // Silent-failure guard: this sweep must REMOVE the leaving user
          // from every roster array. `players/waitlist/pending` here are
          // the post-filter arrays we're about to write (the promoted user
          // is waitlist[0], never `userId`); if `userId` still appears, the
          // removal didn't take. We still commit (behaviour unchanged).
          const leaveStillIn = players.includes(userId)
            ? 'players'
            : waitlist.includes(userId)
              ? 'waitlist'
              : pending.includes(userId)
                ? 'pending'
                : null;
          if (leaveStillIn) {
            logUnexpected('cancelDidNotRemoveUser', {
              gameId: gd.id,
              userId,
              where: leaveStillIn,
            });
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tx.update(ref, {
            players,
            waitlist,
            pending,
            participantIds,
            cancellations,
            updatedAt: Date.now(),
          } as any);
          return {
            promotedUid,
            title: d.title ?? '',
            createdBy: typeof d.createdBy === 'string' ? d.createdBy : '',
            wasInPlayers,
          };
        });
        if (result.promotedUid) {
          notificationsService.dispatch({
            type: 'spotOpened',
            recipientId: result.promotedUid,
            payload: { gameId: gd.id, gameTitle: result.title },
          });
        }
        if (result.wasInPlayers) noteAdmin(result.createdBy, result.title);
      } catch (err) {
        logError('leaveGame', err, { userId });
        if (__DEV__) console.warn('[leaveAll] tx failed', gd.id, err);
      }
    }
    // One push per admin, regardless of how many games they ran
    // that the user was in.
    if (!suppressNotifications) {
      for (const [adminId, titles] of adminTitles) {
        notificationsService.dispatch({
          type: 'playerCancelled',
          recipientId: adminId,
          payload: {
            cancellingUserId: userId,
            gameTitles: titles,
            reason: 'accountDeleted',
          },
        });
      }
    }
  },

  /**
   * Phase E.2.2: Admin-only "cancel game". Flips status to 'finished'
   * (we don't have a separate 'cancelled' enum yet) and dispatches a
   * `gameCanceledOrUpdated` fan-out notification — the Cloud Function
   * resolves recipients to players + waitlist + pending of the game.
   */
  async cancelGameByAdmin(gameId: string): Promise<void> {
    clearMyGamesCache();
    // Empty/falsy gameId would explode at `docs.game('')` and is almost
    // certainly an upstream race (live match opened against an unloaded
    // game). Bail silently — the caller's optimistic UI is harmless.
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      // Stage 2: cancellation is its own status — used to be overloaded
      // onto 'finished' which made history labelling impossible.
      g.status = 'cancelled';
      g.locked = true;
      g.updatedAt = Date.now();
    } else {
      try {
        const ref = docs.game(gameId);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const status = snap.data().status;
        // Don't re-dispatch if a terminal state already landed; the
        // fan-out notification has already been written.
        if (status === 'cancelled' || status === 'finished') return;
        // updateDoc bypasses the converter; see `setLiveMatch` note.
        await updateDoc(ref, {
          status: 'cancelled',
          updatedAt: Date.now(),
        });
      } catch (err) {
        logError('cancelGameByAdmin', err, { gameId });
        if (__DEV__) {
          console.warn('[gameService] cancelGameByAdmin failed', err);
        }
        throw err;
      }
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId, // fan-out marker — CF resolves participants
      payload: {
        gameId,
        action: 'cancelled',
        editorUid: USE_MOCK_DATA
          ? ''
          : getFirebase().auth.currentUser?.uid ?? '',
      },
    });
    logEvent(AnalyticsEvent.GameFinished, { gameId, byAdmin: true });
  },

  /**
   * Admin-only: flip the per-game visibility between 'public' and
   * 'community'. Layers of validation:
   *
   *   1. Enum check — value must be one of the two allowed strings.
   *   2. Status check — game must be in 'open'. Locked / active /
   *      finished / cancelled games can't be reopened to / hidden
   *      from the public feed; the registration window is the only
   *      meaningful time to flip this.
   *   3. Authorization — the caller must be the game's createdBy or
   *      an admin of the parent group. We check client-side here AND
   *      Firestore rules re-check server-side; both layers reject
   *      non-admins so a forged client can't bypass.
   *
   * Idempotent: writing the same value is a no-op (and we still
   * bump updatedAt so cleanly track the touch in audit logs).
   */
  async setVisibility(
    gameId: string,
    visibility: 'public' | 'community',
  ): Promise<void> {
    if (!gameId) return;
    if (visibility !== 'public' && visibility !== 'community') {
      throw new Error('setVisibility: invalid visibility');
    }
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('setVisibility: game not found');
      if (g.status !== 'open' && g.status !== 'scheduled') {
        throw new Error('setVisibility: game is not editable');
      }
      g.visibility = visibility;
      g.updatedAt = Date.now();
      return;
    }
    const { auth } = getFirebase();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('setVisibility: not signed in');

    try {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) throw new Error('setVisibility: game not found');
      const game = snap.data();
      // Visibility is editable pre-live: while registration is still
      // scheduled (not yet open) OR already open. Only started/terminal
      // games are locked. Previously this rejected 'scheduled' games, so an
      // admin editing an upcoming game hit "יצירת המשחק נכשלה" (user report).
      if (game.status !== 'open' && game.status !== 'scheduled') {
        throw new Error('setVisibility: game is not editable');
      }
      // Admin = creator OR group admin. Group lookup pulls the parent
      // doc once; cheaper than doing it server-side per query.
      const isCreator = game.createdBy === uid;
      let isGroupAdmin = false;
      if (!isCreator) {
        const groupSnap = await getDoc(docs.group(game.groupId));
        if (groupSnap.exists()) {
          isGroupAdmin = (groupSnap.data().adminIds ?? []).includes(uid);
        }
      }
      if (!isCreator && !isGroupAdmin) {
        throw new Error('setVisibility: not authorised');
      }
      await updateDoc(ref, {
        visibility,
        updatedAt: Date.now(),
      });
    } catch (err) {
      logError('setVisibility', err, { gameId, visibility, uid });
      if (__DEV__) console.warn('[gameService] setVisibility failed', err);
      throw err;
    }
  },

  /**
   * Stage 2 lifecycle transition: admin freezes registration (no more
   * joins/cancels). Used between "registration open" and "evening
   * starts" — gives the organizer time to form teams without the
   * roster shifting under their feet.
   */
  async lockRegistration(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      if (g.status !== 'open') return;
      g.status = 'locked';
      g.locked = true;
      g.updatedAt = Date.now();
      return;
    }
    try {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      if (snap.data().status !== 'open') return;
      await updateDoc(ref, { status: 'locked', updatedAt: Date.now() });
    } catch (err) {
      logError('lockRegistration', err, { gameId });
      if (__DEV__) console.warn('[gameService] lockRegistration failed', err);
      throw err;
    }
  },

  /**
   * Stage 2 lifecycle transition: admin starts the evening. Flips
   * `Game.status` to 'active' AND seeds `liveMatch.phase` so the
   * live screen has a sub-state to render. Idempotent — calling on
   * an already-active game is a no-op.
   *
   * NOTE: this is the canonical "start" path going forward.
   * MatchDetailsScreen's existing `handleStartSession` calls
   * `setLiveMatch({phase:'live'})` directly for backward-compat; over
   * time, that should be migrated to call this method instead.
   */
  async startEvening(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      if (g.status === 'active' || g.status === 'finished' ||
          g.status === 'cancelled') return;
      g.status = 'active';
      g.liveMatch = {
        ...(g.liveMatch ?? { phase: 'organizing', assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0 }),
        phase: 'roundReady',
      };
      g.updatedAt = Date.now();
      return;
    }
    try {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      if (
        data.status === 'active' ||
        data.status === 'finished' ||
        data.status === 'cancelled'
      ) {
        return;
      }
      const hasLive = data.liveMatch && typeof data.liveMatch === 'object';
      if (!hasLive) {
        await updateDoc(ref, {
          status: 'active',
          liveMatch: {
            phase: 'roundReady' as const,
            assignments: {},
            benchOrder: [],
            scoreA: 0,
            scoreB: 0,
          },
          updatedAt: Date.now(),
        });
      } else {
        // Field path only — don't rewrite the whole liveMatch from a stale
        // read (would clobber a concurrent goal / timer press).
        await updateDoc(ref, {
          status: 'active',
          'liveMatch.phase': 'roundReady',
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      logError('startEvening', err, { gameId });
      if (__DEV__) console.warn('[gameService] startEvening failed', err);
      throw err;
    }
  },

  /**
   * Mark a game as "actually played" by stamping `liveMatch.startedAt`.
   * Called from the LiveMatch screen the first time the admin taps
   * the timer's play button (after the teams-valid gate passes).
   *
   * Single source of truth for "this game happened": the cleanup CF,
   * stats pipelines, trust scoring and the achievements roll-up all
   * read this field. A game whose roster registered but whose timer
   * never fired stays out of every count and is eligible for deletion
   * by `cleanupStaleGames`.
   *
   * Idempotent. A second call after pause/resume leaves `startedAt`
   * pinned to its original value and only nudges the phase if the
   * caller wants it moved.
   */
  async markGameStarted(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      if (g.status === 'finished' || g.status === 'cancelled') return;
      const prev = g.liveMatch ?? {
        phase: 'organizing' as const,
        assignments: {},
        benchOrder: [],
        scoreA: 0,
        scoreB: 0,
      };
      g.status = 'active';
      g.liveMatch = {
        ...prev,
        phase: 'roundRunning',
        startedAt: prev.startedAt ?? Date.now(),
      };
      g.updatedAt = Date.now();
      return;
    }
    try {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'finished' || data.status === 'cancelled') return;
      const hasLive =
        data.liveMatch && typeof data.liveMatch === 'object';
      if (!hasLive) {
        // First start — no concurrent timer/goals to clobber, so it's safe
        // to seed the initial liveMatch object.
        await updateDoc(ref, {
          status: 'active',
          liveMatch: {
            phase: 'roundRunning' as const,
            assignments: {},
            benchOrder: [],
            scoreA: 0,
            scoreB: 0,
            startedAt: Date.now(),
          },
          updatedAt: Date.now(),
        });
      } else {
        // liveMatch already exists — write ONLY the fields this method owns
        // via field paths. Rewriting the whole liveMatch object from this
        // stale snapshot was the clock-jump vector: a timer toggle / goal
        // that landed on another device between the read and this write got
        // reverted to the stale values.
        const prevStartedAt = (data.liveMatch as { startedAt?: number })
          .startedAt;
        await updateDoc(ref, {
          status: 'active',
          'liveMatch.phase': 'roundRunning',
          ...(prevStartedAt ? {} : { 'liveMatch.startedAt': Date.now() }),
          updatedAt: Date.now(),
        });
      }
    } catch (err) {
      logError('markGameStarted', err, { gameId });
      if (__DEV__) console.warn('[gameService] markGameStarted failed', err);
      throw err;
    }
  },

  /**
   * Start (or resume) the shared match timer. Atomic via Firestore
   * transaction so two admins pressing "play" at the exact same
   * instant can't corrupt the clock — both transactions read the
   * same prior state, the first commits, the second's pre-condition
   * fails and it retries against the new state (which is "already
   * running") and becomes a safe no-op.
   *
   * `userId` / `userName` are denormalised onto `timerControlledBy*`
   * so other devices can render "הטיימר מופעל על ידי דני".
   */
  async startTimer(
    gameId: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g || g.status === 'finished' || g.status === 'cancelled') return;
      const prev = g.liveMatch;
      if (!prev || prev.timerRunning) return;
      const isFirstStart =
        (prev.timerAccumulatedMs ?? 0) === 0 &&
        !(prev.timerEvents && prev.timerEvents.length);
      g.liveMatch = {
        ...prev,
        timerRunning: true,
        timerLastStartedAt: Date.now(),
        timerAccumulatedMs: prev.timerAccumulatedMs ?? 0,
        timerControlledBy: userId,
        timerControlledByName: userName,
        timerEvents: [
          ...(prev.timerEvents ?? []),
          { type: isFirstStart ? 'start' : 'resume', at: Date.now(), byName: userName },
        ],
      };
      g.updatedAt = Date.now();
      return;
    }
    const ref = docs.game(gameId);
    try {
      const cur = await readTimerState(gameId);
      if (!cur || !cur.liveMatch) return;
      if (cur.status === 'finished' || cur.status === 'cancelled') return;
      // Already running — second admin pressing play is a no-op.
      if (cur.liveMatch.timerRunning) return;
      // First press from 00:00 logs as 'start'; a press after a pause logs
      // as 'resume' (drives the stoppages history).
      const isFirstStart =
        (cur.liveMatch.timerAccumulatedMs ?? 0) === 0 &&
        !(cur.liveMatch.timerEvents && cur.liveMatch.timerEvents.length);
      // Field-path write: touch only the timer fields (not the whole
      // liveMatch object) so the write is small, fast to fan out, and gets
      // Firestore's local latency-compensation (the presser sees it
      // instantly). Anchor is `serverNow()` so every device's skew cancels.
      // We re-write the existing accumulator (not reset it) so resume
      // continues from the pre-pause elapsed time, and so the field is
      // never left absent for the native widget/watch readers.
      await updateDoc(ref, {
        'liveMatch.timerRunning': true,
        'liveMatch.timerLastStartedAt': serverNow(),
        'liveMatch.timerAccumulatedMs': cur.liveMatch.timerAccumulatedMs ?? 0,
        'liveMatch.timerControlledBy': userId,
        'liveMatch.timerControlledByName': userName,
        'liveMatch.timerEvents': arrayUnion({
          type: isFirstStart ? 'start' : 'resume',
          at: serverNow(),
          byName: userName,
        }),
        updatedAt: serverNow(),
      });
    } catch (err) {
      logError('startTimer', err, { gameId, userId });
      if (__DEV__) console.warn('[gameService] startTimer failed', err);
      throw err;
    }
  },

  /**
   * Pause the shared match timer. Captures elapsed-ms-since-start
   * into the running accumulator so a subsequent resume continues
   * from the right place. Idempotent: if already paused, no-op.
   */
  async pauseTimer(
    gameId: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g || g.status === 'finished' || g.status === 'cancelled') return;
      const prev = g.liveMatch;
      if (!prev || !prev.timerRunning || !prev.timerLastStartedAt) return;
      const extra = Date.now() - prev.timerLastStartedAt;
      g.liveMatch = {
        ...prev,
        timerRunning: false,
        timerLastStartedAt: null,
        timerAccumulatedMs: (prev.timerAccumulatedMs ?? 0) + Math.max(0, extra),
        timerControlledBy: userId,
        timerControlledByName: userName,
        timerEvents: [
          ...(prev.timerEvents ?? []),
          { type: 'pause', at: Date.now(), byName: userName },
        ],
        // Record the window the timer just ran — evening-level, never wiped.
        activeIntervals: [
          ...(prev.activeIntervals ?? []),
          { s: prev.timerLastStartedAt, e: Date.now() },
        ],
      };
      g.updatedAt = Date.now();
      return;
    }
    const ref = docs.game(gameId);
    try {
      const cur = await readTimerState(gameId);
      if (!cur || !cur.liveMatch) return;
      if (cur.status === 'finished' || cur.status === 'cancelled') return;
      // Already paused — second admin pressing pause is a no-op.
      if (!cur.liveMatch.timerRunning || !cur.liveMatch.timerLastStartedAt) {
        return;
      }
      // Fold the elapsed-since-start into the accumulator, measured in the
      // SHARED server-time base so the frozen value every device snaps to is
      // identical regardless of local clock skew.
      const extra = serverNow() - cur.liveMatch.timerLastStartedAt;
      await updateDoc(ref, {
        'liveMatch.timerRunning': false,
        'liveMatch.timerLastStartedAt': null,
        'liveMatch.timerAccumulatedMs':
          (cur.liveMatch.timerAccumulatedMs ?? 0) + Math.max(0, extra),
        'liveMatch.timerControlledBy': userId,
        'liveMatch.timerControlledByName': userName,
        'liveMatch.timerEvents': arrayUnion({
          type: 'pause',
          at: serverNow(),
          byName: userName,
        }),
        // Record the window the timer just ran — evening-level, never wiped
        // (scopes the Health Connect physical read to timer-active minutes).
        'liveMatch.activeIntervals': arrayUnion({
          s: cur.liveMatch.timerLastStartedAt,
          e: serverNow(),
        }),
        updatedAt: serverNow(),
      });
    } catch (err) {
      logError('pauseTimer', err, { gameId, userId });
      if (__DEV__) console.warn('[gameService] pauseTimer failed', err);
      throw err;
    }
  },

  /**
   * Full match reset — zero the clock (paused) AND wipe the live score +
   * goal log so the round genuinely starts over from 0-0 at 00:00. Admin-only,
   * irreversible (confirmed in the UI). Named `resetTimer` for history; it now
   * resets the whole live match, not just the clock.
   */
  async resetTimer(
    gameId: string,
    userId: string,
    userName: string,
  ): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g || g.status === 'finished' || g.status === 'cancelled') return;
      const prev = g.liveMatch;
      if (!prev) return;
      g.liveMatch = {
        ...prev,
        // Preserve the minutes actually played: if the clock was running, close
        // the open active-interval before zeroing so those timer-active minutes
        // still count toward the physical/health read (mirror pauseTimer).
        activeIntervals:
          prev.timerRunning && prev.timerLastStartedAt
            ? [
                ...(prev.activeIntervals ?? []),
                { s: prev.timerLastStartedAt, e: Date.now() },
              ]
            : prev.activeIntervals,
        timerRunning: false,
        timerLastStartedAt: null,
        timerAccumulatedMs: 0,
        timerControlledBy: userId,
        timerControlledByName: userName,
        timerEvents: [],
        // Clear the clock, mini-game SCORE, and round goal LOG together (badge
        // = goalTally survives). See the real-path comment below.
        scoreA: 0,
        scoreB: 0,
        goals: [],
      };
      g.updatedAt = Date.now();
      return;
    }
    const ref = docs.game(gameId);
    try {
      const cur = await readTimerState(gameId);
      if (!cur || !cur.liveMatch) return;
      if (cur.status === 'finished' || cur.status === 'cancelled') return;
      const lm = cur.liveMatch as {
        timerRunning?: boolean;
        timerLastStartedAt?: number | null;
      };
      const patch: Record<string, unknown> = {
        'liveMatch.timerRunning': false,
        'liveMatch.timerLastStartedAt': null,
        'liveMatch.timerAccumulatedMs': 0,
        'liveMatch.timerControlledBy': userId,
        'liveMatch.timerControlledByName': userName,
        'liveMatch.timerEvents': [],
        // Reset the clock + the mini-game SCORE *and* the round's goal LOG so
        // the score (now 0-0) and `goals[]` stay consistent. Keeping the log
        // while zeroing the score left phantom goals that the next round-end
        // committed to stats. The evening-long per-player BADGE survives — it
        // reads `liveMatch.goalTally`, which is NOT touched here.
        'liveMatch.scoreA': 0,
        'liveMatch.scoreB': 0,
        'liveMatch.goals': [],
        updatedAt: serverNow(),
      };
      // Preserve the minutes actually played: if the clock was running when
      // reset was tapped, close the open active-interval before zeroing so those
      // timer-active minutes still count toward the physical/health read (mirror
      // pauseTimer/endEvening). Without this, resetting mid-round silently drops
      // the played window from liveMatch.activeIntervals.
      if (lm.timerRunning && lm.timerLastStartedAt) {
        patch['liveMatch.activeIntervals'] = arrayUnion({
          s: lm.timerLastStartedAt,
          e: serverNow(),
        });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateDoc(ref, patch as any);
    } catch (err) {
      logError('resetTimer', err, { gameId, userId });
      if (__DEV__) console.warn('[gameService] resetTimer failed', err);
      throw err;
    }
  },

  /**
   * Stage 2 lifecycle transition: admin ends the evening. Flips
   * `Game.status` to 'finished' AND `liveMatch.phase` to 'finished'
   * so consumers that key off either field agree. Read-only after
   * this; the game now belongs to history.
   */
  async endEvening(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      if (g.status === 'finished' || g.status === 'cancelled') return;
      g.status = 'finished';
      g.locked = true;
      g.endedAt = Date.now();
      if (g.liveMatch) {
        const openSeg =
          g.liveMatch.timerRunning && g.liveMatch.timerLastStartedAt
            ? [{ s: g.liveMatch.timerLastStartedAt, e: Date.now() }]
            : [];
        g.liveMatch = {
          ...g.liveMatch,
          phase: 'finished',
          timerRunning: false,
          timerLastStartedAt: null,
          activeIntervals: [...(g.liveMatch.activeIntervals ?? []), ...openSeg],
        };
      }
      g.updatedAt = Date.now();
      return;
    }
    try {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.status === 'finished' || data.status === 'cancelled') return;
      // If the admin ends the evening WITHOUT first ending the running round,
      // that round's goals/assists were never aggregated (they only live on
      // liveMatch.goals, which we're about to freeze). Commit them now so the
      // last round's scorers/assisters count. `data` is the RAW doc, so its
      // goals still carry assisterId. Idempotent via the committedRounds latch.
      const lm = data.liveMatch as import('@/types').LiveMatchState | undefined;
      const rot = data.rotation as import('@/types').MatchRotation | undefined;
      const draft = data.draftTeams as DraftTeamsResult | undefined;
      // Did the final round's stats commit succeed? If it FAILED (offline blip
      // at night's end), we must NOT wipe the goal log below — otherwise the
      // last round's goals/assists/wins are lost forever. Preserve them so a
      // later retry (the committedRounds latch dedupes) can still aggregate.
      let finalRoundCommitted = true;
      if (lm && rot && draft && (lm.goals?.length ?? 0) > 0) {
        const winnerSide: 'A' | 'B' | null =
          (lm.scoreA ?? 0) > (lm.scoreB ?? 0)
            ? 'A'
            : (lm.scoreB ?? 0) > (lm.scoreA ?? 0)
              ? 'B'
              : null;
        try {
          await this._commitRoundStatsAndClear(gameId, lm, rot, draft, winnerSide);
        } catch (err) {
          finalRoundCommitted = false;
          logError('endEvening.commitFinalRound', err, { gameId });
        }
      }
      const updates: Record<string, unknown> = {
        status: 'finished',
        // The real end epoch — bounds the physical-data read window.
        endedAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (data.liveMatch) {
        // Field paths only — never rewrite the whole liveMatch from a stale
        // read (a last-second goal/timer press between the read above and
        // this write would be lost).
        updates['liveMatch.phase'] = 'finished';
        // If the evening ended with the timer still RUNNING, close that final
        // active window so the whole played time is recorded (evening-level,
        // survives the goals/score freeze below), AND stop the timer — otherwise
        // the frozen doc keeps timerRunning=true and physicalSyncService would
        // push the same final window AGAIN (double-count + uncapped next-morning
        // read).
        if (lm?.timerRunning && lm.timerLastStartedAt) {
          updates['liveMatch.activeIntervals'] = arrayUnion({
            s: lm.timerLastStartedAt,
            e: serverNow(),
          });
          updates['liveMatch.timerRunning'] = false;
          updates['liveMatch.timerLastStartedAt'] = null;
        }
        if (finalRoundCommitted) {
          // Commit succeeded (it already zeroed goals/score) → freeze empty.
          updates['liveMatch.goals'] = [];
          updates['liveMatch.scoreA'] = 0;
          updates['liveMatch.scoreB'] = 0;
        }
        // Commit FAILED → keep the goal log/score so nothing is lost; only
        // the phase flip above applies.
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await updateDoc(ref, updates as any);
    } catch (err) {
      logError('endEvening', err, { gameId });
      if (__DEV__) console.warn('[gameService] endEvening failed', err);
      throw err;
    }
    logEvent(AnalyticsEvent.GameFinished, { gameId, byAdmin: true });
  },

  // ── Phase 5: arrival status (foundation for GPS-based detection) ──────

  /**
   * Write a per-player arrival status to /games/{id}.arrivals[uid].
   * Idempotent: when the new status matches the existing one we skip
   * the write and the discipline trigger.
   *
   * Side effects on transition:
   *   prev → 'late'    : disciplineService.reportLate (yellow / red by lateness)
   *   prev → 'no_show' : red card with reason='no_show'
   *
   * Both side effects fire only when the status actually changes, so
   * repeated taps / GPS pings never double-issue.
   */
  async setArrival(
    gameId: string,
    userId: UserId,
    status: ArrivalStatus,
  ): Promise<{ changed: boolean }> {
    if (!gameId || !userId) return { changed: false };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return { changed: false };
      const prev = (g.arrivals ?? {})[userId] ?? 'unknown';
      if (prev === status) return { changed: false };
      g.arrivals = { ...(g.arrivals ?? {}), [userId]: status };
      g.updatedAt = Date.now();
      await fireDisciplineForArrival(userId, gameId, g.startsAt, status);
      logEvent(AnalyticsEvent.ArrivalMarked, { gameId, status });
      return { changed: true };
    }

    const ref = docs.game(gameId);
    let data;
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) return { changed: false };
      data = snap.data();
      const prev = (data.arrivals ?? {})[userId] ?? 'unknown';
      if (prev === status) return { changed: false };
      // Field-path write — touch ONLY this player's arrivals key. Rewriting
      // the whole `arrivals` map from a stale getDoc dropped a concurrent
      // arrival (two admins marking different players at once) and could
      // revive a player removed between the read and the write.
      await updateDoc(ref, {
        [`arrivals.${userId}`]: status,
        updatedAt: Date.now(),
      });
    } catch (err) {
      logError('setArrival', err, { gameId, userId, status });
      if (__DEV__) console.warn('[gameService] setArrival failed', err);
      throw err;
    }
    await fireDisciplineForArrival(userId, gameId, data.startsAt, status);
    logEvent(AnalyticsEvent.ArrivalMarked, { gameId, status });
    return { changed: true };
  },

  // ── Phase D.1: live-match persistence + realtime sync ─────────────────

  /**
   * Merge-write to `/games/{id}.liveMatch`. Mock mode mutates an
   * in-memory game and notifies any subscribers; Firebase mode writes
   * via `setDoc(merge=true)` and lets the snapshot listener echo it
   * back to subscribers.
   */
  async setLiveMatch(
    gameId: string,
    next: LiveMatchState,
    opts: { markTeamsEditedManually?: boolean } = {},
  ): Promise<void> {
    // Firestore rejects `undefined` field values, so strip them
    // before writing. Optional fields (scoreC/D/E, per-team orders,
    // updatedAt) can legitimately be missing on legacy state, and
    // round-tripping a freshly-read state through `setLiveMatch`
    // would otherwise blow up with "Unsupported field value: undefined".
    const stamped = stripUndefined({
      ...next,
      updatedAt: Date.now(),
    }) as LiveMatchState;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      g.liveMatch = stamped;
      if (opts.markTeamsEditedManually) g.teamsEditedManually = true;
      g.updatedAt = Date.now();
      mockLiveSubscribers.get(gameId)?.forEach((cb) => cb(stamped));
      return;
    }
    // updateDoc bypasses the typed converter — required because our
    // `gameConverter.toFirestore` only implements the full-object
    // overload. With `setDoc(merge:true)` the partial would still flow
    // through the converter, which would emit `undefined` for every
    // required Game field that's absent from the patch and Firestore
    // would reject the write with "Function setDoc() called with
    // invalid data: Unsupported field value: undefined".
    const patch: Record<string, unknown> = {
      liveMatch: stamped,
      updatedAt: Date.now(),
    };
    // Only flip the flag when the caller asked us to. The scheduled
    // auto-balance Cloud Function will write `liveMatch` directly
    // (with admin SDK) and explicitly NOT pass this flag, so it
    // never marks the game as manually edited.
    if (opts.markTeamsEditedManually) patch.teamsEditedManually = true;
    await updateGameDoc(gameId, patch);
  },

  /**
   * Subscribe to live-match changes. Returns an unsub function — call it
   * on cleanup to detach. Mock mode synthesizes the realtime channel via
   * an in-memory pub/sub so a single device still gets the same callback
   * shape during dev.
   */
  subscribeLiveMatch(
    gameId: string,
    cb: (state: LiveMatchState | null) => void
  ): () => void {
    if (USE_MOCK_DATA) {
      const list = mockLiveSubscribers.get(gameId) ?? new Set();
      list.add(cb);
      mockLiveSubscribers.set(gameId, list);
      // Fire current state immediately (mirrors Firestore's first-snapshot behaviour).
      const g = mockGamesV2.find((x) => x.id === gameId);
      cb(g?.liveMatch ?? null);
      // Poll for changes too — most mock mutations bump game.updatedAt but only
      // two call the registry, so without polling the UI froze after timer/
      // goal writes (mirrors onSnapshot's continuous delivery).
      let lastStamp = g?.updatedAt ?? 0;
      const iv = setInterval(() => {
        const cur = mockGamesV2.find((x) => x.id === gameId);
        const stamp = cur?.updatedAt ?? 0;
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          cb(cur?.liveMatch ?? null);
        }
      }, 800);
      return () => {
        clearInterval(iv);
        list.delete(cb);
      };
    }
    const ref = docs.game(gameId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return cb(null);
        cb(snap.data().liveMatch ?? null);
      },
      (err) => {
        logError('subscribeLiveMatch', err, { gameId });
        if (__DEV__) console.warn('[gameService] subscribeLiveMatch error', err);
      }
    );
    return unsub;
  },

  /** Live subscription to a game's rotation + drafted teams (both Game
   *  top-level fields) so the live-rotation panel updates on every device. */
  subscribeRotation(
    gameId: string,
    cb: (data: { rotation?: import('@/types').MatchRotation; draftTeams?: DraftTeamsResult }) => void,
  ): () => void {
    if (USE_MOCK_DATA) {
      // Fire now + poll (updatedAt) — see subscribeLiveGame's mock path.
      const fire = () => {
        const g = mockGamesV2.find((x) => x.id === gameId);
        cb({ rotation: g?.rotation, draftTeams: g?.draftTeams });
      };
      fire();
      let lastStamp = mockGamesV2.find((x) => x.id === gameId)?.updatedAt ?? 0;
      const iv = setInterval(() => {
        const stamp = mockGamesV2.find((x) => x.id === gameId)?.updatedAt ?? 0;
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          fire();
        }
      }, 800);
      return () => clearInterval(iv);
    }
    const ref = docs.game(gameId);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return cb({});
        const g = snap.data();
        cb({ rotation: g.rotation, draftTeams: g.draftTeams });
      },
      (err) => {
        logError('subscribeRotation', err, { gameId });
        if (__DEV__) console.warn('[gameService] subscribeRotation error', err);
      },
    );
  },

  /**
   * Combined live subscription: liveMatch + rotation + draftTeams from ONE
   * game-doc listener. The advanced live screen needs all three; using a
   * single onSnapshot (instead of subscribeLiveMatch + subscribeRotation on
   * the same doc) halves the reads — every game write (e.g. a timer press)
   * used to bill TWO reads per device, now one.
   */
  subscribeLiveGame(
    gameId: string,
    cb: (data: {
      liveMatch: LiveMatchState | null;
      rotation?: import('@/types').MatchRotation;
      draftTeams?: DraftTeamsResult;
    }) => void,
  ): () => void {
    if (USE_MOCK_DATA) {
      // Mirror onSnapshot in mock: fire now + poll for changes (updatedAt) so
      // the live screen actually re-renders after timer/goal/team mutations.
      // Without this, mock QA showed a frozen 00:00 timer after a successful
      // start — the mutation landed but the one-shot callback never re-fired.
      const fire = () => {
        const g = mockGamesV2.find((x) => x.id === gameId);
        cb({ liveMatch: g?.liveMatch ?? null, rotation: g?.rotation, draftTeams: g?.draftTeams });
      };
      fire();
      let lastStamp = mockGamesV2.find((x) => x.id === gameId)?.updatedAt ?? 0;
      const iv = setInterval(() => {
        const stamp = mockGamesV2.find((x) => x.id === gameId)?.updatedAt ?? 0;
        if (stamp !== lastStamp) {
          lastStamp = stamp;
          fire();
        }
      }, 800);
      return () => clearInterval(iv);
    }
    const ref = docs.game(gameId);
    return onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) return cb({ liveMatch: null });
        const g = snap.data();
        cb({ liveMatch: g.liveMatch ?? null, rotation: g.rotation, draftTeams: g.draftTeams });
      },
      (err) => {
        logError('subscribeLiveGame', err, { gameId });
        if (__DEV__) console.warn('[gameService] subscribeLiveGame error', err);
      },
    );
  },

  // ── Guests ──────────────────────────────────────────────────────────────
  // Coach/admin-only mutations. Guests live in the game doc, count toward
  // capacity, and participate in auto-balance with `guest:<id>` ids.

  /**
   * Add a guest to the game. Caller must be the organizer (createdBy)
   * or a community admin (group.adminIds). Throws on:
   *   - missing/blank/over-long name
   *   - rating outside [1,5]
   *   - capacity exceeded (players + guests >= maxPlayers)
   *   - permission denied (also enforced by Firestore rules)
   */
  async addGuest(
    gameId: string,
    callerId: UserId,
    input: { name: string; estimatedRating?: number },
  ): Promise<GameGuest> {
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('addGuest: name is required');
    if (name.length > 20) throw new Error('addGuest: name too long (>20)');
    const rating = input.estimatedRating;
    if (
      rating !== undefined &&
      (typeof rating !== 'number' ||
        !Number.isFinite(rating) ||
        rating <= 0 ||
        rating > 5)
    ) {
      throw new Error('addGuest: estimatedRating must be within (0, 5]');
    }
    // Firestore rejects writes that include `undefined` values
    // (`Unsupported field value`). Build the guest object WITHOUT
    // `estimatedRating` when the caller didn't supply one — including
    // the key with `undefined` would crash the addDoc/update below
    // even though the field is optional in the type.
    const guest: GameGuest = {
      id: genGuestId(),
      name,
      addedBy: callerId,
      createdAt: Date.now(),
      ...(rating !== undefined ? { estimatedRating: rating } : {}),
    };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('addGuest: game not found');
      await assertCanAddGuest(g, callerId);
      // Full game → queue the guest on the waitlist instead of refusing. Count
      // a held promotion offer as an occupied seat (like every other admission
      // path) so a guest can't steal a seat reserved for the offered waitlister.
      const occupancy =
        g.players.length + activeGuestCount(g.guests) + (g.pendingPromotion?.uid ? 1 : 0);
      const wlGuest = occupancy >= g.maxPlayers ? { ...guest, waitlisted: true } : guest;
      g.guests = [...(g.guests ?? []), wlGuest];
      g.updatedAt = Date.now();
      logEvent(AnalyticsEvent.GuestAdded, {
        gameId,
        hasRating: rating !== undefined,
        waitlisted: !!wlGuest.waitlisted,
      });
      return wlGuest;
    }

    // Permission check is done OUTSIDE the transaction (it reads the
    // /groups doc, which Firestore txns can't include in their
    // read-write set without inflating contention). The capacity check
    // + guest write happen INSIDE the txn so an admin can't overflow
    // capacity by racing concurrent guest additions or user joins.
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    let savedGuest: GameGuest = guest;
    try {
      const snapForPerm = await getDoc(ref);
      if (!snapForPerm.exists()) throw new Error('addGuest: game not found');
      const permData = snapForPerm.data();
      await assertCanAddGuest(
        {
          createdBy: permData.createdBy,
          groupId: permData.groupId,
          players: permData.players,
          guestsOpenAt: permData.guestsOpenAt,
        },
        callerId,
      );

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('addGuest: game not found');
        const data = snap.data();
        // Lifecycle guard mirrors firestore.rules: no guest mutations on
        // a game that's already finished/locked.
        if (data.status !== 'open') throw new Error('GAME_NOT_OPEN');
        const playersLen = (data.players ?? []).length;
        const guestsLen = activeGuestCount(data.guests);
        // A held promotion offer reserves a seat — count it so a guest can't
        // steal the seat and push the roster past maxPlayers when the offered
        // waitlister later confirms (matches joinGameV2 / adminAddPlayers).
        const offerReservation = (data.pendingPromotion as { uid?: string } | undefined)?.uid ? 1 : 0;
        // Full game → add the guest as waitlisted (queued) rather than
        // refusing. Waitlisted guests don't occupy an active slot.
        const full = playersLen + guestsLen + offerReservation >= (data.maxPlayers ?? 15);
        savedGuest = full ? { ...guest, waitlisted: true } : guest;
        tx.update(ref, {
          guests: [...(data.guests ?? []), savedGuest],
          updatedAt: Date.now(),
        });
      });
    } catch (err) {
      logError('addGuest', err, { gameId, callerId, name });
      if (__DEV__) console.warn('[gameService] addGuest failed', err);
      throw err;
    }
    logEvent(AnalyticsEvent.GuestAdded, {
      gameId,
      hasRating: rating !== undefined,
      waitlisted: !!savedGuest.waitlisted,
    });
    return savedGuest;
  },

  /**
   * Update an existing guest. Same permission rules as addGuest.
   * Only `name` and `estimatedRating` are editable; other fields
   * (id, addedBy, createdAt) are immutable.
   */
  async updateGuest(
    gameId: string,
    callerId: UserId,
    guestId: string,
    patch: { name?: string },
  ): Promise<GameGuest> {
    const apply = (g: GameGuest): GameGuest => {
      const nextName =
        patch.name !== undefined ? patch.name.trim() : g.name;
      if (!nextName) throw new Error('updateGuest: name is required');
      if (nextName.length > 20) {
        throw new Error('updateGuest: name too long (>20)');
      }
      // The estimatedRating is intentionally NOT mutated here. A guest's
      // rating belongs to the player who ADDED them and can only be changed
      // via `setGuestRating` (adder-only). The admin/creator who reaches
      // updateGuest manages the roster (rename / remove) but must never be
      // able to overwrite the rating — they don't know the guest.
      return { ...g, name: nextName };
    };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('updateGuest: game not found');
      await assertGuestPermission(g.createdBy, g.groupId, callerId);
      const idx = (g.guests ?? []).findIndex((x) => x.id === guestId);
      if (idx < 0) throw new Error('updateGuest: guest not found');
      const updated = apply(g.guests![idx]);
      g.guests = [
        ...g.guests!.slice(0, idx),
        updated,
        ...g.guests!.slice(idx + 1),
      ];
      g.updatedAt = Date.now();
      return updated;
    }

    const ref = docs.game(gameId);
    const { db } = getFirebase();
    try {
      const snapForPerm = await getDoc(ref);
      if (!snapForPerm.exists()) throw new Error('updateGuest: game not found');
      const permData = snapForPerm.data();
      await assertGuestPermission(
        permData.createdBy,
        permData.groupId,
        callerId,
      );

      return await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('updateGuest: game not found');
        const data = snap.data();
        const guests = data.guests ?? [];
        const idx = guests.findIndex((x) => x.id === guestId);
        if (idx < 0) throw new Error('updateGuest: guest not found');
        const updated = apply(guests[idx]);
        const next = [
          ...guests.slice(0, idx),
          updated,
          ...guests.slice(idx + 1),
        ];
        tx.update(ref, {
          guests: next,
          updatedAt: Date.now(),
        });
        return updated;
      });
    } catch (err) {
      logError('updateGuest', err, { gameId, callerId, guestId });
      if (__DEV__) console.warn('[gameService] updateGuest failed', err);
      throw err;
    }
  },

  /**
   * Set (or clear, with `null`) a guest's estimatedRating. Enforced
   * adder-only: ONLY the player whose uid is the guest's `addedBy` may
   * change it — not the admin. Goes through the `setGuestRating` callable
   * (Firestore rules can't gate per-element ownership inside the `guests`
   * array). Resolves when the write commits; the caller rebuilds the
   * updated guest object locally for its optimistic splice.
   */
  async setGuestRating(
    gameId: string,
    callerId: UserId,
    guestId: string,
    rating: number | null,
  ): Promise<void> {
    if (
      rating !== null &&
      (typeof rating !== 'number' ||
        !Number.isFinite(rating) ||
        rating <= 0 ||
        rating > 5)
    ) {
      throw new Error('setGuestRating: rating must be within (0, 5] or null');
    }

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('setGuestRating: game not found');
      const idx = (g.guests ?? []).findIndex((x) => x.id === guestId);
      if (idx < 0) throw new Error('setGuestRating: guest not found');
      const guest = g.guests![idx];
      // Mirror the server's adder-only gate in mock mode.
      if (guest.addedBy !== callerId) throw new Error('PERMISSION_DENIED');
      const { estimatedRating: _drop, ...rest } = guest;
      const updated: GameGuest =
        rating === null
          ? { ...rest }
          : { ...rest, estimatedRating: Math.round(rating * 10) / 10 };
      g.guests = [
        ...g.guests!.slice(0, idx),
        updated,
        ...g.guests!.slice(idx + 1),
      ];
      g.updatedAt = Date.now();
      return;
    }

    try {
      const { httpsCallable } = require('firebase/functions');
      await httpsCallable(
        getFirebase().functions,
        'setGuestRating',
      )({ gameId, guestId, rating });
    } catch (err) {
      logError('setGuestRating', err, { gameId, callerId, guestId });
      if (__DEV__) console.warn('[gameService] setGuestRating failed', err);
      throw err;
    }
  },

  /**
   * Remove a guest. Also strips `guest:<id>` from any team assignments
   * already saved to liveMatch (assignments + benchOrder), so the
   * coach doesn't end up with a phantom slot. Same permission rules.
   */
  async removeGuest(
    gameId: string,
    callerId: UserId,
    guestId: string,
  ): Promise<void> {
    const rosterId = toGuestRosterId(guestId);

    const stripFromLive = (
      live: LiveMatchState | undefined,
    ): LiveMatchState | undefined => {
      if (!live) return live;
      if (
        !live.assignments?.[rosterId] &&
        !(live.benchOrder ?? []).includes(rosterId)
      ) {
        return live;
      }
      const { [rosterId]: _gone, ...rest } = live.assignments ?? {};
      void _gone;
      return {
        ...live,
        assignments: rest,
        benchOrder: (live.benchOrder ?? []).filter((id) => id !== rosterId),
      };
    };

    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      await assertGuestPermission(g.createdBy, g.groupId, callerId);
      g.guests = (g.guests ?? []).filter((x) => x.id !== guestId);
      g.liveMatch = stripFromLive(g.liveMatch);
      g.updatedAt = Date.now();
      mockLiveSubscribers.get(gameId)?.forEach((cb) => cb(g.liveMatch ?? null));
      logEvent(AnalyticsEvent.GuestRemoved, { gameId });
      return;
    }

    const ref = docs.game(gameId);
    const { db } = getFirebase();
    try {
      const snapForPerm = await getDoc(ref);
      if (!snapForPerm.exists()) return;
      const permData = snapForPerm.data();
      await assertGuestPermission(
        permData.createdBy,
        permData.groupId,
        callerId,
      );

      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const nextGuests = (data.guests ?? []).filter((x) => x.id !== guestId);
        const nextLive = stripFromLive(data.liveMatch);
        tx.update(ref, {
          guests: nextGuests,
          ...(nextLive ? { liveMatch: nextLive } : {}),
          updatedAt: Date.now(),
        });
      });
    } catch (err) {
      logError('removeGuest', err, { gameId, callerId, guestId });
      if (__DEV__) console.warn('[gameService] removeGuest failed', err);
      throw err;
    }
    logEvent(AnalyticsEvent.GuestRemoved, { gameId });
  },

  /**
   * Admin: rewrite the guests array to a new ORDER and/or waitlisted flags —
   * used to reorder waitlisted guests and to promote a waitlisted guest into the
   * active roster ("להרכב"). Reorder-only: the incoming set MUST hold exactly the
   * same guest ids (no add/remove — that's addGuest/removeGuest). Admin-gated.
   */
  async adminReorderGuests(
    gameId: string,
    callerId: UserId,
    nextGuests: GameGuest[],
  ): Promise<void> {
    const sameSet = (a: GameGuest[], b: GameGuest[]): boolean => {
      if (a.length !== b.length) return false;
      const ida = new Set(a.map((g) => g.id));
      return b.every((g) => ida.has(g.id));
    };
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      await assertGuestPermission(g.createdBy, g.groupId, callerId);
      if (!sameSet(g.guests ?? [], nextGuests)) {
        throw new Error('adminReorderGuests: guest set changed');
      }
      g.guests = nextGuests;
      g.updatedAt = Date.now();
      return;
    }
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    try {
      const snapForPerm = await getDoc(ref);
      if (!snapForPerm.exists()) return;
      const permData = snapForPerm.data();
      await assertGuestPermission(permData.createdBy, permData.groupId, callerId);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const current = (data.guests ?? []) as GameGuest[];
        // Same-set guard — reject if a stale client tries to add/remove here.
        if (!sameSet(current, nextGuests)) {
          throw new Error('GUEST_SET_CHANGED');
        }
        // Capacity guard for any newly-active (promoted) guest.
        const activeGuests = nextGuests.filter((x) => !x.waitlisted).length;
        const players = (data.players ?? []).length;
        const maxPlayers = (data.maxPlayers as number) ?? 15;
        if (players + activeGuests > maxPlayers) {
          throw new Error('GAME_FULL');
        }
        tx.update(ref, { guests: nextGuests, updatedAt: Date.now() });
      });
    } catch (err) {
      logError('adminReorderGuests', err, { gameId, callerId });
      if (__DEV__) console.warn('[gameService] adminReorderGuests failed', err);
      throw err;
    }
  },
};

/**
 * Permission gate for guest mutations. Caller is allowed if they're the
 * game organizer (createdBy) OR an admin of the parent community.
 * Mirrors the Firestore rule on /games/{id}.update — duplicated here so
 * we can fail fast with a clear error before the network round-trip.
 */
/**
 * ADD-guest permission. Looser than {@link assertGuestPermission}: besides the
 * creator and group admins, a registered participant may add a guest UNLESS the
 * game restricts it until a set time (`guestsOpenAt`). When `guestsOpenAt` is
 * unset/0 there's no restriction — any participant can always add. This mirrors
 * `canAddGuest` (client gate) and the firestore.rules self-add-guest branch.
 */
async function assertCanAddGuest(
  game: {
    createdBy?: string | null;
    groupId?: string | null;
    players?: string[];
    guestsOpenAt?: number | null;
  },
  callerId: string,
): Promise<void> {
  if (game.createdBy && callerId === game.createdBy) return;
  if (game.groupId) {
    if (USE_MOCK_DATA) {
      const { groupService } = await import('./groupService');
      const g = await groupService.get(game.groupId);
      if (g && g.adminIds.includes(callerId)) return;
    } else {
      const groupSnap = await getDoc(docs.group(game.groupId));
      if (
        groupSnap.exists() &&
        ((groupSnap.data().adminIds as string[] | undefined) ?? []).includes(
          callerId,
        )
      ) {
        return;
      }
    }
  }
  // Registered participant + guests open (no restriction, or time passed).
  const openAt = game.guestsOpenAt ?? 0;
  if ((game.players ?? []).includes(callerId) && Date.now() >= openAt) return;
  throw new Error('PERMISSION_DENIED');
}

async function assertGuestPermission(
  createdBy: string | null | undefined,
  groupId: string | null | undefined,
  callerId: string,
): Promise<void> {
  if (createdBy && callerId === createdBy) return;
  if (!groupId) {
    throw new Error('PERMISSION_DENIED');
  }
  if (USE_MOCK_DATA) {
    const { groupService } = await import('./groupService');
    const g = await groupService.get(groupId);
    if (g && g.adminIds.includes(callerId)) return;
    throw new Error('PERMISSION_DENIED');
  }
  const groupSnap = await getDoc(docs.group(groupId));
  if (!groupSnap.exists()) throw new Error('PERMISSION_DENIED');
  const grp = groupSnap.data();
  if ((grp.adminIds ?? []).includes(callerId)) return;
  throw new Error('PERMISSION_DENIED');
}

function genGuestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Resolve a roster id (uid OR `guest:<id>`) to a display-friendly object.
 * Used by every renderer that mixes real users and guests in the same
 * list: TeamCard, FieldView (live match), the registered list, etc.
 */
export function resolveRosterEntry(
  rosterId: string,
  game: Pick<Game, 'guests'> | null | undefined,
):
  | { kind: 'guest'; guest: GameGuest; rosterId: string }
  | { kind: 'user'; userId: string; rosterId: string } {
  if (isGuestId(rosterId)) {
    const guestId = rosterId.slice(GUEST_ID_PREFIX.length);
    const guest = game?.guests?.find((g) => g.id === guestId);
    if (guest) return { kind: 'guest', guest, rosterId };
    // Unknown guest id (e.g., removed mid-session) — degrade to a
    // synthetic placeholder so the UI doesn't crash.
    return {
      kind: 'guest',
      guest: {
        id: guestId,
        name: '—',
        addedBy: '',
        createdAt: 0,
      },
      rosterId,
    };
  }
  return { kind: 'user', userId: rosterId, rosterId };
}

// In-memory pub/sub used by mock mode so subscribeLiveMatch has the
// same shape (callback-based) regardless of mode.
const mockLiveSubscribers: Map<
  string,
  Set<(state: LiveMatchState | null) => void>
> = new Map();

export function __resetGameServiceForTests() {
  activeGame = null;
}

// ─── Helpers used by gameStore ────────────────────────────────────────────

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function nextThursdayAt(hour: number, minute: number): number {
  const d = new Date();
  const day = d.getDay();
  const delta = (4 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

/**
 * Map an arrival-status transition to a discipline action. Called after
 * any successful change in `setArrival`. 'arrived' and 'unknown'
 * intentionally produce no card.
 */
async function fireDisciplineForArrival(
  userId: UserId,
  gameId: string,
  startsAt: number | undefined,
  status: ArrivalStatus,
): Promise<void> {
  if (status === 'late') {
    if (typeof startsAt !== 'number') return;
    await disciplineService.reportLate({
      userId,
      gameId,
      gameStartsAt: startsAt,
    });
    return;
  }
  if (status === 'no_show') {
    await disciplineService.issueCard({
      userId,
      type: 'red',
      reason: 'no_show',
      gameId,
    });
  }
}
