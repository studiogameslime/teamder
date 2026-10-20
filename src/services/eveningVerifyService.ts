// The evenings waiting on an admin's word, and the one call that answers.
//
// An evening the sweep closed with no trace of play is 'unverified': finished,
// but not counted, and not deleted. It stays that way until a club admin says
// whether it happened. This service finds those and carries the answer back.
//
// Scoped to ONE club, read on demand, without dropping unresolved evenings: this is a rare state — most
// clubs will never have one — so it must cost nothing on the screens that ask.

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { eveningPlayState, type PlayableEvening } from '@/utils/eveningPlayed';
import { mockGamesV2 } from '@/data/mockData';
import type { GroupId } from '@/types';

export interface UnverifiedEvening {
  id: string;
  title: string;
  startsAt: number;
}

export const eveningVerifyService = {
  /** Evenings in this club waiting on a decision, oldest first — an admin
   *  answering them in order relives the season the way it happened. */
  async listUnverified(groupId: GroupId): Promise<UnverifiedEvening[]> {
    if (!groupId) return [];
    if (USE_MOCK_DATA) return mockGamesV2.filter(g => g.groupId === groupId && eveningPlayState(g as PlayableEvening) === 'unverified')
      .sort((a,b) => a.startsAt - b.startsAt).map(g => ({ id: g.id, title: g.title, startsAt: g.startsAt }));
    const { httpsCallable } = require('firebase/functions');
    const result = await httpsCallable(getFirebase().functions, 'listSeasonUnverified')({ groupId });
    return result.data.items;
  },

  /**
   * The admin's verdict. One call, one evening.
   *
   * A callable because the rules forbid every client write to a finished game.
   * The server re-checks that the evening is still waiting, so two admins
   * answering at once cannot overwrite each other with different verdicts —
   * the first answer stands and the second is a no-op.
   */
  async setPlayed(gameId: string, played: boolean, occurredAt?: number): Promise<boolean> {
    if (!gameId) return false;
    if (USE_MOCK_DATA) {
      const g = mockGamesV2.find((x) => x.id === gameId);
      if (!g) return false;
      (g as PlayableEvening).playVerified = played;
      return true;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { httpsCallable } = require('firebase/functions');
      const { functions } = getFirebase();
      await httpsCallable(functions, 'setEveningPlayed')({ gameId, played, ...(occurredAt ? { occurredAt } : {}) });
      return true;
    } catch (err) {
      logError('setEveningPlayed', err, { gameId, played });
      return false;
    }
  },
};
