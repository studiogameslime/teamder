// A player who scores and then leaves the pitch keeps the goal.
//
// Reported twice from real evenings: score in the third minute, get
// substituted, and the goal vanishes because the teams sent at the end of the
// round no longer contain you.
//
// These cases are the rule, written down.

import { buildRoundSides } from '../../functions/src/roundSides';

const isReal = (id: string) => !id.startsWith('guest:');

const build = (over: Partial<Parameters<typeof buildRoundSides>[0]> = {}) =>
  buildRoundSides({
    sideA: [],
    sideB: [],
    goals: [],
    roster: new Set(['a1', 'a2', 'b1', 'b2', 'sub', 'bench']),
    arrivals: {},
    isReal,
    ...over,
  });

describe('a scorer who left the pitch still played', () => {
  it('a substituted scorer is put back, with the goal and the mini-game', () => {
    // 'sub' scored for A, then was swapped off before the round ended.
    const r = build({
      sideA: ['a1', 'a2'],
      sideB: ['b1', 'b2'],
      goals: [{ scorerId: 'sub', team: 'A' }],
    });
    expect(r.A).toContain('sub');
    expect(r.onField.has('sub')).toBe(true);
    expect(r.restored).toEqual(['sub']);
  });

  it('a substituted assister too', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'a1', assisterId: 'sub', team: 'A' }],
    });
    expect(r.A).toContain('sub');
    expect(r.restored).toEqual(['sub']);
  });

  it('scorer and assister both, from one goal', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'sub', assisterId: 'bench', team: 'A' }],
    });
    expect(r.A).toEqual(expect.arrayContaining(['sub', 'bench']));
    expect(r.onField.size).toBe(4);
  });

  it('an own goal puts the scorer on the side that CONCEDED', () => {
    // Team A gained the point, so the own goal came off a B player's boot.
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'sub', team: 'A', ownGoal: true }],
    });
    expect(r.B).toContain('sub');
    expect(r.A).not.toContain('sub');
  });

  it('an own goal has no assist to restore', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'sub', assisterId: 'bench', team: 'A', ownGoal: true }],
    });
    expect(r.restored).toEqual(['sub']);
    expect(r.onField.has('bench')).toBe(false);
  });
});

describe('but the repair cannot be used to smuggle anyone in', () => {
  it('a player who is not on the game roster stays out', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'stranger', team: 'A' }],
    });
    expect(r.onField.has('stranger')).toBe(false);
    expect(r.restored).toEqual([]);
  });

  it('a no-show stays out, however many goals name him', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'sub', team: 'A' }, { scorerId: 'sub', team: 'A' }],
      arrivals: { sub: 'no_show' },
    });
    expect(r.onField.has('sub')).toBe(false);
  });

  it('a guest is never placed on a side — no cross-game identity', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      roster: new Set(['a1', 'b1', 'guest:x']),
      goals: [{ scorerId: 'guest:x', team: 'A' }],
    });
    expect(r.onField.has('guest:x')).toBe(false);
  });

  it('a goal with no team cannot place anybody', () => {
    // Legacy payloads carry no side, so there is nowhere to put the scorer.
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [{ scorerId: 'sub' }, { scorerId: 'bench', team: null }],
    });
    expect(r.restored).toEqual([]);
  });
});

describe('nobody is counted twice', () => {
  it('two goals by the same restored player add him once', () => {
    const r = build({
      sideA: ['a1'],
      sideB: ['b1'],
      goals: [
        { scorerId: 'sub', team: 'A' },
        { scorerId: 'sub', team: 'A' },
        { scorerId: 'sub', assisterId: 'sub', team: 'A' },
      ],
    });
    expect(r.A.filter((id) => id === 'sub')).toHaveLength(1);
    expect(r.restored).toEqual(['sub']);
  });

  it('a player already on a side is not moved by a later goal', () => {
    // He is on B; a goal says A scored and names him. He stays on B — the
    // sides as sent win, the repair only fills gaps.
    const r = build({
      sideA: ['a1'],
      sideB: ['sub'],
      goals: [{ scorerId: 'sub', team: 'A' }],
    });
    expect(r.B).toContain('sub');
    expect(r.A).not.toContain('sub');
    expect(r.restored).toEqual([]);
  });

  it('a uid sent on both sides lands on exactly one', () => {
    // Otherwise the same player takes a win and a loss in one mini-game.
    const r = build({ sideA: ['a1', 'a2'], sideB: ['a2', 'b1'] });
    expect(r.A).toContain('a2');
    expect(r.B).not.toContain('a2');
    expect(r.B).toEqual(['b1']);
  });

  it('a uid repeated within one side appears once', () => {
    const r = build({ sideA: ['a1', 'a1', 'a2'], sideB: ['b1'] });
    expect(r.A).toEqual(['a1', 'a2']);
  });
});

describe('the ordinary round is untouched', () => {
  it('no goals, no repair, sides exactly as sent', () => {
    const r = build({ sideA: ['a1', 'a2'], sideB: ['b1', 'b2'] });
    expect(r.A).toEqual(['a1', 'a2']);
    expect(r.B).toEqual(['b1', 'b2']);
    expect(r.restored).toEqual([]);
    expect(r.onField.size).toBe(4);
  });

  it('a scorer who is still on his side is not "restored"', () => {
    const r = build({
      sideA: ['a1', 'a2'],
      sideB: ['b1'],
      goals: [{ scorerId: 'a1', assisterId: 'a2', team: 'A' }],
    });
    expect(r.restored).toEqual([]);
  });
});
