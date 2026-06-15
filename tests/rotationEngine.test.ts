import {
  startRotation,
  recordWinner,
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

describe('rotationEngine — 8 players cannot start (need 10 = two full 5s)', () => {
  const perTeam = 5;
  const teams: RotationTeam[] = [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
  ];
  it('canStart is false and startRotation returns null', () => {
    expect(canStart(teams, perTeam)).toBe(false);
    expect(startRotation(teams, perTeam, 'temporary', pickFirst)).toBeNull();
    // eslint-disable-next-line no-console
    console.log('\n[GATE] 8 players, perTeam=5 → canStart=false (need 10). Rotation NOT started.\n');
  });
});
