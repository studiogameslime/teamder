"use strict";
// Two rules the filler matcher got wrong, pulled out so they can be tested.
//
// Both come from one production push, screenshotted and reported: at 04:04 in
// the morning, a stranger was invited to fill a game that was already full,
// with the words "חסרים 20 שחקנים".
Object.defineProperty(exports, "__esModule", { value: true });
exports.FILLER_QUIET_UNTIL_HOUR = exports.FILLER_QUIET_FROM_HOUR = void 0;
exports.occupancyOf = occupancyOf;
exports.israelHour = israelHour;
exports.inFillerQuietHours = inFillerQuietHours;
/**
 * How many spots on the pitch are actually taken.
 *
 * ⚠️ Registered players PLUS guests. The filler matcher counted only
 * `players`, so a game filled entirely with guests read as empty: it passed
 * the "already full" test, passed the shortage threshold, and announced a gap
 * of twenty. `runSendShortageWarnings` had always counted guests — the filler
 * path was the odd one out, which is exactly why this now lives in one place.
 */
function occupancyOf(g) {
    return (g.players?.length ?? 0) + (g.guests?.length ?? 0);
}
/** Israel-local hour of an instant. The Functions runtime clock is UTC. */
function israelHour(epoch) {
    const h = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Jerusalem',
        hourCycle: 'h23',
        hour: '2-digit',
    }).format(new Date(epoch));
    return parseInt(h, 10);
}
/** 22:00 → 08:00 Israel time. */
exports.FILLER_QUIET_FROM_HOUR = 22;
exports.FILLER_QUIET_UNTIL_HOUR = 8;
/**
 * Is now a time we refuse to send a filler opportunity?
 *
 * A filler opportunity is the least urgent push the app sends, and the only
 * one that reaches people who never asked about that particular game. The
 * sweep runs every 15 minutes, so a game held back here goes out the moment
 * the window opens; nothing is lost but the middle of the night.
 *
 * Deliberately NOT applied to reminders or shortage warnings — those go to
 * people already committed to the game, and a two-hours-to-kickoff warning
 * that waits until morning is worthless.
 */
function inFillerQuietHours(epoch) {
    const hour = israelHour(epoch);
    return hour >= exports.FILLER_QUIET_FROM_HOUR || hour < exports.FILLER_QUIET_UNTIL_HOUR;
}
