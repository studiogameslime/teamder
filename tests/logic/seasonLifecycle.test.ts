// When a season may close, and what may change while it runs.

import {
  isSeasonDue,
  canCloseNow,
  roundsRemaining,
  validateTargetChange,
  continueSeasonTarget,
  addMonthsClamped,
  type SeasonState,
} from '@/utils/seasonLifecycle';

const state = (over: Partial<SeasonState> = {}): SeasonState => ({
  cadence: { type: 'rounds', targetRounds: 24 },
  completedRounds: 0,
  hasOpenGame: false,
  hasUnsealedGame: false,
  ...over,
});

const NOW = Date.UTC(2026, 8, 13); // 13.09.2026

describe('is the season due', () => {
  it('by rounds: at the target, not before', () => {
    expect(isSeasonDue(state({ completedRounds: 23 }), NOW)).toBe(false);
    expect(isSeasonDue(state({ completedRounds: 24 }), NOW)).toBe(true);
    expect(isSeasonDue(state({ completedRounds: 30 }), NOW)).toBe(true);
  });

  it('by date: at the moment, not before', () => {
    const c = { type: 'date' as const, endsAt: NOW };
    expect(isSeasonDue(state({ cadence: c }), NOW - 1)).toBe(false);
    expect(isSeasonDue(state({ cadence: c }), NOW)).toBe(true);
  });

  it('an unset target never comes due', () => {
    expect(isSeasonDue(state({ cadence: { type: 'rounds' } }), NOW)).toBe(false);
    expect(isSeasonDue(state({ cadence: { type: 'date' } }), NOW)).toBe(false);
  });
});

describe('the seam a season is allowed to close on', () => {
  it('closes when the club is quiet', () => {
    expect(canCloseNow(state()).ok).toBe(true);
  });

  it('never while a game is open — that splits an evening in two', () => {
    const r = canCloseNow(state({ hasOpenGame: true }));
    expect(r.ok).toBe(false);
    expect(r.blocker).toBe('openGame');
  });

  it('never before the last evening is sealed', () => {
    // Closing across this gap makes the summary compare tonight against a
    // table with no history, so every stat reads as a club record — and the
    // summary is written once, so the wrong story is permanent.
    const r = canCloseNow(state({ hasUnsealedGame: true }));
    expect(r.ok).toBe(false);
    expect(r.blocker).toBe('unsealedGame');
  });

  it('being due does not by itself permit closing', () => {
    const s = state({ completedRounds: 24, hasOpenGame: true });
    expect(isSeasonDue(s, NOW)).toBe(true);
    expect(canCloseNow(s).ok).toBe(false);
  });
});

describe('rounds remaining', () => {
  it('counts down to the total, never below zero', () => {
    expect(roundsRemaining(state({ completedRounds: 17 }))).toBe(7);
    expect(roundsRemaining(state({ completedRounds: 24 }))).toBe(0);
    expect(roundsRemaining(state({ completedRounds: 30 }))).toBe(0);
  });

  it('is null for a season that ends on a date', () => {
    expect(roundsRemaining(state({ cadence: { type: 'date', endsAt: NOW } }))).toBeNull();
  });
});

describe('moving the finish line mid-season', () => {
  it('allows a target ahead of what has been played', () => {
    const r = validateTargetChange(
      { type: 'rounds', targetRounds: 24 }, { completedRounds: 17 }, NOW);
    expect(r.ok).toBe(true);
  });

  it('rejects a target already reached — that is "end now" in disguise', () => {
    for (const target of [17, 12, 1]) {
      const r = validateTargetChange(
        { type: 'rounds', targetRounds: target }, { completedRounds: 17 }, NOW);
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('roundsNotAbovePlayed');
    }
  });

  it('rejects a date in the past', () => {
    const r = validateTargetChange(
      { type: 'date', endsAt: NOW - 1 }, { completedRounds: 5 }, NOW);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('dateInPast');
  });

  it('accepts a date in the future', () => {
    const r = validateTargetChange(
      { type: 'date', endsAt: NOW + 86_400_000 }, { completedRounds: 5 }, NOW);
    expect(r.ok).toBe(true);
  });

  it('rejects a missing or nonsense target', () => {
    expect(validateTargetChange({ type: 'rounds' }, { completedRounds: 3 }, NOW).reason)
      .toBe('missingTarget');
    expect(validateTargetChange({ type: 'rounds', targetRounds: 0 }, { completedRounds: 3 }, NOW).reason)
      .toBe('missingTarget');
    expect(validateTargetChange({ type: 'date' }, { completedRounds: 3 }, NOW).reason)
      .toBe('missingTarget');
  });

  it('switching cadence type is just another change', () => {
    const r = validateTargetChange(
      { type: 'date', endsAt: NOW + 1000 }, { completedRounds: 17 }, NOW);
    expect(r.ok).toBe(true);
  });
});

describe('continuing season 1 on a club with history', () => {
  it('measures a date target from switch-on, not from the club start', () => {
    // A two-year-old club picking six months must not be handed a deadline
    // eighteen months in the past.
    const c = continueSeasonTarget(
      { type: 'date', endsAt: NOW + 6 * 30 * 86_400_000 }, 60, NOW, addMonthsClamped);
    expect(c.endsAt).toBeGreaterThan(NOW);
  });

  it('lifts a rounds target above what has already been played', () => {
    // 60 played, admin types 24 — taken literally the season ends on save.
    const c = continueSeasonTarget(
      { type: 'rounds', targetRounds: 24 }, 60, NOW, addMonthsClamped);
    expect(c.targetRounds).toBe(61);
  });

  it('leaves a sensible rounds target alone', () => {
    const c = continueSeasonTarget(
      { type: 'rounds', targetRounds: 24 }, 17, NOW, addMonthsClamped);
    expect(c.targetRounds).toBe(24);
  });
});

describe('month arithmetic', () => {
  it('six months after 31 August is the last day of February, not 3 March', () => {
    const aug31 = new Date(2026, 7, 31).getTime();
    const out = new Date(addMonthsClamped(aug31, 6));
    expect(out.getMonth()).toBe(1);            // February
    expect(out.getDate()).toBeGreaterThanOrEqual(28);
    expect(out.getDate()).toBeLessThanOrEqual(29);
  });

  it('31 January plus one month clamps to the end of February', () => {
    const jan31 = new Date(2026, 0, 31).getTime();
    const out = new Date(addMonthsClamped(jan31, 1));
    expect(out.getMonth()).toBe(1);
    expect(out.getDate()).toBeLessThanOrEqual(29);
  });

  it('an ordinary day is untouched', () => {
    const mar15 = new Date(2026, 2, 15).getTime();
    const out = new Date(addMonthsClamped(mar15, 3));
    expect(out.getMonth()).toBe(5);            // June
    expect(out.getDate()).toBe(15);
  });

  it('crosses the year', () => {
    const nov30 = new Date(2026, 10, 30).getTime();
    const out = new Date(addMonthsClamped(nov30, 3));
    expect(out.getFullYear()).toBe(2027);
    expect(out.getMonth()).toBe(1);
  });
});
