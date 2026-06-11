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

export type DraftMethod = 'snake' | 'regular';

/** Hebrew team letters; team index 0 → 'א'. Dynamic for 2–4 teams. */
export const TEAM_LETTERS = ['א', 'ב', 'ג', 'ד'] as const;
export const MIN_TEAMS = 2;
export const MAX_TEAMS = 4;

export function teamLetter(i: number): string {
  return TEAM_LETTERS[i] ?? String(i + 1);
}

export function teamName(i: number): string {
  return `קבוצה ${teamLetter(i)}`;
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
