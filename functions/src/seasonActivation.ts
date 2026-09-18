// seasonActivation — server-side mirror of `src/utils/seasonActivation.ts`.
//
// Cloud Functions cannot import the app source. The import path is the only
// difference; tests/logic/eveningPlayedMirror.test.ts pins the rest.
//
// ---- everything below this line is a copy of the client file ----

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

import {
  type CalendarDate,
  seasonEndDate,
  nextSeasonStart,
  isValidSeasonMonths,
} from './seasonDates';

export type Cadence = 'date' | 'rounds';
/** Carry season 1 on, or seal it now and begin season 2. */
export type HistoryChoice = 'continue' | 'sealNow';

export interface ActivationInput {
  cadence: Cadence;
  /** Season length in months, for a date cadence. */
  months?: number;
  /** Evenings per season, for a rounds cadence. */
  targetRounds?: number;
  choice: HistoryChoice;
  /** Evenings the club has already played — the real count, from the games. */
  playedHistory: number;
  /** Today, in the club's calendar. */
  today: CalendarDate;
  /** Chosen end for season 1 when carrying it on under a DATE cadence. */
  season1EndsOn?: CalendarDate;
  /** The club has already run at least one season — so there is no season 1 to
   *  give an end date to, and no control on screen that could pick one. */
  hasHistory?: boolean;
}

export type ActivationError =
  | 'monthsInvalid'
  | 'roundsInvalid'
  | 'historyExceedsTarget'
  | 'historyFillsTarget'
  | 'season1EndRequired'
  | 'season1EndNotFuture';

export interface ActivationPlan {
  ok: boolean;
  error?: ActivationError;
  /** How many evenings the club has already played. */
  playedHistory: number;
  /** Season 1 carries on, or is sealed the moment this is applied. */
  sealsSeason1: boolean;
  /** The season that will be RUNNING once this is applied. */
  activeSeasonNo: 1 | 2;
  /** Where the running season's progress starts, for a rounds cadence. */
  startsAtRounds?: number;
  targetRounds?: number;
  /** Evenings still to play before the running season closes. */
  roundsRemaining?: number;
  /** The running season's first and last day, for a date cadence. */
  startsOn?: CalendarDate;
  endsOn?: CalendarDate;
  /** When the season after the running one begins. */
  nextStartsOn?: CalendarDate;
  /** The length every season from the next one onwards will use. */
  months?: number;
}

/**
 * The lower bound on a rounds target.
 *
 * Two evenings, not one: a season of one evening closes the night it opens,
 * which is not a season. There is deliberately NO upper bound — a club that
 * wants a 200-evening season is describing a long season, not a mistake, and
 * the specification did not ask for a ceiling.
 */
export const MIN_SEASON_ROUNDS = 2;

export function isValidSeasonRounds(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_SEASON_ROUNDS;
}

/**
 * What switching seasons on will do — the single answer the settings screen,
 * the confirmation sheet and the server all read.
 */
export function planActivation(input: ActivationInput): ActivationPlan {
  const { cadence, choice, today } = input;
  const playedHistory = Math.max(0, Math.trunc(input.playedHistory || 0));
  const base: ActivationPlan = {
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
    if (playedHistory > target!) {
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
      roundsRemaining: target! - playedHistory,
    };
  }

  // ── date cadence ──
  const months = input.months;
  if (!isValidSeasonMonths(months)) return { ...base, error: 'monthsInvalid' };
  base.months = months;

  if (choice === 'sealNow') {
    // Season 1 is sealed now; season 2 runs the chosen length from today.
    const endsOn = seasonEndDate(today, months!);
    return {
      ...base,
      ok: true,
      startsOn: today,
      endsOn,
      nextStartsOn: nextSeasonStart(endsOn),
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
      return { ...base, ok: true, endsOn: seasonEndDate(today, months!) };
    }
    return { ...base, error: 'season1EndRequired' };
  }
  if (end <= today) return { ...base, error: 'season1EndNotFuture' };
  return {
    ...base,
    ok: true,
    endsOn: end,
    nextStartsOn: nextSeasonStart(end),
  };
}
