// "Is this the season's LAST evening?" — and "how long until it closes?"
//
// Two questions the app had no single answer to, asked by three surfaces at
// once (the club card, the game screen, the countdown). Kept here rather than
// in each of them for the reason every other season counter is: the same
// question answered twice is how two screens end up disagreeing about one
// season, which this feature has now done four times.

import type { GroupSeasons } from '@/types';

/**
 * Evenings still to play before a rounds season reaches its target.
 *
 * `null` for a season measured in TIME — it has a date, not a countdown of
 * evenings, and returning 0 for it would read as "the last one".
 */
export function roundsLeftInSeason(
  seasons: GroupSeasons | undefined,
): number | null {
  if (!seasons?.enabled) return null;
  const c = seasons.cadence;
  if (c?.type !== 'rounds' || typeof c.targetRounds !== 'number') return null;
  return Math.max(0, c.targetRounds - (seasons.playedRounds ?? 0));
}

/**
 * The next evening played will be this season's last.
 *
 * Exactly one left, not zero: at zero the season has already MET its target
 * and is in the correction window, where the right message is the countdown
 * below and not "give it everything you've got".
 */
export function isFinalRoundOfSeason(
  seasons: GroupSeasons | undefined,
): boolean {
  return roundsLeftInSeason(seasons) === 1;
}

/**
 * Milliseconds until the correction window shuts and the season closes, or
 * `null` when the season is not in one.
 *
 * Clamped at 0 rather than going negative: the window can expire minutes
 * before the sweep that acts on it runs, and a negative countdown on screen is
 * a bug report.
 */
export function msUntilSeasonCloses(
  seasons: GroupSeasons | undefined,
  now: number,
): number | null {
  const at = seasons?.pendingClose?.closeAt;
  if (typeof at !== 'number' || at <= 0) return null;
  // Belt and braces: a stale `pendingClose` left by a season that has since
  // been replaced must not count down the new one's clock.
  if (
    seasons?.pendingClose?.seasonId &&
    seasons.currentId &&
    seasons.pendingClose.seasonId !== seasons.currentId
  ) {
    return null;
  }
  return Math.max(0, at - now);
}

/** `2:05:47` — hours:minutes:seconds, hours uncapped. */
export function formatCloseCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${h}:${two(m)}:${two(s)}`;
}
