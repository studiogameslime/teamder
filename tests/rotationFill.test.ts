// rotationFill — the interactive-fill primitives (nextFillNeeded /
// applyChosenFill) that back the "choose who completes the team" popup.
// These must agree with the auto path's outcome (field always full) while
// letting the caller substitute the admin's selection for the random pick.

import {
  nextFillNeeded,
  applyChosenFill,
  recordWinnerSkeleton,
  startRotationSkeleton,
  startRotation,
  rosterOf,
  type RotationTeam,
} from '@/services/rotationEngine';

// Deterministic "recommendation" = first n (mirrors what the auto path / the
// pre-selected popup choice would do, but reproducibly).
const pickFirst = <T>(arr: T[], n: number): T[] => arr.slice(0, n);

const PER = 5;

// 12 players, 3 teams, drafted EVENLY → 4,4,4 (the captain-draft outcome).
function teams444(): RotationTeam[] {
  return [
    { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
    { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
    { index: 2, playerIds: ['c1', 'c2', 'c3', 'c4'] },
  ];
}

describe('nextFillNeeded', () => {
  it('reports the first short playing team + its donor pool (loser-first)', () => {
    const teams = teams444();
    // Teams 0 and 1 play (4 each); team 2 is the bench/donor pool.
    const req = nextFillNeeded([0, 1], teams, [], PER, null);
    expect(req).not.toBeNull();
    expect(req!.team).toBe(0); // first playing team in order
    expect(req!.deficit).toBe(1); // 4 → 5 needs 1
    expect(req!.donors).toEqual(['c1', 'c2', 'c3', 'c4']); // only off team
  });

  it('returns null when both playing teams are already full', () => {
    const full: RotationTeam[] = [
      { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4', 'a5'] },
      { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4', 'b5'] },
      { index: 2, playerIds: ['c1', 'c2'] },
    ];
    expect(nextFillNeeded([0, 1], full, [], PER, null)).toBeNull();
  });

  it('puts the loser team first in the donor order', () => {
    const teams: RotationTeam[] = [
      { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4', 'a5'] }, // winner, full
      { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] }, // incoming, short by 1
      { index: 2, playerIds: ['c1', 'c2', 'c3', 'c4'] }, // loser (just went off)
    ];
    const req = nextFillNeeded([0, 1], teams, [], PER, 2 /* loser */);
    expect(req!.team).toBe(1);
    expect(req!.donors[0]).toBe('c1'); // loser team 2's players come first
  });
});

describe('applyChosenFill', () => {
  it('temporary: records a loan, field roster reflects it, home roster keeps the id', () => {
    const teams = teams444();
    const { teams: t, loans } = applyChosenFill(teams, [], 0, ['c1'], 'temporary');
    expect(loans).toEqual([{ playerId: 'c1', homeTeam: 2, filledTeam: 0 }]);
    expect(rosterOf(0, t, loans)).toHaveLength(5); // team 0 now full on the field
    expect(rosterOf(2, t, loans)).toHaveLength(3); // donor down to 3 on the field
    expect(t.find((x) => x.index === 2)!.playerIds).toContain('c1'); // still home
  });

  it('permanent: moves the player home team to the target', () => {
    const teams = teams444();
    const { teams: t, loans } = applyChosenFill(teams, [], 0, ['c1'], 'permanent');
    expect(loans).toHaveLength(0);
    expect(t.find((x) => x.index === 0)!.playerIds).toContain('c1');
    expect(t.find((x) => x.index === 2)!.playerIds).not.toContain('c1');
  });

  it('round-1 both-short: each playing team takes 1, the bench shrinks by 2', () => {
    const teams = teams444();
    let state = { teams, loans: [] as any[] };
    // team 0 completes first (admin chose c1), then team 1 (admin chose c3).
    state = applyChosenFill(state.teams, state.loans, 0, ['c1'], 'temporary');
    state = applyChosenFill(state.teams, state.loans, 1, ['c3'], 'temporary');
    expect(rosterOf(0, state.teams, state.loans)).toHaveLength(5);
    expect(rosterOf(1, state.teams, state.loans)).toHaveLength(5);
    expect(rosterOf(2, state.teams, state.loans)).toHaveLength(2); // bench 4 → 2
    // The second team's pool must exclude what the first already took.
    const req2 = nextFillNeeded([1, 0], state.teams, state.loans, PER, null);
    expect(req2).toBeNull(); // both full now
  });

  it('order independence: who picks first changes WHO, never the counts', () => {
    const order1 = (() => {
      let s = { teams: teams444(), loans: [] as any[] };
      s = applyChosenFill(s.teams, s.loans, 0, ['c1'], 'temporary');
      s = applyChosenFill(s.teams, s.loans, 1, ['c2'], 'temporary');
      return [rosterOf(0, s.teams, s.loans).length, rosterOf(1, s.teams, s.loans).length, rosterOf(2, s.teams, s.loans).length];
    })();
    const order2 = (() => {
      let s = { teams: teams444(), loans: [] as any[] };
      s = applyChosenFill(s.teams, s.loans, 1, ['c2'], 'temporary'); // team 1 first
      s = applyChosenFill(s.teams, s.loans, 0, ['c1'], 'temporary');
      return [rosterOf(0, s.teams, s.loans).length, rosterOf(1, s.teams, s.loans).length, rosterOf(2, s.teams, s.loans).length];
    })();
    expect(order1).toEqual([5, 5, 2]);
    expect(order2).toEqual([5, 5, 2]);
  });
});

describe('skeletons expose the pre-fill state', () => {
  it('startRotationSkeleton: two teams on, no fill applied yet', () => {
    const s = startRotationSkeleton(teams444(), PER, 'temporary');
    expect(s).not.toBeNull();
    expect(s!.playing).toEqual([0, 1]);
    expect(s!.loserFirst).toBeNull();
    expect(s!.rotation.loans).toEqual([]); // not yet filled
    // Both playing teams are still short until the caller fills them.
    expect(rosterOf(0, s!.teams, s!.rotation.loans)).toHaveLength(4);
  });

  // The user's emulator scenarios — verified through the real engine flow.
  it('SCENARIO 12 players (5v5, 3 teams 4-4-4): both playing teams complete to 5 from the bench', () => {
    const res = startRotation(teams444(), PER, 'temporary', pickFirst);
    expect(res).not.toBeNull();
    const r = res!;
    expect(r.rotation.playing).toEqual([0, 1]);
    expect(r.rotation.waiting).toEqual([2]);
    // Both on-field teams reach 5; the bench (team 2) gives up 2 → has 2 left.
    expect(rosterOf(0, r.teams, r.rotation.loans)).toHaveLength(5);
    expect(rosterOf(1, r.teams, r.rotation.loans)).toHaveLength(5);
    expect(rosterOf(2, r.teams, r.rotation.loans)).toHaveLength(2);
    // Exactly 2 borrowed players, both FROM the bench (team 2).
    expect(r.rotation.loans).toHaveLength(2);
    expect(r.rotation.loans.every((l) => l.homeTeam === 2)).toBe(true);
  });

  it('SCENARIO 16 players (5v5, 4 teams 4-4-4-4): each playing team borrows 1 from the waiting teams', () => {
    const teams: RotationTeam[] = [
      { index: 0, playerIds: ['a1', 'a2', 'a3', 'a4'] },
      { index: 1, playerIds: ['b1', 'b2', 'b3', 'b4'] },
      { index: 2, playerIds: ['c1', 'c2', 'c3', 'c4'] },
      { index: 3, playerIds: ['d1', 'd2', 'd3', 'd4'] },
    ];
    const res = startRotation(teams, PER, 'temporary', pickFirst);
    const r = res!;
    expect(r.rotation.playing).toEqual([0, 1]);
    expect(r.rotation.waiting).toEqual([2, 3]);
    expect(rosterOf(0, r.teams, r.rotation.loans)).toHaveLength(5);
    expect(rosterOf(1, r.teams, r.rotation.loans)).toHaveLength(5);
    // 2 borrowed total, from the waiting teams (2 and/or 3), never from a playing team.
    expect(r.rotation.loans).toHaveLength(2);
    expect(r.rotation.loans.every((l) => l.homeTeam === 2 || l.homeTeam === 3)).toBe(true);
  });

  it('recordWinnerSkeleton: loser is the first donor, incoming comes on unfilled', () => {
    const teams = teams444();
    const rotation = {
      playing: [0, 1] as [number, number],
      waiting: [2],
      loans: [],
      wins: {},
      round: 1,
      updatedAt: 0,
    };
    const s = recordWinnerSkeleton(0, teams, rotation, PER, 'temporary');
    expect(s.playing).toEqual([0, 2]); // winner 0 stays, team 2 comes on
    expect(s.loserFirst).toBe(1); // loser is the donor pool
    expect(s.rotation.waiting).toEqual([1]);
  });
});
