"use strict";
// Who counts as having played a mini-game — and why a scorer who left the
// pitch still does.
//
// The two sides are what every stat in a round hangs off: goals and assists
// are only credited to players on a side, and `rounds`, wins, losses, ties and
// clean sheets are credited to exactly that set. So the question "who was on
// the pitch" has to be answered once, carefully, in one place.
//
// The hard case is the one this file exists for. A player scores in the third
// minute and is then substituted off, sent to a different team, or goes home.
// By the time the round ends, the teams the client sends no longer contain
// him. Filtering the goal against those teams throws it away — reported from
// production as "שחקן ששם גול או בישול ולא נמצא בקבוצות לא מקבל את זה
// לסטטיסטיקה האישית שלו".
//
// Dropping the goal is the wrong half to surrender. If a rostered player
// scored or assisted in this round then he was on the pitch for it, whatever
// the teams look like now — so he is PUT BACK on a side. That credits the goal
// AND the mini-game, and keeps the invariant the filter existed to protect:
// every credited stat belongs to somebody who was playing.
//
// Extracted from commitRoundStats so the rule can be tested rather than
// trusted, the same way eveningScoreCore and cleanSheets were.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRoundSides = buildRoundSides;
/**
 * Build the two sides, deduped, disjoint, and repaired.
 *
 * Deduped and disjoint first: a uid appearing twice, or on both sides — a
 * client team-assignment bug or a forged payload — used to be credited a win
 * AND a loss in the same round, plus a self-pair polluting the duo and nemesis
 * stats.
 *
 * Then the repair. Placement follows from `team`, which names the side that
 * gained the point:
 *   • a normal goal was scored BY that side, so the scorer belongs to it;
 *   • an own goal was scored by the side that CONCEDED, so the scorer belongs
 *     to the other one;
 *   • an assister always set up his own team's goal, so he shares the scorer's
 *     side — and an own goal has no assist to credit.
 * A goal with no `team` cannot place anybody and so cannot resurrect anybody.
 */
function buildRoundSides(args) {
    const { sideA, sideB, goals, roster, arrivals, isReal } = args;
    const seen = new Set();
    const A = [];
    const B = [];
    const eligible = (id) => isReal(id) && roster.has(id) && arrivals[id] !== 'no_show';
    for (const id of sideA) {
        if (eligible(id) && !seen.has(id)) {
            seen.add(id);
            A.push(id);
        }
    }
    for (const id of sideB) {
        if (eligible(id) && !seen.has(id)) {
            seen.add(id);
            B.push(id);
        }
    }
    const restored = [];
    const canRejoin = (id) => typeof id === 'string' && eligible(id) && !seen.has(id);
    for (const g of goals) {
        if (g.team !== 'A' && g.team !== 'B')
            continue;
        const scoringSide = g.ownGoal
            ? g.team === 'A'
                ? B
                : A
            : g.team === 'A'
                ? A
                : B;
        if (canRejoin(g.scorerId)) {
            seen.add(g.scorerId);
            scoringSide.push(g.scorerId);
            restored.push(g.scorerId);
        }
        if (!g.ownGoal && canRejoin(g.assisterId)) {
            const side = g.team === 'A' ? A : B;
            seen.add(g.assisterId);
            side.push(g.assisterId);
            restored.push(g.assisterId);
        }
    }
    return { A, B, onField: new Set([...A, ...B]), restored };
}
