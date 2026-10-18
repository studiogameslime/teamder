import { NEUTRAL_RATING, normalizeRating } from './teamBalanceCore';

export type FillUsage = Record<string, { games: number; fills: number; lastRound: number }>;
export type FillTeam = { index: number; playerIds: string[] };
export const fillRating = (id: string, ratings: Record<string, number>) =>
  Number.isFinite(ratings[id]) && ratings[id] > 0 ? normalizeRating(ratings[id]) : NEUTRAL_RATING;
export const fillAverage = (ids: string[], ratings: Record<string, number>) =>
  ids.reduce((sum, id) => sum + fillRating(id, ratings), 0) / Math.max(1, ids.length);

export function fillComparisonText(sides: [string[], string[]], ratings: Record<string, number>): string {
  if (sides.flat().some(id => !Number.isFinite(ratings[id]) || ratings[id] <= 0)) {
    return 'לחלק מהשחקנים אין דירוג. ההשוואה משתמשת עבורם בדירוג בסיס של 3 מתוך 5.';
  }
  return Math.abs(fillAverage(sides[0], ratings) - fillAverage(sides[1], ratings)) <= 0.2
    ? 'ההרכבים שנבחרו קרובים בדירוג.' : 'קיים פער דירוג בין ההרכבים. אפשר לשנות את המשלימים.';
}

/** Joint, bounded search. No player can be borrowed twice. Near-equivalent
 * rating gaps (0.05 on the five-point scale) are ordered by actual workload.
 * Beam search is deliberately bounded; the result is a recommendation, not
 * a claim of a globally optimal or perfectly equal split. */
export function recommendFill(
  sides: [FillTeam, FillTeam], donors: string[], capacity: number,
  ratings: Record<string, number>, usage: FillUsage = {}, round = 1,
  searchWidth = 96,
) {
  const occupied = new Set(sides.flatMap(t => t.playerIds));
  const pool = [...new Set(donors)].filter(id => !occupied.has(id));
  const need = sides.map(t => Math.max(0, capacity - t.playerIds.length));
  type State = { picks: [string[], string[]]; left: string[]; burden: number };
  let beam: State[] = [{ picks: [[], []], left: pool, burden: 0 }];
  const gap = (s: State) => Math.abs(fillAverage([...sides[0].playerIds, ...s.picks[0]], ratings)
    - fillAverage([...sides[1].playerIds, ...s.picks[1]], ratings));
  // Interleave sides, including in shortages, instead of exhausting donors on A.
  for (let slot = 0; slot < Math.max(...need); slot++) for (const side of [0, 1] as const) {
    if (slot >= need[side]) continue;
    const next: State[] = [];
    for (const state of beam) {
      if (!state.left.length) { next.push(state); continue; }
      for (const id of state.left) {
        const u = usage[id];
        const picks: [string[], string[]] = [state.picks[0].slice(), state.picks[1].slice()];
        picks[side].push(id);
        next.push({ picks, left: state.left.filter(p => p !== id), burden: state.burden
          + (u?.games ?? 0) * 4 + (u?.fills ?? 0) + (u?.lastRound === round - 1 ? 2 : 0) });
      }
    }
    const seen = new Set<string>();
    beam = next.sort((a, b) => gap(a) - gap(b) || a.burden - b.burden).filter(s => {
      const key = s.picks.map(ids => ids.slice().sort().join(',')).join('|');
      if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, searchWidth);
  }
  const bestGap = Math.min(...beam.map(gap));
  const best = beam.filter(s => gap(s) <= bestGap + 0.05 + 1e-9)
    .sort((a, b) => a.burden - b.burden || gap(a) - gap(b))[0];
  return { picks: best.picks, gap: gap(best), missing: need.map((n, i) => n - best.picks[i].length) };
}

/** Minimise the worst completed matchup first, then the mean matchup gap.
 * Size-preserving swaps keep the configured 5/4/4 or 4/4/4 structure. */
export function balanceWithFill(initial: string[][], capacity: number, ratings: Record<string, number>) {
  let teams = initial.map(ids => ids.slice());
  const score = (candidate: string[][]) => {
    const gaps: number[] = [];
    for (let a = 0; a < candidate.length; a++) for (let b = a + 1; b < candidate.length; b++) {
      const donors = candidate.flatMap((ids, i) => i === a || i === b ? [] : ids);
      const plan = recommendFill([{index:a,playerIds:candidate[a]}, {index:b,playerIds:candidate[b]}], donors, capacity, ratings, {}, 1, 24);
      gaps.push(plan.gap);
    }
    return Math.max(...gaps) * 4 + gaps.reduce((s, g) => s + g, 0) / Math.max(1, gaps.length);
  };
  let best = score(teams);
  // Limit work on large squads. Every accepted swap must improve all-matchup score.
  let evaluations = 0;
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (let a = 0; a < teams.length; a++) for (let b = a + 1; b < teams.length; b++) {
      for (let x = 0; x < teams[a].length; x++) for (let y = 0; y < teams[b].length; y++) {
        if (++evaluations > (teams.length<=3 && capacity<=7 ? 180 : 24)) return teams;
        const next = teams.map(ids => ids.slice());
        [next[a][x], next[b][y]] = [next[b][y], next[a][x]];
        const value = score(next);
        if (value < best - 1e-9) { teams = next; best = value; improved = true; }
      }
    }
    if (!improved) break;
  }
  return teams;
}
