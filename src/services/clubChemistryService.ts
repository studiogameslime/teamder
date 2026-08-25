// Reading the club's pair rollup.
//
// One query for the whole club, then the six winners are picked in memory. The
// alternative — scanning every mini-game ever played each time the statistics
// screen opens — was never on the table: the real club has 57 mini-games behind
// 241 pairs, and that ratio only gets worse.
import { collection, getDocs, query, where } from 'firebase/firestore';

import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError, isExpectedDenial } from '@/services/errorLog';
import {
  EMPTY_PAIR,
  pickChemistry,
  type ChemistryPick,
  type PairTotals,
} from '@/utils/clubChemistry';
import { mockClubChemistry } from '@/data/mockClubChemistry';

export interface ClubChemistry {
  /** The six cards, minus any category with too little behind it. */
  picks: ChemistryPick[];
  /** Every pair in the club, so opening a card costs no further read. */
  pairs: Record<string, PairTotals>;
  /**
   * When these counters start.
   *
   * Every number on a pair card comes from this window and no other. The same
   * documents also carry a legacy `assists` total covering MORE history with no
   * direction to it — deliberately not read here, because a card showing that
   * total beside a directional breakdown would print a breakdown that does not
   * add up to its own total.
   */
  since: number | null;
}

const n = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

export const clubChemistryService = {
  async get(groupId: string): Promise<ClubChemistry> {
    const empty: ClubChemistry = { picks: [], pairs: {}, since: null };
    if (!groupId) return empty;
    if (USE_MOCK_DATA) return mockClubChemistry();
    try {
      const { db } = getFirebase();
      const [rows, stats] = await Promise.all([
        getDocs(query(collection(db, 'communityPairStats'), where('groupId', '==', groupId))),
        getDocs(query(collection(db, 'communityStats'), where('groupId', '==', groupId))),
      ]);
      const pairs: Record<string, PairTotals> = {};
      rows.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const a = typeof x.a === 'string' ? x.a : '';
        const b = typeof x.b === 'string' ? x.b : '';
        if (!a || !b) return;
        pairs[a < b ? `${a}__${b}` : `${b}__${a}`] = {
          ...EMPTY_PAIR,
          sameTeam: n(x.sameTeam),
          winsTogether: n(x.winsTogether),
          lossesTogether: n(x.lossesTogether),
          cleanSheetsTogether: n(x.cleanSheetsTogether),
          against: n(x.against),
          winsA: n(x.winsA),
          winsB: n(x.winsB),
          assistsAToB: n(x.assistsAToB),
          assistsBToA: n(x.assistsBToA),
        };
      });
      const since = stats.docs[0]?.get('chemistrySince');
      return {
        picks: pickChemistry(pairs),
        pairs,
        since: typeof since === 'number' && since > 0 ? since : null,
      };
    } catch (err) {
      if (!isExpectedDenial(err)) logError('clubChemistryGet', err, { groupId });
      return empty;
    }
  },
};
