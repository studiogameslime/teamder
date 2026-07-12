import {
  reduceRounds,
  computeFun,
  computeRadar,
  computeHeatZones,
  type RoundHistoryDoc,
} from '@/utils/eveningStats';

const R = (over: Partial<RoundHistoryDoc>): RoundHistoryDoc => ({
  roundId: '1',
  teamA: [],
  teamB: [],
  scoreA: 0,
  scoreB: 0,
  winnerSide: 'tie',
  goals: [],
  at: 0,
  ...over,
});

describe('reduceRounds', () => {
  const rounds: RoundHistoryDoc[] = [
    R({
      roundId: '1',
      at: 1,
      teamA: ['me', 'x'],
      teamB: ['y', 'z'],
      winnerSide: 'A',
      goals: [
        { scorerId: 'me', assisterId: null, ownGoal: false, team: 'A' },
        { scorerId: 'x', assisterId: 'me', ownGoal: false, team: 'A' },
      ],
    }),
    R({
      roundId: '2',
      at: 2,
      teamA: ['me', 'x'],
      teamB: ['w', 'v'],
      winnerSide: 'B',
      goals: [{ scorerId: 'w', assisterId: null, ownGoal: false, team: 'B' }],
    }),
    R({
      roundId: '3',
      at: 3,
      teamA: ['a', 'b'],
      teamB: ['me', 'x'],
      winnerSide: 'B',
      goals: [{ scorerId: 'me', assisterId: null, ownGoal: false, team: 'B' }],
    }),
  ];
  const s = reduceRounds('me', rounds);

  it('counts only rounds the player was on the field', () => {
    expect(s.playedRounds).toBe(3);
  });
  it('sums team goals for/against from the player POV', () => {
    expect(s.teamGoalsFor).toBe(3);
    expect(s.teamGoalsAgainst).toBe(1);
  });
  it('computes contribution as involvement ÷ team goals', () => {
    expect(s.contribution).toEqual({ pct: 100, touched: 3, teamGoals: 3 });
  });
  it('finds the best mini-game (most goals+assists)', () => {
    expect(s.bestMiniGame).toEqual({ round: 1, goals: 1, assists: 1 });
  });
  it('measures scoring + held-the-pitch streaks (broken by a loss)', () => {
    expect(s.scoringStreak).toBe(1);
    expect(s.heldPitch).toBe(1);
  });

  it('rewards a real held-the-pitch run of consecutive wins', () => {
    const streak = reduceRounds('me', [
      R({ at: 1, teamA: ['me'], teamB: ['o'], winnerSide: 'A' }),
      R({ at: 2, teamA: ['me'], teamB: ['p'], winnerSide: 'A' }),
      R({ at: 3, teamA: ['me'], teamB: ['q'], winnerSide: 'A' }),
      R({ at: 4, teamA: ['me'], teamB: ['r'], winnerSide: 'B' }),
    ]);
    expect(streak.heldPitch).toBe(3);
  });

  it('a sit-out round breaks both streaks (you did not hold the pitch)', () => {
    const s3 = reduceRounds('me', [
      R({ at: 1, teamA: ['me'], teamB: ['o'], winnerSide: 'A', goals: [{ scorerId: 'me', assisterId: null, ownGoal: false, team: 'A' }] }),
      R({ at: 2, teamA: ['a'], teamB: ['b'], winnerSide: 'A' }), // me sat out
      R({ at: 3, teamA: ['me'], teamB: ['q'], winnerSide: 'A', goals: [{ scorerId: 'me', assisterId: null, ownGoal: false, team: 'A' }] }),
    ]);
    // Two winning/scoring rounds separated by a sit-out must NOT bridge.
    expect(s3.heldPitch).toBe(1);
    expect(s3.scoringStreak).toBe(1);
    expect(s3.playedRounds).toBe(2);
  });

  it('own goals do not count toward team goals or contribution', () => {
    const s2 = reduceRounds('me', [
      R({
        at: 1,
        teamA: ['me'],
        teamB: ['o'],
        winnerSide: 'B',
        goals: [{ scorerId: 'me', assisterId: null, ownGoal: true, team: 'A' }],
      }),
    ]);
    expect(s2.teamGoalsFor).toBe(0);
    expect(s2.contribution).toBeNull();
  });

  it('returns null contribution when the team never scored', () => {
    expect(reduceRounds('me', [R({ teamA: ['me'], teamB: ['o'], winnerSide: 'B' })]).contribution).toBeNull();
  });
});

describe('computeFun', () => {
  it('translates calories + distance into fun units', () => {
    const f = computeFun({ calories: 640, distanceM: 6200 });
    expect(f.pizzas).toBe(2.5);
    expect(f.fieldLengths).toBe(59);
    expect(f.phoneCharges).toBe(4);
  });
  it('is safe for a device with no data', () => {
    expect(computeFun({})).toEqual({ pizzas: 0, fieldLengths: 0, phoneCharges: 0 });
  });
});

describe('computeRadar', () => {
  it('clamps every axis to 0..1 and names a two-axis profile', () => {
    const r = computeRadar({ distanceM: 99999, topSpeedKmh: 99, effortScore: 200 }, 20, 20);
    for (const k of ['attack', 'run', 'speed', 'stamina', 'assist'] as const) {
      expect(r[k]).toBeGreaterThanOrEqual(0);
      expect(r[k]).toBeLessThanOrEqual(1);
    }
    expect(r.profile).toContain('-');
  });
});

describe('computeHeatZones', () => {
  it('splits a top-heavy grid into attack-dominant zones', () => {
    const z = computeHeatZones([1, 1, 0, 0], 2, 2);
    expect(z).toEqual({ attack: 100, middle: 0, defense: 0 });
  });
  it('returns null for an empty / malformed grid', () => {
    expect(computeHeatZones([], 0, 0)).toBeNull();
    expect(computeHeatZones([1], 5, 5)).toBeNull();
  });
});
