// rotationDeep — exhaustive correctness for the "winner-stays" rotation across
// MANY rounds and BOTH fill modes (temporary vs permanent). Pre-release gate:
// the field must always be full, never duplicate a player, never field a player
// who isn't really available, and conserve the total squad.

import {
  startRotation,
  recordWinner,
  recordTie,
  rosterOf,
  type RotationTeam,
} from '@/services/rotationEngine';
import type { MatchRotation } from '@/types';

const pickFirst = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

function makeTeams(sizes: number[]): RotationTeam[] {
  let n = 0;
  return sizes.map((size, index) => ({
    index,
    playerIds: Array.from({ length: size }, () => `p${++n}`),
  }));
}

/** All distinct player ids that exist across the (possibly reassigned) teams. */
function allPlayers(teams: RotationTeam[]): Set<string> {
  const s = new Set<string>();
  teams.forEach((t) => t.playerIds.forEach((p) => s.add(p)));
  return s;
}

/** Assert the core invariants for a rotation state. */
function checkInvariants(
  res: { rotation: MatchRotation; teams: RotationTeam[] },
  perTeam: number,
  originalPlayers: Set<string>,
  label: string,
) {
  const { rotation: r, teams } = res;
  const [a, b] = r.playing;
  const rosterA = rosterOf(a, teams, r.loans);
  const rosterB = rosterOf(b, teams, r.loans);

  // 1. Both playing teams are exactly full.
  expect(`${label}:A=${rosterA.length}`).toBe(`${label}:A=${perTeam}`);
  expect(`${label}:B=${rosterB.length}`).toBe(`${label}:B=${perTeam}`);

  // 2. No player appears on BOTH on-field teams at once.
  const onField = [...rosterA, ...rosterB];
  expect(onField.length).toBe(new Set(onField).size);

  // 3. Every on-field player is a real squad member (no phantom ids).
  onField.forEach((p) => expect(originalPlayers.has(p)).toBe(true));

  // 4. The squad is conserved — no one created or lost across reassignments.
  const now = allPlayers(teams);
  expect(now.size).toBe(originalPlayers.size);
  originalPlayers.forEach((p) => expect(now.has(p)).toBe(true));
}

/** Play `rounds` rounds, winner = the first playing team each time, asserting
 *  invariants after start and after every round. */
function playSequence(sizes: number[], perTeam: number, mode: 'temporary' | 'permanent', rounds: number) {
  const original = allPlayers(makeTeams(sizes));
  let teams = makeTeams(sizes);
  const start = startRotation(teams, perTeam, mode, pickFirst);
  expect(start).not.toBeNull();
  let state = start!;
  teams = state.teams;
  checkInvariants(state, perTeam, original, `${mode}/${sizes}/start`);

  for (let round = 1; round <= rounds; round++) {
    const winner = state.rotation.playing[0];
    state = recordWinner(winner, teams, state.rotation, perTeam, mode, pickFirst);
    teams = state.teams;
    checkInvariants(state, perTeam, original, `${mode}/${sizes}/r${round}`);
  }
  return state;
}

describe('rotation invariants — temporary fill', () => {
  it('3 teams 4-4-4, 8 rounds: field always full, no dup, squad conserved', () => {
    playSequence([4, 4, 4], 5, 'temporary', 8);
  });
  it('3 teams 5-5-2 (uneven draft), 8 rounds', () => {
    playSequence([5, 5, 2], 5, 'temporary', 8);
  });
  it('4 teams 4-4-4-4, 10 rounds', () => {
    playSequence([4, 4, 4, 4], 5, 'temporary', 10);
  });
  it('3 even teams 5-5-5 (no fill needed), 6 rounds', () => {
    playSequence([5, 5, 5], 5, 'temporary', 6);
  });
});

describe('rotation invariants — permanent fill', () => {
  it('3 teams 4-4-4, 8 rounds', () => {
    playSequence([4, 4, 4], 5, 'permanent', 8);
  });
  it('4 teams 4-4-4-4, 10 rounds', () => {
    playSequence([4, 4, 4, 4], 5, 'permanent', 10);
  });
});

describe('temporary fill — a borrowed player RETURNS when their home team comes on', () => {
  it('the loan is dropped once the donor team plays again', () => {
    // 3 teams of 4 (perTeam 5). Start: teams 0,1 play, each borrows 1 from team 2.
    const teams = makeTeams([4, 4, 4]);
    const start = startRotation(teams, 5, 'temporary', pickFirst)!;
    // Two loans, both FROM team 2.
    expect(start.rotation.loans).toHaveLength(2);
    expect(start.rotation.loans.every((l) => l.homeTeam === 2)).toBe(true);
    const borrowed = start.rotation.loans.map((l) => l.playerId);

    // Team 0 wins, team 1 loses → team 2 comes on. Its loaned-out players return.
    const r1 = recordWinner(0, start.teams, start.rotation, 5, 'temporary', pickFirst);
    // No loan should still have homeTeam === 2 (team 2 is now playing → reclaimed).
    expect(r1.rotation.loans.some((l) => l.homeTeam === 2)).toBe(false);
    // The previously-borrowed players are back in team 2's on-field roster.
    const team2Roster = rosterOf(2, r1.teams, r1.rotation.loans);
    borrowed.forEach((p) => expect(team2Roster).toContain(p));
  });
});

describe('permanent fill — a borrowed player STAYS (home reassigned, no loan)', () => {
  it('donor team shrinks, target grows, and no loans are created', () => {
    const teams = makeTeams([4, 4, 4]);
    const start = startRotation(teams, 5, 'permanent', pickFirst)!;
    // Permanent mode never records loans.
    expect(start.rotation.loans).toHaveLength(0);
    // Two players moved off team 2 onto teams 0 and 1 → team 2 now has 2.
    const t2 = start.teams.find((t) => t.index === 2)!;
    expect(t2.playerIds).toHaveLength(2);
    expect(start.teams.find((t) => t.index === 0)!.playerIds).toHaveLength(5);
    expect(start.teams.find((t) => t.index === 1)!.playerIds).toHaveLength(5);

    // After a full round, the moved players do NOT snap back to team 2.
    const movedAway = makeTeams([4, 4, 4])
      .find((t) => t.index === 2)!
      .playerIds.filter((p) => !t2.playerIds.includes(p));
    const r1 = recordWinner(0, start.teams, start.rotation, 5, 'permanent', pickFirst);
    const t2After = r1.teams.find((t) => t.index === 2)!.playerIds;
    movedAway.forEach((p) => expect(t2After).not.toContain(p));
  });
});

describe('tie rotation invariants (4 teams)', () => {
  it('bothOut: both playing teams leave, two waiting come on, field stays full', () => {
    const original = allPlayers(makeTeams([4, 4, 4, 4]));
    let teams = makeTeams([4, 4, 4, 4]);
    const start = startRotation(teams, 5, 'temporary', pickFirst)!;
    teams = start.teams;
    const res = recordTie(teams, start.rotation, 5, 'temporary', 'bothOut', pickFirst);
    checkInvariants(res, 5, original, 'tie/bothOut');
    // The two previously-waiting teams (2,3) are now on.
    expect(res.rotation.playing).toEqual([2, 3]);
  });
  it('veteranOut: only the incumbent leaves, challenger stays', () => {
    const original = allPlayers(makeTeams([4, 4, 4, 4]));
    let teams = makeTeams([4, 4, 4, 4]);
    const start = startRotation(teams, 5, 'temporary', pickFirst)!;
    teams = start.teams;
    const res = recordTie(teams, start.rotation, 5, 'temporary', 'veteranOut', pickFirst);
    checkInvariants(res, 5, original, 'tie/veteranOut');
    // Challenger (playing[1]=1) stays on.
    expect(res.rotation.playing).toContain(1);
  });
});
