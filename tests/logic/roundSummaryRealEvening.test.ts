/**
 * The core, run against a real evening pulled out of production.
 *
 * Hand-written objects prove the rules; this proves the SHAPES — that what the
 * app actually stores after a night of football feeds the summary without a
 * translation layer quietly papering over a mismatch. The fixture is the
 * 19.08.2026 evening of "כדורגל אנשים טובים": 10 mini-games, 15 players.
 */
import fixture from '../fixtures/evening-19-08.json';
import {
  buildRoundSummary,
  type PlayerEvening,
  type RoundRec,
} from '@/utils/roundSummary';

const summary = buildRoundSummary({
  gameId: fixture.gameId,
  groupId: fixture.groupId,
  at: 1_755_000_000_000,
  players: fixture.players as PlayerEvening[],
  rounds: fixture.rounds as RoundRec[],
  career: [],
  club: { goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 },
  records: null,
  personalBests: {},
  standings: [],
  basis: { since: null, eveningsCompared: 0 },
  now: 1_755_000_100_000,
});

it('reads the evening exactly as it was played', () => {
  // A real 3-team evening: every mini-game had a winner, so `ties` is 0 — which
  // is exactly why the club table hides the draws column for this club.
  expect(summary.stats).toEqual({
    rounds: 10, goals: 20, assists: 17, shootouts: 3, ties: 0,
  });
});

it('finds the same leaders a human counting by hand would', () => {
  // איתי דוידי, 5 goals — and he was alone on 5.
  expect(summary.leaders.topScorers?.value).toBe(5);
  expect(summary.leaders.topScorers?.userIds).toHaveLength(1);
  // ראובן מימון, 5 assists.
  expect(summary.leaders.topAssisters?.value).toBe(5);
  expect(summary.leaders.topAssisters?.userIds).toHaveLength(1);
});

it('finds the blue team, which won six of the ten', () => {
  expect(summary.teamHighlights.best).toEqual([
    { colourIndex: 1, wins: 6, losses: 2, played: 8 },
  ]);
});

it('finds the pair that actually created goals together', () => {
  // ראובן מימון and איתי דוידי: four goals one way, one back — five between
  // them, and the strongest link of the night. Nobody in the club could have
  // named it the morning after, which is the whole reason to compute it.
  expect(summary.pairHighlight?.goals).toBe(5);
  expect(summary.pairHighlight?.userIds).toHaveLength(2);
  expect(summary.pairHighlight?.breakdown).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ goals: 4 }),
      expect.objectContaining({ goals: 1 }),
    ]),
  );
});

it('claims nothing it cannot support — no history, no records', () => {
  expect(summary.events).toHaveLength(0);
  expect(summary.coverage).toEqual({ hasRoundHistory: true, hasAssists: true });
});

it('never double-counts a mini-game across the players who played it', () => {
  const appearances = (fixture.players as PlayerEvening[]).reduce((a, p) => a + p.rounds, 0);
  expect(appearances).toBeGreaterThan(summary.stats.rounds * 5);
  expect(summary.stats.rounds).toBe(fixture.rounds.length);
});
