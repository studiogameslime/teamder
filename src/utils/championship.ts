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

/**
 * THE club-table order. One comparator, used everywhere a player's position
 * in a club is decided.
 *
 * Wins first — the club table ranks by success, per the owner — then goals,
 * then assists, then uid. The uid is not decoration: it is what makes the
 * order TOTAL. Without a final tie-break the result depends on the order the
 * rows happened to arrive in, and that order is not the same everywhere:
 *
 *   • a LIVE slice arrives already ranked, straight from `buildChampionshipRows`
 *   • an ALL-TIME slice arrives from `mergeAllTime`, in map-insertion order
 *
 * So two players level on wins could sit one way round on the club's stats
 * screen and the other way round on the two-player screen, and each would be
 * telling the reader a different position for the same person in the same
 * club. Exported so that cannot happen again by copying.
 *
 * ⚠️ This is the TIE-BREAK and the primary key TOGETHER. A caller that sorts
 * by its own column first (the stats table lets you tap any header) should
 * use `comparePoints` only as the fallback — see `compareByThen`.
 */
export function comparePoints(a: ChampionshipRow, b: ChampionshipRow): number {
  return (
    b.wins - a.wins ||
    b.goals - a.goals ||
    b.assists - a.assists ||
    a.uid.localeCompare(b.uid)
  );
}

/**
 * Sort by one numeric column, descending, and fall back to the club order.
 *
 * The stats table sorts by whichever header was tapped. Equal values used to
 * keep "the incoming order", which is only meaningful when the incoming order
 * means something — and for an all-time slice it does not. This makes every
 * column's ties resolve the same way the table's own ranking does.
 */
export function compareByThen(
  key: keyof ChampionshipRow,
): (a: ChampionshipRow, b: ChampionshipRow) => number {
  return (a, b) =>
    Number(b[key] ?? 0) - Number(a[key] ?? 0) || comparePoints(a, b);
}

export interface ChampionshipRow {
  uid: string;
  goals: number;
  assists: number;
  /** Mini-games (winner-stays rounds) the player was on the field for. */
  rounds: number;
  /** Mini-games (rounds) the player's side won. */
  wins: number;
  /** Mini-games (rounds) that ended level. Only reachable in formats where a
   *  draw can stand — four teams and up. In a three-team club it is 0 for
   *  everyone, which is why the column that shows it hides itself. */
  ties: number;
  /** Mini-games (rounds) the player's side lost. */
  losses: number;
  /** Full games (evenings) the player took part in. */
  games: number;
  /** Penalty-shootout kicker: taken / scored. Drives "מלך הפנדלים". */
  penTaken: number;
  penScored: number;
  /** Penalty-shootout keeper: faced / saved. Drives "מלך שוערי הפנדלים". */
  penFaced: number;
  penSaved: number;
  /** Own goals the player scored (into their own net). Drives "מלך השערים
   *  העצמיים". NEVER counted in `goals`. */
  ownGoals: number;
  /** "שער נקי" — mini-games the player's side finished without conceding. */
  cleanSheets: number;
  /** Coverage denominators: how many mini-games the metric was actually being
   *  recorded in. `cleanSheets / rounds` folds in rounds from before the
   *  metric existed — 22% of them in the big club — and understates every
   *  long-standing player. Absent on rows the backfill has not reached, which
   *  is why both are optional rather than defaulted to 0: a 0 would claim the
   *  metric was never measured, which is a different statement from not
   *  knowing. See src/utils/efficiencyStats.ts. */
  csRounds?: number;
  asRounds?: number;
  /** True for a GUEST row (per-game table only) — the caller resolves the name
   *  from game.guests instead of /users, and it opens no player card. */
  isGuest?: boolean;
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
export type ChampionshipSort = 'perGame' | 'goals' | 'points';

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
    ties?: number;
    losses?: number;
    games?: number;
    penTaken?: number;
    penScored?: number;
    penFaced?: number;
    penSaved?: number;
    ownGoals?: number;
    cleanSheets?: number;
    csRounds?: number;
    asRounds?: number;
    isGuest?: boolean;
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
    ties: typeof x.ties === 'number' ? x.ties : 0,
    losses: typeof x.losses === 'number' ? x.losses : 0,
    games: typeof x.games === 'number' ? x.games : 0,
    penTaken: typeof x.penTaken === 'number' ? x.penTaken : 0,
    penScored: typeof x.penScored === 'number' ? x.penScored : 0,
    penFaced: typeof x.penFaced === 'number' ? x.penFaced : 0,
    penSaved: typeof x.penSaved === 'number' ? x.penSaved : 0,
    ownGoals: typeof x.ownGoals === 'number' ? x.ownGoals : 0,
    cleanSheets: typeof x.cleanSheets === 'number' ? x.cleanSheets : 0,
    // Deliberately NOT defaulted to 0 — see the field comment. Undefined means
    // "unknown, fall back to rounds"; 0 would mean "never measured".
    ...(typeof x.csRounds === 'number' ? { csRounds: x.csRounds } : {}),
    ...(typeof x.asRounds === 'number' ? { asRounds: x.asRounds } : {}),
    ...(x.isGuest === true ? { isGuest: true } : {}),
  }));
  if (sortBy === 'goals' || sortBy === 'points') {
    // 'points' (community table): sort by WINS, then goals, then assists
    //   (per user request — the club table ranks by success first).
    // 'goals': raw goals, then wins, then games (legacy).
    return rows
      // Keep anyone with ANY contribution — include assists so a pure
      // playmaker (assists>0, goals/wins/games=0) isn't dropped, which would
      // hide the real top-assister and under-count the club's assist total.
      .filter(
        (r) =>
          r.uid &&
          (keepAll || r.goals > 0 || r.assists > 0 || r.games > 0 || r.wins > 0),
      )
      .sort((a, b) =>
        sortBy === 'points'
          ? // The one club order, shared with every other screen that places
            // a player in this club. See `comparePoints`.
            comparePoints(a, b)
          : b.goals - a.goals ||
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
