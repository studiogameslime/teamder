// Regression guards for the penalty-shootout persistence path.
//
// `readLiveMatch` rebuilds the live state from Firestore on every listener tick,
// keeping ONLY fields it explicitly deserializes. Without an explicit `shootout`
// branch the whole tiebreaker (first team, keepers, every kick) is stripped on
// each read and the UI resets mid-shootout / the round-end commit sees no kicks.
// `readStats` has the same risk for the six penalty stat fields.
//
// `@/firebase/config` is mocked because the real module pulls in AsyncStorage
// (native) at import time; the functions under test are pure.

jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn() }));

import { readLiveMatch, readStats } from '@/firebase/firestore';

const base = { phase: 'roundRunning', assignments: {}, benchOrder: [], scoreA: 0, scoreB: 0 };

describe('readLiveMatch — shootout survives deserialization', () => {
  it('keeps firstTeam, both keepers, and every kick with all fields', () => {
    const lm = readLiveMatch({
      ...base,
      shootout: {
        firstTeam: 'B',
        keeperA: 'gkA',
        keeperB: 'gkB',
        kicks: [
          { id: 'pk1', kickerId: 'k1', keeperId: 'gkB', team: 'A', scored: true, at: 111 },
          { id: 'pk2', kickerId: 'k2', keeperId: 'gkA', team: 'B', scored: false, at: 222 },
        ],
      },
    });
    expect(lm?.shootout).toBeDefined();
    expect(lm!.shootout!.firstTeam).toBe('B');
    expect(lm!.shootout!.keeperA).toBe('gkA');
    expect(lm!.shootout!.keeperB).toBe('gkB');
    expect(lm!.shootout!.kicks).toHaveLength(2);
    // The bug would strip these — pin each field.
    expect(lm!.shootout!.kicks[0]).toEqual({
      id: 'pk1',
      kickerId: 'k1',
      keeperId: 'gkB',
      team: 'A',
      scored: true,
      at: 111,
    });
    expect(lm!.shootout!.kicks[1].scored).toBe(false);
    expect(lm!.shootout!.kicks[1].team).toBe('B');
  });

  it('accepts a just-started shootout (keepers unset, no kicks yet)', () => {
    const lm = readLiveMatch({ ...base, shootout: { firstTeam: 'A', kicks: [] } });
    expect(lm?.shootout).toBeDefined();
    expect(lm!.shootout!.firstTeam).toBe('A');
    expect(lm!.shootout!.keeperA).toBeUndefined();
    expect(lm!.shootout!.keeperB).toBeUndefined();
    expect(lm!.shootout!.kicks).toEqual([]);
  });

  it('preserves an explicit null keeper (distinct from unset)', () => {
    const lm = readLiveMatch({
      ...base,
      shootout: { firstTeam: 'A', keeperA: null, keeperB: 'gkB', kicks: [] },
    });
    expect(lm!.shootout!.keeperA).toBeNull();
    expect(lm!.shootout!.keeperB).toBe('gkB');
  });

  it('drops an invalid shootout with no firstTeam', () => {
    const lm = readLiveMatch({ ...base, shootout: { kicks: [] } });
    expect(lm?.shootout).toBeUndefined();
  });

  it('returns no shootout when the field is absent (a normal round)', () => {
    const lm = readLiveMatch({ ...base });
    expect(lm?.shootout).toBeUndefined();
  });

  it('filters out malformed kicks (missing id / kicker / bad team) but keeps valid ones', () => {
    const lm = readLiveMatch({
      ...base,
      shootout: {
        firstTeam: 'A',
        kicks: [
          { id: 'ok', kickerId: 'k1', keeperId: 'g', team: 'A', scored: true, at: 1 },
          { kickerId: 'noId', keeperId: 'g', team: 'A', scored: true, at: 2 }, // no id
          { id: 'noKicker', keeperId: 'g', team: 'A', scored: true, at: 3 }, // no kicker
          { id: 'badTeam', kickerId: 'k', keeperId: 'g', team: 'C', scored: true, at: 4 }, // bad team
        ],
      },
    });
    expect(lm!.shootout!.kicks).toHaveLength(1);
    expect(lm!.shootout!.kicks[0].id).toBe('ok');
  });

  it('coerces a kick missing keeperId/at to safe defaults', () => {
    const lm = readLiveMatch({
      ...base,
      shootout: { firstTeam: 'A', kicks: [{ id: 'x', kickerId: 'k', team: 'B', scored: true }] },
    });
    const k = lm!.shootout!.kicks[0];
    expect(k.keeperId).toBe('');
    expect(k.at).toBe(0);
    expect(k.scored).toBe(true);
  });

  it('treats a non-true scored as false', () => {
    const lm = readLiveMatch({
      ...base,
      // scored omitted entirely → false
      shootout: { firstTeam: 'A', kicks: [{ id: 'x', kickerId: 'k', keeperId: 'g', team: 'A', at: 5 }] },
    });
    expect(lm!.shootout!.kicks[0].scored).toBe(false);
  });
});

describe('readStats — penalty fields survive deserialization', () => {
  it('keeps all six penalty fields when present', () => {
    const s = readStats({
      stats: {
        totalGames: 3,
        penTaken: 8,
        penScored: 5,
        penMissed: 3,
        penFaced: 6,
        penSaved: 2,
        penConceded: 4,
      },
    });
    expect(s).toMatchObject({
      penTaken: 8,
      penScored: 5,
      penMissed: 3,
      penFaced: 6,
      penSaved: 2,
      penConceded: 4,
    });
  });

  it('leaves penalty fields undefined (not 0) when absent — a player who never took one', () => {
    const s = readStats({ stats: { totalGames: 1, goals: 2 } });
    expect(s!.penTaken).toBeUndefined();
    expect(s!.penScored).toBeUndefined();
    expect(s!.penFaced).toBeUndefined();
    expect(s!.penSaved).toBeUndefined();
  });

  it('ignores non-numeric penalty values (undefined, not garbage)', () => {
    const s = readStats({ stats: { totalGames: 1, penScored: 'lots' as unknown as number } });
    expect(s!.penScored).toBeUndefined();
  });

  it('keeps a legitimate zero when explicitly present', () => {
    const s = readStats({ stats: { totalGames: 1, penTaken: 2, penScored: 0, penMissed: 2 } });
    expect(s!.penScored).toBe(0);
    expect(s!.penTaken).toBe(2);
  });
});
