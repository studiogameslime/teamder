import { buildRoundSummary, type RoundSummaryInput } from '@/utils/roundSummary';
import { buildRoundSummary as buildServerRoundSummary } from '../../functions/src/roundSummary';
import { correctedRoundSummary } from '../../functions/src/retroRoundSummary';

function threeToOneEvening(): RoundSummaryInput {
  return {
    gameId: 'summary-guest-evening',
    groupId: 'summary-guest-club',
    at: 1_700_000_000_000,
    players: [
      { userId: 'guest:scorer', isGuest: true, goals: 1, assists: 0, wins: 1, cleanSheets: 0, rounds: 1 },
      { userId: 'guest:assister', isGuest: true, goals: 0, assists: 1, wins: 1, cleanSheets: 0, rounds: 1 },
      { userId: 'opponent', goals: 1, assists: 0, wins: 0, cleanSheets: 0, rounds: 1 },
    ],
    rounds: [{
      teamAIndex: 0,
      teamBIndex: 1,
      winnerSide: 'A',
      shootout: false,
      goals: [
        { scorerId: 'guest:scorer', assisterId: 'guest:assister', ownGoal: false, team: 'A' },
        { scorerId: null, assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'opponent', assisterId: null, ownGoal: true, team: 'A' },
        { scorerId: 'opponent', assisterId: null, ownGoal: false, team: 'B' },
      ],
    }],
    career: [],
    club: { goals: 0, assists: 0, rounds: 0, cleanSheets: 0, shootoutRounds: 0, evenings: 0 },
    records: null,
    personalBests: {},
    standings: [],
    basis: { since: 1, eveningsCompared: 0 },
    now: 1_700_000_100_000,
  };
}

describe.each([
  ['client', buildRoundSummary],
  ['server', buildServerRoundSummary],
] as const)('%s complete evening goal totals', (_name, build) => {
  it('counts all four goals in 3:1: guest, unknown scorer, own goal and opponent', () => {
    const evening = threeToOneEvening();
    expect(evening.rounds[0].goals.filter((event) => event.team === 'A')).toHaveLength(3);
    expect(evening.rounds[0].goals.filter((event) => event.team === 'B')).toHaveLength(1);

    const summary = build(evening);

    expect(summary.stats).toEqual({ rounds: 1, goals: 4, assists: 1, shootouts: 0, ties: 0 });
    // Guests contribute to the evening totals, while unidentified/own goals
    // never invent individual credits or change the real opponent's one goal.
    expect(summary.leaders.topScorers).toEqual({ userIds: ['opponent'], value: 1 });
    expect(summary.leaders.topAssisters).toBeNull();
    expect(evening.players.map(({ userId, goals, assists }) => ({ userId, goals, assists }))).toEqual([
      { userId: 'guest:scorer', goals: 1, assists: 0 },
      { userId: 'guest:assister', goals: 0, assists: 1 },
      { userId: 'opponent', goals: 1, assists: 0 },
    ]);
  });

  it('counts an unidentified own goal exactly once', () => {
    const evening = threeToOneEvening();
    evening.rounds[0].goals[2].scorerId = null;

    expect(build(evening).stats.goals).toBe(4);
  });

  it('keeps corrected player rows authoritative without counting known history goals again', () => {
    const evening = threeToOneEvening();
    // Completing a missed goal changes the guest's player row; it does not
    // rewrite the original 3:1 mini-game or add a fifth history event.
    evening.players[0].goals += 1;
    evening.players[1].assists += 1;

    expect(build(evening).stats).toEqual({ rounds: 1, goals: 5, assists: 2, shootouts: 0, ties: 0 });
    expect(evening.rounds[0].goals).toHaveLength(4);
  });

  it('preserves goals with an unknown scorer even when there are no individual stats rows', () => {
    const evening = threeToOneEvening();
    evening.players = [];
    evening.rounds[0].goals = [{ scorerId: null, assisterId: null, ownGoal: false, team: 'B' }];

    expect(build(evening).stats).toEqual({ rounds: 1, goals: 1, assists: 0, shootouts: 0, ties: 0 });
  });
});

describe('server summary correction with unidentified and guest goals', () => {
  it('rebuilds the complete 3:1 total from normalized history and guest rows', () => {
    const evening = threeToOneEvening();
    const original = { gameId: evening.gameId, groupId: evening.groupId, at: evening.at, events: [] };
    const stats = evening.players.map(({ isGuest: _isGuest, ...player }) => player);
    const summary = correctedRoundSummary(original, stats, evening.rounds, [], [], evening.now);

    expect(summary.stats).toEqual({ rounds: 1, goals: 4, assists: 1, shootouts: 0, ties: 0 });
    expect(summary.leaders.topScorers).toEqual({ userIds: ['opponent'], value: 1 });
    expect(summary.leaders.topAssisters).toBeNull();
  });

  it('adds and removes a guest retro goal once while keeping the unknown and own goals', () => {
    const evening = threeToOneEvening();
    const original = { gameId: evening.gameId, groupId: evening.groupId, at: evening.at, events: [] };
    const correctedStats = evening.players.map((player) => ({
      ...player,
      goals: player.goals + (player.userId === 'guest:scorer' ? 1 : 0),
      assists: player.assists + (player.userId === 'guest:assister' ? 1 : 0),
    }));
    const retro = [{ scorerId: 'guest:scorer', assisterId: 'guest:assister' }];

    const afterAdd = correctedRoundSummary(original, correctedStats, evening.rounds, retro, [], evening.now);
    const afterRemove = correctedRoundSummary(original, evening.players, evening.rounds, [], [], evening.now + 1);

    expect(afterAdd.stats).toEqual({ rounds: 1, goals: 5, assists: 2, shootouts: 0, ties: 0 });
    expect(afterRemove.stats).toEqual({ rounds: 1, goals: 4, assists: 1, shootouts: 0, ties: 0 });
    expect(evening.rounds[0].goals).toHaveLength(4);
  });
});
