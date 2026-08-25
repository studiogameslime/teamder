// The arithmetic behind the "פורמט המחזור" stepper, kept out of the component
// so it can be tested directly — the app's Jest environment is `node`, and the
// rules worth pinning here (clamping, a half-typed field, NaN) are exactly the
// ones a rendering test would struggle to reach.
import {
  TEAM_COUNT_MAX,
  TEAM_COUNT_MIN,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
} from '@/types';

export interface Bounds {
  min: number;
  max: number;
}

export const TEAM_SIZE_BOUNDS: Bounds = { min: TEAM_SIZE_MIN, max: TEAM_SIZE_MAX };
export const TEAM_COUNT_BOUNDS: Bounds = { min: TEAM_COUNT_MIN, max: TEAM_COUNT_MAX };

/** Round and clamp into range. Anything non-finite falls back to `min` rather
 *  than propagating NaN into a number that ends up in Firestore. */
export function clampToBounds(n: number, { min, max }: Bounds): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** One press of − or +. Clamped, so holding a button at the edge is a no-op
 *  rather than a value that drifts past the limit and gets clamped later. */
export function stepBy(current: number, delta: number, bounds: Bounds): number {
  return clampToBounds(current + delta, bounds);
}

/**
 * Commit what the user typed into the number field.
 *
 * The field is free-form while focused — mid-edit it is legitimately `''`, and
 * on some keyboards `'-'` or `'3.'` are reachable. None of those are a number,
 * and none of them should silently become one: an unparseable entry restores
 * the value that was there, an out-of-range one is clamped.
 */
export function commitTyped(raw: string, current: number, bounds: Bounds): number {
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? clampToBounds(n, bounds) : current;
}

/** `5 × 5` with 3 teams is 15 players, not 10 — n is PER TEAM. */
export function totalPlayers(teamSize: number, teamCount: number): number {
  return teamSize * teamCount;
}

/**
 * How the chosen structure sits against a roster that is already registered.
 * `null` when there is no roster to compare with (a brand-new game), which is
 * the create flow — there the card shows the total and nothing else.
 */
export function fitAgainstRoster(
  total: number,
  registered: number | undefined,
): { kind: 'exact' | 'short' | 'over'; by: number } | null {
  if (typeof registered !== 'number' || registered <= 0) return null;
  if (registered === total) return { kind: 'exact', by: 0 };
  return registered < total
    ? { kind: 'short', by: total - registered }
    : { kind: 'over', by: registered - total };
}

