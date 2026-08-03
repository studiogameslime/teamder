// Pure, dependency-free scoring for the evening summary card. Kept out of
// eveningSummaryService (which pulls in RN/Firebase) so it stays unit-testable
// in a plain node jest env, and so the formula lives in exactly one place.
// The adaptive headline + insight lines live in ./eveningNarrative.
//
// Weighted performance model, final score 6.0–10.0. Five categories, each first
// scored 0–10, then blended by weight and mapped into the 6–10 display range:
//
//   50% wins          — win rate (team success you were part of)
//   20% goals         — goals per game
//   15% assists       — assists per game
//   10% contribution  — your goals+assists as % of your team's goals
//    5% penalties     — shootout: scored/saved good, missed/conceded bad
//
// Sparsity: a category with no data for this player this evening (no team
// goals → no contribution; no shootout involvement → no penalties) is DROPPED
// and its weight redistributed proportionally, so a player is never punished
// for a situation that never came up. A subset of this formula (wins/goals/
// assists only) is mirrored in the `computeStandings` Cloud Function.

/** Category weights (sum = 1). Tunable in one place. */
export const SCORE_WEIGHTS = {
  wins: 0.5,
  goals: 0.2,
  assists: 0.15,
  contribution: 0.1,
  penalties: 0.05,
} as const;

/** goals/game that maps to a perfect 10 on the goals axis (linear below). */
export const GOALS_PER_GAME_FOR_10 = 2;
/** assists/game that maps to a perfect 10 on the assists axis. */
export const ASSISTS_PER_GAME_FOR_10 = 1;

/** Penalty axis: start neutral at 5, move per shootout outcome, clamp 0–10. */
export const PENALTY_POINTS = {
  base: 5,
  scored: 2, // ⚽ I scored
  saved: 3, // 🧤 I saved one as keeper
  missed: -2, // ❌ I missed
  conceded: -1, // 🥅 scored on me (small — conceding a pen is the norm)
} as const;

export interface PenaltyTally {
  scored: number;
  saved: number;
  missed: number;
  conceded: number;
}

export interface EveningScoreInput {
  goals: number;
  assists: number;
  wins: number;
  gamesPlayed: number;
  /** your goals+assists as % (0–100) of your team's goals; null if the team
   *  scored nothing (category is then dropped). */
  contributionPct: number | null;
  /** shootout tallies; all-zero → the penalty category is dropped. */
  pen: PenaltyTally;
}

const clamp10 = (x: number) => Math.max(0, Math.min(10, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Weighted evening score in [6.0, 10.0]. See the file header for the model.
 * A player who took the field for no mini-games gets the 6.0 floor.
 */
export function eveningScore(input: EveningScoreInput): number {
  const gp = input.gamesPlayed;
  if (gp <= 0) return 6.0;

  const winsScore = clamp10((input.wins / gp) * 10);
  const goalsScore = clamp10((input.goals / gp / GOALS_PER_GAME_FOR_10) * 10);
  const assistsScore = clamp10(
    (input.assists / gp / ASSISTS_PER_GAME_FOR_10) * 10,
  );

  // [weight, categoryScore] — always-present core three first.
  const cats: Array<[number, number]> = [
    [SCORE_WEIGHTS.wins, winsScore],
    [SCORE_WEIGHTS.goals, goalsScore],
    [SCORE_WEIGHTS.assists, assistsScore],
  ];
  if (input.contributionPct != null) {
    cats.push([SCORE_WEIGHTS.contribution, clamp10(input.contributionPct / 10)]);
  }
  const penInvolved =
    input.pen.scored + input.pen.saved + input.pen.missed + input.pen.conceded;
  if (penInvolved > 0) {
    const p =
      PENALTY_POINTS.base +
      input.pen.scored * PENALTY_POINTS.scored +
      input.pen.saved * PENALTY_POINTS.saved +
      input.pen.missed * PENALTY_POINTS.missed +
      input.pen.conceded * PENALTY_POINTS.conceded;
    cats.push([SCORE_WEIGHTS.penalties, clamp10(p)]);
  }

  // Weighted average over PRESENT categories (re-normalised → 0–10).
  const wsum = cats.reduce((s, [w]) => s + w, 0);
  const weighted = cats.reduce((s, [w, v]) => s + w * v, 0) / wsum;

  const score = 6 + (weighted / 10) * 4;
  return round1(Math.max(6, Math.min(10, score)));
}
