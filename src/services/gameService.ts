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
  GameSummary,
  GroupId,
  LiveMatchState,
  MatchRound,
  Player,
  SkillLevel,
  Team,
  TeamColor,
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
    skillLevel?: SkillLevel;
    cancelDeadlineHours?: number;
    fieldType?: import('@/types').FieldType;
    matchDurationMinutes?: number;
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
      skillLevel: input.skillLevel,
      cancelDeadlineHours: input.cancelDeadlineHours,
      fieldType: input.fieldType,
      matchDurationMinutes: input.matchDurationMinutes,
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
      if (g.requiresApproval) {
        g.pending = [...(g.pending ?? []), userId];
        bucket = 'pending';
      } else if (g.players.length < g.maxPlayers) {
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
    if (data.requiresApproval) {
      updates.pending = [...pending, userId];
      bucket = 'pending';
    } else if (players.length < (data.maxPlayers ?? 15)) {
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
    const { db } = getFirebase();
    const batch = writeBatch(db);
    batch.set(ref, { ...data, ...updates }, { merge: true });
    await batch.commit();
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
    const { db } = getFirebase();
    const batch = writeBatch(db);
    batch.set(
      ref,
      {
        ...data,
        players,
        waitlist,
        pending,
        participantIds,
        updatedAt: Date.now(),
      },
      { merge: true }
    );
    await batch.commit();
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
    next: LiveMatchState
  ): Promise<void> {
    const stamped: LiveMatchState = { ...next, updatedAt: Date.now() };
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return;
      g.liveMatch = stamped;
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
    await updateDoc(docs.game(gameId), {
      liveMatch: stamped,
      updatedAt: Date.now(),
    });
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
};

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
