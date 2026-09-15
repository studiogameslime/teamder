// "Did this evening actually get played?"
//
// This one question decides whether a finished game is sealed into the club's
// history: whether it gets a round summary, whether it advances the season,
// and whether it counts toward the titles. Getting it wrong is not a display
// bug — the seal happens once and is never recomputed.
//
// It used to be answered by a single field, `liveMatch.startedAt`, stamped by
// the app the first time an admin pressed start. That made the whole record
// depend on one client write succeeding. The write swallows its own failures,
// so a dropped request on a bad pitch connection meant the admin went on to
// run rounds and enter goals exactly as normal, and the evening quietly
// vanished from the club's history with nothing to show anything had gone
// wrong. The `phase` values checked alongside it looked like a second opinion
// but were not: the same function wrote all of them, in the same update, so
// they were only ever present or absent together.
//
// So the question is answered from EVIDENCE instead — anything on the game
// that could only exist if people played. Each signal below is written by a
// different action at a different moment, which is the point: the record no
// longer rests on any single write landing.
//
// Deliberately generous. Crediting an evening that somehow left one of these
// traces behind costs a club one extra row in its history; missing a real
// evening costs its players a night that never happened, permanently.

export interface PlayedEvidence {
  liveMatch?: {
    startedAt?: number | null;
    phase?: string;
    /** Windows the clock was actually running. Never cleared between rounds. */
    activeIntervals?: unknown;
    /** Every timer press of the evening. Never cleared between rounds. */
    timerEvents?: unknown;
    timerAccumulatedMs?: number | null;
    timerLastStartedAt?: number | null;
  } | null;
  /** Present once a round has been started and its teams committed. */
  rotation?: unknown;
}

const hasItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const isPos = (v: unknown): boolean => typeof v === 'number' && v > 0;

export function wasActuallyPlayed(
  game: PlayedEvidence | undefined | null,
): boolean {
  if (!game) return false;
  const lm = game.liveMatch ?? undefined;

  // The original stamp. Still first — when it is there, it is the most direct
  // answer there is.
  if (typeof lm?.startedAt === 'number') return true;

  // The phases the same stamp writes. Kept for games written before the rest
  // of this list existed, not as an independent signal.
  if (
    lm?.phase === 'roundRunning' ||
    lm?.phase === 'roundEnded' ||
    lm?.phase === 'live'
  ) {
    return true;
  }

  // The clock ran. Starting it is a statistic in its own right: the physical
  // read is scoped to exactly these windows, so an evening with them produced
  // real per-player data.
  if (hasItems(lm?.activeIntervals)) return true;

  // Somebody pressed a timer control. Weaker than the windows above — a press
  // that was immediately undone still lands here — but a press only happens
  // with people on a pitch waiting for it.
  if (hasItems(lm?.timerEvents)) return true;
  if (isPos(lm?.timerAccumulatedMs)) return true;
  if (typeof lm?.timerLastStartedAt === 'number') return true;

  // A round was started and its two sides committed. This is the one that
  // covers goal entry: the scoreboard only opens once a rotation exists, so
  // any evening with goals in it has this — INCLUDING the ordinary case where
  // the clock sits at 00:00 and is never started, because committing the
  // line-ups resets it and leaves it paused.
  if (game.rotation) return true;

  return false;
}
