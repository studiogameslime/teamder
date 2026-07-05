// Game-tab store — stripped to the surface that the redesigned screens
// actually read. The original store carried the pre-v2 registration
// flow (registerSelf / cancelSelf / generateTeams / timer / endMatch)
// + their selectors; those were only consumed by the legacy
// GameRegistration / GameDetails / TeamSetup / GoalkeeperOrder screens
// that have since been deleted.
//
// What the new screens read:
//   • `players`          — uid → Player map (jersey/displayName lookup)
//   • `hydratePlayers`   — fetch /users docs and merge into the map
//   • `currentUserId`    — auth uid; consumed by selectors that mark
//                          "this is you"
//   • `setCurrentUserId` — set from RootNavigator on login
//   • `game.status`      — read by RootNavigator to suppress the
//                          App-Open ad when a live match is locked

import { create } from 'zustand';
import { Game, Player, PlayerId, UserId } from '@/types';
import { mockGame, mockPlayers } from '@/data/mockData';
import { groupService } from '@/services';
import { USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';

// Per-uid last-hydrated timestamp so a cached player is REFRESHED after a TTL
// instead of being pinned for the whole session (a rename / avatar change used
// to show stale on every roster until sign-out). Cleared on reset().
const playerHydratedAt = new Map<string, number>();
const PLAYER_HYDRATE_TTL_MS = 5 * 60 * 1000;

/**
 * Empty Game placeholder. The redesigned screens query games via
 * `gameService` and never write back through this store, so the only
 * field anyone reads here is `status`.
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

interface GameStore {
  /** uid → Player lookup. Empty in real mode until `hydratePlayers`. */
  players: Record<PlayerId, Player>;
  /** Fetch /users docs for `uids` and merge into `players`. */
  hydratePlayers: (uids: UserId[]) => Promise<void>;

  /** Stub game; only `status` is observed (RootNavigator ad gating). */
  game: Game;

  /** Auth uid; null until RootNavigator sets it after login. */
  currentUserId: PlayerId | null;
  setCurrentUserId: (id: PlayerId) => void;

  /** Clear the cached players map + game + uid on sign-out / account switch so
   *  the next account never sees the previous user's roster. No-op in mock. */
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  // Mock mode seeds with the canned data so the demo flow looks
  // identical. Firebase mode starts CLEAN: empty players map,
  // placeholder game, no currentUserId.
  players: USE_MOCK_DATA
    ? Object.fromEntries(mockPlayers.map((p) => [p.id, p]))
    : {},
  game: USE_MOCK_DATA ? mockGame : makeEmptyGame(),
  currentUserId: USE_MOCK_DATA ? mockPlayers[6]?.id ?? null : null,

  setCurrentUserId: (id) => set({ currentUserId: id }),

  reset: () => {
    if (USE_MOCK_DATA) return; // keep the demo seed intact
    playerHydratedAt.clear();
    set({ players: {}, game: makeEmptyGame(), currentUserId: null });
  },

  hydratePlayers: async (uids) => {
    if (USE_MOCK_DATA) return; // mockPlayers map is already populated
    if (uids.length === 0) return;
    const existing = get().players;
    const now = Date.now();
    // Fetch a uid if it's not cached OR its cache is older than the TTL.
    const missing = uids.filter(
      (id) =>
        !existing[id] ||
        now - (playerHydratedAt.get(id) ?? 0) > PLAYER_HYDRATE_TTL_MS,
    );
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
            avatarId: u.avatarId,
            photoUrl: u.photoUrl,
          };
          playerHydratedAt.set(u.id, now);
        }
        return { players: next };
      });
    } catch (err) {
      logError('hydratePlayers', err, { count: missing.length });
      if (__DEV__) console.warn('[gameStore] hydratePlayers failed', err);
    }
  },
}));
