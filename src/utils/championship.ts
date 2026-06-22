// Championship scoring — shared by the per-community and per-game tables.
//
// Raw score ranks players across goals + assists: a goal is worth 2 points,
// an assist 1 point. The table then ranks by score PER MINI-GAME played
// (efficiency), not raw volume — so it's fair to players who played fewer
// rounds. Kept in one place so the service ranking and the table display
// can never drift apart.

export const GOAL_POINTS = 2;
export const ASSIST_POINTS = 1;

export interface ChampionshipRow {
  uid: string;
  goals: number;
  assists: number;
  /** Mini-games (winner-stays rounds) the player was on the field for. */
  rounds: number;
}

/** goals×2 + assists×1 */
export function championshipScore(goals: number, assists: number): number {
  return goals * GOAL_POINTS + assists * ASSIST_POINTS;
}

/**
 * Score per mini-game played. Rows with no round tally yet (historical data
 * recorded before per-player rounds were tracked) fall back to the raw score
 * so a known scorer never drops to zero during the transition.
 */
export function perGameScore(
  goals: number,
  assists: number,
  rounds: number,
): number {
  const s = championshipScore(goals, assists);
  return rounds > 0 ? s / rounds : s;
}

/**
 * Build the ranked rows from raw {userId, goals, assists, rounds} stat docs.
 * Drops players with no goals AND no assists. Sorts by score-per-mini-game
 * desc, then raw score, then uid — a deterministic tie-break so medals stay
 * STABLE across reads (Firestore doc-iteration order is otherwise unstable).
 */
export function rankChampionshipRows(
  docs: Array<{
    userId?: string;
    goals?: number;
    assists?: number;
    rounds?: number;
  }>,
): ChampionshipRow[] {
  return docs
    .map((x) => ({
      uid: x.userId ?? '',
      goals: typeof x.goals === 'number' ? x.goals : 0,
      assists: typeof x.assists === 'number' ? x.assists : 0,
      rounds: typeof x.rounds === 'number' ? x.rounds : 0,
    }))
    .filter((r) => r.uid && (r.goals > 0 || r.assists > 0))
    .sort(
      (a, b) =>
        perGameScore(b.goals, b.assists, b.rounds) -
          perGameScore(a.goals, a.assists, a.rounds) ||
        championshipScore(b.goals, b.assists) -
          championshipScore(a.goals, a.assists) ||
        a.uid.localeCompare(b.uid),
    );
}
