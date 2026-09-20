// A closed season is closed to corrections (§12).
//
// Extracted from `index.ts` so it can be TESTED rather than only asserted. It
// began life inside the retro-goal loader guarding one callable; §12 made it
// the rule for every path that can change a recorded result, and the one thing
// a rule applied in four places must not be is untestable — the seasons audit
// already carries a defect named `inseason-tested-as-a-private-copy` for a
// check verified against a copy of itself rather than the code that runs.
//
// Callers: loadRetroGameContext (addRetroGoal, removeRetroGoal),
// setEveningPlayed, commitRoundStats.

import { HttpsError } from 'firebase-functions/v2/https';

/** The parts of a club document this decision reads. */
export interface SeasonLockClub {
  seasons?: {
    enabled?: boolean;
    currentId?: string;
    currentNo?: number;
  };
}

/** The parts of a game document this decision reads. */
export interface SeasonLockGame {
  seasonId?: unknown;
}

/**
 * Which season does this evening belong to?
 *
 * ⚠️ An UNSTAMPED evening belongs to season 1. The `games.seasonId` stamp only
 * began being written when seasons shipped, so every evening a club played
 * before that has none — on the one club that has ever run seasons, 19 of 22.
 * Reading "no stamp" as "the current season" let a correction to an evening
 * from June be credited to season 2, inflating its totals and its מלך השערים
 * while season 1's sealed archive stayed wrong with no way to fix it.
 *
 * Returns '' when the club runs no seasons, where the question is meaningless.
 */
export function seasonOfEvening(
  club: SeasonLockClub | undefined,
  game: SeasonLockGame,
): string {
  const seasons = club?.seasons;
  if (!seasons?.enabled) return '';
  const stamped = typeof game.seasonId === 'string' ? game.seasonId : '';
  if (stamped) return stamped;
  return seasons.currentNo === 1 ? seasons.currentId ?? '' : 's1';
}

/** True when this evening's season is still open to corrections. */
export function seasonIsOpenForGame(
  club: SeasonLockClub | undefined,
  game: SeasonLockGame,
): boolean {
  const seasons = club?.seasons;
  // A club that runs no seasons has nothing to lock.
  if (!seasons?.enabled) return true;
  return seasonOfEvening(club, game) === seasons.currentId;
}

/**
 * Refuse a statistical correction to an evening whose season has closed.
 *
 * Why it matters, in the case that produced it: retro-goal writes go straight
 * into `communityPlayerStats` and `communityStats`, which are the SEASON's
 * counters. Correcting a goal from a season that has since closed lands in the
 * wrong season twice over — the sealed archive stays wrong, and the running
 * season is credited with a goal nobody scored in it. Removing one is worse:
 * the counter it decrements may already be at zero, and Firestore's increment
 * goes negative without complaint, so a club table starts showing −1 goals.
 *
 * A season that is merely WAITING to close is still open, and that is the
 * point of the correction window (§13): during `pendingClose` the season is
 * still `currentId`, so this admits the write.
 */
export function assertSeasonOpenForGame(
  club: SeasonLockClub | undefined,
  game: SeasonLockGame,
): void {
  if (seasonIsOpenForGame(club, game)) return;
  throw new HttpsError(
    'failed-precondition',
    'closedSeasonGame: this evening belongs to a season that has already closed',
  );
}
