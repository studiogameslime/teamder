// Draft Teams (חלוקת כוחות) — pure logic for the captain-draft flow.
//
// A manager picks 2–4 captains; each captain is the first member of their
// team. The remaining registered players are then drafted in turns. Two
// orderings are supported:
//   • regular: א,ב,ג, א,ב,ג, …            (same order every round)
//   • snake:   א,ב,ג, ג,ב,א, א,ב,ג, …     (reverse every other round)
//
// Everything here is pure + dynamic in the number of teams — no UI assumes
// a fixed count.

import type { DraftTeamsResult } from '@/types';

export type DraftMethod = 'snake' | 'regular';

/** Hebrew team letters; team index 0 → 'א'. Dynamic for 2–4 teams. */
export const TEAM_LETTERS = ['א', 'ב', 'ג', 'ד'] as const;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;

export function teamLetter(i: number): string {
  return TEAM_LETTERS[i] ?? String(i + 1);
}

// Teams are identified by COLOR (clearer than "קבוצה א/ב"), fixed per index.
const TEAM_COLOR_NAMES = ['אדומה', 'כחולה', 'ירוקה', 'צהובה'];
export function teamName(i: number): string {
  const c = TEAM_COLOR_NAMES[i];
  return c ? `קבוצה ${c}` : `קבוצה ${teamLetter(i)}`;
}

/**
 * The sequence of team indices that pick, in order, for `picks` total
 * picks. `picks` is normally (totalPlayers − numCaptains): captains are
 * already seated, so only the remaining players get drafted.
 */
export function buildPickOrder(
  numTeams: number,
  picks: number,
  method: DraftMethod,
): number[] {
  const order: number[] = [];
  if (numTeams <= 0 || picks <= 0) return order;
  let round = 0;
  while (order.length < picks) {
    const forward = method === 'regular' || round % 2 === 0;
    for (let t = 0; t < numTeams && order.length < picks; t++) {
      order.push(forward ? t : numTeams - 1 - t);
    }
    round++;
  }
  return order;
}

/**
 * A short, representative path for the setup-screen preview — two full
 * rounds so the snake reversal is visible (e.g. א,ב,ג,ג,ב,א).
 */
export function previewPath(numTeams: number, method: DraftMethod): number[] {
  return buildPickOrder(numTeams, numTeams * 2, method);
}

/**
 * Rebuild the global pick sequence (uids in the order they were drafted)
 * from a SAVED draft result, so re-opening a finished draft can resume on
 * the summary and still be edited. Each team's `playerIds[0]` is the
 * captain; the rest are members in their pick order. Interleaving them by
 * the deterministic order reproduces the original `picks` array.
 */
export function reconstructPicks(draft: DraftTeamsResult): string[] {
  const teams = draft.teams.slice().sort((a, b) => a.index - b.index);
  const queues = teams.map((t) => t.playerIds.slice(1)); // members only
  const total = queues.reduce((s, q) => s + q.length, 0);
  const order = buildPickOrder(draft.numTeams, total, draft.method);
  const cursor = new Array(draft.numTeams).fill(0);
  const picks: string[] = [];
  for (const team of order) {
    const q = queues[team];
    if (q && cursor[team] < q.length) {
      picks.push(q[cursor[team]]);
      cursor[team] += 1;
    }
  }
  return picks;
}
