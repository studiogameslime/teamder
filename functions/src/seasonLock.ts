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
import { todayIn } from './seasonDates';

/** The parts of a club document this decision reads. */
export interface SeasonLockClub {
  seasons?: {
    policyVersion?: number;
    startedAt?: number;
    playedRounds?: number;
    cadence?: { type?: string; endsOn?: string };
    pendingClose?: { seasonId?: string; dueAt?: number; closeAt?: number; pausedAt?: number; reason?: string; temporary?: boolean };
    enabled?: boolean;
    currentId?: string;
    currentNo?: number;
    count?: number;
    disabledAt?: number;
    operation?: unknown;
  };
}

/** An expired natural window is immutable even before the sweep archives it.
 * Manual requests still have to admit the settlement they are waiting for. */
export function seasonCorrectionWindowExpired(seasons: SeasonLockClub['seasons'], now = Date.now()): boolean {
  const p = seasons?.pendingClose;
  return seasons?.enabled === true && !!p && !p.temporary && p.reason !== 'manual' &&
    (!p.seasonId || p.seasonId === seasons.currentId) && p.pausedAt == null &&
    typeof p.closeAt === 'number' && p.closeAt <= now;
}

export function assertSeasonTargetEditable(seasons: SeasonLockClub['seasons'], now = Date.now()): void {
  if (seasonCorrectionWindowExpired(seasons, now)) {
    throw new HttpsError('failed-precondition', 'closedSeasonGame: correction window expired; refresh the season');
  }
}

/** Validate a supplied date independently of a pre-existing season stamp. */
export function assertSeasonOccurrence(club: SeasonLockClub | undefined, game: SeasonLockGame, at: number): void {
  const s = club?.seasons;
  if (s?.policyVersion !== 2 || !s.enabled || game.seasonId !== s.currentId) return;
  if (todayIn(undefined, at) < todayIn(undefined, s.startedAt ?? 0) ||
      (s.pendingClose?.dueAt != null && at > s.pendingClose.dueAt)) {
    throw new HttpsError('failed-precondition', 'closedSeasonGame: occurrence date conflicts with the season');
  }
}

/** The parts of a game document this decision reads. */
export interface SeasonLockGame {
  seasonId?: unknown;
  startsAt?: unknown;
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
  const stamped = typeof game.seasonId === 'string' ? game.seasonId : '';
  if (stamped) return stamped;
  if (seasons?.policyVersion === 2) {
    const at = typeof game.startsAt === 'number' ? game.startsAt : 0;
    if (!seasons.enabled) return at >= (seasons.disabledAt ?? Infinity) ? `off_${seasons.count ?? 0}_${seasons.disabledAt}` : '';
    if (!at || todayIn(undefined, at) < todayIn(undefined, seasons.startedAt ?? 0)) return '';
    if (seasons.pendingClose && at > (seasons.pendingClose.dueAt ?? 0)) return '';
    if (seasons.cadence?.type === 'date' && seasons.cadence.endsOn && (seasons.playedRounds ?? 0) >= 5 && todayIn(undefined, at) > seasons.cadence.endsOn) return '';
    return seasons.currentId ?? '';
  }
  if (!seasons?.enabled && !(seasons?.count)) return '';
  return seasons?.currentNo === 1 ? seasons?.currentId ?? '' : 's1';
}

/** True when this evening's season is still open to corrections. */
export function seasonIsOpenForGame(
  club: SeasonLockClub | undefined,
  game: SeasonLockGame,
): boolean {
  const seasons = club?.seasons;
  // A club that runs no seasons has nothing to lock.
  if (seasons?.operation) return false;
  if (!seasons?.enabled) {
    if (seasons?.policyVersion === 2) return seasonOfEvening(club, game) === `off_${seasons.count ?? 0}_${seasons.disabledAt ?? 0}`;
    const closed = seasons?.count ?? Math.max(0, (seasons?.currentNo ?? 1) - 1);
    if (!closed) return true;
    const stamp = seasonOfEvening(club, game);
    return stamp === '' || stamp === `off_${seasons?.count ?? 0}_${seasons?.disabledAt ?? 0}` ||
      (stamp === seasons?.currentId && (seasons?.currentNo ?? 1) > (seasons?.count ?? 0));
  }
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
  options: { settlement?: boolean; now?: number } = {},
): void {
  if (club?.seasons?.operation) throw new HttpsError('failed-precondition', 'season-operation:busy');
  // Only server settlement paths may finish a round admitted before expiry.
  // A retro correction never passes this option, including inside its transaction.
  if (!options.settlement) assertSeasonTargetEditable(club?.seasons, options.now);
  if (seasonIsOpenForGame(club, game)) return;
  throw new HttpsError(
    'failed-precondition',
    'closedSeasonGame: this evening belongs to a season that has already closed',
  );
}
