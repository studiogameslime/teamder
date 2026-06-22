// Championship scoring — shared by the per-community and per-game tables.
//
// Score is a single number that ranks players across goals + assists:
//   a goal is worth 2 points, an assist 1 point.
// Kept in one place so the service's ranking and the table's displayed
// score can never drift apart.

export const GOAL_POINTS = 2;
export const ASSIST_POINTS = 1;

export interface ChampionshipRow {
  uid: string;
  goals: number;
  assists: number;
}

/** goals×2 + assists×1 */
export function championshipScore(goals: number, assists: number): number {
  return goals * GOAL_POINTS + assists * ASSIST_POINTS;
}

/**
 * Build the ranked rows from raw {userId, goals, assists} stat docs.
 * Drops players with no goals AND no assists. Sorts by score desc, then
 * goals desc, then uid — a deterministic tie-break so medals stay STABLE
 * across reads (Firestore doc-iteration order is otherwise unstable).
 */
export function rankChampionshipRows(
  docs: Array<{ userId?: string; goals?: number; assists?: number }>,
): ChampionshipRow[] {
  return docs
    .map((x) => ({
      uid: x.userId ?? '',
      goals: typeof x.goals === 'number' ? x.goals : 0,
      assists: typeof x.assists === 'number' ? x.assists : 0,
    }))
    .filter((r) => r.uid && (r.goals > 0 || r.assists > 0))
    .sort(
      (a, b) =>
        championshipScore(b.goals, b.assists) -
          championshipScore(a.goals, a.assists) ||
        b.goals - a.goals ||
        a.uid.localeCompare(b.uid),
    );
}
