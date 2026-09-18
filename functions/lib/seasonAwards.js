"use strict";
// seasonAwards — server-side mirror of `src/utils/seasonAwards.ts`.
//
// Cloud Functions live in their own tsconfig rootDir (`functions/src`), so the
// app source cannot be imported from here. Same arrangement as
// notificationDedup: the two files are kept byte-identical below this header,
// and tests/logic/seasonAwardsMirror.test.ts fails if they ever drift.
//
// Why the SERVER decides the titles: they are decided once, at the moment a
// season closes, from the numbers as they stood — and they are written into
// the sealed archive. A client computing them later would be re-deciding a
// past season from whatever it could still read, which is exactly the drift
// the archive exists to prevent.
//
// ---- everything below this line is a copy of the client file ----
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEASON_TITLE_KEYS = void 0;
exports.eligibilityThreshold = eligibilityThreshold;
exports.isEligible = isEligible;
exports.minPenaltyAttempts = minPenaltyAttempts;
exports.computeSeasonAwards = computeSeasonAwards;
exports.SEASON_TITLE_KEYS = [
    'topScorer',
    'topAssister',
    'mvp',
    'topWinner',
    'mostLoyal',
    'cleanSheetKing',
    'penaltyKing',
    'penaltyKeeper',
    'deadlyDuo',
];
/**
 * Half the season's finished rounds, rounded up.
 *
 * Measured against the club: 13 rounds → 7, and 13 of 29 players clear it.
 * That club's attendance is bimodal — a core on 9–12 and then a drop to 5 —
 * so half lands in the gap rather than through anybody's middle.
 */
function eligibilityThreshold(completedRounds) {
    return Math.ceil(Math.max(0, completedRounds) / 2);
}
/**
 * Did this player turn up enough to be considered?
 *
 * Evenings against evenings. Both sides of this comparison must be the same
 * unit or the gate means nothing — see the note on `games`.
 */
function isEligible(line, completedRounds) {
    return line.games >= eligibilityThreshold(completedRounds);
}
/**
 * Penalties need a second gate, because a rate off one kick is not a record.
 * Scales with the season and then stops: a 50-round season should not demand
 * a shootout specialist.
 *
 *   10 rounds → 2    24 → 3    35 → 4    50+ → 5
 */
function minPenaltyAttempts(completedRounds) {
    return Math.min(5, Math.max(2, Math.ceil(Math.max(0, completedRounds) / 10)));
}
/**
 * Assists a pair must have exchanged before "deadly duo" means anything.
 *
 * Mirrors CHEMISTRY_MIN.deadlyDuo in src/utils/clubChemistry.ts — the club's
 * chemistry card shows a הצמד הקטלני under that name all year, and a season
 * title that crowned a different pair would simply look wrong.
 */
const MIN_DUO_ASSISTS = 3;
/** The bottom of the evening-score scale. A season in which nobody rose above
 *  it has no player of the season — see the note at the `mvp` call. */
const MVP_SCALE_FLOOR = 6;
/** Everyone holding the maximum, or null when the max is not worth a title. */
function leaders(rows, value, id, 
/** The value must EXCEED this to count. Zero goals is not a goalscoring title. */
floor = 0) {
    let best = -Infinity;
    for (const r of rows) {
        const v = value(r);
        if (v > best)
            best = v;
    }
    if (!Number.isFinite(best) || best <= floor)
        return null;
    // Compared on the exact value; only the DISPLAY is ever rounded, so two
    // averages of 8.3746 and 8.3751 are two different numbers here.
    const winners = rows.filter((r) => value(r) === best).map(id);
    return winners.length ? { winners, value: best } : null;
}
/**
 * Decide every title for a closed season.
 *
 * `completedRounds` is the season's finished-round count — the denominator for
 * both gates. It comes from the sealed-evening counter, never from a query
 * over games: deleting a game does not decrement anything, so a live count
 * drifts below the rounds that were actually credited.
 */
function computeSeasonAwards(players, pairs, completedRounds) {
    // A season with no finished evenings awards nothing.
    //
    // Not a formality. `eligibilityThreshold(0)` is 0, so every gate opens: a
    // club whose evenings were never sealed — one that played only unfinished
    // games, or one closed the week it was created — would crown nine champions
    // on a single goal, permanently, and the archive would carry it forever.
    // "Not awarded" is already a result everywhere else here; it is the right
    // result here too.
    if (completedRounds <= 0) {
        return exports.SEASON_TITLE_KEYS.reduce((acc, k) => ({ ...acc, [k]: null }), {});
    }
    const eligible = players.filter((p) => isEligible(p, completedRounds));
    const minAttempts = minPenaltyAttempts(completedRounds);
    // Both halves of a pair must clear the gate on their own, or a regular and
    // a one-night guest could take the duo title between them.
    const eligibleUids = new Set(eligible.map((p) => p.uid));
    const eligiblePairs = pairs.filter((p) => eligibleUids.has(p.a) && eligibleUids.has(p.b));
    const rate = (made, attempts) => attempts > 0 ? made / attempts : 0;
    return {
        topScorer: leaders(eligible, (p) => p.goals, (p) => p.uid),
        topAssister: leaders(eligible, (p) => p.assists, (p) => p.uid),
        // Average, not sum: the spec's call. The half-season gate is what stops
        // it rewarding someone who only shows up on the easy nights.
        //
        // Floored at the SCALE's own bottom, not at zero.
        //
        // The evening score is clamped to [6, 10], and 6.0 is also what it returns
        // for a player who took the field for no mini-games — which is every
        // player of every club that runs the plain timer, because mini-games only
        // exist in advanced mode. With a floor of 0 the sentinel cleared it, so
        // the title that is supposed to name the season was awarded to the entire
        // eligible roster at the value that means "nothing was recorded".
        //
        // On the one club that has ever closed a season, all seven members hold
        // שחקן העונה at exactly 6.0, and seven title documents sit on seven
        // profiles. Nobody beat anybody.
        mvp: leaders(eligible, (p) => p.mvpAvg, (p) => p.uid, MVP_SCALE_FLOOR),
        topWinner: leaders(eligible, (p) => p.wins, (p) => p.uid),
        // Loyalty is turning up, so it counts EVENINGS. On mini-games it would
        // reward whoever happened to play in the longest rotations instead.
        mostLoyal: leaders(eligible, (p) => p.games, (p) => p.uid),
        cleanSheetKing: leaders(eligible, (p) => p.cleanSheets, (p) => p.uid),
        penaltyKing: leaders(eligible.filter((p) => p.penTaken >= minAttempts), (p) => rate(p.penScored, p.penTaken), (p) => p.uid),
        penaltyKeeper: leaders(eligible.filter((p) => p.penFaced >= minAttempts), (p) => rate(p.penSaved, p.penFaced), (p) => p.uid),
        // A floor, like every other title has. With the default of 0 a single
        // assist between two regulars took the crown, which is not a partnership —
        // and the club's chemistry card uses the same threshold for the same name.
        deadlyDuo: leaders(eligiblePairs, (p) => p.score, (p) => `${p.a}__${p.b}`, MIN_DUO_ASSISTS - 1),
    };
}
