// Pure, dependency-free scoring for the evening summary card. Kept out of
// eveningSummaryService (which pulls in RN/Firebase) so it stays unit-testable
// in a plain node jest env, and so the formula lives in exactly one place.
// The adaptive headline + insight lines live in ./eveningNarrative.
//
// SELF-BASED weighted model, final score 6.0–10.0. Each category is first
// scored 0–10, then blended by weight and mapped into the 6–10 display range.
// Weights depend on shootout involvement (each set sums to 1.0):
//
//   no shootout:   50% wins · 30% goals · 20% assists
//   in a shootout: 45% wins · 30% goals · 20% assists · 5% penalties
//
//   wins    — win rate (the one team-aligned axis you're rewarded for)
//   goals   — YOUR goals this evening vs the community benchmark
//   assists — YOUR assists this evening vs the community benchmark
//   penalties — shootout: scored/saved good, missed/conceded bad
//
// The score is measured against YOURSELF only — there is no "contribution %"
// (share of your team's goals), which perversely punished you for a teammate
// scoring. The goals/assists "perfect 10" targets are the COMMUNITY-HISTORICAL
// average of the top scorer's / top assister's total for an evening ("מלך
// השערים" per מחזור) — so a 10 is calibrated to what the best player in YOUR
// group actually does, and is always reachable. Targets arrive per-community
// from communityStats; the DEFAULT_* fallbacks apply only before a group has
// any finished-evening history.
//
// Penalties only count for players actually involved in a shootout. Rather than
// re-normalising, there are TWO explicit weight sets that each sum to 1.0 — for
// a shootout player, the penalty axis takes its 5% out of the WINS weight
// (50→45); goals/assists stay fixed. A subset (wins/goals/assists) is mirrored
// in the evening-standings Cloud Function — keep both in sync.

/** No shootout involvement (the common case). Sums to 1.0. */
export const SCORE_WEIGHTS_NO_PEN = {
  wins: 0.5,
  goals: 0.3,
  assists: 0.2,
} as const;

/** Shootout involvement — the 5% penalty axis comes out of wins. Sums to 1.0. */
export const SCORE_WEIGHTS_WITH_PEN = {
  wins: 0.45,
  goals: 0.3,
  assists: 0.2,
  penalties: 0.05,
} as const;

/** Fallback "perfect 10" targets used ONLY before a community has any
 *  finished-evening history (no benchmark on communityStats yet). Once one
 *  evening is credited, the per-community king-average takes over. Kept in sync
 *  with the Cloud Function. */
export const DEFAULT_GOALS_FOR_10 = 4;
export const DEFAULT_ASSISTS_FOR_10 = 2;
/** A benchmark never drops below this, so a freak low-scoring history can't make
 *  a single goal worth a perfect 10. */
export const BENCHMARK_FLOOR = 1;

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
  /** Evening-TOTAL goals that map to a perfect 10 — the community's historical
   *  average of the top scorer's goals per evening ("מלך השערים"). Absent/≤0 →
   *  DEFAULT_GOALS_FOR_10. Floored at BENCHMARK_FLOOR. */
  goalsFor10?: number;
  /** Evening-total assists for a perfect 10 — the top-assister average. */
  assistsFor10?: number;
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

  const goalsFor10 = Math.max(
    BENCHMARK_FLOOR,
    input.goalsFor10 && input.goalsFor10 > 0
      ? input.goalsFor10
      : DEFAULT_GOALS_FOR_10,
  );
  const assistsFor10 = Math.max(
    BENCHMARK_FLOOR,
    input.assistsFor10 && input.assistsFor10 > 0
      ? input.assistsFor10
      : DEFAULT_ASSISTS_FOR_10,
  );

  // Wins is a rate (share of mini-games won). Goals/assists are SELF-based
  // evening TOTALS measured against the community king benchmark — NOT divided
  // per mini-game, because the benchmark is itself a per-evening figure.
  const winsScore = clamp10((input.wins / gp) * 10);
  const goalsScore = clamp10((input.goals / goalsFor10) * 10);
  const assistsScore = clamp10((input.assists / assistsFor10) * 10);

  const penInvolved =
    input.pen.scored + input.pen.saved + input.pen.missed + input.pen.conceded;

  // Two explicit weight sets, each summing to 1.0 → no re-normalisation.
  let weighted: number;
  if (penInvolved > 0) {
    const penScore = clamp10(
      PENALTY_POINTS.base +
        input.pen.scored * PENALTY_POINTS.scored +
        input.pen.saved * PENALTY_POINTS.saved +
        input.pen.missed * PENALTY_POINTS.missed +
        input.pen.conceded * PENALTY_POINTS.conceded,
    );
    const w = SCORE_WEIGHTS_WITH_PEN;
    weighted =
      winsScore * w.wins +
      goalsScore * w.goals +
      assistsScore * w.assists +
      penScore * w.penalties;
  } else {
    const w = SCORE_WEIGHTS_NO_PEN;
    weighted =
      winsScore * w.wins + goalsScore * w.goals + assistsScore * w.assists;
  }

  const score = 6 + (weighted / 10) * 4;
  return round1(Math.max(6, Math.min(10, score)));
}
