import {
  startRotation,
  recordWinner,
  recordTie,
  rosterOf,
  canStart,
  type RotationTeam,
} from '@/services/rotationEngine';

// Deterministic picker (first n) so the scenarios are reproducible.
const pickFirst = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

function sizes(teamIdxs: number[], teams: RotationTeam[], loans: any[]) {
  return teamIdxs.map((i) => `team${i}=${rosterOf(i, teams, loans).length}`).join(', ');
}

describe('rotationEngine — 5v5, 13 guests → teams 5-4-4', () => {
  const perTeam = 5;
  // 13 players drafted into 3 uneven teams: 5, 4, 4.
  const teams: RotationTeam[] = [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4', 'a5'] },
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
    { index: 2, playerIds: ['c1', 'c2', 'c3', 'c4'] },
  ];

  it('starts with two FULL teams (short one borrows from the team that is off)', () => {
    const res = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    expect(res).not.toBeNull();
    const r = res.rotation;
    // Both playing teams are full (5).
    expect(rosterOf(r.playing[0], teams, r.loans).length).toBe(5);
    expect(rosterOf(r.playing[1], teams, r.loans).length).toBe(5);
    expect(r.playing).toEqual([0, 1]);
    expect(r.waiting).toEqual([2]);
    expect(r.loans).toHaveLength(1); // team1 borrowed 1 from team2
    // eslint-disable-next-line no-console
    console.log('\n[START] playing 0 vs 1 | ' + sizes([0, 1, 2], teams, r.loans) +
      ` | waiting=[${r.waiting}] | loans=${JSON.stringify(r.loans)}`);
  });

  it('rotates on a win: loser out, waiting in, filled from the loser; temp loan returns home', () => {
    const start = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    // team0 beats team1.
    const next = recordWinner(0, teams, start.rotation, perTeam, 'temporary', pickFirst);
    const r = next.rotation;
    expect(r.playing).toEqual([0, 2]);   // winner stays, team2 comes on
    expect(r.waiting).toEqual([1]);      // loser waits
    expect(rosterOf(0, teams, r.loans).length).toBe(5);
    expect(rosterOf(2, teams, r.loans).length).toBe(5); // team2 filled from loser
    // c1 (borrowed into team1 at start) returned to its home team2.
    expect(r.loans.some((l) => l.playerId === 'c1')).toBe(false);
    // eslint-disable-next-line no-console
    console.log('[WIN 0] playing 0 vs 2 | ' + sizes([0, 1, 2], teams, r.loans) +
      ` | waiting=[${r.waiting}] | loans=${JSON.stringify(r.loans)}\n`);
  });
});

// The format is the PLAN for the evening, not a rule about who may play.
// Eight people who turned up to a 5v5 game play 4v4, and until this they could
// not start at all — the owner's report, and the reason the rule changed.
describe('rotationEngine — a short evening still starts', () => {
  const perTeam = 5;
  const teams: RotationTeam[] = [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
  ];
  it('8 players in a 5v5 game start as 4v4', () => {
    expect(canStart(teams)).toBe(true);
    const r = startRotation(teams, perTeam, 'temporary', pickFirst);
    expect(r).not.toBeNull();
    expect(r!.rotation.playing).toEqual([0, 1]);
    // Nobody is borrowed: there is no third team to borrow FROM, and the two
    // sides stay as they were drafted.
    expect(rosterOf(0, r!.teams, r!.rotation.loans).length).toBe(4);
    expect(rosterOf(1, r!.teams, r!.rotation.loans).length).toBe(4);
  });

  it('starts uneven too — 4 against 3 is a real evening', () => {
    const uneven: RotationTeam[] = [
      { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
      { index: 1, playerIds: ['b1', 'b2', 'b3'] },
    ];
    expect(canStart(uneven)).toBe(true);
    expect(startRotation(uneven, perTeam, 'temporary', pickFirst)).not.toBeNull();
  });

  // What is still refused: a side with nobody on it. That is not a short
  // match, it is a broken one.
  it('refuses a team with no players, and a single team', () => {
    expect(canStart([
      { index: 0, playerIds: ['a1', 'a2'] },
      { index: 1, playerIds: [] },
    ])).toBe(false);
    expect(canStart([{ index: 0, playerIds: ['a1', 'a2'] }])).toBe(false);
    expect(canStart([])).toBe(false);
  });
});

describe('rotationEngine — recordTie (4-team advancedTieMode)', () => {
  const perTeam = 4;
  // 4 full teams of 4. Start → playing [0,1], waiting [2,3].
  const teams: RotationTeam[] = [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
    { index: 2, playerIds: ['c1', 'c2', 'c3', 'c4'] },
    { index: 3, playerIds: ['d1', 'd2', 'd3', 'd4'] },
  ];

  it('bothOut: both on-field teams go off, the two waiting teams come on', () => {
    const start = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    expect(start.rotation.playing).toEqual([0, 1]);
    expect(start.rotation.waiting).toEqual([2, 3]);
    const res = recordTie(teams, start.rotation, perTeam, 'temporary', 'bothOut', pickFirst);
    expect(res.rotation.playing).toEqual([2, 3]);     // waiting teams came on
    // Both went to the back — CHALLENGER FIRST. playing[0] is the incumbent, so
    // team 0 had been on the pitch longer than team 1; sending it back on first
    // meant the side that had played most returned soonest. This expectation
    // used to read [0, 1] and was pinning that, which is why the order stood so
    // long. Changed deliberately 2026-08-29.
    expect(res.rotation.waiting).toEqual([1, 0]);
  });

  it('veteranOut: the veteran (playing[0]) goes off, the challenger stays', () => {
    const start = startRotation(teams, perTeam, 'temporary', pickFirst)!;
    const res = recordTie(teams, start.rotation, perTeam, 'temporary', 'veteranOut', pickFirst);
    // veteran=0 off, challenger=1 stays, next waiting (2) comes on.
    expect(res.rotation.playing).toEqual([1, 2]);
    expect(res.rotation.waiting).toEqual([3, 0]);
  });
});
