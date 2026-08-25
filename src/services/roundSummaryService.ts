// Reading the sealed round summary.
//
// There is deliberately no builder here. The summary is written once by the
// Cloud Function that closes the evening, against a history that has already
// moved on by the time anyone opens the screen — so the client's only job is to
// fetch it. If the document is missing, the honest answer is "no summary for
// this evening", not a second, differently-computed one.
import { doc, getDoc } from 'firebase/firestore';

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError, isExpectedDenial } from '@/services/errorLog';
import type { RoundSummary } from '@/utils/roundSummary';
import { mockRoundSummary } from '@/data/mockRoundSummary';

export const roundSummaryService = {
  /**
   * The club's summary for one evening, or null when there is none.
   *
   * Null is a normal outcome, not a failure: evenings played before this
   * feature existed were never sealed, and an evening that ran without the
   * live rotation has nothing to summarise.
   */
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
