// Regression guard for the "assists always 0" bug.
//
// Root cause was that `readLiveMatch` rebuilt every goal WITHOUT `assisterId`,
// so the assist was stripped on every read → the round-end stats commit saw a
// null assister → per-player assist tallies stayed 0 forever. A second strip in
// `readStats` dropped `stats.assists`/`stats.wins`. These tests pin both so the
// field can never be silently dropped again.
//
// `@/firebase/config` is mocked because the real module imports
// AsyncStorage (a native RN module) at load time, which can't run under
// jest/node. The functions under test are pure and never call getFirebase.

jest.mock('@/firebase/config', () => ({
  getFirebase: jest.fn(),
}));

import { readLiveMatch, readStats } from '@/firebase/firestore';

describe('readLiveMatch — assist survives deserialization', () => {
  it('keeps assisterId on a goal that has one', () => {
    const lm = readLiveMatch({
      phase: 'roundRunning',
      assignments: {},
      benchOrder: [],
      scoreA: 1,
      scoreB: 0,
      goals: [
        { id: 'g1', team: 'A', scorerId: 'scorer1', assisterId: 'assister1', minute: 7, at: 123 },
      ],
    });
    expect(lm).toBeDefined();
    expect(lm!.goals).toHaveLength(1);
    // The bug: this used to come back undefined.
    expect(lm!.goals![0].assisterId).toBe('assister1');
    // Sanity: the rest of the goal is intact too.
    expect(lm!.goals![0].scorerId).toBe('scorer1');
    expect(lm!.goals![0].minute).toBe(7);
  });

  it('leaves assisterId undefined on a goal with no assist (no crash, no garbage)', () => {
    const lm = readLiveMatch({
      phase: 'roundRunning',
      assignments: {},
      benchOrder: [],
      scoreA: 1,
      scoreB: 0,
      goals: [{ id: 'g2', team: 'B', scorerId: 'scorer2', minute: 3, at: 456 }],
    });
    expect(lm!.goals![0].assisterId).toBeUndefined();
    expect(lm!.goals![0].scorerId).toBe('scorer2');
  });

  it('ignores a non-string assisterId (own-goal / malformed)', () => {
    const lm = readLiveMatch({
      phase: 'roundRunning',
      assignments: {},
      benchOrder: [],
      scoreA: 0,
      scoreB: 1,
      goals: [{ id: 'g3', team: 'B', scorerId: null, assisterId: null, ownGoal: true, minute: 1, at: 1 }],
    });
    expect(lm!.goals![0].assisterId).toBeUndefined();
    expect(lm!.goals![0].ownGoal).toBe(true);
  });
});

describe('readStats — assists & wins survive deserialization', () => {
  it('returns the real assists and wins values', () => {
    const s = readStats({
      stats: { totalGames: 10, attended: 8, cancelled: 1, goals: 5, assists: 3, wins: 4 },
    });
    expect(s).toEqual({
      totalGames: 10,
      attended: 8,
      cancelled: 1,
      goals: 5,
      assists: 3, // the bug: used to be dropped → undefined → rendered 0
      wins: 4, // same
    });
  });

  it('defaults assists/wins to 0 when absent (legacy stat docs)', () => {
    const s = readStats({ stats: { totalGames: 2, attended: 2, cancelled: 0, goals: 0 } });
    expect(s!.assists).toBe(0);
    expect(s!.wins).toBe(0);
  });
});
