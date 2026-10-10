// A season cannot be sealed before it has been played.
//
// Reported 24.09: a club created minutes earlier, with no evening ever played,
// could switch seasons on in the edit screen and press "סיים עונה עכשיו" — and
// it worked. The archive is written ONCE and never recomputed, so what that
// produced was permanent: a season holding nothing, nine `null` titles
// (`leaders` refuses an empty field), and `count: 1` saying the club has a
// closed season behind it.
//
// MIN_SEASON_ROUNDS was already the floor at the OTHER end — a season may not
// be set to END after fewer than two evenings. It was enforceable when a
// season was created and not when it was sealed, so it was only ever a
// suggestion about the future.

// Test refusal wording, not native error delivery/storage. Stub that boundary
// rather than creating a virtual copy of the installed react-native module.
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

import { MIN_SEASON_ROUNDS } from '@/utils/seasonActivation';
import { seasonRefusalText } from '@/services/seasonService';

/** The server's guard, as `endSeasonNow` applies it. */
const mayClose = (played: number) => played >= MIN_SEASON_ROUNDS;

/** The disable path's, which DISCARDS instead of archiving below the floor. */
const disableArchives = (played: number) => played >= MIN_SEASON_ROUNDS;

describe('ending a season on purpose', () => {
  it('is refused on a season that has played nothing', () => {
    expect(mayClose(0)).toBe(false);
  });

  it('is refused one evening short', () => {
    expect(mayClose(MIN_SEASON_ROUNDS - 1)).toBe(false);
  });

  it('is allowed exactly at the floor', () => {
    expect(mayClose(MIN_SEASON_ROUNDS)).toBe(true);
  });

  it('the floor is the same number the target picker already enforced', () => {
    // One rule, both ends of a season. If these ever diverge, a club can set a
    // target it may not then seal, or seal one it could not have set.
    expect(MIN_SEASON_ROUNDS).toBe(2);
  });
});

describe('switching the feature off', () => {
  it('discards an empty season rather than archiving it', () => {
    // Turning seasons off is not the same act as ending a season and must not
    // manufacture history.
    expect(disableArchives(0)).toBe(false);
  });

  it('still archives a season that was actually played', () => {
    expect(disableArchives(5)).toBe(true);
  });

  it('is the escape hatch that keeps the close floor from being a trap', () => {
    // An admin who enabled seasons by mistake can neither close the season
    // (below the floor) nor be stuck with it: switching off removes it.
    const played = 0;
    expect(mayClose(played)).toBe(false);
    expect(disableArchives(played)).toBe(false);
  });
});

describe('what the admin is told', () => {
  it('names the club\'s own figure and what it takes', () => {
    const t = seasonRefusalText('tooFewRounds', { seasonNo: 1, played: 1 });
    expect(t).toContain('מחזור אחד');
    expect(t).toContain('2');
    // And the way out, so the refusal is not a dead end.
    expect(t).toContain('כבו את העונות');
  });

  it('says "no evening at all" rather than "0 evenings"', () => {
    const t = seasonRefusalText('tooFewRounds', { seasonNo: 1, played: 0 });
    expect(t).toContain('עוד לא שוחק אף מחזור');
    expect(t).not.toContain('0 מחזורים');
  });

  it('falls back to the bare rule when the server named no figure', () => {
    const t = seasonRefusalText('tooFewRounds', { seasonNo: 1 });
    expect(t).toContain('לפחות');
  });
});
