// Server mirror.
// ---- everything below this line is a copy of the client file ----

import { seasonEndDate, todayIn, isValidSeasonMonths, type CalendarDate } from './seasonDates';

/** Approved season policy, 19.10.2026. Server mirror is pinned by a test. */
export const SEASON_POLICY_VERSION = 2;
export const MIN_SEASON_ROUNDS = 5;
export const MAX_SEASON_ROUNDS = 200;
export const CORRECTION_WINDOW_MS = 24 * 60 * 60 * 1000;
export function seasonClosureKind(completedRounds: number): 'competitive' | 'cancelled' {
  return completedRounds >= MIN_SEASON_ROUNDS ? 'competitive' : 'cancelled';
}
export type SeasonHistoryChoice = 'fresh' | 'sealNow' | 'continue';
export interface SeasonTarget {
  type: 'date' | 'rounds';
  months?: number | null;
  targetRounds?: number | null;
  startsOn?: CalendarDate | null;
  endsOn?: CalendarDate | null;
  endsAt?: number | null;
}
export interface CorrectionWindow {
  seasonId: string;
  dueAt: number;
  closeAt: number;
  reason: 'date' | 'rounds' | 'manual';
  pausedAt?: number;
  remainingMs?: number;
  awaitingVerification?: number;
}

export function maxSeasonTarget(includedHistory = 0): number {
  return Math.max(0, Math.trunc(includedHistory)) + MAX_SEASON_ROUNDS;
}

/** Calendar end is inclusive; the effective boundary is the next midnight. */
export function seasonTargetDue(target: SeasonTarget, played: number, now: number): boolean {
  if (target.type === 'rounds') return typeof target.targetRounds === 'number' && played >= target.targetRounds;
  if (target.endsOn) return todayIn(undefined, now) > target.endsOn;
  return typeof target.endsAt === 'number' && now >= target.endsAt;
}

export function makeSeasonTarget(type: 'date' | 'rounds', value: number, startsOn: CalendarDate): SeasonTarget {
  return type === 'rounds'
    ? { type, targetRounds: value, months: null, startsOn: null, endsOn: null, endsAt: null }
    : { type, months: value, startsOn, endsOn: seasonEndDate(startsOn, value), endsAt: null, targetRounds: null };
}

export function validateSeasonTarget(args: {
  target: SeasonTarget;
  previousType?: 'date' | 'rounds';
  played: number;
  includedHistory?: number;
  now: number;
  activation?: boolean;
}): { ok: boolean; error?: 'roundsInvalid' | 'monthsInvalid' | 'targetBehind' | 'switchTargetReached'; due: boolean } {
  const { target, played, now } = args;
  const due = seasonTargetDue(target, played, now);
  if (target.type === 'rounds') {
    const n = target.targetRounds;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < MIN_SEASON_ROUNDS || n > maxSeasonTarget(args.includedHistory)) {
      return { ok: false, error: 'roundsInvalid', due };
    }
    if (n < played) return { ok: false, error: 'targetBehind', due };
  } else if (!isValidSeasonMonths(target.months)) {
    return { ok: false, error: 'monthsInvalid', due };
  }
  if (due && (args.activation || (args.previousType && target.type !== args.previousType))) {
    return { ok: false, error: 'switchTargetReached', due };
  }
  return { ok: true, due };
}

/** Pause preserves the exact remaining duration; repeated refreshes never reset it. */
export function updateCorrectionWindow(window: CorrectionWindow, unverified: number, now: number): CorrectionWindow {
  if (unverified > 0) {
    return { ...window, pausedAt: window.pausedAt ?? now,
      remainingMs: window.remainingMs ?? Math.max(0, window.closeAt - now), awaitingVerification: unverified };
  }
  const { pausedAt, remainingMs, awaitingVerification: _count, ...rest } = window;
  return { ...rest, closeAt: pausedAt != null ? now + Math.max(0, remainingMs ?? window.closeAt - pausedAt) : window.closeAt };
}

export function correctionTimeLeft(window: CorrectionWindow, now: number): number {
  return Math.max(0, window.pausedAt != null ? window.remainingMs ?? 0 : window.closeAt - now);
}

/** Earliest schedulable kickoff. A paused window can be extended by a later
 * verification, so the actual start still has to be checked by the server. */
export function seasonScheduleBoundary(seasons: { pendingClose?: { closeAt: number; pausedAt?: number; remainingMs?: number }; operation?: unknown } | undefined, now: number): number | null {
  if (seasons?.operation) return Infinity;
  const p = seasons?.pendingClose;
  if (!p) return null;
  return p.pausedAt != null ? now + Math.max(0, p.remainingMs ?? 0) : p.closeAt;
}
