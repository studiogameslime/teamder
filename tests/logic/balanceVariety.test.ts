import {
  balanceCore,
  buildPairRepeatWeights,
  balancePenalty,
  balanceBand,
  pairKey,
  GAP_MAX,
  GAP_EXCELLENT,
  NEUTRAL_RATING,
  type PastSplit,
} from '@/utils/teamBalanceCore';

// The real 12.08 roster of "כדורגל אנשים טובים": 15 players, 3 teams of 5.
const RATINGS_1208 = [
  4.5, 4, 3.6, 3.2, 4, 3.3, 3, 3.5, 3.2, 4.3, 2.7, 3.4, 3, 4, 1,
];
const IDS = RATINGS_1208.map((_, i) => `p${i}`);
const RATINGS: Record<string, number> = {};
RATINGS_1208.forEach((r, i) => {
  RATINGS[`p${i}`] = r;
});

const rate = (id: string) => RATINGS[id] ?? NEUTRAL_RATING;
const avg = (ids: string[]) => ids.reduce((s, i) => s + rate(i), 0) / ids.length;
const gapOf = (teams: string[][]) => {
  const a = teams.map(avg);
  return Math.max(...a) - Math.min(...a);
};

function split(opts: { history?: PastSplit[]; rng?: () => number } = {}) {
  return balanceCore({
    playerIds: IDS,
    ratings: RATINGS,
    numTeams: 3,
    perTeam: 5,
    pairWeights: opts.history
      ? buildPairRepeatWeights(opts.history)
      : undefined,
    rng: opts.rng,
  });
}

/** A split of the 15 into 3 fixed teams, used as history. */
const asSplit = (startsAt: number, teams: number[][]): PastSplit => ({
  startsAt,
  teams: teams.map((t) => t.map((i) => `p${i}`)),
});

const LAST_WEEK = asSplit(1000, [
  [0, 1, 2, 3, 4],
  [5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14],
]);

/** How many pairs of a split were together in `prev`. */
function repeatedPairs(teams: string[][], prev: PastSplit): number {
  const teamOf: Record<string, number> = {};
  prev.teams.forEach((t, i) => t.forEach((id) => (teamOf[id] = i)));
  let n = 0;
  for (const team of teams) {
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const a = teamOf[team[i]];
        const b = teamOf[team[j]];
        if (a !== undefined && a === b) n += 1;
      }
    }
  }
  return n;
}

describe('1 · 15 players, 3 teams of 5', () => {
  it('splits everyone into three fives, nobody benched or duplicated', () => {
    const r = split({ history: [LAST_WEEK] });
    expect(r.teams.map((t) => t.length).sort()).toEqual([5, 5, 5]);
    expect(r.bench).toHaveLength(0);
    expect(new Set(r.teams.flat()).size).toBe(15);
  });
});

describe('2 · no history at all', () => {
  it('behaves like a pure balance split — no bias, no drift', () => {
    for (let i = 0; i < 20; i++) {
      const r = split();
      expect(r.repeat).toBe(0);
      // With nothing to gain from variety it must not spend balance either.
      expect(r.gap).toBeLessThanOrEqual(GAP_EXCELLENT);
    }
  });
  it('is still non-deterministic', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      seen.add(
        split()
          .teams.map((t) => t.slice().sort().join(','))
          .sort()
          .join('|'),
      );
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });
});

describe('3 · the same 15 players over several game-nights', () => {
  it('keeps the gap inside the ceiling every week', () => {
    let history: PastSplit[] = [];
    for (let week = 0; week < 8; week++) {
      const r = split({ history });
      expect(r.gap).toBeLessThanOrEqual(GAP_MAX + 1e-9);
      history = [{ startsAt: week, teams: r.teams }, ...history];
    }
  });

  it('breaks up last week much more often than it repeats it', () => {
    // 3 teams of 5 = 30 pairs. Repeating the same split would score 30.
    let history: PastSplit[] = [LAST_WEEK];
    const repeats: number[] = [];
    for (let week = 0; week < 6; week++) {
      const r = split({ history });
      repeats.push(repeatedPairs(r.teams, history[0]));
      history = [{ startsAt: 2000 + week, teams: r.teams }, ...history];
    }
    const worst = Math.max(...repeats);
    expect(worst).toBeLessThan(15); // never half of last week's pairs
  });
});

describe('4 · a pair from last week is discouraged, never forbidden', () => {
  it('can still put two players together two weeks running', () => {
    // A roster where balance leaves exactly ONE acceptable split: ratings
    // 5 / 1 / 4 / 2 over two pairs. {a,b} vs {c,d} is 3.0 vs 3.0; every other
    // pairing is off by 1.0 or more. So a+b must be rebuilt even though they
    // were together last week — the model discourages repeats, it never
    // refuses to produce one.
    const ids = ['a', 'b', 'c', 'd'];
    const ratings = { a: 5, b: 1, c: 4, d: 2 };
    const history: PastSplit[] = [
      { startsAt: 1, teams: [['a', 'b'], ['c', 'd']] },
    ];
    let together = 0;
    for (let i = 0; i < 30; i++) {
      const r = balanceCore({
        playerIds: ids,
        ratings,
        numTeams: 2,
        perTeam: 2,
        pairWeights: buildPairRepeatWeights(history),
      });
      if (r.teams.some((t) => t.includes('a') && t.includes('b'))) together += 1;
      expect(r.gap).toBeLessThanOrEqual(GAP_MAX + 1e-9);
    }
    // Balance forces the same shape; the model must not refuse to produce it.
    expect(together).toBe(30);
  });
});

describe('5 · pairs that keep recurring get pushed apart', () => {
  it('a pair together three nights running is rarer than a fresh pair', () => {
    const history: PastSplit[] = [
      asSplit(3, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14]]),
      asSplit(2, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14]]),
      asSplit(1, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14]]),
    ];
    const weights = buildPairRepeatWeights(history);
    // p0+p1 were together in all three → 1.0 + 0.6 + 0.3
    expect(weights[pairKey('p0', 'p1')]).toBeCloseTo(1.9, 6);
    // p0+p5 never were → absent
    expect(weights[pairKey('p0', 'p5')]).toBeUndefined();

    // Measured across ALL pairs, not two hand-picked ones: this roster has a
    // 1.0 outlier, and carrying him at an equal average forces a fixed strong
    // core, so individual pairs can be pinned by arithmetic rather than by the
    // model. The aggregate is what the variety rule is supposed to move.
    const counts: Record<string, number> = {};
    const RUNS = 40;
    for (let i = 0; i < RUNS; i++) {
      const r = split({ history });
      for (const t of r.teams) {
        for (let a = 0; a < t.length; a++) {
          for (let b = a + 1; b < t.length; b++) {
            const k = pairKey(t[a], t[b]);
            counts[k] = (counts[k] ?? 0) + 1;
          }
        }
      }
    }
    const mean = (xs: number[]) =>
      xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    const wasTogether = Object.keys(counts).filter((k) => weights[k]);
    const wasNot = Object.keys(counts).filter((k) => !weights[k]);
    expect(mean(wasTogether.map((k) => counts[k]))).toBeLessThan(
      mean(wasNot.map((k) => counts[k])),
    );
    // And the pair that was together all three nights is not among the ones
    // the split keeps rebuilding.
    expect(counts[pairKey('p0', 'p1')] ?? 0).toBeLessThan(RUNS / 2);
  });
});

describe('6/7 · balance is traded for variety, but only up to a point', () => {
  const scale = 6; // 30 pairs × 0.2 — one cost unit ≈ six last-week pairs
  const cost = (gap: number, repeat: number) =>
    balancePenalty(gap) + repeat / scale;

  it('0.09 with excellent variety beats 0.03 with poor variety', () => {
    expect(cost(0.09, 0)).toBeLessThan(cost(0.03, 12));
  });

  it('0.19 does NOT beat 0.08 on a small variety gain', () => {
    // "slightly better" = two fewer repeated pairs.
    expect(cost(0.19, 4)).toBeGreaterThan(cost(0.08, 6));
  });

  it('the penalty is continuous — no cliff at a zone edge', () => {
    // Continuity is about the limit at the boundary, not about the slope: the
    // slope is MEANT to jump (that is what makes the outer bands expensive).
    for (const edge of [0.1, 0.15, 0.2]) {
      const below = balancePenalty(edge - 1e-6);
      const above = balancePenalty(edge + 1e-6);
      expect(Math.abs(above - below)).toBeLessThan(1e-4);
    }
  });

  it('gets progressively more expensive as the gap grows', () => {
    const a = balancePenalty(0.1) - balancePenalty(0.05);
    const b = balancePenalty(0.15) - balancePenalty(0.1);
    const c = balancePenalty(0.2) - balancePenalty(0.15);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('8 · the ceiling holds', () => {
  it('never returns a split above 0.20 when a legal one exists', () => {
    const history: PastSplit[] = [LAST_WEEK];
    for (let i = 0; i < 40; i++) {
      const r = split({ history });
      expect(r.fallback).toBe(false);
      expect(r.gap).toBeLessThanOrEqual(GAP_MAX + 1e-9);
    }
  });
});

describe('9 · fallback when 0.20 is unreachable', () => {
  it('produces a split and reports the fallback instead of failing', () => {
    // One player far outside the rest: no split of 2×2 can get within 0.20.
    const ids = ['a', 'b', 'c', 'd'];
    const ratings = { a: 5, b: 4.8, c: 4.6, d: 0.5 };
    for (let i = 0; i < 10; i++) {
      const r = balanceCore({
        playerIds: ids,
        ratings,
        numTeams: 2,
        perTeam: 2,
      });
      expect(r.teams.flat()).toHaveLength(4);
      expect(r.fallback).toBe(true);
      expect(r.gap).toBeGreaterThan(GAP_MAX);
      // …but still close to the best this roster allows: (5+0.5)/2 vs
      // (4.8+4.6)/2 = 1.95 is the minimum possible gap here.
      expect(r.gap).toBeLessThanOrEqual(1.95 + 0.03 + 1e-9);
    }
  });
});

describe('10 · a missed night does not consume a pair slot', () => {
  it('counts the last shared MEETINGS, not the last calendar nights', () => {
    // p0 and p1 were together on night 1. Nights 2 and 3 are without p0.
    // Their most recent shared meeting is still night 1, at full weight.
    const history: PastSplit[] = [
      { startsAt: 3, teams: [['p1', 'p2'], ['p3', 'p4']] },
      { startsAt: 2, teams: [['p1', 'p3'], ['p2', 'p4']] },
      { startsAt: 1, teams: [['p0', 'p1'], ['p2', 'p3']] },
    ];
    const w = buildPairRepeatWeights(history);
    expect(w[pairKey('p0', 'p1')]).toBeCloseTo(1.0, 6);
  });

  it('a night with no stored split is skipped entirely', () => {
    const history: PastSplit[] = [
      { startsAt: 3, teams: [] }, // nothing known about this night
      { startsAt: 2, teams: [] },
      { startsAt: 1, teams: [['p0', 'p1'], ['p2', 'p3']] },
    ];
    const w = buildPairRepeatWeights(history);
    expect(w[pairKey('p0', 'p1')]).toBeCloseTo(1.0, 6);
  });

  it('meeting on OPPOSITE teams uses a slot but adds no weight', () => {
    const history: PastSplit[] = [
      { startsAt: 2, teams: [['p0', 'p2'], ['p1', 'p3']] }, // opposites
      { startsAt: 1, teams: [['p0', 'p1'], ['p2', 'p3']] }, // together
    ];
    const w = buildPairRepeatWeights(history);
    // The together-night is their SECOND most recent meeting → 0.6, not 1.0.
    expect(w[pairKey('p0', 'p1')]).toBeCloseTo(0.6, 6);
  });

  it('guests carry no history — their ids are per-game', () => {
    const history: PastSplit[] = [
      { startsAt: 1, teams: [['p0', 'guest:x'], ['p1', 'p2']] },
    ];
    const w = buildPairRepeatWeights(history);
    expect(w[pairKey('p0', 'guest:x')]).toBeUndefined();
  });
});

describe('11/12 · ratings', () => {
  it('a missing rating still scores as the neutral 3.0', () => {
    const r = balanceCore({
      playerIds: ['a', 'b', 'c', 'd'],
      ratings: { a: 3, c: 3 },
      numTeams: 2,
      perTeam: 2,
    });
    expect(r.unratedCount).toBe(2);
    expect(r.gap).toBeCloseTo(0, 6); // everyone effectively 3.0
  });

  it('legacy 1–10 ratings are normalised, not left to dominate', () => {
    const r = balanceCore({
      playerIds: ['a', 'b', 'c', 'd'],
      ratings: { a: 10, b: 9, c: 4.5, d: 5 }, // 10/9 are legacy → 5/4.5
      numTeams: 2,
      perTeam: 2,
    });
    expect(r.gap).toBeLessThanOrEqual(GAP_MAX);
  });
});

describe('13 · the anti-stacking rule still holds', () => {
  it('does not pile the 4.0+ players onto one team, even chasing variety', () => {
    const history: PastSplit[] = [LAST_WEEK];
    for (let i = 0; i < 40; i++) {
      const r = split({ history });
      for (const t of r.teams) {
        expect(t.filter((id) => rate(id) >= 4).length).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('performance', () => {
  it('a split with history stays fast enough for a button press', () => {
    const history: PastSplit[] = [LAST_WEEK];
    const start = Date.now();
    for (let i = 0; i < 10; i++) split({ history });
    const perSplit = (Date.now() - start) / 10;
    expect(perSplit).toBeLessThan(150);
  });
});

describe('diagnostics recorded on every split', () => {
  it('classifies the gap into the tolerance bands', () => {
    expect(balanceBand(0)).toBe('A');
    expect(balanceBand(0.1)).toBe('A');
    expect(balanceBand(0.101)).toBe('B');
    expect(balanceBand(0.15)).toBe('B');
    expect(balanceBand(0.151)).toBe('C');
    expect(balanceBand(0.2)).toBe('C');
    expect(balanceBand(0.201)).toBe('over');
  });

  it('reports a band consistent with the gap it returns', () => {
    const history: PastSplit[] = [LAST_WEEK];
    for (let i = 0; i < 20; i++) {
      const r = split({ history });
      expect(r.band).toBe(balanceBand(r.gap));
      expect(r.band === 'A' || r.band === 'B' || r.band === 'C').toBe(true);
    }
  });

  it('marks the fallback split as over the ceiling', () => {
    const r = balanceCore({
      playerIds: ['a', 'b', 'c', 'd'],
      ratings: { a: 5, b: 4.8, c: 4.6, d: 0.5 },
      numTeams: 2,
      perTeam: 2,
    });
    expect(r.fallback).toBe(true);
    expect(r.band).toBe('over');
  });
});
