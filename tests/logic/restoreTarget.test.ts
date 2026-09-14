// Where a player who went home comes back to.
//
// The interesting case is the one that was reported: his team was emptied and
// retired mid-evening, so it is out of the rotation but still listed in
// draftTeams. Restoring him onto it puts him on a side that will never play
// again, and he disappears from the evening.

import { restoreTargetTeam } from '@/utils/restoreTarget';

/** 0 = red, 1 = blue, 2 = green — the evening from the report. */
const teams = (sizes: Record<number, number>) =>
  Object.entries(sizes).map(([index, n]) => ({
    index: Number(index),
    playerIds: Array.from({ length: n }, (_, i) => `p${index}_${i}`),
  }));

describe('normally he rejoins his own team', () => {
  it('when it is on the field', () => {
    const t = teams({ 0: 4, 1: 5, 2: 5 });
    expect(restoreTargetTeam(0, t, { playing: [0, 1], waiting: [2] })).toBe(0);
  });

  it('when it is waiting its turn', () => {
    const t = teams({ 0: 5, 1: 5, 2: 4 });
    expect(restoreTargetTeam(2, t, { playing: [0, 1], waiting: [2] })).toBe(2);
  });
});

describe('his team was retired mid-evening', () => {
  it('he does NOT land on the retired team', () => {
    // Greens (2) emptied and retired: gone from the rotation, still in teams.
    const t = teams({ 0: 5, 1: 5, 2: 0 });
    const target = restoreTargetTeam(2, t, { playing: [0, 1], waiting: [] });
    expect(target).not.toBe(2);
  });

  it('he lands on the smallest side still playing', () => {
    const t = teams({ 0: 5, 1: 3, 2: 0 });
    expect(restoreTargetTeam(2, t, { playing: [0, 1], waiting: [] })).toBe(1);
  });

  it('a waiting team counts as still playing', () => {
    const t = teams({ 0: 5, 1: 5, 2: 0, 3: 2 });
    expect(restoreTargetTeam(2, t, { playing: [0, 1], waiting: [3] })).toBe(3);
  });

  it('ties break on the lower index, so the choice is repeatable', () => {
    const t = teams({ 0: 4, 1: 4, 2: 0 });
    const first = restoreTargetTeam(2, t, { playing: [1, 0], waiting: [] });
    const again = restoreTargetTeam(2, t, { playing: [0, 1], waiting: [] });
    expect(first).toBe(0);
    expect(again).toBe(0);
  });
});

describe('before the evening starts rotating', () => {
  it('with no rotation yet, he simply goes home', () => {
    const t = teams({ 0: 5, 1: 5, 2: 5 });
    expect(restoreTargetTeam(2, t, undefined)).toBe(2);
    expect(restoreTargetTeam(2, t, { playing: [], waiting: [] })).toBe(2);
  });

  it('and falls back to the first team only if his own is truly gone', () => {
    const t = teams({ 0: 5, 1: 5 });
    expect(restoreTargetTeam(7, t, undefined)).toBe(0);
  });
});

describe('degenerate input never throws', () => {
  it('no teams at all', () => {
    expect(restoreTargetTeam(2, [], { playing: [0, 1], waiting: [] })).toBe(0);
  });

  it('a rotation naming a team that is not in the list', () => {
    // Should still pick from the rotation rather than inventing a team.
    const t = teams({ 0: 5 });
    expect(restoreTargetTeam(9, t, { playing: [0, 4], waiting: [] })).toBe(4);
  });
});
