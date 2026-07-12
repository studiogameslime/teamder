// Pure, dependency-free scoring for the evening summary card. Kept out of
// eveningSummaryService (which pulls in RN/Firebase) so it stays unit-testable
// in a plain node jest env, and so the formula lives in exactly one place.

/**
 * Evening score, 6.0–10.0. Blends three objective, position-fair signals:
 *   • win share  (wins / rounds)      — team success you were part of
 *   • attack     (goals×2 + assists)  — direct contribution
 *   • a base floor of 6 so a tough evening never reads as "failure".
 * NOTE: effort (distance/HR) is folded in later (phase 3) so a runner who
 * didn't score still scores well; until then this is the participation+result
 * baseline.
 */
export function eveningScore(
  goals: number,
  assists: number,
  wins: number,
  rounds: number,
): number {
  const winShare = rounds > 0 ? wins / rounds : 0;
  const attack = goals * 2 + assists;
  const raw = 6 + winShare * 2 + Math.min(1, attack / 8) * 2;
  return Math.round(Math.min(10, Math.max(6, raw)) * 10) / 10;
}

/** Adaptive headline + emoji, so every player type gets a fitting title. */
export function pickTitle(
  goals: number,
  assists: number,
  winShare: number,
  rounds: number,
): { title: string; emoji: string } {
  if (goals >= 3) return { title: 'ערב של חלוץ', emoji: '🔥' };
  if (assists >= 3) return { title: 'מפעל הבישולים', emoji: '🅰️' };
  if (winShare >= 0.7 && rounds >= 3)
    return { title: 'מכונת ניצחונות', emoji: '🏆' };
  if (goals >= 1) return { title: 'תורם בהתקפה', emoji: '⚽' };
  if (rounds >= 6) return { title: 'עבד קשה', emoji: '💪' };
  return { title: 'ערב טוב', emoji: '👟' };
}
