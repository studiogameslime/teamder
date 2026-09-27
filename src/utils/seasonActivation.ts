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
} from '@/utils/seasonDates';

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
  /**
   * A target EQUAL to the evenings already played closes the season, instead of
   * being refused.
   *
   * Only the live "עדכן את יעד העונה" path sets it. Switching seasons ON has a
   * chip that says exactly this out loud — "לסגור ולהתחיל חדשה" — so a target
   * its own history already fills is a mistake there, and stays refused. A club
   * whose season is already running has no such chip and no other way to say
   * "this evening was the last one": an admin who moves the line to the number
   * the club is standing on means the season ends here, which is precisely what
   * `updateSeasonTarget` records as `endsTheSeason` and closes on.
   */
  equalTargetCloses?: boolean;
}

export type ActivationError =
  | 'monthsInvalid'
  | 'roundsInvalid'
  | 'historyExceedsTarget'
  | 'historyFillsTarget'
  | 'season1EndRequired'
  | 'season1EndNotFuture'
  /** "לסגור ולהתחיל חדשה" chosen with fewer than MIN_SEASON_ROUNDS behind the
   *  club. Sealing is closing, and a season may not close under the floor. */
  | 'sealTooFewRounds';

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
  /** Applying this CLOSES the running season on the spot — the target is the
   *  count the club has already played, so there is nothing left for it to
   *  play. Only reachable with `equalTargetCloses`, and the screen that sets
   *  that flag says so before the admin presses anything. */
  closesSeasonNow?: boolean;
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

  // Sealing is CLOSING a season, and a season may not close under the floor.
  //
  // The rule was already enforced at the two other doors — `endSeasonNow`
  // refuses to seal a season that has played fewer than MIN_SEASON_ROUNDS, and
  // the target picker refuses to set one that would end sooner. This door was
  // left open: a club with nothing behind it could switch seasons ON, choose
  // "לסגור ולהתחיל חדשה", and get an archived season 1 holding zero evenings —
  // nine `null` titles over an empty table, `count: 1`, and a club that now
  // reports a closed season it never played. An archive is written once and
  // never recomputed, so that record is permanent.
  //
  // Checked before the cadence is validated on purpose: the refusal is about
  // the choice the admin just made, not about a month count they have not
  // reached yet.
  if (choice === 'sealNow' && playedHistory < MIN_SEASON_ROUNDS) {
    return { ...base, error: 'sealTooFewRounds' };
  }

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
      //
      // …unless closing is the answer the caller came for. On the live
      // target-change path there is no "seal now" chip to point at, so this is
      // the admin saying the season ends at the number the club has reached —
      // allowed, and named as a close rather than disguised as a target.
      if (!input.equalTargetCloses) {
        return { ...base, error: 'historyFillsTarget' };
      }
      return {
        ...base,
        ok: true,
        startsAtRounds: playedHistory,
        roundsRemaining: 0,
        closesSeasonNow: true,
      };
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
      // nextStartsOn as well, not the end date alone. Every other activation
      // path hands the confirmation sheet all three of its lines, and the sheet
      // renders each only when its field is present — so this branch, the one a
      // club takes when it switches seasons back ON, was the single plan that
      // came up a line short: an end date and no "עונה N+1 מתחילה ב-". Derived
      // the same way the two sibling successes derive it, from the end date
      // this branch has just computed.
      const endsOn = seasonEndDate(today, months!);
      return { ...base, ok: true, endsOn, nextStartsOn: nextSeasonStart(endsOn) };
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
