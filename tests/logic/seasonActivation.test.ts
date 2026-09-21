// Switching seasons on in a club that already has a history.
//
// The irreversible decision in the feature: everything played becomes season 1,
// and the admin chooses whether it carries on or is sealed now. Every scenario
// below is from the specification.
import {
  planActivation,
  isValidSeasonRounds,
  MIN_SEASON_ROUNDS,
} from '@/utils/seasonActivation';

const TODAY = '2026-09-16';
const rounds = (o: Partial<Parameters<typeof planActivation>[0]> = {}) =>
  planActivation({
    cadence: 'rounds',
    targetRounds: 24,
    choice: 'continue',
    playedHistory: 18,
    today: TODAY,
    ...o,
  });
const dated = (o: Partial<Parameters<typeof planActivation>[0]> = {}) =>
  planActivation({
    cadence: 'date',
    months: 3,
    choice: 'sealNow',
    playedHistory: 30,
    today: TODAY,
    ...o,
  });

describe('rounds cadence, carrying season 1 on', () => {
  it('18 played against a 24 target → 18/24 with 6 to go', () => {
    const p = rounds();
    expect(p.ok).toBe(true);
    expect(p.startsAtRounds).toBe(18);
    expect(p.roundsRemaining).toBe(6);
    expect(p.activeSeasonNo).toBe(1);
    expect(p.sealsSeason1).toBe(false);
  });

  it('30 played against a 24 target → refused', () => {
    // You cannot carry on a season that already holds more than its maximum.
    const p = rounds({ playedHistory: 30 });
    expect(p.ok).toBe(false);
    expect(p.error).toBe('historyExceedsTarget');
  });

  it('24 played against a 24 target → refused, it is already full', () => {
    // Not an arithmetic error, but a season with nothing left to play would
    // close on the next sweep — a confusing way to say "seal it now".
    const p = rounds({ playedHistory: 24 });
    expect(p.ok).toBe(false);
    expect(p.error).toBe('historyFillsTarget');
  });

  it('24 played against 24 CLOSES it, once the caller says equality may', () => {
    // The live "עדכן את יעד העונה" path. A running season has no "seal now"
    // chip to point at, so an admin who moves the finish line onto the number
    // the club is standing on is saying the season ends here — which is what
    // the server records as `endsTheSeason`. Reported by an admin who could
    // see 20/24 on the card and could not set 20.
    const p = rounds({ playedHistory: 24, equalTargetCloses: true });
    expect(p.ok).toBe(true);
    expect(p.error).toBeUndefined();
    expect(p.closesSeasonNow).toBe(true);
    expect(p.roundsRemaining).toBe(0);
    expect(p.startsAtRounds).toBe(24);
  });

  it('and 30 played against 24 is still refused, flag or no flag', () => {
    // A target UNDER the count is not a close, it is a number the season can
    // never play its way to. The server refuses it as well.
    const p = rounds({ playedHistory: 30, equalTargetCloses: true });
    expect(p.ok).toBe(false);
    expect(p.error).toBe('historyExceedsTarget');
    expect(p.closesSeasonNow).toBeUndefined();
  });

  it('a target with room left never claims to close anything', () => {
    const p = rounds({ playedHistory: 20, equalTargetCloses: true });
    expect(p.ok).toBe(true);
    expect(p.roundsRemaining).toBe(4);
    expect(p.closesSeasonNow).toBeUndefined();
  });

  it('23 played against 24 → allowed, exactly one evening left', () => {
    const p = rounds({ playedHistory: 23 });
    expect(p.ok).toBe(true);
    expect(p.roundsRemaining).toBe(1);
  });

  it('a club with no history starts at 0', () => {
    const p = rounds({ playedHistory: 0 });
    expect(p.ok).toBe(true);
    expect(p.startsAtRounds).toBe(0);
    expect(p.roundsRemaining).toBe(24);
  });
});

describe('rounds cadence, sealing season 1 now', () => {
  it('30 played and a 24 target is fine — season 2 begins empty', () => {
    const p = rounds({ playedHistory: 30, choice: 'sealNow' });
    expect(p.ok).toBe(true);
    expect(p.sealsSeason1).toBe(true);
    expect(p.activeSeasonNo).toBe(2);
    expect(p.startsAtRounds).toBe(0);
    expect(p.roundsRemaining).toBe(24);
    // The history is still reported, because the confirmation has to say what
    // is being sealed.
    expect(p.playedHistory).toBe(30);
  });
});

describe('rounds targets', () => {
  it('accepts the presets and any sensible custom count', () => {
    expect(isValidSeasonRounds(24)).toBe(true);
    expect(isValidSeasonRounds(48)).toBe(true);
    expect(isValidSeasonRounds(7)).toBe(true);
    // No upper bound was specified, and a long season is not a mistake.
    expect(isValidSeasonRounds(200)).toBe(true);
  });

  it('refuses a season that would close the night it opens', () => {
    expect(isValidSeasonRounds(1)).toBe(false);
    expect(isValidSeasonRounds(0)).toBe(false);
    expect(isValidSeasonRounds(-3)).toBe(false);
    expect(isValidSeasonRounds(4.5)).toBe(false);
    expect(MIN_SEASON_ROUNDS).toBe(2);
    expect(rounds({ targetRounds: 1 }).error).toBe('roundsInvalid');
  });
});

describe('date cadence, sealing season 1 now', () => {
  it('season 2 runs the chosen length from today', () => {
    const p = dated();
    expect(p.ok).toBe(true);
    expect(p.activeSeasonNo).toBe(2);
    expect(p.startsOn).toBe('2026-09-16');
    expect(p.endsOn).toBe('2026-12-15');
    expect(p.nextStartsOn).toBe('2026-12-16');
  });

  it('honours a custom length', () => {
    const p = dated({ months: 2 });
    expect(p.endsOn).toBe('2026-11-15');
    expect(p.nextStartsOn).toBe('2026-11-16');
  });

  it('refuses an invalid length', () => {
    expect(dated({ months: 0 }).error).toBe('monthsInvalid');
    expect(dated({ months: 25 }).error).toBe('monthsInvalid');
    expect(dated({ months: undefined }).error).toBe('monthsInvalid');
  });
});

describe('date cadence, carrying season 1 on', () => {
  it('needs an end date for season 1 — there is no honest start to compute', () => {
    const p = dated({ choice: 'continue' });
    expect(p.ok).toBe(false);
    expect(p.error).toBe('season1EndRequired');
  });

  it('the chosen end must be in the future', () => {
    expect(dated({ choice: 'continue', season1EndsOn: TODAY }).error).toBe(
      'season1EndNotFuture',
    );
    expect(
      dated({ choice: 'continue', season1EndsOn: '2026-09-15' }).error,
    ).toBe('season1EndNotFuture');
  });

  it('season 2 starts the day after season 1 ends — the spec example', () => {
    const p = dated({ choice: 'continue', season1EndsOn: '2026-10-31' });
    expect(p.ok).toBe(true);
    expect(p.activeSeasonNo).toBe(1);
    expect(p.endsOn).toBe('2026-10-31');
    expect(p.nextStartsOn).toBe('2026-11-01');
    // …and the chosen length applies from season 2 onwards.
    expect(p.months).toBe(3);
  });
});

describe('the plan is the same answer everywhere', () => {
  it('is pure — the same input gives the same plan', () => {
    expect(rounds()).toEqual(rounds());
    expect(dated()).toEqual(dated());
  });

  it('never reports ok together with an error', () => {
    for (const p of [
      rounds({ playedHistory: 30 }),
      rounds({ playedHistory: 24 }),
      rounds({ targetRounds: 0 }),
      dated({ months: 99 }),
      dated({ choice: 'continue' }),
    ]) {
      expect(p.ok).toBe(false);
      expect(typeof p.error).toBe('string');
    }
  });
});

describe('a client that predates the season-1 end picker', () => {
  // 1.1.7 is live in the store and sends no `season1EndsOn`. Requiring one
  // turned "הפעל עונות" into "משהו השתבש" for every club on that build —
  // reported within hours of the deploy. The server fills the gap rather than
  // refusing, because a shipped client cannot learn to send it.
  it('is not refused — season 1 runs the chosen length from today', () => {
    const p = planActivation({
      cadence: 'date',
      months: 3,
      choice: 'continue',
      playedHistory: 19,
      today: '2026-09-16',
      // The fallback the server computes when the request carries none.
      season1EndsOn: '2026-12-15',
    });
    expect(p.ok).toBe(true);
    expect(p.endsOn).toBe('2026-12-15');
    expect(p.nextStartsOn).toBe('2026-12-16');
  });

  it('and a client that DOES send one still gets what the admin chose', () => {
    const p = planActivation({
      cadence: 'date',
      months: 3,
      choice: 'continue',
      playedHistory: 19,
      today: '2026-09-16',
      season1EndsOn: '2026-10-31',
    });
    expect(p.endsOn).toBe('2026-10-31');
    expect(p.nextStartsOn).toBe('2026-11-01');
  });
});

describe('a club that already ran a season', () => {
  // The date picker for "when does season 1 end" is rendered only on a first
  // activation. Demanding its value from a club that has no season 1 left the
  // date cadence permanently unreachable: dead button, and a red line naming a
  // season the club archived months ago.
  const base = {
    cadence: 'date' as const,
    months: 6,
    choice: 'continue' as const,
    playedHistory: 22,
    today: '2026-09-18' as const,
  };

  it('does not have to date a season 1 it no longer has', () => {
    const plan = planActivation({ ...base, hasHistory: true });
    expect(plan.ok).toBe(true);
    expect(plan.error).toBeUndefined();
    expect(plan.endsOn).toBe('2027-03-17');
  });

  it('a first activation still must pick one', () => {
    expect(planActivation({ ...base, hasHistory: false }).error).toBe(
      'season1EndRequired',
    );
    expect(planActivation(base).error).toBe('season1EndRequired');
  });

  it('an explicit date still wins over the derived one', () => {
    const plan = planActivation({
      ...base,
      hasHistory: true,
      season1EndsOn: '2026-11-30',
    });
    expect(plan.ok).toBe(true);
    expect(plan.endsOn).toBe('2026-11-30');
  });
});
