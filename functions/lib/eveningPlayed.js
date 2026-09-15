"use strict";
// eveningPlayed — server-side mirror of `src/utils/eveningPlayed.ts`.
//
// Cloud Functions live in their own tsconfig rootDir (`functions/src`), so the
// app source cannot be imported from here. Same arrangement as seasonAwards and
// notificationDedup: the two files are kept byte-identical below this header,
// and tests/logic/eveningPlayedMirror.test.ts fails if they ever drift.
//
// Why it must exist on BOTH sides: the server decides what an evening is
// credited for, and the app decides what it shows a player about the same
// evening. When those two answers came from different code they disagreed in
// production — a night the server refused to count still appeared in a
// player's totals. One rule, copied, pinned by a test.
//
// ---- everything below this line is a copy of the client file ----
Object.defineProperty(exports, "__esModule", { value: true });
exports.playEvidence = playEvidence;
exports.eveningPlayStateWithReason = eveningPlayStateWithReason;
exports.eveningPlayState = eveningPlayState;
exports.didEveningHappen = didEveningHappen;
exports.needsPlayVerification = needsPlayVerification;
const hasItems = (v) => Array.isArray(v) && v.length > 0;
const isPos = (v) => typeof v === 'number' && v > 0;
/**
 * The strongest evidence this evening was played, or null if there is none.
 *
 * Ordered most-direct first, so the reason it returns reads as the best answer
 * available rather than the first one checked.
 */
function playEvidence(game) {
    if (!game)
        return null;
    const lm = game.liveMatch ?? undefined;
    // The kickoff stamp, and the phases written by the same update. Kept
    // together because they are one signal, not two — treating them as
    // independent is what made the old check look safer than it was.
    if (typeof lm?.startedAt === 'number' ||
        lm?.phase === 'roundRunning' ||
        lm?.phase === 'roundEnded' ||
        lm?.phase === 'live') {
        return 'timer';
    }
    // The clock ran. These windows are what the physical (Health Connect) read
    // is scoped to, so an evening carrying them produced real per-player data.
    if (hasItems(lm?.activeIntervals))
        return 'timer';
    // Somebody pressed a timer control, or time accumulated. Weaker than a
    // closed window — a press undone immediately still lands here — but a press
    // only happens with people on a pitch waiting for it.
    if (hasItems(lm?.timerEvents) ||
        isPos(lm?.timerAccumulatedMs) ||
        typeof lm?.timerLastStartedAt === 'number') {
        return 'timer';
    }
    // A mini-game was aggregated: real goals, by real players, on two real
    // sides. The strongest signal there is, and the only one written by the
    // server rather than the phone.
    if (isPos(game.committedRoundCount))
        return 'result';
    // Goals or a score sitting on the live scoreboard, not yet committed.
    if (hasItems(lm?.goals) || isPos(lm?.scoreA) || isPos(lm?.scoreB)) {
        return 'gameEvent';
    }
    // A round was started and its two sides committed. This is what covers goal
    // entry with the clock never started: committing the line-ups resets the
    // clock and leaves it paused, and the scoreboard only opens once a rotation
    // exists.
    if (game.rotation)
        return 'result';
    return null;
}
/**
 * True for an evening that finished before this module existed.
 *
 * Every close now records HOW it ended. A finished evening with no such record
 * was closed by an older build, and there is no way to learn what happened on
 * it — so it keeps counting exactly as it always has. This is the whole of the
 * backward-compatibility story: no migration, no backfill, and not one
 * historical number moves.
 */
function isLegacyClose(game) {
    return game.endedBy !== 'admin' && game.endedBy !== 'auto';
}
/** The answer, and why. */
function eveningPlayStateWithReason(game) {
    if (!game)
        return { state: 'pending', reason: null };
    // An admin cancelled it. Nothing else can override that.
    if (game.status === 'cancelled')
        return { state: 'notHappened', reason: null };
    // Still to come, or under way. There is nothing to decide yet.
    if (game.status !== 'finished')
        return { state: 'pending', reason: null };
    // An admin's explicit decision on an unverified evening outranks everything
    // the data can infer — they were there.
    if (game.playVerified === true) {
        return { state: 'happened', reason: 'adminVerified' };
    }
    if (game.playVerified === false)
        return { state: 'notHappened', reason: null };
    // Ending the evening is not a technical signal, it is a statement: "this
    // happened and I am closing it." It stands on its own, with no timer, no
    // goals and no result — the admin knows whether they played.
    if (game.endedBy === 'admin') {
        return { state: 'happened', reason: 'manualCompletion' };
    }
    const evidence = playEvidence(game);
    if (evidence)
        return { state: 'happened', reason: evidence };
    // Closed by the sweep, with nothing to show for it. The one case the system
    // refuses to decide on its own.
    if (game.endedBy === 'auto')
        return { state: 'unverified', reason: null };
    // Finished, no record of how, no evidence: an evening from before this
    // shipped. It counted yesterday and it counts today.
    if (isLegacyClose(game))
        return { state: 'happened', reason: 'legacy' };
    return { state: 'unverified', reason: null };
}
/** THE question. Everything that depends on "did this evening happen" asks
 *  this, and nothing re-derives it from a timer, a goal array or a status. */
function eveningPlayState(game) {
    return eveningPlayStateWithReason(game).state;
}
/** Shorthand for the common case. An evening that is pending or unverified is
 *  NOT counted — only a definite yes is. */
function didEveningHappen(game) {
    return eveningPlayState(game) === 'happened';
}
/** An evening waiting on an admin's word. */
function needsPlayVerification(game) {
    return eveningPlayState(game) === 'unverified';
}
