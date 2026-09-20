import {
  assertSeasonOpenForGame,
  seasonIsOpenForGame,
  seasonOfEvening,
} from '../../functions/src/seasonLock';

// §12 — a closed season is closed to corrections, on every write path.
//
// This is the guard `addRetroGoal`, `removeRetroGoal`, `setEveningPlayed` and
// `commitRoundStats` all call before touching a recorded result. It is tested
// here against the module those callables import — not against a restatement
// of the rule, which is the defect the seasons audit records as
// `inseason-tested-as-a-private-copy`.
//
// The production shapes below are real: מועדון שכחת שושי is on season 2 with
// one season closed, and 19 of its 22 season-1 evenings carry no `seasonId`
// stamp at all, because the stamp only began being written when the feature
// shipped.

const SHOSHI = {
  seasons: { enabled: true, currentId: 's2', currentNo: 2 },
};
const FRESH_CLUB = {
  seasons: { enabled: true, currentId: 's1', currentNo: 1 },
};
const NO_SEASONS = { seasons: { enabled: false } };

const threw = (fn: () => void): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return String((e as { message?: string }).message ?? e);
  }
};

describe('which season an evening belongs to', () => {
  it('a stamped evening belongs to its stamp', () => {
    expect(seasonOfEvening(SHOSHI, { seasonId: 's1' })).toBe('s1');
    expect(seasonOfEvening(SHOSHI, { seasonId: 's2' })).toBe('s2');
  });

  // The rule the whole guard turns on. Without it, every evening a club played
  // before seasons shipped reads as "the current season".
  it('an UNSTAMPED evening belongs to season 1, not to the running season', () => {
    expect(seasonOfEvening(SHOSHI, {})).toBe('s1');
    expect(seasonOfEvening(SHOSHI, { seasonId: null })).toBe('s1');
    expect(seasonOfEvening(SHOSHI, { seasonId: 42 })).toBe('s1');
  });

  it('and on a club still in its FIRST season that is the running season', () => {
    expect(seasonOfEvening(FRESH_CLUB, {})).toBe('s1');
  });

  it('a club with seasons off has no answer to give', () => {
    expect(seasonOfEvening(NO_SEASONS, { seasonId: 's1' })).toBe('');
    expect(seasonOfEvening(undefined, {})).toBe('');
  });
});

describe('addRetroGoal against a CLOSED season is refused', () => {
  const MESSAGE =
    'closedSeasonGame: this evening belongs to a season that has already closed';

  // The exact case the owner would hit: completing a goal missed in an evening
  // from season 1, on a club that has since moved to season 2.
  it('an unstamped season-1 evening, on a club now in season 2', () => {
    expect(threw(() => assertSeasonOpenForGame(SHOSHI, {}))).toBe(MESSAGE);
    expect(seasonIsOpenForGame(SHOSHI, {})).toBe(false);
  });

  it('and an explicitly stamped season-1 evening', () => {
    expect(threw(() => assertSeasonOpenForGame(SHOSHI, { seasonId: 's1' }))).toBe(
      MESSAGE,
    );
  });

  it('the refusal is failed-precondition, not a generic error', () => {
    try {
      assertSeasonOpenForGame(SHOSHI, {});
      throw new Error('should have refused');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('failed-precondition');
    }
  });
});

describe('and an OPEN season still accepts corrections', () => {
  it('an evening of the running season', () => {
    expect(threw(() => assertSeasonOpenForGame(SHOSHI, { seasonId: 's2' }))).toBeNull();
    expect(seasonIsOpenForGame(SHOSHI, { seasonId: 's2' })).toBe(true);
  });

  it("a first-season club's unstamped evenings — its whole history", () => {
    // The case that makes the unstamped rule matter in both directions: a club
    // that turned seasons on last week may correct the evenings it played
    // before that, because they ARE season 1 and season 1 is running.
    expect(threw(() => assertSeasonOpenForGame(FRESH_CLUB, {}))).toBeNull();
  });

  it('every evening of a club that runs no seasons at all', () => {
    // 195 of the 196 clubs in production. The guard must be invisible to them.
    expect(threw(() => assertSeasonOpenForGame(NO_SEASONS, { seasonId: 's1' }))).toBeNull();
    expect(threw(() => assertSeasonOpenForGame(undefined, {}))).toBeNull();
  });

  // §13 — the correction window is FOR corrections.
  it('a season merely waiting to close is still open', () => {
    const waiting = {
      seasons: {
        enabled: true,
        currentId: 's2',
        currentNo: 2,
        pendingClose: { seasonId: 's2', dueAt: 1, closeAt: 2, reason: 'rounds' },
      },
    };
    expect(threw(() => assertSeasonOpenForGame(waiting, { seasonId: 's2' }))).toBeNull();
  });
});
