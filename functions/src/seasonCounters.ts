// The counting rules behind every "how many מחזורים" in the app.
//
// ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// There are four different ways this backend answers that question, they were
// four inline loops inside `index.ts`, and none of them could be reached by a
// test — the only "coverage" they had was a regular expression run over
// index.ts as a string. They disagreed in production, repeatedly and
// expensively:
//
//   • The club screen scanned the games and said 22 מחזורים.
//   • `playedEveningsOfSeason` counted only STAMPED games and said 3, because
//     the stamp only began being written when the feature shipped and 19 of
//     those 22 evenings predate it. Pressing undo on season 1 wrote that 3.
//   • `completedRoundsOf` called with two arguments instead of three fell
//     through to `eveningsSealed - roundsAtStart` — a subtraction of two
//     counters, one of which only began on 26.08.2026 — and said 3 for a
//     season the card said was 22. "סיים עונה עכשיו" would have archived it.
//   • The archive then held whichever of those numbers the closing path
//     happened to use, for ever: a season summary is written with create().
//
// So the rules live here, pure, with the games passed in. index.ts keeps the
// queries — which documents to read is not a rule, it is a lookup — and this
// file keeps every decision made about them. `tests/logic/
// seasonCounterReconciliation.test.ts` runs all of them over one fixture of
// the real club and asserts they agree.
//
// The stamp rule is deliberately identical to the client's (`inSeason` in
// gameService, which the club screen scans with). The two used to disagree by
// nineteen evenings.

import { didEveningHappen, type PlayableEvening } from './eveningPlayed';
import {
  isCalendarDate,
  isSeasonOver,
  type CalendarDate,
} from './seasonDates';

/** A finished game, as far as the counters care: did it happen, and which
 *  season was it played in. */
export type StampedEvening = PlayableEvening & { seasonId?: unknown };

/**
 * Does this evening belong to the season being counted?
 *
 * A game with NO stamp belongs to season 1. The stamp is written when a game
 * goes active (see onGameRosterChanged), so every evening a club played before
 * switching seasons on carries nothing — and those evenings ARE season 1,
 * because that is what "your history becomes season 1" means. Counting only
 * the stamped ones is what brought the one real club's season 1 back holding
 * three of its twenty-two evenings.
 */
export function eveningInSeason(
  game: StampedEvening,
  seasonId: string,
  seasonNo?: number,
): boolean {
  const stamp = typeof game.seasonId === 'string' ? game.seasonId : '';
  return stamp ? stamp === seasonId : seasonNo === 1;
}

/**
 * How many evenings a season has actually held.
 *
 * `didEveningHappen` is the arbiter — an evening the sweep closed with nothing
 * on it is 'unverified' and counts for nobody until an admin says so, and a
 * cancelled one never happened. This is the number the archive seals, so it is
 * asked of the same module the club screen asks.
 */
export function countSeasonEvenings(
  games: readonly StampedEvening[],
  seasonId: string,
  seasonNo?: number,
): number {
  if (!seasonId) return 0;
  let n = 0;
  for (const g of games) {
    if (eveningInSeason(g, seasonId, seasonNo) && didEveningHappen(g)) n += 1;
  }
  return n;
}

/** The club's whole history, every season of it. What season 1 is seeded with
 *  when a club switches seasons on. */
export function countPlayedEvenings(games: readonly PlayableEvening[]): number {
  let n = 0;
  for (const g of games) if (didEveningHappen(g)) n += 1;
  return n;
}

/**
 * A season's progress, from what the club document holds.
 *
 * `playedRounds` is the number the club is SHOWN on its card, seeded when the
 * season opens and incremented by every seal, so reading it means the sweep
 * closes a season on the same number the card displays.
 *
 * The fallback is for a season opened before that mirror existed, and it is
 * the thing that keeps going wrong: `eveningsSealed` is an ALL-TIME counter
 * that only began on 26.08.2026, so subtracting the season's offset from it
 * answers for the era of the counter rather than for the club. It is a last
 * resort, not an equivalent — every caller that has a `playedRounds` must pass
 * it.
 */
export function completedRoundsFrom(
  sealedEvenings: number,
  roundsAtStart?: number,
  playedRounds?: number,
): number {
  if (typeof playedRounds === 'number' && playedRounds >= 0) return playedRounds;
  const all =
    typeof sealedEvenings === 'number' && sealedEvenings > 0
      ? sealedEvenings
      : 0;
  const base =
    typeof roundsAtStart === 'number' && roundsAtStart > 0 ? roundsAtStart : 0;
  return Math.max(0, all - base);
}

/**
 * What ends this season — the one question the hourly sweep and the
 * close-on-seal both have to answer, and used to answer separately.
 *
 * 'none' is a real answer and the dangerous one: a rounds cadence with no
 * target, or a cadence that is neither, is a season that can never end and
 * nothing anywhere said so. The caller reports it; it is not a silent skip.
 */
export type SeasonFinishLine =
  | { kind: 'rounds'; target: number }
  /** A calendar end, in the CLUB's days rather than in UTC instants. */
  | { kind: 'date'; endsOn: CalendarDate }
  /** A season opened before calendar boundaries existed. */
  | { kind: 'epoch'; endsAt: number }
  | { kind: 'none'; cadence: string };

export function seasonFinishLine(cadence: {
  type?: string;
  endsOn?: unknown;
  endsAt?: number | null;
  targetRounds?: number | null;
}): SeasonFinishLine {
  if (cadence?.type === 'rounds') {
    const target = cadence.targetRounds;
    // A rounds season is finished by evenings and by nothing else. Falling
    // through to the date branch here would close it on an `endsAt` left
    // behind by an earlier date cadence — the merge:true leftovers the
    // cadence-hygiene guard exists for.
    return typeof target === 'number' && target > 0
      ? { kind: 'rounds', target }
      : { kind: 'none', cadence: 'rounds' };
  }
  // The calendar date wins over the epoch: it is the one that lands on the
  // club's midnight rather than on UTC's.
  if (isCalendarDate(cadence?.endsOn)) {
    return { kind: 'date', endsOn: cadence.endsOn };
  }
  if (typeof cadence?.endsAt === 'number' && cadence.endsAt > 0) {
    return { kind: 'epoch', endsAt: cadence.endsAt };
  }
  return { kind: 'none', cadence: cadence?.type ?? '(none)' };
}

/**
 * Has this season reached its finish line?
 *
 * The hourly sweep is the only unattended path in the app that destroys data —
 * it wipes the club table, awards nine titles, pushes every participant and
 * opens the next season — and the decision to run it was three inline branches
 * inside a paged scan, reachable by no test.
 *
 * `played` is only consulted for a rounds line, so the caller can leave it at 0
 * for the others rather than paying for a count it does not need: a date club
 * that is simply not due yet must cost no read at all.
 */
export function isSeasonDue(
  line: SeasonFinishLine,
  at: { played: number; now: number; today: CalendarDate },
): boolean {
  switch (line.kind) {
    case 'rounds':
      return at.played >= line.target;
    case 'date':
      // Through the END of its last day, in the CLUB's calendar. Compared as
      // dates rather than as instants, so the rollover cannot land at 02:00
      // local just because Cloud Functions run in UTC.
      return isSeasonOver(line.endsOn, at.today);
    case 'epoch':
      return at.now >= line.endsAt;
    case 'none':
      // A season with no finish line is never due, and the caller reports it
      // rather than skipping quietly — a club can sit in one for ever.
      return false;
  }
}
