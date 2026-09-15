// "Did this evening actually take place?" — the one place that answers it.
//
// ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// A מחזור is a club NIGHT; the משחקונים inside it are a different count. Whether
// the NIGHT happened is the hinge for a surprising amount of the app: how many
// evenings the club has held, who attended, attendance streaks, every player
// and club statistic, the history list, the round summary, the achievements,
// and how far a season has progressed.
//
// Before this module there were TWO answers to that question and they did not
// agree:
//
//   • The server credited attendance and sealed the summary only when the game
//     carried evidence of play — which for a long time meant one client-written
//     field, `liveMatch.startedAt`.
//   • The client (`isAttendedGame`, and the club-stats scan) asked only whether
//     `status === 'finished'`, with no evidence gate at all.
//
// So a night the server refused to count still showed up in a player's
// "משחקים" total, in their achievements, and in the club's organisation rate.
// Nothing reconciled the two. This module is that reconciliation: every surface
// asks `eveningPlayState`, and nothing infers the answer from a timer field, a
// goal array or a status string on its own.
//
// ─── THE THREE ANSWERS ──────────────────────────────────────────────────────
//
// 'happened'     — it took place. Counts everywhere.
// 'notHappened'  — it did not: cancelled, or an admin said so.
// 'unverified'   — it was closed by the system, left no trace of play, and
//                  nobody has said either way. Does NOT count, and is not
//                  deleted: it waits for an admin.
// 'pending'      — not over yet. Nothing to decide.
//
// 'unverified' is the new one, and it is the point. A club that organises in
// the app but plays offline leaves no trace at all; the sweep that closes
// forgotten evenings cannot tell that night apart from one nobody showed up
// to. Guessing either way is wrong — counting a night that never happened
// inflates the club's history, and silently dropping a night that DID happen
// takes an evening away from everyone who played it. So the system declines to
// guess and asks, once, in one place.
//
// ─── WHAT COUNTS AS EVIDENCE ────────────────────────────────────────────────
//
// Anything on the game that could only exist if people played. Each signal is
// written by a different action at a different moment, so the record does not
// rest on any single write landing — which is exactly how the old single-field
// version failed.
//
// There is deliberately NO minimum duration on the timer. Starting it at all is
// evidence; a night that ran four minutes is still a night.
//
// A REGULAR evening cannot produce goals, results or rotations — the simple
// live screen is a clock and nothing else. That is not a special case in the
// list below, it is simply what the list evaluates to when those fields cannot
// exist. One list, both modes, no branch to keep in sync.
//
// ─── BACKWARD COMPATIBILITY ─────────────────────────────────────────────────
//
// Every evening closed before this shipped carries no `endedBy`, and is treated
// as 'happened' exactly as it is today. The system only declines to guess about
// nights it watched itself close. Nothing historical moves, and no backfill is
// needed — see `isLegacyClose`.

/** How a finished evening reached its end. Absent on everything closed before
 *  this module shipped, which is what makes the legacy rule below possible. */
export type EveningEndedBy =
  | 'admin' // an admin pressed "סיים מחזור" — a statement that it happened
  | 'auto'; // the sweep closed a forgotten evening

export type EveningPlayState =
  'happened' | 'notHappened' | 'unverified' | 'pending';

/** Why the answer is what it is. For copy, logs and tests — never for control
 *  flow in a caller, which should branch on the state alone. */
export type PlayEvidenceSource =
  | 'timer' // the clock ran, or was started
  | 'gameEvent' // a goal, an assist, a penalty
  | 'result' // a round was committed with two sides and an outcome
  | 'manualCompletion' // an admin ended the evening
  | 'adminVerified' // an admin confirmed it after the fact
  | 'legacy'; // closed before this existed; counted as it always was

/** The subset of a game this module reads. Deliberately structural so both the
 *  app's `Game` and the server's raw document satisfy it without a cast. */
export interface PlayableEvening {
  status?: string;
  endedBy?: string;
  /** Set ONLY by an admin deciding an unverified evening. */
  playVerified?: boolean;
  liveMatch?: {
    startedAt?: number | null;
    phase?: string;
    /** Windows the clock actually ran. Never cleared between rounds. */
    activeIntervals?: unknown;
    /** Every timer press of the evening. Never cleared between rounds. */
    timerEvents?: unknown;
    timerAccumulatedMs?: number | null;
    timerLastStartedAt?: number | null;
    /** Goals entered on the live scoreboard and not yet committed. */
    goals?: unknown;
    scoreA?: number | null;
    scoreB?: number | null;
  } | null;
  /** Present once a round has been started and its two sides committed. */
  rotation?: unknown;
  /** Mini-games already aggregated. Advanced mode only. */
  committedRoundCount?: number | null;
}

const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const isPos = (v: unknown): boolean => typeof v === 'number' && v > 0;

/**
 * The strongest evidence this evening was played, or null if there is none.
 *
 * Ordered most-direct first, so the reason it returns reads as the best answer
 * available rather than the first one checked.
 */
export function playEvidence(
  game: PlayableEvening | null | undefined,
): PlayEvidenceSource | null {
  if (!game) return null;
  const lm = game.liveMatch ?? undefined;

  // The kickoff stamp, and the phases written by the same update. Kept
  // together because they are one signal, not two — treating them as
  // independent is what made the old check look safer than it was.
  if (
    typeof lm?.startedAt === 'number' ||
    lm?.phase === 'roundRunning' ||
    lm?.phase === 'roundEnded' ||
    lm?.phase === 'live'
  ) {
    return 'timer';
  }

  // The clock ran. These windows are what the physical (Health Connect) read
  // is scoped to, so an evening carrying them produced real per-player data.
  if (hasItems(lm?.activeIntervals)) return 'timer';

  // Somebody pressed a timer control, or time accumulated. Weaker than a
  // closed window — a press undone immediately still lands here — but a press
  // only happens with people on a pitch waiting for it.
  if (
    hasItems(lm?.timerEvents) ||
    isPos(lm?.timerAccumulatedMs) ||
    typeof lm?.timerLastStartedAt === 'number'
  ) {
    return 'timer';
  }

  // A mini-game was aggregated: real goals, by real players, on two real
  // sides. The strongest signal there is, and the only one written by the
  // server rather than the phone.
  if (isPos(game.committedRoundCount)) return 'result';

  // Goals or a score sitting on the live scoreboard, not yet committed.
  if (hasItems(lm?.goals) || isPos(lm?.scoreA) || isPos(lm?.scoreB)) {
    return 'gameEvent';
  }

  // A round was started and its two sides committed. This is what covers goal
  // entry with the clock never started: committing the line-ups resets the
  // clock and leaves it paused, and the scoreboard only opens once a rotation
  // exists.
  if (game.rotation) return 'result';

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
function isLegacyClose(game: PlayableEvening): boolean {
  return game.endedBy !== 'admin' && game.endedBy !== 'auto';
}

/** The answer, and why. */
export function eveningPlayStateWithReason(
  game: PlayableEvening | null | undefined,
): { state: EveningPlayState; reason: PlayEvidenceSource | null } {
  if (!game) return { state: 'pending', reason: null };

  // An admin cancelled it. Nothing else can override that.
  if (game.status === 'cancelled')
    return { state: 'notHappened', reason: null };

  // Still to come, or under way. There is nothing to decide yet.
  if (game.status !== 'finished') return { state: 'pending', reason: null };

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
  if (evidence) return { state: 'happened', reason: evidence };

  // Closed by the sweep, with nothing to show for it. The one case the system
  // refuses to decide on its own.
  if (game.endedBy === 'auto') return { state: 'unverified', reason: null };

  // Finished, no record of how, no evidence: an evening from before this
  // shipped. It counted yesterday and it counts today.
  if (isLegacyClose(game)) return { state: 'happened', reason: 'legacy' };

  return { state: 'unverified', reason: null };
}

/** THE question. Everything that depends on "did this evening happen" asks
 *  this, and nothing re-derives it from a timer, a goal array or a status. */
export function eveningPlayState(
  game: PlayableEvening | null | undefined,
): EveningPlayState {
  return eveningPlayStateWithReason(game).state;
}

/** Shorthand for the common case. An evening that is pending or unverified is
 *  NOT counted — only a definite yes is. */
export function didEveningHappen(
  game: PlayableEvening | null | undefined,
): boolean {
  return eveningPlayState(game) === 'happened';
}

/** An evening waiting on an admin's word. */
export function needsPlayVerification(
  game: PlayableEvening | null | undefined,
): boolean {
  return eveningPlayState(game) === 'unverified';
}
