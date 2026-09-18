"use strict";
// seasonActivation — server-side mirror of `src/utils/seasonActivation.ts`.
//
// Cloud Functions cannot import the app source. The import path is the only
// difference; tests/logic/eveningPlayedMirror.test.ts pins the rest.
//
// ---- everything below this line is a copy of the client file ----
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_SEASON_ROUNDS = void 0;
exports.isValidSeasonRounds = isValidSeasonRounds;
exports.planActivation = planActivation;
// Turning seasons on for a club that already has a history.
//
// This is the one irreversible decision in the feature: everything the club has
// ever played becomes season 1, and the admin chooses whether season 1 carries
// on or is sealed on the spot. Getting it wrong either archives two years by
// accident or starts a season that is already over.
//
// Pure, so the settings screen, the confirmation sheet and the server all reach
// the same answer from the same inputs — the summary a person approves has to
// be the thing that actually happens.
const seasonDates_1 = require("./seasonDates");
/**
 * The lower bound on a rounds target.
 *
 * Two evenings, not one: a season of one evening closes the night it opens,
 * which is not a season. There is deliberately NO upper bound — a club that
 * wants a 200-evening season is describing a long season, not a mistake, and
 * the specification did not ask for a ceiling.
 */
exports.MIN_SEASON_ROUNDS = 2;
function isValidSeasonRounds(n) {
    return typeof n === 'number' && Number.isInteger(n) && n >= exports.MIN_SEASON_ROUNDS;
}
/**
 * What switching seasons on will do — the single answer the settings screen,
 * the confirmation sheet and the server all read.
 */
function planActivation(input) {
    const { cadence, choice, today } = input;
    const playedHistory = Math.max(0, Math.trunc(input.playedHistory || 0));
    const base = {
        ok: false,
        playedHistory,
        sealsSeason1: choice === 'sealNow',
        activeSeasonNo: choice === 'sealNow' ? 2 : 1,
    };
    if (cadence === 'rounds') {
        const target = input.targetRounds;
        if (!isValidSeasonRounds(target))
            return { ...base, error: 'roundsInvalid' };
        base.targetRounds = target;
        if (choice === 'sealNow') {
            // History is sealed as season 1; season 2 starts empty.
            return { ...base, ok: true, startsAtRounds: 0, roundsRemaining: target };
        }
        // Carrying season 1 on: it already holds the club's history, so the target
        // has to leave somewhere to go.
        if (playedHistory > target) {
            return { ...base, error: 'historyExceedsTarget' };
        }
        if (playedHistory === target) {
            // Exactly full. Not an error in arithmetic, but there is no such thing as
            // a running season with nothing left to play — it would close on the
            // sweep's next pass, which is a confusing way to say "seal it now".
            return { ...base, error: 'historyFillsTarget' };
        }
        return {
            ...base,
            ok: true,
            startsAtRounds: playedHistory,
            roundsRemaining: target - playedHistory,
        };
    }
    // ── date cadence ──
    const months = input.months;
    if (!(0, seasonDates_1.isValidSeasonMonths)(months))
        return { ...base, error: 'monthsInvalid' };
    base.months = months;
    if (choice === 'sealNow') {
        // Season 1 is sealed now; season 2 runs the chosen length from today.
        const endsOn = (0, seasonDates_1.seasonEndDate)(today, months);
        return {
            ...base,
            ok: true,
            startsOn: today,
            endsOn,
            nextStartsOn: (0, seasonDates_1.nextSeasonStart)(endsOn),
        };
    }
    // Carrying season 1 on under a date cadence, there is no honest start date to
    // compute — the history stretches back as far as the club does. So season 1 is
    // a transitional season whose END the admin picks, and the chosen length only
    // begins to apply from season 2.
    //
    // Only on a FIRST activation, though. A club that is already running seasons,
    // or that closed some and is switching the feature back on, has no season 1 to
    // give an end date to — and the control that picks one is rendered only on a
    // first activation, so demanding it left every such club with a dead button, a
    // red line naming a season it archived months ago, and no date picker anywhere
    // on the screen. The date cadence was unreachable for the entire life of a
    // club. The server already derives the date itself in this case.
    const end = input.season1EndsOn;
    if (!end) {
        if (input.hasHistory) {
            return { ...base, ok: true, endsOn: (0, seasonDates_1.seasonEndDate)(today, months) };
        }
        return { ...base, error: 'season1EndRequired' };
    }
    if (end <= today)
        return { ...base, error: 'season1EndNotFuture' };
    return {
        ...base,
        ok: true,
        endsOn: end,
        nextStartsOn: (0, seasonDates_1.nextSeasonStart)(end),
    };
}
