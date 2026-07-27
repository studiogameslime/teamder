// Exhaustive tests for the penalty-shootout stat logic (src/utils/penaltyStats.ts).
// This module is the CANONICAL spec for how penalty stats are recorded + how the
// community penalty leaders are derived; `aggregatePenalties` mirrors the
// commitRoundStats cloud function. If these pass, the recording math is correct.

import {
  buildShootoutPenaltyPayload,
  aggregatePenalties,
  penaltyKing,
  penaltyKeeperKing,
  pctOf,
  PENALTY_ROUND_CAP,
  type PenaltyKick,
} from '@/utils/penaltyStats';

// ── helpers ──────────────────────────────────────────────────────────────
const kick = (
  kickerId: string,
  keeperId: string,
  scored: boolean,
  i = 0,
): { id: string; kickerId: string; keeperId: string; team: 'A' | 'B'; scored: boolean; at: number } => ({
  id: `pk_${kickerId}_${i}`,
  kickerId,
  keeperId,
  team: 'A',
  scored,
  at: 1000 + i,
});
const shootout = (kicks: ReturnType<typeof kick>[]) => ({ firstTeam: 'A' as const, kicks });
// Everyone real + on field unless a test overrides.
const ALL = { isOnField: () => true, isReal: () => true };

// ═══════════════════════════════════════════════════════════════════════════
describe('buildShootoutPenaltyPayload', () => {
  it('maps each kick to {kickerId, keeperId, scored}', () => {
    const p = buildShootoutPenaltyPayload(
      shootout([kick('k1', 'g1', true, 0), kick('k2', 'g1', false, 1)]),
    );
    expect(p).toEqual([
      { kickerId: 'k1', keeperId: 'g1', scored: true },
      { kickerId: 'k2', keeperId: 'g1', scored: false },
    ]);
  });

  it('returns [] for undefined / null / no-kicks shootout', () => {
    expect(buildShootoutPenaltyPayload(undefined)).toEqual([]);
    expect(buildShootoutPenaltyPayload(null)).toEqual([]);
    expect(buildShootoutPenaltyPayload({ firstTeam: 'A', kicks: [] })).toEqual([]);
  });

  it('coerces a missing keeperId to null and a falsy scored to false', () => {
    const p = buildShootoutPenaltyPayload({
      firstTeam: 'B',
      kicks: [{ id: 'x', kickerId: 'k1', keeperId: '', team: 'B', scored: false, at: 1 }],
    });
    expect(p[0]).toEqual({ kickerId: 'k1', keeperId: null, scored: false });
  });

  it('preserves order (kick sequence is meaningful)', () => {
    const p = buildShootoutPenaltyPayload(
      shootout([kick('a', 'g', true, 0), kick('b', 'g', true, 1), kick('c', 'g', false, 2)]),
    );
    expect(p.map((x) => x.kickerId)).toEqual(['a', 'b', 'c']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('aggregatePenalties — kicker tallies', () => {
  it('scored kick → taken+1, scored+1, missed 0', () => {
    const { byKicker } = aggregatePenalties([{ kickerId: 'k', keeperId: 'g', scored: true }], ALL);
    expect(byKicker.k).toEqual({ taken: 1, scored: 1, missed: 0 });
  });

  it('missed kick → taken+1, missed+1, scored 0', () => {
    const { byKicker } = aggregatePenalties([{ kickerId: 'k', keeperId: 'g', scored: false }], ALL);
    expect(byKicker.k).toEqual({ taken: 1, scored: 0, missed: 1 });
  });

  it('accumulates multiple kicks by the same kicker (dedup into one entry)', () => {
    const pens: PenaltyKick[] = [
      { kickerId: 'k', keeperId: 'g', scored: true },
      { kickerId: 'k', keeperId: 'g', scored: true },
      { kickerId: 'k', keeperId: 'g', scored: false },
    ];
    const { byKicker } = aggregatePenalties(pens, ALL);
    expect(byKicker.k).toEqual({ taken: 3, scored: 2, missed: 1 });
    expect(Object.keys(byKicker)).toHaveLength(1);
  });

  it('taken always equals scored + missed (invariant)', () => {
    const pens: PenaltyKick[] = [
      { kickerId: 'a', keeperId: 'g', scored: true },
      { kickerId: 'a', keeperId: 'g', scored: false },
      { kickerId: 'b', keeperId: 'g', scored: true },
    ];
    const { byKicker } = aggregatePenalties(pens, ALL);
    for (const s of Object.values(byKicker)) {
      expect(s.taken).toBe(s.scored + s.missed);
    }
  });
});

describe('aggregatePenalties — keeper tallies (the scored↔conceded inversion)', () => {
  it('kick SCORED → keeper faced+1, conceded+1, saved 0', () => {
    const { byKeeper } = aggregatePenalties([{ kickerId: 'k', keeperId: 'g', scored: true }], ALL);
    expect(byKeeper.g).toEqual({ faced: 1, saved: 0, conceded: 1 });
  });

  it('kick MISSED → keeper faced+1, saved+1, conceded 0 (a miss is a save for the keeper)', () => {
    const { byKeeper } = aggregatePenalties([{ kickerId: 'k', keeperId: 'g', scored: false }], ALL);
    expect(byKeeper.g).toEqual({ faced: 1, saved: 1, conceded: 0 });
  });

  it('faced always equals saved + conceded (invariant)', () => {
    const pens: PenaltyKick[] = [
      { kickerId: 'a', keeperId: 'g', scored: true },
      { kickerId: 'b', keeperId: 'g', scored: false },
      { kickerId: 'c', keeperId: 'g', scored: false },
    ];
    const { byKeeper } = aggregatePenalties(pens, ALL);
    expect(byKeeper.g).toEqual({ faced: 3, saved: 2, conceded: 1 });
    expect(byKeeper.g.faced).toBe(byKeeper.g.saved + byKeeper.g.conceded);
  });
});

describe('aggregatePenalties — both sides of one kick are credited', () => {
  it('a single kick credits its kicker AND its keeper', () => {
    const { byKicker, byKeeper } = aggregatePenalties(
      [{ kickerId: 'k', keeperId: 'g', scored: true }],
      ALL,
    );
    expect(byKicker.k.taken).toBe(1);
    expect(byKeeper.g.faced).toBe(1);
  });

  it('same person as kicker in one kick and keeper in another (both roles counted)', () => {
    // Player X kicks (scores), then later is the keeper facing a miss.
    const pens: PenaltyKick[] = [
      { kickerId: 'X', keeperId: 'Y', scored: true },
      { kickerId: 'Y', keeperId: 'X', scored: false },
    ];
    const { byKicker, byKeeper } = aggregatePenalties(pens, ALL);
    expect(byKicker.X).toEqual({ taken: 1, scored: 1, missed: 0 });
    expect(byKeeper.X).toEqual({ faced: 1, saved: 1, conceded: 0 });
  });
});

describe('aggregatePenalties — gating (guests + off-field carry no stats)', () => {
  it('excludes a kicker who is not real (guest)', () => {
    const { byKicker } = aggregatePenalties([{ kickerId: 'guest:1', keeperId: 'g', scored: true }], {
      isOnField: () => true,
      isReal: (id) => !id.startsWith('guest:'),
    });
    expect(byKicker['guest:1']).toBeUndefined();
  });

  it('still credits the keeper even when the kicker is a guest', () => {
    const { byKicker, byKeeper } = aggregatePenalties(
      [{ kickerId: 'guest:1', keeperId: 'g', scored: true }],
      { isOnField: () => true, isReal: (id) => !id.startsWith('guest:') },
    );
    expect(byKicker['guest:1']).toBeUndefined();
    expect(byKeeper.g).toEqual({ faced: 1, saved: 0, conceded: 1 });
  });

  it('excludes a kicker who is off the field', () => {
    const { byKicker } = aggregatePenalties([{ kickerId: 'bench', keeperId: 'g', scored: true }], {
      isOnField: (id) => id !== 'bench',
      isReal: () => true,
    });
    expect(byKicker.bench).toBeUndefined();
  });

  it('excludes an off-field keeper but keeps the on-field kicker', () => {
    const { byKicker, byKeeper } = aggregatePenalties(
      [{ kickerId: 'k', keeperId: 'benchGk', scored: false }],
      { isOnField: (id) => id !== 'benchGk', isReal: () => true },
    );
    expect(byKicker.k).toEqual({ taken: 1, scored: 0, missed: 1 });
    expect(byKeeper.benchGk).toBeUndefined();
  });

  it('skips entries with a null/empty kicker and keeper', () => {
    const pens: PenaltyKick[] = [
      { kickerId: null, keeperId: null, scored: true },
      { kickerId: '', keeperId: '', scored: false },
    ];
    const { byKicker, byKeeper } = aggregatePenalties(pens, ALL);
    expect(byKicker).toEqual({});
    expect(byKeeper).toEqual({});
  });
});

describe('aggregatePenalties — safety + edge cases', () => {
  it('returns empty maps for null / undefined / empty input', () => {
    expect(aggregatePenalties(null, ALL)).toEqual({ byKicker: {}, byKeeper: {} });
    expect(aggregatePenalties(undefined, ALL)).toEqual({ byKicker: {}, byKeeper: {} });
    expect(aggregatePenalties([], ALL)).toEqual({ byKicker: {}, byKeeper: {} });
  });

  it(`caps at PENALTY_ROUND_CAP (${PENALTY_ROUND_CAP}) kicks — a forged huge payload is clipped`, () => {
    const pens: PenaltyKick[] = Array.from({ length: 50 }, () => ({
      kickerId: 'k',
      keeperId: 'g',
      scored: true,
    }));
    const { byKicker, byKeeper } = aggregatePenalties(pens, ALL);
    expect(byKicker.k.taken).toBe(PENALTY_ROUND_CAP);
    expect(byKeeper.g.faced).toBe(PENALTY_ROUND_CAP);
  });

  it('a realistic 5-vs-5 shootout tallies correctly end to end', () => {
    // Red kickers r1..r5 vs blue keeper gk; blue kickers b1..b5 vs red keeper gr.
    const pens: PenaltyKick[] = [
      { kickerId: 'r1', keeperId: 'gk', scored: true },
      { kickerId: 'b1', keeperId: 'gr', scored: false },
      { kickerId: 'r2', keeperId: 'gk', scored: true },
      { kickerId: 'b2', keeperId: 'gr', scored: true },
      { kickerId: 'r3', keeperId: 'gk', scored: false },
      { kickerId: 'b3', keeperId: 'gr', scored: true },
    ];
    const { byKicker, byKeeper } = aggregatePenalties(pens, ALL);
    // Red scored 2 of 3; blue scored 2 of 3.
    expect(byKicker.r1.scored).toBe(1);
    expect(byKicker.r3.missed).toBe(1);
    // gk (blue keeper) faced 3 red kicks, saved 1 (r3 missed), conceded 2.
    expect(byKeeper.gk).toEqual({ faced: 3, saved: 1, conceded: 2 });
    // gr (red keeper) faced 3 blue kicks, saved 1 (b1 missed), conceded 2.
    expect(byKeeper.gr).toEqual({ faced: 3, saved: 1, conceded: 2 });
  });

  it('payload → aggregate round-trips (buildShootoutPenaltyPayload feeds aggregatePenalties)', () => {
    const sh = shootout([kick('k1', 'g1', true, 0), kick('k1', 'g1', false, 1), kick('k2', 'g1', true, 2)]);
    const { byKicker, byKeeper } = aggregatePenalties(buildShootoutPenaltyPayload(sh), ALL);
    expect(byKicker.k1).toEqual({ taken: 2, scored: 1, missed: 1 });
    expect(byKicker.k2).toEqual({ taken: 1, scored: 1, missed: 0 });
    expect(byKeeper.g1).toEqual({ faced: 3, saved: 1, conceded: 2 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('pctOf', () => {
  it('rounds to a whole percent', () => {
    expect(pctOf(1, 3)).toBe(33);
    expect(pctOf(2, 3)).toBe(67);
    expect(pctOf(3, 4)).toBe(75);
  });
  it('is 0 when there are no attempts (no divide-by-zero)', () => {
    expect(pctOf(0, 0)).toBe(0);
    expect(pctOf(5, 0)).toBe(0);
  });
  it('is 100 for a perfect record', () => {
    expect(pctOf(4, 4)).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('penaltyKing (top scorer)', () => {
  it('picks the player with the most penalties scored', () => {
    const king = penaltyKing([
      { userId: 'a', penScored: 3, penTaken: 5 },
      { userId: 'b', penScored: 7, penTaken: 10 },
      { userId: 'c', penScored: 1, penTaken: 1 },
    ]);
    expect(king?.userId).toBe('b');
    expect(king?.count).toBe(7);
    expect(king?.attempts).toBe(10);
    expect(king?.pct).toBe(70);
  });

  it('breaks a tie on scored by higher success %', () => {
    const king = penaltyKing([
      { userId: 'a', penScored: 5, penTaken: 10 }, // 50%
      { userId: 'b', penScored: 5, penTaken: 6 }, //  83%
    ]);
    expect(king?.userId).toBe('b');
  });

  it('breaks a scored+% tie by more attempts (bigger sample)', () => {
    const king = penaltyKing([
      { userId: 'a', penScored: 4, penTaken: 8 }, // 50%, 8 att
      { userId: 'b', penScored: 4, penTaken: 8 }, // 50%, 8 att → same → uid
      { userId: 'c', penScored: 4, penTaken: 4 }, // 100% wins anyway
    ]);
    expect(king?.userId).toBe('c');
    // With c removed, a and b are fully tied → deterministic uid order.
    const king2 = penaltyKing([
      { userId: 'z', penScored: 4, penTaken: 8 },
      { userId: 'a', penScored: 4, penTaken: 8 },
    ]);
    expect(king2?.userId).toBe('a'); // 'a' < 'z'
  });

  it('ranks by Wilson score — a proven high-volume scorer beats a one-shot 100%', () => {
    // 8/10 (80%) should outrank 1/1 (100%): more attempts + strong rate wins,
    // so a lucky single penalty no longer crowns the king (Pulse feedback).
    const king = penaltyKing([
      { userId: 'volume', penScored: 8, penTaken: 10 }, // 80%, big sample
      { userId: 'oneshot', penScored: 1, penTaken: 1 }, // 100%, tiny sample
    ]);
    expect(king?.userId).toBe('volume');
    expect(king?.pct).toBe(80); // still shows the REAL success %
  });

  it('returns null when nobody has scored a penalty', () => {
    expect(
      penaltyKing([
        { userId: 'a', penScored: 0, penTaken: 3 },
        { userId: 'b', penScored: 0, penTaken: 0 },
      ]),
    ).toBeNull();
    expect(penaltyKing([])).toBeNull();
  });

  it('handles missing fields as zero', () => {
    const king = penaltyKing([{ userId: 'a' }, { userId: 'b', penScored: 1, penTaken: 1 }]);
    expect(king?.userId).toBe('b');
  });

  it('ignores keeper fields (a save is not a scored penalty)', () => {
    const king = penaltyKing([
      { userId: 'a', penSaved: 9, penFaced: 9, penScored: 0, penTaken: 0 },
      { userId: 'b', penScored: 1, penTaken: 2 },
    ]);
    expect(king?.userId).toBe('b');
  });
});

describe('penaltyKeeperKing (top saver)', () => {
  it('picks the keeper with the most penalties saved', () => {
    const king = penaltyKeeperKing([
      { userId: 'a', penSaved: 2, penFaced: 8 },
      { userId: 'b', penSaved: 6, penFaced: 12 },
      { userId: 'c', penSaved: 1, penFaced: 1 },
    ]);
    expect(king?.userId).toBe('b');
    expect(king?.count).toBe(6);
    expect(king?.attempts).toBe(12);
    expect(king?.pct).toBe(50);
  });

  it('breaks a saved tie by higher save %', () => {
    const king = penaltyKeeperKing([
      { userId: 'a', penSaved: 3, penFaced: 12 }, // 25%
      { userId: 'b', penSaved: 3, penFaced: 5 }, //  60%
    ]);
    expect(king?.userId).toBe('b');
  });

  it('returns null when nobody has saved a penalty', () => {
    expect(
      penaltyKeeperKing([
        { userId: 'a', penSaved: 0, penFaced: 5 },
        { userId: 'b', penSaved: 0, penFaced: 0 },
      ]),
    ).toBeNull();
    expect(penaltyKeeperKing([])).toBeNull();
  });

  it('ignores kicker fields (a scored penalty is not a save)', () => {
    const king = penaltyKeeperKing([
      { userId: 'a', penScored: 9, penTaken: 9, penSaved: 0, penFaced: 0 },
      { userId: 'b', penSaved: 1, penFaced: 3 },
    ]);
    expect(king?.userId).toBe('b');
  });

  it('king and keeper-king can be two different players in the same community', () => {
    const players = [
      { userId: 'striker', penScored: 8, penTaken: 10, penSaved: 0, penFaced: 0 },
      { userId: 'keeper', penScored: 0, penTaken: 1, penSaved: 5, penFaced: 9 },
    ];
    expect(penaltyKing(players)?.userId).toBe('striker');
    expect(penaltyKeeperKing(players)?.userId).toBe('keeper');
  });
});
