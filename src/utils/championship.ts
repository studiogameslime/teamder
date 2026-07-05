// Championship / community-stats scoring — shared by the per-GAME table
// (after a game ends) and the per-COMMUNITY table (in community details).
//
// GAME table: goals + assists, ranked by score PER MINI-GAME (efficiency):
//   a goal is worth 2 points, an assist 1, divided by mini-games played.
// COMMUNITY table: cumulative games / wins / goals over the player's whole
//   time in the club, ranked by goals.
// Kept in one place so the service ranking and the table display can't drift.

export const GOAL_POINTS = 2;
export const ASSIST_POINTS = 1;

export interface ChampionshipRow {
  uid: string;
  goals: number;
  assists: number;
  /** Mini-games (winner-stays rounds) the player was on the field for. */
  rounds: number;
  /** Mini-games (rounds) the player's side won. */
  wins: number;
  /** Mini-games (rounds) the player's side lost. */
  losses: number;
  /** Full games (evenings) the player took part in. */
  games: number;
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
  // rounds === 0 → no per-game efficiency (e.g. a player with only retro goals,
  // which credit goals but no round). Returning the RAW score here wrongly
  // ranked them ABOVE efficient per-game scorers; 0 keeps them out of the
  // per-game medals until they actually play a round.
  return rounds > 0 ? s / rounds : 0;
}

/** How a championship row list is ranked. */
export type ChampionshipSort = 'perGame' | 'goals';

/**
 * Build the ranked rows from raw stat docs.
 * - 'perGame' (game table): keeps every player with a stat row (all who played,
 *   incl. goalless); sorts by score-per-mini-game, then raw score.
 * - 'goals' (community table): keeps anyone with any activity (goals/games);
 *   sorts by goals, then wins, then games.
 * Final tie-break is uid so medals stay STABLE across reads.
 */
export function rankChampionshipRows(
  docs: Array<{
    userId?: string;
    goals?: number;
    assists?: number;
    rounds?: number;
    wins?: number;
    losses?: number;
    games?: number;
  }>,
  sortBy: ChampionshipSort = 'perGame',
  // When true, keep EVERY row (even all-zeros) instead of dropping the inactive
  // — used by the community table to list all members, not just those with
  // stats (user report). Zero-rows still rank last by the same sort.
  keepAll = false,
): ChampionshipRow[] {
  const rows = docs.map((x) => ({
    uid: x.userId ?? '',
    goals: typeof x.goals === 'number' ? x.goals : 0,
    assists: typeof x.assists === 'number' ? x.assists : 0,
    rounds: typeof x.rounds === 'number' ? x.rounds : 0,
    wins: typeof x.wins === 'number' ? x.wins : 0,
    losses: typeof x.losses === 'number' ? x.losses : 0,
    games: typeof x.games === 'number' ? x.games : 0,
  }));
  if (sortBy === 'goals') {
    return rows
      // Keep anyone with ANY contribution — include assists so a pure
      // playmaker (assists>0, goals/wins/games=0) isn't dropped, which would
      // hide the real top-assister and under-count the club's assist total.
      .filter(
        (r) =>
          r.uid &&
          (keepAll || r.goals > 0 || r.assists > 0 || r.games > 0 || r.wins > 0),
      )
      .sort(
        (a, b) =>
          b.goals - a.goals ||
          b.wins - a.wins ||
          b.games - a.games ||
          a.uid.localeCompare(b.uid),
      );
  }
  // Game table: keep EVERY player who took the field (has a stat row), even
  // with 0 goals/assists — the table should list all participants, not only
  // scorers (user report). Scorers rank first; goalless players sink to the
  // bottom (score 0) but still appear.
  return rows
    .filter((r) => r.uid)
    .sort(
      (a, b) =>
        perGameScore(b.goals, b.assists, b.rounds) -
          perGameScore(a.goals, a.assists, a.rounds) ||
        championshipScore(b.goals, b.assists) -
          championshipScore(a.goals, a.assists) ||
        a.uid.localeCompare(b.uid),
    );
}
