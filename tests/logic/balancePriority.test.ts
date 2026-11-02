import { balanceCore, ratingProfilePenalty, type BuildTeam } from '@/utils/teamBalanceCore';
import approved from '../fixtures/team-balance-priority-2026-10-30.json';

function seeded(seed = 42) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function fixture(values: number[]) {
  const playerIds = values.map((_, i) => `p${i}`);
  return { playerIds, ratings: Object.fromEntries(playerIds.map((id, i) => [id, values[i]])) };
}
function built(teams: string[][], ratings: Record<string, number>): BuildTeam[] {
  return teams.map(ids => ({ ids, size: ids.length, total: ids.reduce((sum, id) => sum + ratings[id], 0) }));
}

// Independent labeled-partition oracle. Deliberately small inputs let the test
// evaluate every split without sharing production enumeration or comparison.
function oracle(values: number[], sizes: number[], weights: Record<string, number>) {
  const input = fixture(values), ordered = values.slice().sort((a, b) => b - a);
  const high = ordered[sizes.length - 1], low = ordered[ordered.length - sizes.length];
  function quality(teams: string[][]) {
    const profiles = teams.map(ids => ids.map(id => input.ratings[id]).sort((a, b) => b - a));
    const avg = profiles.map(p => p.reduce((s, v) => s + v, 0) / p.length);
    let stack = 0, repeat = 0, profile = 0;
    for (const team of teams) {
      const top = team.filter(id => input.ratings[id] >= high).length;
      const bottom = team.filter(id => input.ratings[id] < high && input.ratings[id] <= low).length;
      stack += top ** 2 + bottom ** 2;
      for (let a = 0; a < team.length; a++) for (let b = a + 1; b < team.length; b++) {
        const [x, y] = [team[a], team[b]].sort(); repeat += weights[`${x}|${y}`] ?? 0;
      }
    }
    const ranks = Math.max(...sizes);
    const quantile = (p: number[], q: number) => {
      const at = q * (p.length - 1), fraction = at % 1;
      return p[Math.floor(at)] * (1 - fraction) + p[Math.ceil(at)] * fraction;
    };
    for (let rank = 0; rank < ranks; rank++) {
      const qs = profiles.map(p => quantile(p, ranks === 1 ? 0 : rank / (ranks - 1)));
      for (let a = 0; a < qs.length; a++) for (let b = a + 1; b < qs.length; b++) profile += (qs[a] - qs[b]) ** 2;
    }
    return [Math.max(...avg) - Math.min(...avg), stack, profile, repeat];
  }
  function less(a: number[], b: number[]) {
    for (let i = 0; i < a.length; i++) {
      if (Math.abs(a[i] - b[i]) > 1e-9) return a[i] < b[i];
    }
    return false;
  }
  let best = [Infinity, Infinity, Infinity, Infinity];
  const search = (left: string[], teams: string[][]) => {
    if (teams.length === sizes.length - 1) {
      const q = quality([...teams, left]); if (less(q, best)) best = q; return;
    }
    const choose = (start: number, chosen: string[]) => {
      if (chosen.length === sizes[teams.length]) { search(left.filter(id => !chosen.includes(id)), [...teams, chosen]); return; }
      for (let i = start; i <= left.length - (sizes[teams.length] - chosen.length); i++) choose(i + 1, [...chosen, left[i]]);
    };
    choose(0, []);
  };
  search(input.playerIds, []);
  return { best, quality };
}

test.each([
  { values: [5, 4, 4, 3, 2, 1], count: 2 },
  { values: [5, 5, 4, 4, 2, 2, 1, 1], count: 2 },
  { values: [5, 4.5, 4, 3.8, 3, 2.8, 2, 1.5, 1], count: 3 },
  { values: [5, 4.5, 4, 3.8, 3, 2.8, 2, 1.5, 1, 0.5], count: 3 },
])('matches an independent exhaustive oracle: $count teams from $values', ({ values, count }) => {
  const input = fixture(values);
  // Deliberately enormous repeat weights may not buy a worse gap or profile.
  const weights = { 'p0|p2': 1000, 'p0|p3': 1000, 'p1|p2': 1000, 'p1|p3': 1000, 'p4|p6': 1000, 'p5|p7': 1000 };
  const result = balanceCore({ ...input, numTeams: count, perTeam: 5, pairWeights: weights, rng: seeded() });
  const reference = oracle(values, result.teams.map(t => t.length), weights);
  reference.quality(result.teams).forEach((v, i) => expect(v).toBeCloseTo(reference.best[i], 8));
});

test('reproduces the approved 28.10 roster quality without storing player identities', () => {
  const input = fixture(approved.ratings);
  for (const seed of [7, 42, 123]) {
    const result = balanceCore({ ...input, numTeams: 3, perTeam: 5, pairWeights: approved.pairWeights, rng: seeded(seed) });
    expect(result.gap).toBeCloseTo(approved.expected.gap, 8);
    expect(result.stack).toBe(approved.expected.stack);
    expect(result.repeat).toBeCloseTo(approved.expected.repeat, 8);
    expect(ratingProfilePenalty(built(result.teams, input.ratings), id => input.ratings[id])).toBeCloseTo(approved.expected.profile, 8);
    expect(new Set(result.teams.flat()).size).toBe(15);
  }
});

test('different equal-size skill profiles cannot be hidden by identical averages', () => {
  const input = fixture([5, 5, 4, 4, 2, 2, 1, 1]);
  const weights = { 'p0|p2': 1000, 'p0|p3': 1000, 'p1|p2': 1000, 'p1|p3': 1000 };
  const result = balanceCore({ ...input, numTeams: 2, perTeam: 4, pairWeights: weights, rng: seeded() });
  expect(result.teams.map(t => t.map(id => input.ratings[id]).sort((a, b) => b - a))).toEqual([[5, 4, 2, 1], [5, 4, 2, 1]]);
  expect(result.gap).toBeCloseTo(0, 8);
  expect(result.repeat).toBe(2000);
});

test('unequal sizes compare corresponding relative ranks including endpoints', () => {
  const input = fixture([5, 3, 1, 5, 1, 3]);
  const rate = (id: string) => input.ratings[id];
  expect(ratingProfilePenalty(built([['p0', 'p1', 'p2'], ['p3', 'p4']], input.ratings), rate)).toBe(0);
  expect(ratingProfilePenalty(built([['p0', 'p1', 'p2'], ['p5']], input.ratings), rate)).toBe(8);
});

test.each([{ n: 19, count: 3 }, { n: 21, count: 7 }, { n: 16, count: 4 }])('bounded larger-roster search keeps every player once (%j)', ({ n, count }) => {
  const input = fixture(Array.from({ length: n }, (_, i) => 1 + (i * 7 % 41) / 10));
  const result = balanceCore({ ...input, numTeams: count, perTeam: Math.ceil(n / count), candidates: 8, rng: seeded() });
  expect(result.teams.flat().slice().sort()).toEqual(input.playerIds.slice().sort());
  expect(new Set(result.teams.flat()).size).toBe(n);
  const sizes = result.teams.map(t => t.length);
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  expect(result.bench).toEqual([]);
});

test('uniform unrated draws stay varied without inventing ratings', () => {
  const playerIds = Array.from({ length: 15 }, (_, i) => `p${i}`), rng = seeded();
  const signatures = new Set<string>();
  for (let i = 0; i < 12; i++) {
    const result = balanceCore({ playerIds, ratings: {}, numTeams: 3, perTeam: 5, rng });
    expect(result.unratedCount).toBe(15); expect(result.gap).toBe(0);
    signatures.add(result.teams.map(t => t.slice().sort().join(',')).sort().join('|'));
  }
  expect(signatures.size).toBeGreaterThan(8);
});

test('capacity overflow remains explicit and never duplicates a player', () => {
  const input = fixture([5, 4, 3, 2, 1]);
  const result = balanceCore({ ...input, numTeams: 2, perTeam: 2, rng: seeded() });
  expect(result.teams.flat().length).toBe(4);
  expect(result.bench).toEqual(['p4']);
  expect(new Set([...result.teams.flat(), ...result.bench]).size).toBe(5);
});
