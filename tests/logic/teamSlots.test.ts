import {
  MIN_TEAM_AFTER_MOVE,
  canMoveInto,
  canMoveOut,
  openSlots,
} from '@/utils/teamSlots';

describe('openSlots', () => {
  it('is the gap up to the format size', () => {
    expect(openSlots(3, 5)).toBe(2);
    expect(openSlots(4, 5)).toBe(1);
  });

  it('is zero for a full team, and never negative for an over-full one', () => {
    expect(openSlots(5, 5)).toBe(0);
    // Over-full happens: a permanent fill can absorb a donor past the format.
    // A negative count would render as a crash, not as "no slots".
    expect(openSlots(6, 5)).toBe(0);
  });

  it('returns 0 rather than NaN when a size is missing', () => {
    expect(openSlots(NaN, 5)).toBe(0);
    expect(openSlots(3, undefined as unknown as number)).toBe(0);
  });
});

describe('canMoveOut', () => {
  it('allows a move while the team stays a team', () => {
    expect(canMoveOut(5)).toBe(true);
    expect(canMoveOut(3)).toBe(true);
  });

  it('refuses to take the last players off a team', () => {
    expect(canMoveOut(MIN_TEAM_AFTER_MOVE)).toBe(false);
    expect(canMoveOut(1)).toBe(false);
    expect(canMoveOut(0)).toBe(false);
  });
});

describe('canMoveInto', () => {
  it('accepts the real case: 13 players drafted 5/4/4', () => {
    // Move one off the five so the two on the pitch are even.
    expect(canMoveInto(5, 4, 5)).toBe(true);
  });

  it('refuses a full target even when the source could spare someone', () => {
    expect(canMoveInto(5, 5, 5)).toBe(false);
  });

  it('refuses a source at the floor even when the target has room', () => {
    expect(canMoveInto(2, 3, 5)).toBe(false);
  });
});
