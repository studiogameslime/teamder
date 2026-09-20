import { eveningScoreServer, WIN_PRIOR_GAMES } from '../../functions/src/eveningScoreCore';

// The sentinel, and why the season mean must exclude it BY CAUSE rather than
// by value.
//
// `eveningScoreServer` opens with `if (gamesPlayed <= 0) return 6.0`. That 6.0
// does not mean "this player had a poor night"; it means "this player took the
// field for no mini-game, so there is nothing to rate". Until 20.09.2026 the
// season accumulator folded it into the average anyway, once per attendance,
// and שחקן העונה on the one club that has closed a season came out shared by
// all seven members at exactly 6.0.
//
// The fix excludes it on `rounds > 0` — the same input the formula itself
// tests. The product rule is explicit that a GENUINE 6.0 must keep counting,
// so excluding on `score === 6` would be wrong. This file pins both halves:
// the sentinel is exactly 6.0, and a real rating is reachable at 6.0 too.

const NO_PEN = { scored: 0, saved: 0, missed: 0, conceded: 0 };

describe('the sentinel', () => {
  it('no mini-games returns exactly 6.0, whatever else happened', () => {
    expect(eveningScoreServer(0, 0, 0, 0, 4, 2, NO_PEN)).toBe(6.0);
    // Even with goals on the sheet — an own-goal correction, a retro goal
    // credited to a night the player did not rotate through.
    expect(eveningScoreServer(3, 2, 0, 0, 4, 2, NO_PEN)).toBe(6.0);
    expect(eveningScoreServer(0, 0, 0, -1, 4, 2, NO_PEN)).toBe(6.0);
  });
});

describe('a real rating can also be 6.0, which is why value is not the test', () => {
  // The floor is 6 and the formula clamps to it, so a bad enough real night
  // lands on the same number as the sentinel. If the accumulator excluded
  // `score === 6` it would silently drop these.
  it('a long night with nothing to show for it reaches the floor', () => {
    // winsScore = ((0 + WIN_PRIOR_GAMES/2) / (g + WIN_PRIOR_GAMES)) * 10.
    // At g = 60 that is 0.16, weighted 0.08, score 6.03 → rounds to 6.0.
    const s = eveningScoreServer(0, 0, 0, 60, 4, 2, NO_PEN);
    expect(s).toBe(6.0);
  });

  it('and so does a penalty night that went badly', () => {
    const s = eveningScoreServer(0, 0, 0, 60, 4, 2, {
      scored: 0, saved: 0, missed: 3, conceded: 4,
    });
    expect(s).toBe(6.0);
  });

  it('but an ordinary night never does', () => {
    // This is what makes the bug so visible in production: at realistic
    // rotation counts the formula cannot return 6.0, so every stored 6.0 on a
    // normal evening is a sentinel. With no wins, goals or assists at all:
    for (const rounds of [1, 2, 4, 6, 8, 10]) {
      expect(eveningScoreServer(0, 0, 0, rounds, 4, 2, NO_PEN)).toBeGreaterThan(6.0);
    }
    // The worst an ordinary six-mini-game night can do:
    expect(eveningScoreServer(0, 0, 0, 6, 4, 2, NO_PEN)).toBeCloseTo(6.3, 1);
  });

  it('the prior is what keeps it off the floor', () => {
    // Two phantom draws, so a player with no wins is not on a 0% record.
    expect(WIN_PRIOR_GAMES).toBe(2);
  });
});

describe('the discriminator the accumulator uses', () => {
  /** What `functions/src/index.ts` now asks before folding a score in. */
  const isRealRating = (rounds: number) => rounds > 0;

  it('separates the two 6.0s correctly', () => {
    expect(isRealRating(0)).toBe(false);   // sentinel — excluded
    expect(isRealRating(60)).toBe(true);   // genuine 6.0 — counted
  });

  it('and a value test would not', () => {
    const sentinel = eveningScoreServer(0, 0, 0, 0, 4, 2, NO_PEN);
    const genuine = eveningScoreServer(0, 0, 0, 60, 4, 2, NO_PEN);
    expect(sentinel).toBe(genuine);        // indistinguishable by value…
    expect(isRealRating(0)).not.toBe(isRealRating(60)); // …separable by cause
  });
});
