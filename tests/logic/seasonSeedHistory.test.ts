/**
 * A season owns the history the club has already played, and its numbers agree.
 *
 * Owner's report on a live club: "הפעלנו עונות בשככת שושי, ומופיע לנו 7 מתוך 24
 * מחזורים, שיחקנו בפועל 19". Both numbers were wrong in different directions.
 *
 * Season 1 used to be seeded with the club's history, read from
 * `clubRecords.eveningsSealed` — a counter that only began on 26.08.2026 when
 * evening-sealing shipped. So the club saw neither its history (19) nor a fresh
 * start (0), but however many evenings a young counter happened to have seen.
 *
 * Two invariants come out of the fix, and this pins both:
 *   1. A new season shows 0 played.
 *   2. `roundsAtStart` is the sealed count AT THAT INSTANT — because progress
 *      is `sealed - roundsAtStart`, and seeding the two from different moments
 *      makes a season that reads "0 מתוך 24" close after 17.
 */
import { seasonSeed } from '@/utils/seasonSeed';

describe('seeding a season', () => {
  it('starts a brand-new club at zero', () => {
    expect(seasonSeed(0)).toEqual({ roundsAtStart: 0, playedRounds: 0 });
  });

  it('starts a club with history at zero, not at its history', () => {
    // The exact case reported: 7 sealed evenings, a 24-evening target.
    const seed = seasonSeed(7);
    expect(seed.playedRounds).toBe(0);
    // …and the offset absorbs those 7, so "24" means 24 more.
    expect(seed.roundsAtStart).toBe(7);
  });

  it('keeps the displayed progress and the sweep in agreement', () => {
    // progress = sealed - roundsAtStart, which is what the rollover measures.
    const sealed = 7;
    const seed = seasonSeed(sealed);
    expect(sealed - seed.roundsAtStart).toBe(seed.playedRounds);
  });

  it('never reuses a stale offset', () => {
    // A club that ran seasons before, switched them off, played on, and
    // switched them back on. Reusing the OLD offset (say 3) would show 0 while
    // the sweep measured 4 — closing the season four evenings early.
    const seed = seasonSeed(7);
    expect(seed.roundsAtStart).not.toBe(3);
    expect(seed.roundsAtStart).toBe(7);
  });

  it('treats a missing or nonsense counter as zero', () => {
    expect(seasonSeed(undefined as never)).toEqual({
      roundsAtStart: 0,
      playedRounds: 0,
    });
    expect(seasonSeed(-4)).toEqual({ roundsAtStart: 0, playedRounds: 0 });
    expect(seasonSeed(NaN)).toEqual({ roundsAtStart: 0, playedRounds: 0 });
  });
});
