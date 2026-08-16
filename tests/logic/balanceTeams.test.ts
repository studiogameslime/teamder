import { balanceTeams, NEUTRAL_RATING, normalizeRating } from '@/utils/draft';

// A roster helper: ratings[i] → player `p<i>` (null = unrated).
function roster(ratings: (number | null)[]) {
  const playerIds = ratings.map((_, i) => `p${i}`);
  const map: Record<string, number> = {};
  ratings.forEach((r, i) => {
    if (r != null) map[`p${i}`] = r;
  });
  return { playerIds, ratings: map };
}

function avg(ids: string[], ratings: Record<string, number>): number {
  const v = ids.map((id) =>
    typeof ratings[id] === 'number' && ratings[id] > 0
      ? normalizeRating(ratings[id])
      : NEUTRAL_RATING,
  );
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function run(
  ratings: (number | null)[],
  numTeams: number,
  format: '5v5' | '6v6' = '6v6',
) {
  const r = roster(ratings);
  const out = balanceTeams({
    ...r,
    numTeams,
    format,
    createdBy: 'admin',
  });
  const averages = out.result.teams.map((t) => avg(t.playerIds, r.ratings));
  return { out, averages, ratings: r.ratings };
}

// The exact shape the user hit: 19 players over 3 teams always came back
// 3.3 / 3.3 / 2.9 because the old greedy balanced SUMS, so the 7-man team
// carried the same total across one more player.
const NINETEEN = [
  5, 4.5, 4.5, 4, 4, 4, 3.5, 3.5, 3.5, 3, 3, 3, 3, 2.5, 2.5, 2, 2, 1.5, 1,
];

describe('balanceTeams — fairness', () => {
  it('equalises AVERAGES even when team sizes differ (19 over 3)', () => {
    for (let i = 0; i < 30; i++) {
      const { averages } = run(NINETEEN, 3);
      const spread = Math.max(...averages) - Math.min(...averages);
      // The old algorithm sat at ~0.4 here, every single run.
      expect(spread).toBeLessThanOrEqual(0.1);
    }
  });

  it('places everyone exactly once, no bench, no duplicates', () => {
    const { out } = run(NINETEEN, 3);
    const all = out.result.teams.flatMap((t) => t.playerIds);
    expect(all).toHaveLength(NINETEEN.length);
    expect(new Set(all).size).toBe(NINETEEN.length);
  });

  it('team sizes stay as even as possible', () => {
    const { out } = run(NINETEEN, 3);
    const sizes = out.result.teams.map((t) => t.playerIds.length).sort();
    expect(sizes).toEqual([6, 6, 7]);
  });

  it('captain is the highest-rated member of each team', () => {
    const { out, ratings } = run(NINETEEN, 3);
    for (const t of out.result.teams) {
      const best = Math.max(...t.playerIds.map((id) => ratings[id] ?? NEUTRAL_RATING));
      expect(ratings[t.captainId] ?? NEUTRAL_RATING).toBe(best);
      expect(t.playerIds[0]).toBe(t.captainId);
    }
  });

  it('a duplicate roster id is placed once, not twice', () => {
    const out = balanceTeams({
      playerIds: ['a', 'b', 'c', 'd', 'a'],
      ratings: { a: 5, b: 4, c: 3, d: 2 },
      numTeams: 2,
      createdBy: 'admin',
    });
    const all = out.result.teams.flatMap((t) => t.playerIds);
    expect(all.filter((x) => x === 'a')).toHaveLength(1);
    expect(all).toHaveLength(4);
  });

  it('normalises legacy 1–10 ratings instead of letting them dominate', () => {
    const { averages } = run([10, 9, 8, 7, 3, 2.5, 2, 1.5], 2);
    expect(Math.max(...averages) - Math.min(...averages)).toBeLessThanOrEqual(0.2);
    expect(Math.max(...averages)).toBeLessThanOrEqual(5);
  });

  it('unrated players count as the neutral middle and spread out', () => {
    const { out } = run([5, 4.5, 4, null, null, null, 2, 1.5], 2);
    expect(out.unratedCount).toBe(3);
  });

  it('never makes more teams than there are players', () => {
    const { out } = run([4, 3], 4);
    expect(out.result.numTeams).toBe(2);
    expect(out.result.teams.every((t) => t.playerIds.length > 0)).toBe(true);
  });

  it('reports the averages it balanced on', () => {
    const { out, averages } = run(NINETEEN, 3);
    out.teamAverages.forEach((a, i) => {
      expect(a).toBeCloseTo(Math.round(averages[i] * 10) / 10, 5);
    });
  });
});

// The real 12.08 roster of "כדורגל אנשים טובים" — the split that came back
// 3.5 / 3.5 / 3.1 eight times in a row.
const REAL_1208 = [
  4.5, 4, 3.6, 3.2, 4, 3.3, 3, 3.5, 3.2, 4.3, 2.7, 3.4, 3, 4, 1,
];

describe('balanceTeams — the 12.08 roster', () => {
  it('splits it evenly instead of 3.5 / 3.5 / 3.1', () => {
    for (let i = 0; i < 20; i++) {
      const { averages } = run(REAL_1208, 3, '5v5');
      expect(Math.max(...averages) - Math.min(...averages)).toBeLessThanOrEqual(0.1);
    }
  });

  it('never piles the strongest players onto one team', () => {
    // Five players are rated 4.0+, so over 3 teams the best possible spread of
    // them is 2/2/1 — no team may hold three.
    for (let i = 0; i < 20; i++) {
      const { out, ratings } = run(REAL_1208, 3, '5v5');
      for (const t of out.result.teams) {
        const strong = t.playerIds.filter((id) => (ratings[id] ?? 0) >= 4).length;
        expect(strong).toBeLessThanOrEqual(2);
      }
    }
  });

  it('shows one shared average on screen (rounded to a decimal)', () => {
    for (let i = 0; i < 20; i++) {
      const { averages } = run(REAL_1208, 3, '5v5');
      const shown = new Set(averages.map((a) => a.toFixed(1)));
      expect(shown.size).toBe(1);
    }
  });

  it('almost every press gives a different split', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { out } = run(REAL_1208, 3, '5v5');
      seen.add(
        out.result.teams
          .map((t) => t.playerIds.slice().sort().join(','))
          .sort()
          .join('|'),
      );
    }
    // Was 1 distinct split, always. Any regression that re-freezes the search
    // (a deterministic tie-break, a tolerance too tight to move in) shows up
    // here before it reaches the pitch.
    expect(seen.size).toBeGreaterThanOrEqual(12);
  });

  it('stays fast enough for a button press', () => {
    const start = Date.now();
    for (let i = 0; i < 10; i++) run(REAL_1208, 3, '5v5');
    expect(Date.now() - start).toBeLessThan(1500);
  });
});

describe('balanceTeams — variety', () => {
  it('reruns produce different teams (the 8-identical-splits bug)', () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { out } = run(NINETEEN, 3);
      signatures.add(
        out.result.teams
          .map((t) => t.playerIds.slice().sort().join(','))
          .sort()
          .join('|'),
      );
    }
    // The old algorithm produced ONE signature across any number of runs.
    expect(signatures.size).toBeGreaterThan(5);
  });

  it('variety never comes at the cost of fairness', () => {
    for (let i = 0; i < 20; i++) {
      const { averages } = run([5, 4, 4, 3.5, 3, 3, 2.5, 2, 2, 1], 2);
      expect(Math.max(...averages) - Math.min(...averages)).toBeLessThanOrEqual(0.1);
    }
  });
});
