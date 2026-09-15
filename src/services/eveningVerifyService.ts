// The evenings waiting on an admin's word, and the one call that answers.
//
// An evening the sweep closed with no trace of play is 'unverified': finished,
// but not counted, and not deleted. It stays that way until a club admin says
// whether it happened. This service finds those and carries the answer back.
//
// Scoped to ONE club, read on demand, and capped: this is a rare state — most
// clubs will never have one — so it must cost nothing on the screens that ask.

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

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

/** How far back to look. An evening nobody has decided in three months is not
 *  something an admin can remember anyway, and asking is worse than leaving
 *  it uncounted. */
const LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;
/** Ceiling on the banner. A club returning from a long silence could have
 *  several; a list of twenty is a chore, not a prompt. */
const MAX_SHOWN = 20;

export const eveningVerifyService = {
  /** Evenings in this club waiting on a decision, oldest first — an admin
   *  answering them in order relives the season the way it happened. */
  async listUnverified(groupId: GroupId): Promise<UnverifiedEvening[]> {
    if (!groupId) return [];
    const since = Date.now() - LOOKBACK_MS;
    if (USE_MOCK_DATA) {
      return mockGamesV2
        .filter(
          (g) =>
            g.groupId === groupId &&
            g.startsAt >= since &&
            eveningPlayState(g as PlayableEvening) === 'unverified',
        )
        .sort((a, b) => a.startsAt - b.startsAt)
        .slice(0, MAX_SHOWN)
        .map((g) => ({ id: g.id, title: g.title, startsAt: g.startsAt }));
    }
    try {
      const { db } = getFirebase();
      // Filtered on `endedBy`, which only the sweep writes — so the query
      // reads a handful of documents rather than every finished game. The
      // state is still decided by `eveningPlayState` below: this narrows, it
      // does not answer.
      const snap = await getDocs(
        query(
          collection(db, 'games'),
          where('groupId', '==', groupId),
          where('endedBy', '==', 'auto'),
          orderBy('startsAt', 'desc'),
          fsLimit(60),
        ),
      );
      const out: UnverifiedEvening[] = [];
      snap.forEach((d) => {
        const g = d.data() as Record<string, unknown>;
        if (typeof g.startsAt !== 'number' || g.startsAt < since) return;
        if (eveningPlayState(g as PlayableEvening) !== 'unverified') return;
        out.push({
          id: d.id,
          title: typeof g.title === 'string' ? g.title : '',
          startsAt: g.startsAt,
        });
      });
      return out.sort((a, b) => a.startsAt - b.startsAt).slice(0, MAX_SHOWN);
    } catch (err) {
      // A failed lookup here is NOT the same as having nothing to verify, and
      // treating it that way is how this feature could die silently: the card
      // renders nothing on an empty list, so a query that always throws looks
      // exactly like a healthy club — while every auto-closed evening stays
      // uncounted for ever, because this card is the only way out of that
      // state. It shipped needing a composite index that did not exist.
      //
      // So: log it, then fall back to an index the app has always had
      // (groupId + status + startsAt) and filter in memory. Sixty documents is
      // a cheap price for a screen that must not be able to lie.
      logError('listUnverifiedEvenings', err, { groupId });
      try {
        const { db } = getFirebase();
        const snap = await getDocs(
          query(
            collection(db, 'games'),
            where('groupId', '==', groupId),
            where('status', '==', 'finished'),
            orderBy('startsAt', 'desc'),
            fsLimit(60),
          ),
        );
        const out: UnverifiedEvening[] = [];
        snap.forEach((d) => {
          const g = d.data() as Record<string, unknown>;
          if (typeof g.startsAt !== 'number' || g.startsAt < since) return;
          if (eveningPlayState(g as PlayableEvening) !== 'unverified') return;
          out.push({
            id: d.id,
            title: typeof g.title === 'string' ? g.title : '',
            startsAt: g.startsAt,
          });
        });
        return out.sort((a, b) => a.startsAt - b.startsAt).slice(0, MAX_SHOWN);
      } catch (err2) {
        logError('listUnverifiedEveningsFallback', err2, { groupId });
        return [];
      }
    }
  },

  /**
   * The admin's verdict. One call, one evening.
   *
   * A callable because the rules forbid every client write to a finished game.
   * The server re-checks that the evening is still waiting, so two admins
   * answering at once cannot overwrite each other with different verdicts —
   * the first answer stands and the second is a no-op.
   */
  async setPlayed(gameId: string, played: boolean): Promise<boolean> {
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
      await httpsCallable(functions, 'setEveningPlayed')({ gameId, played });
      return true;
    } catch (err) {
      logError('setEveningPlayed', err, { gameId, played });
      return false;
    }
  },
};
