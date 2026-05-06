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
            avatarId: u.avatarId,
            photoUrl: u.photoUrl,
          };
        }
        return { players: next };
      });
    } catch (err) {
      if (__DEV__) console.warn('[gameStore] hydratePlayers failed', err);
    }
  },
}));
