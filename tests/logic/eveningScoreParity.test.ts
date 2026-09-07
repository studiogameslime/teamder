// CONTRACT test: the evening score means the same thing on both sides (P1-11).
//
// The formula is implemented twice — src/utils/eveningScore.ts (the number the
// player reads on the summary card) and functions/src/eveningScoreCore.ts (the
// number onGameRosterChanged seals into eveningStandings and ranks the club by).
// There is no build that spans the app bundle and the Cloud Functions package,
// so they cannot share a module. This is the thing that keeps them honest.
//
// It has already been needed once: the server copy silently dropped the penalty
// axis, so a keeper who saved a shootout penalty had it recorded in his stats
// and missing from the score that ranked him.
//
// If you change one implementation, this fails. That is not the test being
// brittle — it is the test doing its job. Change both.

import {
  eveningScore,
  DEFAULT_GOALS_FOR_10,
  DEFAULT_ASSISTS_FOR_10,
  BENCHMARK_FLOOR,
  SCORE_WEIGHTS_NO_PEN,
  SCORE_WEIGHTS_WITH_PEN,
  PENALTY_POINTS,
  type PenaltyTally,
} from '@/utils/eveningScore';
import {
  eveningScoreServer,
  DEFAULT_GOALS_FOR_10 as SRV_DEFAULT_GOALS,
  DEFAULT_ASSISTS_FOR_10 as SRV_DEFAULT_ASSISTS,
  BENCHMARK_FLOOR as SRV_FLOOR,
} from '../../functions/src/eveningScoreCore';

const NO_PEN: PenaltyTally = { scored: 0, saved: 0, missed: 0, conceded: 0 };

/** The caller resolves the benchmarks before calling the server function; the
 *  client function resolves them internally. Apply the same resolution so the
 *  two are being asked the same question. */
const resolve = (v: number | undefined, fallback: number) =>
  Math.max(BENCHMARK_FLOOR, v && v > 0 ? v : fallback);

function bothAgree(input: {
  goals: number;
  assists: number;
  wins: number;
  gamesPlayed: number;
  goalsFor10?: number;
  assistsFor10?: number;
  pen: PenaltyTally;
}): { client: number; server: number } {
  const client = eveningScore(input);
  const server = eveningScoreServer(
    input.goals,
    input.assists,
    input.wins,
    input.gamesPlayed,
    resolve(input.goalsFor10, DEFAULT_GOALS_FOR_10),
    resolve(input.assistsFor10, DEFAULT_ASSISTS_FOR_10),
    input.pen,
  );
  return { client, server };
}

describe('the constants are the same on both sides', () => {
  it('benchmark defaults and floor match', () => {
    expect(SRV_DEFAULT_GOALS).toBe(DEFAULT_GOALS_FOR_10);
    expect(SRV_DEFAULT_ASSISTS).toBe(DEFAULT_ASSISTS_FOR_10);
    expect(SRV_FLOOR).toBe(BENCHMARK_FLOOR);
  });

  it('each weight set still sums to exactly 1.0', () => {
    const a = SCORE_WEIGHTS_NO_PEN;
    const b = SCORE_WEIGHTS_WITH_PEN;
    expect(a.wins + a.goals + a.assists).toBeCloseTo(1, 10);
    expect(b.wins + b.goals + b.assists + b.penalties).toBeCloseTo(1, 10);
  });

  it('the penalty axis takes its share out of WINS, leaving the rest fixed', () => {
    expect(SCORE_WEIGHTS_WITH_PEN.goals).toBe(SCORE_WEIGHTS_NO_PEN.goals);
    expect(SCORE_WEIGHTS_WITH_PEN.assists).toBe(SCORE_WEIGHTS_NO_PEN.assists);
    expect(SCORE_WEIGHTS_NO_PEN.wins - SCORE_WEIGHTS_WITH_PEN.wins)
      .toBeCloseTo(SCORE_WEIGHTS_WITH_PEN.penalties, 10);
  });
});

describe('golden cases — named situations, both implementations', () => {
  const cases: [string, Parameters<typeof bothAgree>[0], number][] = [
    ['a player who took the field for no mini-games gets the floor',
      { goals: 0, assists: 0, wins: 0, gamesPlayed: 0, pen: NO_PEN }, 6.0],
    // Showing up and losing everything now scores just ABOVE the 6.0 floor a
    // no-show gets — a consequence of the win-rate shrinkage, and the right way
    // round: turning up beats not turning up.
    ['a quiet evening: played, lost everything, scored nothing',
      { goals: 0, assists: 0, wins: 0, gamesPlayed: 4, pen: NO_PEN }, 6.3],
    // A four-game sweep no longer reads as a flawless record — that claim is
    // exactly what WIN_PRIOR_GAMES exists to stop.
    ['a perfect evening against the default benchmarks',
      { goals: 4, assists: 2, wins: 4, gamesPlayed: 4, pen: NO_PEN }, 9.7],
    ['beyond perfect still clamps at 10',
      { goals: 40, assists: 20, wins: 4, gamesPlayed: 4, pen: NO_PEN }, 9.7],
    ['an ordinary good night',
      { goals: 2, assists: 1, wins: 2, gamesPlayed: 4, pen: NO_PEN }, 8.0],
    ['a keeper who saved one in the shootout',
      { goals: 0, assists: 0, wins: 2, gamesPlayed: 4,
        pen: { scored: 0, saved: 1, missed: 0, conceded: 0 } }, 7.1],
    ['a striker who missed his penalty',
      { goals: 1, assists: 0, wins: 1, gamesPlayed: 4,
        pen: { scored: 0, saved: 0, missed: 1, conceded: 0 } }, 7.0],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      const { client, server } = bothAgree(input);
      expect(client).toBe(server);
      expect(client).toBe(expected);
    });
  }
});

describe('the two implementations agree across the whole input space', () => {
  it('exhaustive sweep of realistic evenings', () => {
    const pens: PenaltyTally[] = [
      NO_PEN,
      { scored: 1, saved: 0, missed: 0, conceded: 0 },
      { scored: 0, saved: 2, missed: 0, conceded: 0 },
      { scored: 0, saved: 0, missed: 1, conceded: 0 },
      { scored: 0, saved: 0, missed: 0, conceded: 3 },
      { scored: 2, saved: 1, missed: 1, conceded: 1 },
    ];
    let checked = 0;
    for (const gamesPlayed of [0, 1, 3, 5, 8, 12]) {
      for (const goals of [0, 1, 2, 5, 11]) {
        for (const assists of [0, 1, 3, 7]) {
          for (const wins of [0, 1, 3, 8, 12]) {
            for (const goalsFor10 of [undefined, 0, 0.5, 1, 3, 6.5]) {
              for (const pen of pens) {
                const { client, server } = bothAgree({
                  goals, assists, wins, gamesPlayed, goalsFor10, pen,
                });
                expect(server).toBe(client);
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });

  it('agrees on the degenerate benchmarks the floor is there to catch', () => {
    // A club whose history says "the top scorer usually gets 0.2 goals" must not
    // make one goal worth a perfect 10 — on either side.
    for (const bench of [0, -1, 0.01, 0.5, 1]) {
      const { client, server } = bothAgree({
        goals: 1, assists: 1, wins: 1, gamesPlayed: 2,
        goalsFor10: bench, assistsFor10: bench, pen: NO_PEN,
      });
      expect(server).toBe(client);
    }
  });

  it('every result stays inside the 6.0–10.0 display range, to one decimal', () => {
    for (const goals of [0, 3, 50]) {
      for (const wins of [0, 2, 99]) {
        const { client, server } = bothAgree({
          goals, assists: 0, wins, gamesPlayed: 2,
          pen: { scored: 9, saved: 9, missed: 9, conceded: 9 },
        });
        for (const v of [client, server]) {
          expect(v).toBeGreaterThanOrEqual(6);
          expect(v).toBeLessThanOrEqual(10);
          expect(Math.round(v * 10) / 10).toBe(v);
        }
      }
    }
  });

  it('the penalty axis is present on BOTH sides — the drift that happened', () => {
    // The regression witness: if the server copy loses the penalty term again,
    // a saved penalty stops moving the server score while it still moves the
    // client one, and this fails.
    const base = { goals: 1, assists: 1, wins: 2, gamesPlayed: 4 };
    const without = bothAgree({ ...base, pen: NO_PEN });
    const withSave = bothAgree({
      ...base,
      pen: { scored: 0, saved: 2, missed: 0, conceded: 0 },
    });
    expect(withSave.server).not.toBe(without.server);
    expect(withSave.server).toBe(withSave.client);
    expect(PENALTY_POINTS.saved).toBeGreaterThan(0);
  });
});

describe('a tiny sample cannot buy a perfect record', () => {
  // The reported bug, in the reporter's own terms: "שחקן ששיחק משחק אחד וניצח
  // אותו יכול לקבל יתרון על שחקן ששיחק 5 משחקים וניצח 4 (לא תקין)".
  const winsOnly = (wins: number, gamesPlayed: number) =>
    bothAgree({ goals: 0, assists: 0, wins, gamesPlayed, pen: NO_PEN });

  it('one game won no longer outranks four wins from five', () => {
    const one = winsOnly(1, 1);
    const five = winsOnly(4, 5);
    expect(one.client).toBe(one.server);
    expect(five.client).toBe(five.server);
    expect(five.client).toBeGreaterThan(one.client);
  });

  it('the same win RATE scores higher the more mini-games back it', () => {
    // 100% over 1, 2, 4 and 8 games — strictly increasing confidence.
    const scores = [1, 2, 4, 8].map((n) => winsOnly(n, n).client);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it('winning more of the same number of games always scores higher', () => {
    const scores = [0, 1, 2, 3, 4, 5].map((w) => winsOnly(w, 5).client);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    }
  });

  it('turning up and losing everything still beats not turning up', () => {
    expect(winsOnly(0, 4).client).toBeGreaterThan(winsOnly(0, 0).client);
    expect(winsOnly(0, 0).client).toBe(6.0);
  });
});
