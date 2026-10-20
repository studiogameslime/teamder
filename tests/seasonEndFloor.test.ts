import { MIN_SEASON_ROUNDS, seasonClosureKind, validateSeasonTarget, makeSeasonTarget } from '@/utils/seasonPolicy';
import { seasonClosureKind as serverKind } from '../functions/src/seasonPolicy';
it('uses a single floor of five for a competitive archive on both sides', () => {
  expect(MIN_SEASON_ROUNDS).toBe(5);
  for (let n=0;n<10;n++) {
    expect(serverKind(n)).toBe(seasonClosureKind(n));
    expect(seasonClosureKind(n)).toBe(n < 5 ? 'cancelled' : 'competitive');
  }
});
it('refuses a below-floor target while permitting cancellation of a short attempt', () => {
  expect(validateSeasonTarget({ target: makeSeasonTarget('rounds',4,'2026-10-19'), played:0, now:0 }).ok).toBe(false);
  expect(seasonClosureKind(4)).toBe('cancelled');
});
