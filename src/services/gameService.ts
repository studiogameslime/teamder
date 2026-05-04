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
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ArrivalStatus,
  Game,
  GameFormat,
  GameGuest,
  GameSummary,
  GroupId,
  GUEST_ID_PREFIX,
  isGuestId,
  LiveMatchState,
  MatchRound,
  Player,
  Team,
  TeamColor,
  toGuestRosterId,
  UserId,
} from '@/types';
import { mockGame, mockGamesV2, mockPlayers } from '@/data/mockData';
import { mockHistory } from '@/data/mockUsers';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { isStaleAfterStart } from '@/services/gameLifecycle';
import { col, docs, GameDoc } from '@/firebase/firestore';
import { stripUndefined } from '@/utils/stripUndefined';
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
 * Defensive cap on the number of "games this user is participating
 * in" docs we'll fetch when checking conflicts. A typical user has
 * a handful of active games at most; this limit only kicks in for
 * pathological histories and prevents a runaway scan.
 */
const CONFLICT_QUERY_LIMIT = 50;

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
async function updateGameDoc(
  gameId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(docs.game(gameId), stripUndefined(patch) as any);
}

function ensureMockGame(): Game {
  if (!activeGame) activeGame = JSON.parse(JSON.stringify(mockGame)) as Game;
  return activeGame;
}

function gameDocFromGame(g: Game): GameDoc {
  const { matches, ...rest } = g;
  return rest;
}

async function loadRoundsFor(gameId: string): Promise<MatchRound[]> {
  const q = query(
    col.rounds(),
    where('gameId', '==', gameId),
    orderBy('index', 'asc')
  );
  const snap = await getDocs(q);
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
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docData = snap.docs
      .map((d) => d.data())
      .find((g) => !isStaleAfterStart({ ...g, matches: [] } as Game));
    if (!docData) return null;
    const matches = await loadRoundsFor(docData.id);
    return { ...docData, matches };
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
    const data = fresh.data()!;
    return { ...data, matches: [] };
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
   *     was assigned to ANY team (mirrors the discipline / achievement
   *     definition: "actually showed up").
   *   • wins — match rounds across those games where the user's team
   *     was the winner (rounds with `winner === 'tie'` are excluded).
   *
   * Bounded by `getHistory`'s recent window (20 most recent terminal
   * games), so the read cost is `~20 game docs + 20 round subqueries`
   * regardless of how many users we score.
   *
   * Mock-mode returns zeros — there's no rounds backing in mock data.
   */
  async getCommunityPlayerStats(
    groupId: GroupId,
    userIds: UserId[],
  ): Promise<Record<UserId, { gamesPlayed: number; wins: number }>> {
    const acc: Record<UserId, { gamesPlayed: number; wins: number }> = {};
    for (const uid of userIds) acc[uid] = { gamesPlayed: 0, wins: 0 };
    if (USE_MOCK_DATA || userIds.length === 0) return acc;

    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', '==', 'finished'),
      orderBy('startsAt', 'desc'),
      limit(20),
    );
    const snap = await getDocs(q);
    // Sequential fetch of rounds — Firestore SDK throttles parallel
    // subqueries anyway, and history rarely exceeds 20 games per
    // community. If this becomes hot we can promise-all chunks of 5.
    for (const doc of snap.docs) {
      const g = doc.data();
      const teams = g.teams ?? [];
      if (teams.length === 0) continue;
      // Per-uid: which team color was this user on (if any)?
      const colorByUid: Record<UserId, string> = {};
      for (const t of teams) {
        for (const pid of t.playerIds ?? []) {
          colorByUid[pid] = t.color;
        }
      }
      // Count gamesPlayed once per uid that appears in any team.
      const requestedSet = new Set(userIds);
      for (const uid of Object.keys(colorByUid)) {
        if (!requestedSet.has(uid)) continue;
        acc[uid].gamesPlayed += 1;
      }
      // Tally wins from this game's rounds.
      const rounds = await loadRoundsFor(g.id);
      for (const r of rounds) {
        if (!r.winner || r.winner === 'tie') continue;
        for (const uid of Object.keys(colorByUid)) {
          if (!requestedSet.has(uid)) continue;
          if (colorByUid[uid] === r.winner) acc[uid].wins += 1;
        }
      }
    }
    return acc;
  },

  async getHistory(groupId: GroupId): Promise<GameSummary[]> {
    if (USE_MOCK_DATA) return mockHistory;

    // Stage 2 lifecycle: history = terminal evenings only. 'locked' is
    // a mid-flow state (registration frozen, game not started) and
    // does NOT belong here — the previous filter accidentally surfaced
    // unfinished games as "history".
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['finished', 'cancelled']),
      orderBy('startsAt', 'desc'),
      limit(20)
    );
    const snap = await getDocs(q);
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
          lastResult:
            last && last.winner
              ? { teamA: last.teamA, teamB: last.teamB, winner: last.winner }
              : undefined,
        };
      })
    );
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
      });
    });

    await batch.commit();
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
    // Firebase: single-field array-contains against the denormalized
    // union. Status filter + sort run client-side so the query needs
    // ONLY the auto-index on `participantIds` — no composite index.
    // Trade-off: pulls finished/locked games too (bounded by games-per-user).
    const snap = await getDocs(
      query(col.games(), where('participantIds', 'array-contains', userId)),
    );
    return snap.docs
      .map((d) => ({ ...d.data(), matches: [] }))
      .filter((g) => g.status === 'open')
      .filter((g) => !isStaleAfterStart(g))
      .sort((a, b) => a.startsAt - b.startsAt);
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
    // operator. Status filter + sort run client-side so we don't need
    // a composite index — the per-field auto-index on `groupId` is
    // enough for `where('groupId', 'in', chunk)`.
    const chunks: string[][] = [];
    for (let i = 0; i < communityIds.length; i += 30) {
      chunks.push(communityIds.slice(i, i + 30));
    }
    const snaps = await Promise.all(
      chunks.map((c) =>
        getDocs(query(col.games(), where('groupId', 'in', c))),
      ),
    );
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
    // Firebase: equality query on the canonical visibility field
    // (auto-indexed). status / startsAt / participation filters run
    // client-side so we don't need a composite index.
    const snap = await getDocs(
      query(col.games(), where('visibility', '==', 'public')),
    );
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
    visibility: 'public' | 'community';
    requiresApproval: boolean;
    bringBall: boolean;
    bringShirts: boolean;
    notes?: string;
    city?: string;
    fieldAddress?: string;
    hasReferee?: boolean;
    hasPenalties?: boolean;
    hasHalfTime?: boolean;
    extraTimeMinutes?: number;
    createdBy: UserId;
  }): Promise<Game> {
    // Defensive: callers come from a TS-typed wizard but the field is
    // user-controlled, so reject anything that isn't one of the two
    // valid values rather than letting a typo land in Firestore.
    if (input.visibility !== 'public' && input.visibility !== 'community') {
      throw new Error('createGameV2: invalid visibility');
    }
    const now = Date.now();
    const base: Omit<Game, 'id'> = {
      groupId: input.groupId,
      title: input.title,
      startsAt: input.startsAt,
      fieldName: input.fieldName,
      maxPlayers: input.maxPlayers,
      minPlayers: input.minPlayers,
      players: [],
      waitlist: [],
      pending: [],
      participantIds: [],
      status: 'open',
      locked: false,
      currentMatchIndex: 0,
      matches: [],
      createdBy: input.createdBy,
      visibility: input.visibility,
      requiresApproval: input.requiresApproval,
      format: input.format,
      numberOfTeams: input.numberOfTeams,
      cancelDeadlineHours: input.cancelDeadlineHours,
      fieldType: input.fieldType,
      matchDurationMinutes: input.matchDurationMinutes,
      autoTeamGenerationMinutesBeforeStart:
        input.autoTeamGenerationMinutesBeforeStart,
      bringBall: input.bringBall,
      bringShirts: input.bringShirts,
      notes: input.notes,
      city: input.city,
      fieldAddress: input.fieldAddress,
      hasReferee: input.hasReferee,
      hasPenalties: input.hasPenalties,
      hasHalfTime: input.hasHalfTime,
      extraTimeMinutes: input.extraTimeMinutes,
      createdAt: now,
      updatedAt: now,
    };
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
      const ref = await addDoc(col.games(), { id: '', ...base });
      createdId = ref.id;
    }

    // Phase E.2: dispatch a "new game in community" notification. We use
    // `recipientId = groupId` as a fan-out marker — the Cloud Function
    // recognises this notification type and resolves recipients by
    // querying users where `newGameSubscriptions` array-contains the
    // groupId. Best-effort; failure here doesn't roll back the create.
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

    logEvent(AnalyticsEvent.GameCreated, {
      gameId: createdId,
      groupId: input.groupId,
      format: input.format ?? '',
      visibility: input.visibility,
      requiresApproval: String(!!input.requiresApproval),
    });

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
      bringBall: boolean;
      bringShirts: boolean;
      notes: string;
      city: string;
      fieldAddress: string;
      hasReferee: boolean;
      hasPenalties: boolean;
      hasHalfTime: boolean;
      extraTimeMinutes: number;
    }>,
  ): Promise<void> {
    // Visibility is access-control. Don't accept it through the
    // generic edit path — there are extra checks (admin, status,
    // enum) that only `setVisibility` enforces. Callers should
    // route visibility flips through that handler instead.
    if ('visibility' in patch) {
      throw new Error('updateGameV2: use setVisibility() to change visibility');
    }
    const updates: Record<string, unknown> = {
      ...patch,
      updatedAt: Date.now(),
    };
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('updateGameV2: game not found');
      Object.assign(g, updates);
    } else {
      await updateGameDoc(gameId, updates);
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId,
      payload: { gameId, action: 'updated' },
    });
    logEvent(AnalyticsEvent.GameEdited, {
      gameId,
      fields: Object.keys(patch).join(','),
    });
  },

  /**
   * Permanently remove a game. Caller must be the creator or a community
   * admin — Firestore rules enforce this; we don't double-check here.
   * Notifies participants so subscribed UIs can navigate away.
   */
  async deleteGame(gameId: string): Promise<void> {
    if (!gameId) return;
    if (USE_MOCK_DATA) {
      const idx = mockGamesV2.findIndex((x) => x.id === gameId);
      if (idx >= 0) mockGamesV2.splice(idx, 1);
    } else {
      await deleteDoc(docs.game(gameId));
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId,
      payload: { gameId, action: 'deleted' },
    });
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
      const snap = await getDocs(
        query(
          col.games(),
          where('participantIds', 'array-contains', userId),
          limit(CONFLICT_QUERY_LIMIT),
        ),
      );
      return snap.docs.map((d) => ({ ...d.data(), matches: [] } as Game));
    })();

    const userParticipates = (g: Game): boolean => {
      // Trust participantIds first — that's why we queried on it. The
      // fallback merge is a defensive net for docs whose denormalised
      // field drifted out of sync with the bucket arrays. Cheap O(n)
      // membership checks; n is the size of one game's roster.
      if ((g.participantIds ?? []).includes(userId)) return true;
      if (g.players?.includes(userId)) return true;
      if (g.waitlist?.includes(userId)) return true;
      if ((g.pending ?? []).includes(userId)) return true;
      return false;
    };

    const conflicts = candidates.filter((g) => {
      if (g.id === targetGame.id) return false;
      if (!ACTIVE_STATUSES.includes(g.status)) return false;
      if (!userParticipates(g)) return false;
      // Live game ALWAYS conflicts — the user is presently committed
      // there, time-window logic doesn't apply.
      if (g.status === 'active') return true;
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
  async joinGameV2(
    gameId: string,
    userId: UserId
  ): Promise<{ bucket: 'players' | 'waitlist' | 'pending' }> {
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) throw new Error('joinGameV2: game not found');
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
      const occupancy = g.players.length + (g.guests?.length ?? 0);
      if (g.requiresApproval) {
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
      g.updatedAt = Date.now();
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
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('joinGameV2: game not found');
      const data = snap.data();

      // Lifecycle gate (mirrors firestore.rules — fail fast client-side
      // with a typed error so the UI can show a friendly message).
      if (data.status !== 'open') throw new Error('GAME_NOT_OPEN');
      if (data.startsAt && data.startsAt < Date.now()) {
        throw new Error('GAME_STARTED');
      }
      if (data.liveMatch?.phase === 'live') throw new Error('GAME_LIVE');

      const players = data.players ?? [];
      const waitlist = data.waitlist ?? [];
      const pending = data.pending ?? [];
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
      const occupancy = players.length + (data.guests ?? []).length;
      const updates: Record<string, unknown> = { updatedAt: Date.now() };
      let bucket: 'players' | 'waitlist' | 'pending';
      if (data.requiresApproval) {
        updates.pending = [...pending, userId];
        bucket = 'pending';
      } else if (occupancy < (data.maxPlayers ?? 15)) {
        updates.players = [...players, userId];
        bucket = 'players';
      } else {
        updates.waitlist = [...waitlist, userId];
        bucket = 'waitlist';
      }
      const existingParticipants: string[] = Array.isArray(
        data.participantIds,
      )
        ? data.participantIds
        : [];
      updates.participantIds = Array.from(
        new Set([...existingParticipants, userId]),
      );
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
      // tx.update bypasses the converter so only the keys we changed
      // land in affectedKeys() — critical for the self-join rule which
      // whitelists ['players','waitlist','pending','participantIds',
      // 'cancellations','updatedAt']. The cast mirrors `updateGameDoc`.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, updates as any);
      return { bucket };
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
      const occupancy = g.players.length + (g.guests?.length ?? 0);
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
      logEvent(AnalyticsEvent.GameJoined, { gameId, bucket, viaApproval: true });
      return { bucket };
    }
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('approveGameJoin: game not found');
      const data = snap.data();
      const pending = (data.pending ?? []) as string[];
      if (!pending.includes(userId)) {
        return { bucket: 'noop' as const, title: data.title ?? '' };
      }
      const players = (data.players ?? []) as string[];
      const waitlist = (data.waitlist ?? []) as string[];
      const occupancy = players.length + (data.guests ?? []).length;
      const nextPending = pending.filter((id) => id !== userId);
      let bucket: 'players' | 'waitlist';
      const updates: Record<string, unknown> = {
        pending: nextPending,
        updatedAt: Date.now(),
      };
      if (occupancy < (data.maxPlayers ?? 15)) {
        updates.players = [...players, userId];
        bucket = 'players';
      } else {
        updates.waitlist = [...waitlist, userId];
        bucket = 'waitlist';
      }
      const existingParticipants: string[] = Array.isArray(
        data.participantIds,
      )
        ? data.participantIds
        : [];
      updates.participantIds = Array.from(
        new Set([...existingParticipants, userId]),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, updates as any);
      return { bucket, title: data.title ?? '' };
    });

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
    logEvent(AnalyticsEvent.GameJoined, {
      gameId,
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
      g.participantIds = (g.participantIds ?? []).filter(
        (id) => id !== userId || g.players.includes(id) || g.waitlist.includes(id),
      );
      g.updatedAt = Date.now();
      notificationsService.dispatch({
        type: 'rejected',
        recipientId: userId,
        payload: { gameId, gameTitle: g.title },
      });
      return;
    }
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    const result = await runTransaction(db, async (tx) => {
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
      // Recompute participantIds: drop the rejected user only if they
      // aren't still on players/waitlist (defensive — they shouldn't be).
      const stillIn =
        players.includes(userId) || waitlist.includes(userId);
      const existingParticipants: string[] = Array.isArray(
        data.participantIds,
      )
        ? data.participantIds
        : [];
      const participantIds = stillIn
        ? existingParticipants
        : existingParticipants.filter((id) => id !== userId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tx.update(ref, {
        pending,
        participantIds,
        updatedAt: Date.now(),
      } as any);
      return { changed: true, title: data.title ?? '' };
    });

    if (!result.changed) return;
    notificationsService.dispatch({
      type: 'rejected',
      recipientId: userId,
      payload: { gameId, gameTitle: result.title },
    });
  },

  /**
   * Remove the current user from any of the three buckets. If they were
   * in `players[]` and the waitlist has anyone, promote the head of the
   * waitlist into the freed slot.
   */
  async cancelGameV2(gameId: string, userId: UserId): Promise<void> {
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      const wasInPlayers = g.players.includes(userId);
      g.players = g.players.filter((id) => id !== userId);
      g.waitlist = g.waitlist.filter((id) => id !== userId);
      g.pending = (g.pending ?? []).filter((id) => id !== userId);
      let promotedUid: string | null = null;
      if (wasInPlayers && g.waitlist.length > 0 && g.players.length < g.maxPlayers) {
        promotedUid = g.waitlist[0];
        g.waitlist = g.waitlist.slice(1);
        g.players = [...g.players, promotedUid];
      }
      // Re-derive the union: cancelling user is gone; promoted user is still
      // a participant so we just drop the cancelled one.
      g.participantIds = (g.participantIds ?? []).filter((id) => id !== userId);
      // Stamp the cancellation time. Discipline derivation reads this
      // to compare against the game's `cancelDeadlineHours` and decide
      // whether the cancel was on time or after the deadline.
      g.cancellations = { ...(g.cancellations ?? {}), [userId]: Date.now() };
      g.updatedAt = Date.now();
      if (promotedUid) {
        notificationsService.dispatch({
          type: 'spotOpened',
          recipientId: promotedUid,
          payload: { gameId, gameTitle: g.title },
        });
      }
      logEvent(AnalyticsEvent.GameCancelled, { gameId, promoted: !!promotedUid });
      return;
    }
    // Atomic cancel via runTransaction. Fixes the lost-update bug
    // where two concurrent cancels promoted the same waitlist head
    // (both wrote `players: [...players, waitlist[0]]` from the same
    // pre-cancel snapshot, leaving the promoted user in BOTH arrays).
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return { promotedUid: null, title: '' };
      const data = snap.data();
      const wasInPlayers = (data.players ?? []).includes(userId);
      let players = (data.players ?? []).filter(
        (id: string) => id !== userId,
      );
      let waitlist = (data.waitlist ?? []).filter(
        (id: string) => id !== userId,
      );
      const pending = (data.pending ?? []).filter(
        (id: string) => id !== userId,
      );
      let promotedUid: string | null = null;
      if (
        wasInPlayers &&
        waitlist.length > 0 &&
        players.length < (data.maxPlayers ?? 15)
      ) {
        promotedUid = waitlist[0];
        waitlist = waitlist.slice(1);
        players = [...players, promotedUid];
      }
      const participantIds = Array.isArray(data.participantIds)
        ? data.participantIds.filter((id: string) => id !== userId)
        : Array.from(new Set([...players, ...waitlist, ...pending]));
      // Stamp the cancellation timestamp (set-and-overwrite) so the
      // discipline snapshot can compare it against the game's
      // cancelDeadlineHours later. We merge into the existing map
      // rather than replacing it — other users' cancellations on the
      // same game must not be wiped.
      const cancellations = {
        ...((data.cancellations as Record<string, number> | undefined) ?? {}),
        [userId]: Date.now(),
      };
      tx.update(ref, {
        players,
        waitlist,
        pending,
        participantIds,
        cancellations,
        updatedAt: Date.now(),
      });
      return { promotedUid, title: data.title ?? '' };
    });

    if (result.promotedUid) {
      notificationsService.dispatch({
        type: 'spotOpened',
        recipientId: result.promotedUid,
        payload: { gameId, gameTitle: result.title },
      });
    }
    logEvent(AnalyticsEvent.GameCancelled, {
      gameId,
      promoted: !!result.promotedUid,
    });
  },

  /**
   * Phase E.2.2: Admin-only "cancel game". Flips status to 'finished'
   * (we don't have a separate 'cancelled' enum yet) and dispatches a
   * `gameCanceledOrUpdated` fan-out notification — the Cloud Function
   * resolves recipients to players + waitlist + pending of the game.
   */
  async cancelGameByAdmin(gameId: string): Promise<void> {
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
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId, // fan-out marker — CF resolves participants
      payload: { gameId, action: 'cancelled' },
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
      if (g.status !== 'open') {
        throw new Error('setVisibility: game is not in open status');
      }
      g.visibility = visibility;
      g.updatedAt = Date.now();
      return;
    }
    const { auth } = getFirebase();
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('setVisibility: not signed in');

    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('setVisibility: game not found');
    const game = snap.data();
    if (game.status !== 'open') {
      throw new Error('setVisibility: game is not in open status');
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
    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    if (snap.data().status !== 'open') return;
    await updateDoc(ref, { status: 'locked', updatedAt: Date.now() });
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
        ...(g.liveMatch ?? { phase: 'organizing', assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0, lateUserIds: [] }),
        phase: 'roundReady',
      };
      g.updatedAt = Date.now();
      return;
    }
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
    const liveMatch = {
      ...(data.liveMatch ?? {
        phase: 'organizing',
        assignments: {},
        benchOrder: [],
        scoreA: 0,
        scoreB: 0,
        lateUserIds: [],
      }),
      phase: 'roundReady' as const,
    };
    await updateDoc(ref, {
      status: 'active',
      liveMatch,
      updatedAt: Date.now(),
    });
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
      if (g.liveMatch) g.liveMatch = { ...g.liveMatch, phase: 'finished' };
      g.updatedAt = Date.now();
      return;
    }
    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    if (data.status === 'finished' || data.status === 'cancelled') return;
    const updates: Record<string, unknown> = {
      status: 'finished',
      updatedAt: Date.now(),
    };
    if (data.liveMatch) {
      updates.liveMatch = { ...data.liveMatch, phase: 'finished' };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(ref, updates as any);
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
    const snap = await getDoc(ref);
    if (!snap.exists()) return { changed: false };
    const data = snap.data();
    const prev = (data.arrivals ?? {})[userId] ?? 'unknown';
    if (prev === status) return { changed: false };
    // updateDoc bypasses the converter; see `setLiveMatch` note.
    await updateDoc(ref, {
      arrivals: { ...(data.arrivals ?? {}), [userId]: status },
      updatedAt: Date.now(),
    });
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
      return () => {
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
        if (__DEV__) console.warn('[gameService] subscribeLiveMatch error', err);
      }
    );
    return unsub;
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
        rating < 1 ||
        rating > 5)
    ) {
      throw new Error('addGuest: estimatedRating must be 1..5');
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
      await assertGuestPermission(g.createdBy, g.groupId, callerId);
      const occupancy = g.players.length + (g.guests?.length ?? 0);
      if (occupancy >= g.maxPlayers) {
        throw new Error('GAME_FULL');
      }
      g.guests = [...(g.guests ?? []), guest];
      g.updatedAt = Date.now();
      logEvent(AnalyticsEvent.GuestAdded, { gameId, hasRating: rating !== undefined });
      return guest;
    }

    // Permission check is done OUTSIDE the transaction (it reads the
    // /groups doc, which Firestore txns can't include in their
    // read-write set without inflating contention). The capacity check
    // + guest write happen INSIDE the txn so an admin can't overflow
    // capacity by racing concurrent guest additions or user joins.
    const ref = docs.game(gameId);
    const { db } = getFirebase();
    const snapForPerm = await getDoc(ref);
    if (!snapForPerm.exists()) throw new Error('addGuest: game not found');
    const permData = snapForPerm.data();
    await assertGuestPermission(permData.createdBy, permData.groupId, callerId);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('addGuest: game not found');
      const data = snap.data();
      // Lifecycle guard mirrors firestore.rules: no guest mutations on
      // a game that's already finished/locked.
      if (data.status !== 'open') throw new Error('GAME_NOT_OPEN');
      const playersLen = (data.players ?? []).length;
      const guestsLen = (data.guests ?? []).length;
      if (playersLen + guestsLen >= (data.maxPlayers ?? 15)) {
        throw new Error('GAME_FULL');
      }
      tx.update(ref, {
        guests: [...(data.guests ?? []), guest],
        updatedAt: Date.now(),
      });
    });
    logEvent(AnalyticsEvent.GuestAdded, { gameId, hasRating: rating !== undefined });
    return guest;
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
    patch: { name?: string; estimatedRating?: number | null },
  ): Promise<GameGuest> {
    const apply = (g: GameGuest): GameGuest => {
      const nextName =
        patch.name !== undefined ? patch.name.trim() : g.name;
      if (!nextName) throw new Error('updateGuest: name is required');
      if (nextName.length > 20) {
        throw new Error('updateGuest: name too long (>20)');
      }
      let nextRating = g.estimatedRating;
      if (patch.estimatedRating === null) {
        nextRating = undefined;
      } else if (patch.estimatedRating !== undefined) {
        const r = patch.estimatedRating;
        if (
          typeof r !== 'number' ||
          !Number.isFinite(r) ||
          r < 1 ||
          r > 5
        ) {
          throw new Error('updateGuest: estimatedRating must be 1..5');
        }
        nextRating = r;
      }
      // Same Firestore-undefined gotcha as addGuest: drop the key
      // entirely when there's no rating instead of writing
      // `estimatedRating: undefined`.
      const { estimatedRating: _drop, ...rest } = g;
      return {
        ...rest,
        name: nextName,
        ...(nextRating !== undefined ? { estimatedRating: nextRating } : {}),
      };
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
    const snapForPerm = await getDoc(ref);
    if (!snapForPerm.exists()) throw new Error('updateGuest: game not found');
    const permData = snapForPerm.data();
    await assertGuestPermission(permData.createdBy, permData.groupId, callerId);

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
    const snapForPerm = await getDoc(ref);
    if (!snapForPerm.exists()) return;
    const permData = snapForPerm.data();
    await assertGuestPermission(permData.createdBy, permData.groupId, callerId);

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
    logEvent(AnalyticsEvent.GuestRemoved, { gameId });
  },
};

/**
 * Permission gate for guest mutations. Caller is allowed if they're the
 * game organizer (createdBy) OR an admin of the parent community.
 * Mirrors the Firestore rule on /games/{id}.update — duplicated here so
 * we can fail fast with a clear error before the network round-trip.
 */
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

export function buildTeamsFrom(registered: string[]): Team[] {
  const shuffled = shuffle(registered).slice(0, 15);
  const colors: TeamColor[] = ['team1', 'team2', 'team3'];
  return colors.map((color, i) => {
    const playerIds = shuffled.slice(i * 5, i * 5 + 5);
    return {
      color,
      playerIds,
      goalkeeperOrder: shuffle(playerIds),
      isWaiting: color === 'team3',
    };
  });
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
