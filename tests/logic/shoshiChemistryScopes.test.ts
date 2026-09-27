// "כימיה במועדון" in all three scopes, on שכחת שושי's PRODUCTION documents.
//
// The owner's report: the section was missing from both "כל הזמנים" and
// "עונה 1". Two different causes wearing one symptom.
//
//   עונה 1      the data was there all along — 21 pairs sealed into the
//               archive — and `parseSeasonTable` never read the field, so it
//               did not exist on the client.
//   כל הזמנים   the data exists nowhere as a stored number: a season close
//               ZEROES the live pair documents, so they describe the running
//               season and the rest lives in the archives. It has to be summed.
//
// This runs the real documents through the real functions, so the numbers
// below are the ones the screen will draw.

import fixture from '../fixtures/shoshiChemistry.json';
import { parsePairs } from '@/utils/seasonArchive';
import { mergePairs, pickChemistry, pairMembers, type PairTotals } from '@/utils/clubChemistry';

const names = fixture.names as Record<string, string>;
const nameOf = (u: string) => names[u] ?? u.slice(0, 6);
const season = parsePairs(fixture.archivePairs);
const live = fixture.livePairs as unknown as Record<string, PairTotals>;
const allTime = mergePairs(live, season);

const cardsOf = (pairs: Record<string, PairTotals>) =>
  Object.fromEntries(
    pickChemistry(pairs).map((p) => {
      const [x, y] = pairMembers(p.pairs[0]);
      return [p.kind, `${nameOf(x)} + ${nameOf(y)} — ${p.value}`];
    }),
  );

describe('עונה 1 — a closed season has chemistry of its own', () => {
  it('reads all 21 sealed pairs off the archive', () => {
    expect(Object.keys(season)).toHaveLength(21);
  });

  it('and draws the cards that used to be absent entirely', () => {
    // Before the fix this object was empty, because `pairs` never reached the
    // client. deadlyDuo is still absent — it needs three assists between a
    // pair and this season's best is two. `bestRatio` joined when the club
    // screen's five categories were added: 7 wins in 10 shared mini-games.
    expect(cardsOf(season)).toEqual({
      winningDuo: 'מתן לוי + Lioz Madar — 7',
      regulars: 'מתן לוי + Lioz Madar — 10',
      bestRatio: 'מתן לוי + Lioz Madar — 70',
      wall: 'Lioz Madar + Nofar Tzabari — 6',
      rivalry: 'Nofar Tzabari + הלן צברי — 11',
      balancedRivalry: 'Nofar Tzabari + הלן צברי — 11',
    });
  });
});

describe('כל הזמנים — summed, because it is stored nowhere', () => {
  it('is strictly bigger than either window it is made of', () => {
    const key = Object.keys(season).find((k) => live[k])!;
    expect(allTime[key].sameTeam).toBe(season[key].sameTeam + live[key].sameTeam);
  });

  it('draws cards whose numbers exceed the season they came from', () => {
    const all = cardsOf(allTime);
    expect(all).toEqual({
      winningDuo: 'מתן לוי + Lioz Madar — 10',
      regulars: 'מתן לוי + Lioz Madar — 14',
      bestRatio: 'מתן לוי + Lioz Madar — 71',
      wall: 'מתן לוי + Lioz Madar — 6',
      rivalry: 'מתן לוי + איציק לוי — 12',
      balancedRivalry: 'Nofar Tzabari + הלן צברי — 11',
    });
    // The headline pair played 10 evenings together all-time against 7 in
    // season 1 — proof the live window really was added rather than replacing.
    expect(all.regulars).not.toEqual(cardsOf(season).regulars);
  });

  it('keeps a pair that exists only in the archive', () => {
    const archiveOnly = Object.keys(season).filter((k) => !live[k]);
    for (const k of archiveOnly) expect(allTime[k]).toEqual(season[k]);
  });
});

describe('עונה 2 — the running season, one evening in', () => {
  it('earns no cards yet, and that is the correct answer, not a failure', () => {
    // Every category has a minimum behind it. A club one evening into a season
    // has not played enough for any pair to mean anything, and the section
    // says so in words rather than drawing six cards built on nothing.
    expect(pickChemistry(live)).toHaveLength(0);
  });
});
