// When a season may close, and what an admin is allowed to change while it is
// running.
//
// Pure functions, shared by the client (which greys out a button and explains
// why) and the server (which is the one that actually decides). Neither may
// have its own opinion: a rule that disagrees across the wire is a rule that
// will be argued about at the exact moment nobody can check it.
//
// The one thing to keep hold of while reading: a season NEVER ends on a
// wall-clock instant. Each mini-game is committed on its own, so a boundary
// that falls between round 3 and round 4 leaves three rounds in the old season
// and three in the new — while the player's own career total, written in the
// same batch, keeps the whole evening. The club and the player would then
// disagree permanently, and nothing would ever reconcile them.
//
// So `isSeasonDue` only answers "has this season run its course". The close
// itself happens at the seam after an evening is sealed, and `canCloseNow`
// is what guards that seam.

export type SeasonCadenceType = 'date' | 'rounds';

export interface SeasonCadence {
  type: SeasonCadenceType;
  /** `date`: when it is due to end. */
  endsAt?: number;
  /** `rounds`: the season's TOTAL finished rounds, never a remainder. */
  targetRounds?: number;
}

/** What the club looks like right now, as far as closing is concerned. */
export interface SeasonState {
  cadence: SeasonCadence;
  /** Finished rounds credited to this season. From the sealed-evening
   *  counter — a live query over games drifts, because deleting a game
   *  decrements nothing. */
  completedRounds: number;
  /** Any game in this club not yet `finished`. */
  hasOpenGame: boolean;
  /** A game has finished but its stats have not been sealed yet. Closing
   *  across that gap makes the evening's summary compare tonight against a
   *  table that no longer holds its own history, and every stat reads as a
   *  brand-new club record — permanently, since the summary is written once. */
  hasUnsealedGame: boolean;
}

/** Has the season reached its target? Says nothing about whether it is safe
 *  to close right now — see `canCloseNow`. */
export function isSeasonDue(state: SeasonState, now: number): boolean {
  const { cadence, completedRounds } = state;
  if (cadence.type === 'rounds') {
    const target = cadence.targetRounds ?? 0;
    return target > 0 && completedRounds >= target;
  }
  const endsAt = cadence.endsAt ?? 0;
  return endsAt > 0 && now >= endsAt;
}

export type CloseBlocker = 'openGame' | 'unsealedGame';

/** May the season close at this instant? */
export function canCloseNow(state: SeasonState): {
  ok: boolean;
  blocker?: CloseBlocker;
} {
  if (state.hasOpenGame) return { ok: false, blocker: 'openGame' };
  if (state.hasUnsealedGame) return { ok: false, blocker: 'unsealedGame' };
  return { ok: true };
}

/** Rounds still to play, or null when the season ends on a date. */
export function roundsRemaining(state: SeasonState): number | null {
  if (state.cadence.type !== 'rounds') return null;
  const target = state.cadence.targetRounds ?? 0;
  return Math.max(0, target - state.completedRounds);
}

export type TargetRejection =
  | 'roundsNotAbovePlayed'
  | 'dateInPast'
  | 'missingTarget';

/**
 * May the admin move the finish line to this new target?
 *
 * Changing it is allowed — they run the club, and a season that has lost six
 * weeks to rain genuinely needs adjusting. Two things are not allowed, and
 * both for the same reason: a target already behind the club would close the
 * season the instant it was saved, which is "end it now" wearing a disguise
 * and skipping every guard that the real action has.
 *
 * Ending it now is a separate, deliberate action with its own confirmation.
 */
export function validateTargetChange(
  next: SeasonCadence,
  state: Pick<SeasonState, 'completedRounds'>,
  now: number,
): { ok: boolean; reason?: TargetRejection } {
  if (next.type === 'rounds') {
    const target = next.targetRounds;
    if (typeof target !== 'number' || target <= 0) {
      return { ok: false, reason: 'missingTarget' };
    }
    // The target is the season's TOTAL. Already played 17 and asking for 24
    // leaves 7 — but asking for 17, or 12, would end it on save.
    if (target <= state.completedRounds) {
      return { ok: false, reason: 'roundsNotAbovePlayed' };
    }
    return { ok: true };
  }

  const endsAt = next.endsAt;
  if (typeof endsAt !== 'number' || endsAt <= 0) {
    return { ok: false, reason: 'missingTarget' };
  }
  if (endsAt <= now) return { ok: false, reason: 'dateInPast' };
  return { ok: true };
}

/**
 * The target offered when seasons are switched on for a club that already has
 * history and the admin chooses to CONTINUE season 1.
 *
 * Both branches are measured from the moment of switching on, never from when
 * the club started. A club two years old that picks "six months" would
 * otherwise be handed a deadline that passed eighteen months ago, and season 1
 * would close on the spot — the exact opposite of what "continue" means.
 */
export function continueSeasonTarget(
  cadence: SeasonCadence,
  completedRounds: number,
  now: number,
  addMonths: (from: number, months: number) => number,
): SeasonCadence {
  if (cadence.type === 'rounds') {
    const asked = cadence.targetRounds ?? 0;
    // Same rule as a mid-season change: the total has to be ahead of what has
    // already been played, or "continue" ends it immediately.
    return {
      type: 'rounds',
      targetRounds: Math.max(asked, completedRounds + 1),
    };
  }
  const months = monthsFromEndsAt(cadence);
  return { type: 'date', endsAt: addMonths(now, months) };
}

/** The cadence carries a date; the settings form thinks in months. */
function monthsFromEndsAt(cadence: SeasonCadence): number {
  return cadence.endsAt && cadence.endsAt > 0
    ? Math.max(1, Math.round((cadence.endsAt - Date.now()) / MONTH_MS))
    : 6;
}

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Add months to a timestamp, clamped to the last valid day.
 *
 * There is no month arithmetic anywhere else in this codebase — everything is
 * weeks — so this is the only place that has to know that six months after
 * 31 August is 28 or 29 February, not 3 March. The naive `setMonth(+6)` rolls
 * over and lands in the next month.
 *
 * Kept UTC-free by operating on the local calendar fields the caller supplies;
 * the server passes an Israel-local midnight so the boundary lands where a
 * person would expect it, and daylight saving is handled by the existing
 * helper rather than by a second date path invented here.
 */
export function addMonthsClamped(from: number, months: number): number {
  const d = new Date(from);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d.getTime();
}
