// Reading the sealed round summary.
//
// There is deliberately no builder here. The summary is written once by the
// Cloud Function that closes the evening, against a history that has already
// moved on by the time anyone opens the screen — so the client's only job is to
// fetch it. If the document is missing, the honest answer is "no summary for
// this evening", not a second, differently-computed one.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError, isExpectedDenial } from '@/services/errorLog';
import type { RoundSummary } from '@/utils/roundSummary';
import type { EveningStat } from '@/utils/eveningRecords';
import { mockRoundSummary, mockEveningStats } from '@/data/mockRoundSummary';

export const roundSummaryService = {
  /**
   * The club's summary for one evening, or null when there is none.
   *
   * Null is a normal outcome, not a failure: evenings played before this
   * feature existed were never sealed, and an evening that ran without the
   * live rotation has nothing to summarise.
   */
  /**
   * Every sealed evening of one club, reduced to the four numbers the club
   * records need.
   *
   * ⚠️ READ COST. This is a collection query, and its size grows with the
   * club's history — today the whole production database holds 25 summaries,
   * but a club that plays weekly for five years would have ~250. That is
   * acceptable for a screen the user opens deliberately and NOT acceptable as
   * a background read, which is why it is called only by the statistics tab
   * and only once per mount.
   *
   * The bounded alternative is a running maximum written at seal time, in
   * `nextRecordBaseline` beside the per-player records it already keeps. It
   * was not taken here for a reason worth writing down: the season archive
   * seals club counters through `totals: Record<string, number>`, and a record
   * carries a gameId as well as a value, so a rollup means widening that
   * contract through the rollover, the archive reader and the all-time sum —
   * and none of it could be demonstrated without a deploy, because the field
   * would be empty until one. Reading the documents that already exist is
   * correct today and provable today.
   *
   * `MAX` is a guard, not a product rule: past it the maximum could be wrong,
   * so the caller is told and the section says "since measurement began"
   * anyway.
   */
  async listEveningStats(
    groupId: string,
    opts?: { from?: number; to?: number },
  ): Promise<{ evenings: EveningStat[]; truncated: boolean }> {
    if (!groupId) return { evenings: [], truncated: false };
    if (USE_MOCK_DATA) {
      return { evenings: mockEveningStats(groupId, opts), truncated: false };
    }
    const MAX = 400;
    try {
      const db = getFirebase().db;
      // Ordered by `at` so the range filter and the order agree — Firestore
      // requires the first orderBy to be the inequality's field.
      const clauses = [
        where('groupId', '==', groupId),
        ...(opts?.from !== undefined ? [where('at', '>=', opts.from)] : []),
        ...(opts?.to !== undefined ? [where('at', '<=', opts.to)] : []),
        orderBy('at', 'desc'),
        fsLimit(MAX),
      ];
      const snap = await getDocs(
        query(collection(db, 'roundSummaries'), ...clauses),
      );
      const evenings: EveningStat[] = snap.docs.map((d) => {
        const v = d.data() as {
          gameId?: string;
          at?: number;
          stats?: { goals?: number; rounds?: number; shootouts?: number };
          coverage?: { hasRoundHistory?: boolean };
        };
        const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
        return {
          gameId: typeof v.gameId === 'string' ? v.gameId : d.id,
          at: n(v.at),
          goals: n(v.stats?.goals),
          rounds: n(v.stats?.rounds),
          shootouts: n(v.stats?.shootouts),
          hasRoundHistory: v.coverage?.hasRoundHistory === true,
        };
      });
      return { evenings, truncated: snap.size >= MAX };
    } catch (err) {
      if (!isExpectedDenial(err)) {
        logError('listEveningStats', err, { groupId });
      }
      if (__DEV__) console.warn('[roundSummary] listEveningStats failed', err);
      // An empty list hides the three cards. That is the right failure: a
      // record nobody can verify is worse than no record.
      return { evenings: [], truncated: false };
    }
  },

  async get(gameId: string): Promise<RoundSummary | null> {
    if (!gameId) return null;
    if (USE_MOCK_DATA) return mockRoundSummary(gameId);
    try {
      const snap = await getDoc(doc(getFirebase().db, 'roundSummaries', gameId));
      if (!snap.exists()) return null;
      return snap.data() as RoundSummary;
    } catch (err) {
      // A member of another club reading a shared link is denied by the rules;
      // that is the rule working, not an error worth reporting.
      if (!isExpectedDenial(err)) logError('roundSummaryGet', err, { gameId });
      return null;
    }
  },
};
