// When a season may close, and what may change while it runs.

import {
  isSeasonDue,
  canCloseNow,
  roundsRemaining,
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

