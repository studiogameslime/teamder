import { earliestCountLeaders, earliestWinRateLeaders, randomLeader, type LeaderHistoryRow } from '../../src/utils/leaderChronology';
const row = (uid: string, at: number, goals: number, gameId = String(at)): LeaderHistoryRow => ({ uid, at, gameId, values: { goals } });
test('a later equalizer cannot displace the player who reached twenty first', () => {
  const history = [row('first', 1, 10), row('later', 1, 10), row('first', 2, 10), row('later', 3, 10)];
  expect(earliestCountLeaders(['later', 'first'], 'goals', 20, history)).toEqual(['first']);
});
test('same-evening ties remain eligible for a random single representative', () => {
  const history = [row('a', 1, 20), row('b', 1, 20)];
  const ids = earliestCountLeaders(['b', 'a'], 'goals', 20, history)!;
  expect(ids).toHaveLength(2);
  expect(randomLeader(ids, () => 0)).toBe('a');
  expect(randomLeader(ids, () => 0.99)).toBe('b');
});
test('missing history never fabricates an earlier attainment', () => {
  expect(earliestCountLeaders(['a', 'b'], 'goals', 20, [row('a', 1, 20), row('b', 2, 5)])).toBeNull();
});
test('later zero-contribution rounds do not move an attainment date', () => {
  const history = [row('a', 1, 20), row('b', 2, 20), row('a', 3, 0)];
  expect(earliestCountLeaders(['a', 'b'], 'goals', 20, history)).toEqual(['a']);
});
test('different metrics keep independent chronology and invalid values stay unknown', () => {
  const history = [row('a', 1, 20), row('b', 2, 20)];
  history[0].values.assists = 5; history[1].values.assists = 5;
  expect(earliestCountLeaders(['a', 'b'], 'assists', 5, history)).toEqual(['a']);
  history[0].values.assists = -1;
  expect(earliestCountLeaders(['a', 'b'], 'assists', 5, history)).toBeNull();
});
test('win-rate chronology cannot award an early percentage before attendance eligibility', () => {
  const history: LeaderHistoryRow[] = [
    { uid: 'a', gameId: 'one', at: 1, values: { wins: 1, rounds: 1, games: 1 } },
    { uid: 'a', gameId: 'three', at: 3, values: { wins: 1, rounds: 1, games: 1 } },
    { uid: 'b', gameId: 'one', at: 1, values: { wins: 1, rounds: 1, games: 1 } },
    { uid: 'b', gameId: 'two', at: 2, values: { wins: 1, rounds: 1, games: 1 } },
  ];
  const expected = { a: { wins: 2, rounds: 2, games: 2 }, b: { wins: 2, rounds: 2, games: 2 } };
  expect(earliestWinRateLeaders(['a', 'b'], 100, 2, history, expected)).toEqual(['b']);
  expect(earliestWinRateLeaders(['a', 'b'], 100, 2, history.slice(1), expected)).toBeNull();
});
