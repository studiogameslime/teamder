"use strict";
// The evening score, server side — extracted so it can be TESTED against the
// client's copy rather than only claimed to match it (audit P1-11).
//
// This formula exists twice: here, where onGameRosterChanged seals each
// player's standing for the night, and in src/utils/eveningScore.ts, where the
// summary card computes the number the player actually reads. Two copies of one
// formula is exactly how they drifted once before — the penalty axis was
// dropped on this side, so a keeper who saved a shootout penalty saw it in his
// stats and absent from the score that ranked him.
//
// They cannot share a module: this file is deployed with the Cloud Functions
// package and the other is bundled into the app, with no build that spans both.
// So the guarantee is a CONTRACT test instead — tests/logic/eveningScoreParity
// runs the same inputs through both and requires the same answer, which only
// works because this is now an exported pure function rather than a closure
// buried inside a 14k-line trigger.
//
// The formula itself is unchanged. Do not "tidy" it here without making the
// identical change in src/utils/eveningScore.ts — the parity test will fail,
// which is the point.
//
// Weights (each set sums to 1.0):
//   no shootout   50% wins · 30% goals · 20% assists
//   in a shootout 45% wins · 30% goals · 20% assists · 5% penalties
// Result is mapped into the 6.0–10.0 display range and rounded to one decimal.
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIN_PRIOR_GAMES = exports.BENCHMARK_FLOOR = exports.DEFAULT_ASSISTS_FOR_10 = exports.DEFAULT_GOALS_FOR_10 = void 0;
exports.eveningScoreServer = eveningScoreServer;
function eveningScoreServer(goals, assists, wins, gamesPlayed, goalsFor10, assistsFor10, pen) {
    if (gamesPlayed <= 0)
        return 6.0;
    const clamp10 = (x) => Math.max(0, Math.min(10, x));
    const winsScore = clamp10(((wins + exports.WIN_PRIOR_GAMES / 2) / (gamesPlayed + exports.WIN_PRIOR_GAMES)) * 10);
    const goalsScore = clamp10((goals / goalsFor10) * 10);
    const assistsScore = clamp10((assists / assistsFor10) * 10);
    const penInvolved = pen.scored + pen.saved + pen.missed + pen.conceded;
    // Two explicit weight sets, each summing to 1.0 — the penalty axis
    // takes its 5% out of WINS (50→45), exactly as on the client.
    let weighted;
    if (penInvolved > 0) {
        const penScore = clamp10(5 + pen.scored * 2 + pen.saved * 3 + pen.missed * -2 + pen.conceded * -1);
        weighted =
            winsScore * 0.45 + goalsScore * 0.3 + assistsScore * 0.2 + penScore * 0.05;
    }
    else {
        weighted = winsScore * 0.5 + goalsScore * 0.3 + assistsScore * 0.2;
    }
    const score = 6 + (weighted / 10) * 4;
    return Math.round(Math.min(10, Math.max(6, score)) * 10) / 10;
}
/** Benchmarks the score is measured against, before a club has any history.
 *  MIRRORED from src/utils/eveningScore.ts — the parity test pins them. */
exports.DEFAULT_GOALS_FOR_10 = 4;
exports.DEFAULT_ASSISTS_FOR_10 = 2;
exports.BENCHMARK_FLOOR = 1;
/** Phantom drawn mini-games added to the win rate, so a one-game sample cannot
 *  read as a perfect record. MIRRORED from src/utils/eveningScore.ts, where the
 *  reasoning is written out; the parity test pins the two together. */
exports.WIN_PRIOR_GAMES = 2;
