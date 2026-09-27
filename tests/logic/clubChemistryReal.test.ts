/**
 * The chemistry core, run over the real club's whole mini-game history.
 *
 * The unit tests prove the rules; this proves the SHAPES and the outcome —
 * that 57 real mini-games produce six answers a person who was there would
 * recognise, and that a pair reads identically no matter which way round it is
 * asked for. That last one is the failure mode with no visible symptom: a
 * head-to-head shown reversed still looks like a perfectly good statistic.
 */
import rounds from '../fixtures/club-rounds.json';
import {
  pairsFromRounds,
  mergePairs,
  pickChemistry,
  pairKey,
  type ChemistryRound,
  type PairTotals,
} from '@/utils/clubChemistry';

let pairs: Record<string, PairTotals> = {};
let miniGames = 0;
for (const evening of rounds.evenings as { rounds: ChemistryRound[] }[]) {
  if (evening.rounds.length === 0) continue;
  miniGames += evening.rounds.length;
  pairs = mergePairs(pairs, pairsFromRounds(evening.rounds));
}
const picks = pickChemistry(pairs);
const by = Object.fromEntries(picks.map((p) => [p.kind, p]));

it('reads the club that actually played', () => {
  expect(miniGames).toBe(57);
  expect(Object.keys(pairs).length).toBe(241);
});

it('finds every category on the club that actually played', () => {
  // Eight, since the club screen's five cards added the win-rate and the
  // losses pairs. This fixture is a real club's rollup, so it is also the
  // check that both new kinds are reachable on real data rather than only in
  // a hand-built pair.
  expect(picks.map((p) => p.kind).sort()).toEqual(
    [
      'balancedRivalry',
      'bestRatio',
      'deadlyDuo',
      'mostLosses',
      'regulars',
      'rivalry',
      'wall',
      'winningDuo',
    ].sort(),
  );
});

it('agrees with the numbers counted independently', () => {
  expect(by.winningDuo.value).toBe(14);
  expect(by.regulars.value).toBe(27);
  expect(by.deadlyDuo.value).toBe(9);
  expect(by.wall.value).toBe(12);
  expect(by.rivalry.value).toBe(26);
});

it('reports the two real ties instead of picking a winner', () => {
  expect(by.wall.tied).toBe(true);
  expect(by.wall.pairs).toHaveLength(2);
  expect(by.rivalry.tied).toBe(true);
  expect(by.rivalry.pairs).toHaveLength(2);
});

it('finds a rivalry that is genuinely level, over a real sample', () => {
  const b = by.balancedRivalry.balance!;
  expect(b.winsA).toBe(b.winsB);
  expect(b.against).toBe(26);
});

it('never lets a pair total exceed the mini-games that were played', () => {
  for (const [key, p] of Object.entries(pairs)) {
    expect(p.winsTogether + p.lossesTogether).toBeLessThanOrEqual(p.sameTeam);
    expect(p.cleanSheetsTogether).toBeLessThanOrEqual(p.sameTeam);
    expect(p.winsA + p.winsB).toBeLessThanOrEqual(p.against);
    // Same-team and against are mutually exclusive per mini-game, so together
    // they cannot exceed the evening count either.
    expect(p.sameTeam + p.against).toBeLessThanOrEqual(miniGames);
    expect(key).toBe(pairKey(...(key.split('__') as [string, string])));
  }
});

it('gives the same pair the same numbers whichever way round it is asked', () => {
  const [a, b] = by.balancedRivalry.pairs[0].split('__');
  expect(pairKey(a, b)).toBe(pairKey(b, a));
  expect(pairs[pairKey(a, b)]).toBe(pairs[pairKey(b, a)]);
});

it('keeps one club’s pairs out of another club’s rollup', () => {
  // Every key here was built from THIS club's rounds only; the global
  // pairStats collection is never consulted by the core at all.
  const players = new Set<string>();
  for (const evening of rounds.evenings as { rounds: ChemistryRound[] }[]) {
    for (const r of evening.rounds) [...r.teamA, ...r.teamB].forEach((u) => players.add(u));
  }
  for (const key of Object.keys(pairs)) {
    const [x, y] = key.split('__');
    expect(players.has(x)).toBe(true);
    expect(players.has(y)).toBe(true);
  }
});
