// Server mirror.
// ---- everything below this line is a copy of the client file ----

import { seasonEndDate, nextSeasonStart, isValidSeasonMonths, type CalendarDate } from './seasonDates';
import { MIN_SEASON_ROUNDS, maxSeasonTarget, type SeasonHistoryChoice } from './seasonPolicy';
export { MIN_SEASON_ROUNDS } from './seasonPolicy';
export type Cadence = 'date' | 'rounds';
export type HistoryChoice = SeasonHistoryChoice;
export interface ActivationInput {
  cadence: Cadence; months?: number; targetRounds?: number; choice: HistoryChoice;
  playedHistory: number; today: CalendarDate; historyStartsOn?: CalendarDate;
  /** Retained only for older callers; an arbitrary end date is never used. */
  season1EndsOn?: CalendarDate; hasHistory?: boolean; equalTargetCloses?: boolean;
}
export type ActivationError = 'monthsInvalid' | 'roundsInvalid' | 'historyExceedsTarget' |
  'historyFillsTarget' | 'season1EndRequired' | 'season1EndNotFuture' | 'sealTooFewRounds';
export interface ActivationPlan {
  ok: boolean; error?: ActivationError; playedHistory: number; sealsSeason1: boolean;
  activeSeasonNo: 1 | 2; startsAtRounds?: number; targetRounds?: number; roundsRemaining?: number;
  closesSeasonNow?: boolean; startsOn?: CalendarDate; endsOn?: CalendarDate; nextStartsOn?: CalendarDate;
  months?: number; historyChoice?: HistoryChoice;
}
export function isSeasonReactivation(seasons?: {count?: number; disabledAt?: number}): boolean {
  return (seasons?.count ?? 0) > 0 || (seasons?.disabledAt ?? 0) > 0;
}
export function isValidSeasonRounds(n: unknown, includedHistory = 0): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= MIN_SEASON_ROUNDS && n <= maxSeasonTarget(includedHistory);
}
export function planActivation(input: ActivationInput): ActivationPlan {
  const playedHistory = Math.max(0, Math.trunc(input.playedHistory || 0));
  const carry = input.choice === 'continue';
  const base: ActivationPlan = { ok: false, playedHistory, sealsSeason1: input.choice === 'sealNow',
    activeSeasonNo: input.choice === 'sealNow' ? 2 : 1, historyChoice: input.choice };
  if (input.choice === 'sealNow' && playedHistory < MIN_SEASON_ROUNDS) return {...base, error: 'sealTooFewRounds'};
  const played = carry ? playedHistory : 0;
  if (input.cadence === 'rounds') {
    const n = input.targetRounds;
    if (!isValidSeasonRounds(n, carry ? playedHistory : 0)) return {...base, error: 'roundsInvalid'};
    if (n! < played) return {...base, error: 'historyExceedsTarget'};
    if (n === played && !input.equalTargetCloses) return {...base, error: 'historyFillsTarget'};
    return {...base, ok: true, targetRounds: n, startsAtRounds: played, roundsRemaining: n! - played,
      ...(n === played ? {closesSeasonNow: true} : {})};
  }
  if (!isValidSeasonMonths(input.months)) return {...base, error: 'monthsInvalid'};
  const startsOn = carry ? input.historyStartsOn ?? input.today : input.today;
  const endsOn = seasonEndDate(startsOn, input.months!);
  if (endsOn < input.today && !input.equalTargetCloses) return {...base, error: 'season1EndNotFuture'};
  return {...base, ok: true, startsOn, endsOn, nextStartsOn: nextSeasonStart(endsOn), months: input.months};
}
