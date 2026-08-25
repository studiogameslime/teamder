// Demo-mode chemistry. Hand-built: the mock club has no mini-game history for
// pairs to have arisen from, and the point of the section is what a club with
// a season behind it looks like.
import { EMPTY_PAIR, pickChemistry, type PairTotals } from '@/utils/clubChemistry';
import { mockPlayers } from '@/data/mockData';
import type { ClubChemistry } from '@/services/clubChemistryService';

export function mockClubChemistry(): ClubChemistry {
  const id = (i: number) => mockPlayers[i % mockPlayers.length]?.id ?? `p${i}`;
  const key = (x: string, y: string) => (x < y ? `${x}__${y}` : `${y}__${x}`);
  const P = (o: Partial<PairTotals>): PairTotals => ({ ...EMPTY_PAIR, ...o });
  const pairs: Record<string, PairTotals> = {
    [key(id(0), id(1))]: P({ sameTeam: 27, winsTogether: 14, lossesTogether: 9, cleanSheetsTogether: 7, assistsAToB: 6, assistsBToA: 3 }),
    [key(id(2), id(3))]: P({ sameTeam: 21, winsTogether: 8, lossesTogether: 10, cleanSheetsTogether: 12 }),
    [key(id(4), id(5))]: P({ against: 26, winsA: 13, winsB: 13 }),
    [key(id(6), id(7))]: P({ against: 22, winsA: 15, winsB: 7 }),
  };
  return {
    picks: pickChemistry(pairs),
    pairs,
    since: Date.now() - 45 * 24 * 60 * 60 * 1000,
  };
}
