// Internal community rating scale. Admins rate community members on a
// decimal 1.0–5.0 scale (one decimal place, e.g. 4.3). "Unrated" is stored as
// 0 / undefined and rendered as an em dash. The same scale is used for a
// guest's skill estimate. Drives the auto-balance algorithm, where an unrated
// player counts as the neutral middle.

// Slider runs 0–5 (owner request): the far-left is 0, the lowest rating.
export const RATING_MIN = 0;
export const RATING_MAX = 5;
export const RATING_STEP = 0.1;
/** Unrated players are scored at the neutral middle during balancing. */
export const RATING_NEUTRAL = 3;

/** True when `v` is a real rating (not unrated/empty). */
export function isRated(v: number | null | undefined): boolean {
  return typeof v === 'number' && v > 0;
}

/** "4.3" — one decimal. Unrated/empty → an em dash. */
export function formatRating(v: number | null | undefined): string {
  return isRated(v) ? (v as number).toFixed(1) : '—';
}

/** Snap a raw value to the 0.1 grid and clamp into [RATING_MIN, RATING_MAX]. */
export function snapRating(v: number): number {
  const snapped = Math.round(v * 10) / 10;
  if (snapped < RATING_MIN) return RATING_MIN;
  if (snapped > RATING_MAX) return RATING_MAX;
  return snapped;
}
