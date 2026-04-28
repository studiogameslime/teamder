import { create } from 'zustand';
import { Game, GroupId, MatchRound, Player, PlayerId, Team, TeamColor, UserId } from '@/types';
import { mockGame, mockPlayers } from '@/data/mockData';
import { gameService, groupService, buildTeamsFrom } from '@/services';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { USE_MOCK_DATA } from '@/firebase/config';

/**
 * Empty Game placeholder used in Firebase mode before any data is loaded.
 * Screens guard on `loadState !== 'ready'` so this never renders, but having
 * a real empty (rather than mock seed) means real-mode store memory is
 * pristine.
 */
function makeEmptyGame(): Game {
  return {
    id: '',
    groupId: '',
    title: '',
    startsAt: 0,
    fieldName: '',
    maxPlayers: 15,
    players: [],
    waitlist: [],
    matches: [],
    currentMatchIndex: 0,
    status: 'open',
    locked: false,
    createdAt: 0,
  };
}

// UI-visible loading states for the game tab. The screens render
// different UI based on this rather than checking the game shape itself,
// so we can distinguish "no game yet" from "permission denied".
export type GameLoadState =
  | 'idle'              // not yet attempted (cold start, Firebase mode)
  | 'loading'           // fetch in flight
  | 'ready'             // game loaded, render normally
  | 'no_game'           // group has no active game yet
  | 'permission_denied' // user can't read this group's games
  | 'error';            // unexpected failure (logged to console)

interface TimerState {
  matchIndex: number;
  startedAt: number | null; // ms epoch when running, null when paused
  accumulatedMs: number;    // ms accumulated across pauses
}

interface GameStore {
  players: Record<PlayerId, Player>;
  /** Hydrate /users docs for a list of uids and merge into `players`. */
  hydratePlayers: (uids: UserId[]) => Promise<void>;

  game: Game;

  // --- load state ---
  loadState: GameLoadState;
  loadActiveGame: (groupId: GroupId) => Promise<void>;
  createGame: (groupId: GroupId) => Promise<void>;

  // current user (for "I'm in / I'm out") — in mock mode we let the user pick
  // any registered slot; in real mode this comes from auth.
  currentUserId: PlayerId | null;
  setCurrentUserId: (id: PlayerId) => void;

  // --- registration phase ---
  registerSelf: () => void;
  cancelSelf: () => void;
  toggleBallCarrier: (playerId: PlayerId) => void;
  toggleJerseyCarrier: (playerId: PlayerId) => void;

  // --- team setup phase ---
  generateTeams: () => void;
  shuffleTeams: () => void;
  reorderGoalkeepers: (color: TeamColor, newOrder: PlayerId[]) => void;
  lockAndStart: () => void;

  // --- match phase ---
  timer: TimerState;
  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  getElapsedMs: () => number;
  endMatch: (winner: TeamColor | 'tie') => void;
}

// Mock mode: the canned game is always available, so loadState starts as
// 'ready'. Firebase mode: 'idle' until the screen calls loadActiveGame().
const INITIAL_LOAD_STATE: GameLoadState = USE_MOCK_DATA ? 'ready' : 'idle';

function isPermissionDenied(err: unknown): boolean {
  // firebase/firestore throws FirebaseError with code 'permission-denied'
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'permission-denied';
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

const TOTAL_MATCHES = 6; // shown as "מתוך 6" in mockups; configurable later

// Fire-and-forget persist. The service decides whether this is a no-op
// (mock mode) or a real Firestore write. Errors are logged so the UI never
// blocks waiting for the network.
function persist(game: Game) {
  gameService.saveGame(game).catch((err) => {
    if (__DEV__) console.warn('gameService.saveGame failed', err);
  });
}

export const useGameStore = create<GameStore>((set, get) => ({
  // Mock mode seeds with the canned data so the existing demo flow looks
  // identical. Firebase mode starts CLEAN: empty players map, empty game,
  // no currentUserId. Screens that read these are gated behind loadState.
  players: USE_MOCK_DATA
    ? Object.fromEntries(mockPlayers.map((p) => [p.id, p]))
    : {},
  game: USE_MOCK_DATA ? mockGame : makeEmptyGame(),
  loadState: INITIAL_LOAD_STATE,
  currentUserId: USE_MOCK_DATA ? mockPlayers[6]?.id ?? null : null,

  setCurrentUserId: (id) => set({ currentUserId: id }),

  hydratePlayers: async (uids) => {
    if (USE_MOCK_DATA) return; // mockPlayers map is already populated
    if (uids.length === 0) return;
    const existing = get().players;
    const missing = uids.filter((id) => !existing[id]);
    if (missing.length === 0) return;
    try {
      const users = await groupService.hydrateUsers(missing);
      set((s) => {
        const next = { ...s.players };
        for (const u of users) {
          next[u.id] = {
            id: u.id,
            displayName: u.name,
            avatarUrl: u.photoUrl,
            jersey: u.jersey,
          };
        }
        return { players: next };
      });
    } catch (err) {
      if (__DEV__) console.warn('[gameStore] hydratePlayers failed', err);
    }
  },

  loadActiveGame: async (groupId) => {
    // Mock mode: nothing to fetch — the store already holds mockGame.
    if (USE_MOCK_DATA) {
      set({ loadState: 'ready' });
      return;
    }
    set({ loadState: 'loading' });
    try {
      const game = await gameService.getActiveGameForGroup(groupId);
      if (game) {
        set({ game, loadState: 'ready' });
        // Hydrate avatars/names for everyone surfaced on game-tab screens.
        const ids = uniq([
          ...game.players,
          ...game.waitlist,
          ...(game.ballHolderUserId ? [game.ballHolderUserId] : []),
          ...(game.jerseysHolderUserId ? [game.jerseysHolderUserId] : []),
          ...(game.teams?.flatMap((t) => t.playerIds) ?? []),
        ]);
        get().hydratePlayers(ids);
      } else {
        set({ loadState: 'no_game' });
      }
    } catch (err) {
      if (isPermissionDenied(err)) {
        if (__DEV__) console.warn('[gameStore] permission denied loading game', err);
        set({ loadState: 'permission_denied' });
      } else {
        if (__DEV__) console.error('[gameStore] loadActiveGame failed', err);
        set({ loadState: 'error' });
      }
    }
  },

  createGame: async (groupId) => {
    set({ loadState: 'loading' });
    try {
      const game = await gameService.createGame(groupId);
      set({ game, loadState: 'ready' });
    } catch (err) {
      if (isPermissionDenied(err)) {
        if (__DEV__) console.warn('[gameStore] permission denied creating game', err);
        set({ loadState: 'permission_denied' });
      } else {
        if (__DEV__) console.error('[gameStore] createGame failed', err);
        set({ loadState: 'error' });
      }
    }
  },

  // -------- registration --------
  // The new model: `players` holds approved registrations for the
  // night (max 15) and `waitlist` holds the per-night overflow. Both
  // are independent of the parent group's community membership — that's
  // tracked on Group.playerIds.

  registerSelf: () =>
    set((s) => {
      const uid = s.currentUserId;
      if (!uid) return s;
      const reg = s.game.players;
      const wait = s.game.waitlist;
      // Already registered or already waiting → no-op
      if (reg.includes(uid) || wait.includes(uid)) return s;

      let game: Game;
      if (reg.length < s.game.maxPlayers) {
        game = { ...s.game, players: [...reg, uid] };
        logEvent(AnalyticsEvent.GameJoined, { gameId: s.game.id });
      } else {
        game = { ...s.game, waitlist: [...wait, uid] };
        logEvent(AnalyticsEvent.WaitlistJoined, { gameId: s.game.id });
      }
      persist(game);
      // Make sure the current user has an entry in the players map so their
      // avatar shows up immediately in the registered list.
      get().hydratePlayers([uid]);
      return { game };
    }),

  cancelSelf: () =>
    set((s) => {
      const uid = s.currentUserId;
      if (!uid) return s;
      const wasRegistered = s.game.players.includes(uid);
      const wasWaiting = s.game.waitlist.includes(uid);
      if (!wasRegistered && !wasWaiting) return s;

      let nextReg = s.game.players.filter((id) => id !== uid);
      let nextWait = s.game.waitlist.filter((id) => id !== uid);

      // If a registered slot opened up, promote the head of the waitlist.
      if (wasRegistered && nextWait.length > 0) {
        const [promoted, ...remainingWait] = nextWait;
        nextReg = [...nextReg, promoted];
        nextWait = remainingWait;
        // TODO: trigger FCM "you've been promoted" for `promoted`.
      }

      // If the leaving user was the ball/jerseys holder, clear those fields.
      const game: Game = {
        ...s.game,
        players: nextReg,
        waitlist: nextWait,
        ballHolderUserId:
          s.game.ballHolderUserId === uid ? undefined : s.game.ballHolderUserId,
        jerseysHolderUserId:
          s.game.jerseysHolderUserId === uid ? undefined : s.game.jerseysHolderUserId,
      };
      persist(game);
      logEvent(AnalyticsEvent.GameCancelled, { gameId: s.game.id });
      return { game };
    }),

  toggleBallCarrier: (playerId) =>
    set((s) => {
      const next: Game = {
        ...s.game,
        ballHolderUserId:
          s.game.ballHolderUserId === playerId ? undefined : playerId,
      };
      persist(next);
      return { game: next };
    }),

  toggleJerseyCarrier: (playerId) =>
    set((s) => {
      const next: Game = {
        ...s.game,
        jerseysHolderUserId:
          s.game.jerseysHolderUserId === playerId ? undefined : playerId,
      };
      persist(next);
      return { game: next };
    }),

  // -------- team setup --------
  generateTeams: () => {
    const s = get();
    const registered = s.game.players;
    if (registered.length < 15 && __DEV__) {
      console.warn(
        `generateTeams: only ${registered.length} registered, need 15. ` +
          `Building teams from what's available.`
      );
    }
    const teams = buildTeamsFrom(registered);
    const game = { ...s.game, teams };
    persist(game);
    set({ game });
  },

  shuffleTeams: () => get().generateTeams(),

  reorderGoalkeepers: (color, newOrder) =>
    set((s) => {
      if (!s.game.teams) return s;
      const game: Game = {
        ...s.game,
        teams: s.game.teams.map((t) =>
          t.color === color ? { ...t, goalkeeperOrder: newOrder } : t
        ),
      };
      persist(game);
      return { game };
    }),

  lockAndStart: () =>
    set((s) => {
      if (!s.game.teams) return s;
      const [a, b, w] = s.game.teams;
      const firstMatch: MatchRound = {
        index: 0,
        teamA: a.color,
        teamB: b.color,
        waiting: w.color,
        goalkeeperA: a.goalkeeperOrder[0],
        goalkeeperB: b.goalkeeperOrder[0],
      };
      const game: Game = {
        ...s.game,
        locked: true,
        status: 'locked',
        currentMatchIndex: 0,
        matches: [firstMatch],
      };
      persist(game);
      logEvent(AnalyticsEvent.GameStarted, { gameId: s.game.id });
      return { game };
    }),

  // -------- match phase --------
  timer: { matchIndex: 0, startedAt: null, accumulatedMs: 0 },

  startTimer: () =>
    set((s) => {
      if (s.timer.startedAt) return s;
      return {
        timer: {
          matchIndex: s.game.currentMatchIndex,
          startedAt: Date.now(),
          accumulatedMs: s.timer.accumulatedMs,
        },
      };
    }),

  pauseTimer: () =>
    set((s) => {
      if (!s.timer.startedAt) return s;
      const now = Date.now();
      return {
        timer: {
          ...s.timer,
          startedAt: null,
          accumulatedMs: s.timer.accumulatedMs + (now - s.timer.startedAt),
        },
      };
    }),

  resetTimer: () =>
    set((s) => ({
      timer: { matchIndex: s.game.currentMatchIndex, startedAt: null, accumulatedMs: 0 },
    })),

  getElapsedMs: () => {
    const t = get().timer;
    return t.startedAt ? t.accumulatedMs + (Date.now() - t.startedAt) : t.accumulatedMs;
  },

  endMatch: (winner) =>
    set((s) => {
      if (!s.game.teams) return s;
      const idx = s.game.currentMatchIndex;
      const cur = s.game.matches[idx];
      if (!cur) return s;

      let leaving: TeamColor;
      let staying: TeamColor;
      if (winner === 'tie' || winner === cur.teamA) {
        leaving = winner === 'tie' ? cur.teamA : cur.teamB;
        staying = winner === 'tie' ? cur.teamB : cur.teamA;
      } else {
        leaving = cur.teamA;
        staying = cur.teamB;
      }
      const incoming = cur.waiting;

      const teams = s.game.teams.map((t) => {
        if (t.color === cur.teamA || t.color === cur.teamB) {
          const [head, ...rest] = t.goalkeeperOrder;
          return { ...t, goalkeeperOrder: [...rest, head] };
        }
        return t;
      });
      const find = (c: TeamColor) => teams.find((t) => t.color === c)!;

      const closed: MatchRound = { ...cur, winner, endedAt: Date.now() };
      const nextRound: MatchRound = {
        index: idx + 1,
        teamA: staying,
        teamB: incoming,
        waiting: leaving,
        goalkeeperA: find(staying).goalkeeperOrder[0],
        goalkeeperB: find(incoming).goalkeeperOrder[0],
      };

      const matches = [...s.game.matches];
      matches[idx] = closed;
      matches.push(nextRound);

      const game: Game = {
        ...s.game,
        teams,
        currentMatchIndex: idx + 1,
        matches,
      };
      persist(game);
      logEvent(AnalyticsEvent.MatchCompleted, {
        gameId: s.game.id,
        matchIndex: idx,
        winner: String(winner),
      });
      return {
        game,
        timer: { matchIndex: idx + 1, startedAt: null, accumulatedMs: 0 },
      };
    }),
}));

export const TOTAL_MATCHES_TARGET = TOTAL_MATCHES;

// Convenience selectors. Signatures preserved so consumer screens
// (GameRegistrationScreen, GameDetailsScreen) don't change shape.
//
// `Player` records in the store are populated from the mock players in
// mock mode and from /users in Firebase mode (loaded by the screens that
// need them — out of scope for this iteration). When a userId isn't in
// `players`, the selector skips it rather than rendering "undefined".

export const selectRegisteredPlayers = (s: GameStore): Player[] =>
  s.game.players.map((id) => s.players[id]).filter(Boolean);

export const selectWaitingPlayers = (s: GameStore): Player[] =>
  s.game.waitlist.map((id) => s.players[id]).filter(Boolean);

export const selectBallCarrier = (s: GameStore): Player | null => {
  const id = s.game.ballHolderUserId;
  return id ? s.players[id] ?? null : null;
};

export const selectJerseyCarrier = (s: GameStore): Player | null => {
  const id = s.game.jerseysHolderUserId;
  return id ? s.players[id] ?? null : null;
};
