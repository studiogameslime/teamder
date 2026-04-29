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
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
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
import { col, docs, GameDoc } from '@/firebase/firestore';
import { notificationsService } from './notificationsService';
import { achievementsService } from './achievementsService';
import { disciplineService } from './disciplineService';

let activeGame: Game | null = null;

/**
 * Drop keys whose value is `undefined`. Firestore rejects undefined
 * values with "Unsupported field value: undefined" — every patch we
 * send through `updateDoc` therefore needs to be sanitised.
 */
function stripUndefined<T extends object>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
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
   * Read one v2 game by id. Returns null when the doc doesn't exist.
   * Mock mode falls back to the in-memory store. Used by screens that
   * already know the gameId and just need to refresh after a write.
   */
  async getGameById(gameId: string): Promise<Game | null> {
    if (!gameId) return null;
    if (USE_MOCK_DATA) {
      const found = mockGamesV2.find((g) => g.id === gameId);
      return found ? ({ ...found, matches: [] } as Game) : null;
    }
    const snap = await getDoc(docs.game(gameId));
    if (!snap.exists()) return null;
    return { ...snap.data(), matches: [] };
  },

  async getActiveGameForGroup(groupId: GroupId): Promise<Game | null> {
    if (USE_MOCK_DATA) return ensureMockGame();

    const { auth } = getFirebase();
    if (!auth.currentUser) throw new Error('getActiveGameForGroup: not signed in');

    // Active = the most recent night that's not yet finished. Once a night
    // is marked finished it falls into history (see getHistory).
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['open', 'locked']),
      orderBy('startsAt', 'desc'),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docData = snap.docs[0].data();
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

  async getHistory(groupId: GroupId): Promise<GameSummary[]> {
    if (USE_MOCK_DATA) return mockHistory;

    // History: any night that's no longer 'open' (i.e. locked or finished).
    const q = query(
      col.games(),
      where('groupId', '==', groupId),
      where('status', 'in', ['locked', 'finished']),
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
   * Public games (`isPublic=true`) the user is not a community member of
   * AND not already involved in. Surfaces the "discover" half of the
   * Games tab.
   */
  async getOpenGames(
    userId: UserId,
    excludeCommunityIds: string[]
  ): Promise<Game[]> {
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.status === 'open' &&
            g.isPublic === true &&
            !excludeCommunityIds.includes(g.groupId) &&
            !g.players.includes(userId) &&
            !g.waitlist.includes(userId) &&
            !(g.pending ?? []).includes(userId)
        )
        .sort((a, b) => a.startsAt - b.startsAt);
    }
    // Firebase: single-field equality on `isPublic` (auto-indexed).
    // Status filter + sort + community/participant exclusion run
    // client-side, so no composite index is required.
    const snap = await getDocs(
      query(col.games(), where('isPublic', '==', true)),
    );
    return snap.docs
      .map((d) => ({ ...d.data(), matches: [] }))
      .filter(
        (g) =>
          g.status === 'open' &&
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
    isPublic: boolean;
    requiresApproval: boolean;
    bringBall: boolean;
    bringShirts: boolean;
    notes?: string;
    createdBy: UserId;
  }): Promise<Game> {
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
      isPublic: input.isPublic,
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
      createdAt: now,
      updatedAt: now,
    };
    let createdId: string;
    if (USE_MOCK_DATA) {
      const game: Game = { id: `gv2-${now}`, ...base };
      mockGamesV2.unshift(game);
      createdId = game.id;
    } else {
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
      },
    });

    return { ...base, id: createdId };
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
      g.updatedAt = Date.now();
      // Phase 3: count this as a "game joined" for achievements. Pending
      // bucket is excluded — those joins haven't actually been admitted.
      if (bucket !== 'pending') {
        achievementsService.bump(userId, 'gamesJoined', 1);
      }
      return { bucket };
    }
    // Firebase: re-read the doc to compute the right bucket, then write.
    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('joinGameV2: game not found');
    const data = snap.data();
    const players = data.players ?? [];
    const waitlist = data.waitlist ?? [];
    const pending = data.pending ?? [];
    if (
      players.includes(userId) ||
      waitlist.includes(userId) ||
      pending.includes(userId)
    ) {
      // already joined — fall back to detected bucket
      return {
        bucket: players.includes(userId)
          ? 'players'
          : waitlist.includes(userId)
            ? 'waitlist'
            : 'pending',
      };
    }
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    let bucket: 'players' | 'waitlist' | 'pending';
    // Guests count toward capacity. A coach who pre-fills the roster
    // with two guests on a 12-cap game leaves 10 slots for real users.
    const occupancy = players.length + (data.guests ?? []).length;
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
    const existingParticipants: string[] = Array.isArray(data.participantIds)
      ? data.participantIds
      : [];
    updates.participantIds = Array.from(new Set([...existingParticipants, userId]));
    // updateDoc bypasses the converter so only the keys we changed land in
    // affectedKeys() — critical for the self-join Firestore rule, which
    // restricts updates to ['players','waitlist','pending','participantIds',
    // 'updatedAt']. A `set(...,{merge:true})` through the typed converter
    // would re-emit nullable optional fields (liveMatch, fieldLat, …) and
    // get rejected as "permission denied" even when the join itself is
    // legal.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(ref, updates as any);
    if (bucket !== 'pending') {
      achievementsService.bump(userId, 'gamesJoined', 1);
    }
    return { bucket };
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
      g.updatedAt = Date.now();
      if (promotedUid) {
        notificationsService.dispatch({
          type: 'spotOpened',
          recipientId: promotedUid,
          payload: { gameId, gameTitle: g.title },
        });
      }
      return;
    }
    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const wasInPlayers = (data.players ?? []).includes(userId);
    let players = (data.players ?? []).filter((id: string) => id !== userId);
    let waitlist = (data.waitlist ?? []).filter((id: string) => id !== userId);
    const pending = (data.pending ?? []).filter((id: string) => id !== userId);
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
    // updateDoc, not set+merge — see the comment in joinGameV2 above.
    await updateDoc(ref, {
      players,
      waitlist,
      pending,
      participantIds,
      updatedAt: Date.now(),
    });
    if (promotedUid) {
      notificationsService.dispatch({
        type: 'spotOpened',
        recipientId: promotedUid,
        payload: { gameId, gameTitle: data.title ?? '' },
      });
    }
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
      g.status = 'finished';
      g.locked = true;
      g.updatedAt = Date.now();
    } else {
      const ref = docs.game(gameId);
      const snap = await getDoc(ref);
      if (!snap.exists()) return;
      // Don't re-dispatch if a previous cancel already landed; the
      // fan-out notification has already been written.
      if (snap.data().status === 'finished') return;
      // updateDoc bypasses the converter; see `setLiveMatch` note.
      await updateDoc(ref, {
        status: 'finished',
        updatedAt: Date.now(),
      });
    }
    notificationsService.dispatch({
      type: 'gameCanceledOrUpdated',
      recipientId: gameId, // fan-out marker — CF resolves participants
      payload: { gameId, action: 'cancelled' },
    });
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(docs.game(gameId), patch as any);
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
    const guest: GameGuest = {
      id: genGuestId(),
      name,
      estimatedRating: rating,
      addedBy: callerId,
      createdAt: Date.now(),
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
      return guest;
    }

    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('addGuest: game not found');
    const data = snap.data();
    await assertGuestPermission(data.createdBy, data.groupId, callerId);
    const playersLen = (data.players ?? []).length;
    const guestsLen = (data.guests ?? []).length;
    if (playersLen + guestsLen >= (data.maxPlayers ?? 15)) {
      throw new Error('GAME_FULL');
    }
    const next = [...(data.guests ?? []), guest];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(ref, {
      guests: next,
      updatedAt: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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
      return { ...g, name: nextName, estimatedRating: nextRating };
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
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('updateGuest: game not found');
    const data = snap.data();
    await assertGuestPermission(data.createdBy, data.groupId, callerId);
    const guests = data.guests ?? [];
    const idx = guests.findIndex((x) => x.id === guestId);
    if (idx < 0) throw new Error('updateGuest: guest not found');
    const updated = apply(guests[idx]);
    const next = [...guests.slice(0, idx), updated, ...guests.slice(idx + 1)];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(ref, {
      guests: next,
      updatedAt: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return updated;
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
      return;
    }

    const ref = docs.game(gameId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    await assertGuestPermission(data.createdBy, data.groupId, callerId);
    const nextGuests = (data.guests ?? []).filter((x) => x.id !== guestId);
    const nextLive = stripFromLive(data.liveMatch);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await updateDoc(ref, {
      guests: nextGuests,
      ...(nextLive ? { liveMatch: nextLive } : {}),
      updatedAt: Date.now(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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
