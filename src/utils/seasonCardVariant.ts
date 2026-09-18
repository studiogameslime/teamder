// Which kind of thing a finished season is, before anything draws it.
//
// The hall of fame has a champion poster, a medal cabinet and a ceremony. All
// of that assumes a season somebody actually played. Three of the seasons in
// production are not that, and one of them — a season opened and closed inside
// the same minute by a seeding bug, with no players and no titles — is the
// FIRST card the owner's own club shows.
//
// So the variant is decided here, once, by a pure function with tests, and the
// screen switches on it. The spectacular branch is unreachable for anything
// else. A guard that lives inside a 400-line screen is a guard somebody
// forgets.

import type { FinishedSeason } from '@/services/seasonHistoryService';

export type SeasonCardVariant =
  /** A real season with titles. Poster, cabinet, the whole ceremony. */
  | 'full'
  /** People played, nobody cleared the half-season gate. A real card with an
   *  empty shelf — the season happened, and saying so matters. */
  | 'noTitles'
  /** Nothing happened in it at all. A ribbon, not a card. */
  | 'void';

export function seasonCardVariant(s: FinishedSeason): SeasonCardVariant {
  // Every counter a club can record, and nothing else.
  //
  // NOT keyed on `totals.rounds` alone: mini-games exist only in advanced mode,
  // so a timer-only club — the common case — records 0 משחקונים for every
  // season it ever plays, and keying the void state on that would erase real
  // seasons.
  //
  // And no longer keyed on how long the season lasted. `endsAt - startsAt` was
  // read as "a season that opened and closed inside two days did not have a
  // season in it", but startsAt is stamped when seasons are switched ON, not at
  // the first evening the season contains: on the one real closed season in
  // production that difference is 31.6 HOURS for three months of football. It
  // sat inside a 48h window, and only `players !== 0` kept a club's entire hall
  // of fame from collapsing into one grey dashed line. Put the span back and it
  // collapses.
  //
  // What is left is a season in which NOTHING was recorded anywhere — no
  // evening sealed, no mini-game, no goal, no assist, nobody who played, no
  // title. There is nothing for a poster to print, whatever the cause, so it is
  // a ribbon. A season with any of those non-zero and still no titles keeps its
  // card: a club with 19 sealed evenings and empty stats is a data problem, and
  // hiding it would hide the problem.
  const nothingRecorded =
    s.players === 0 &&
    s.winners.length === 0 &&
    s.completedRounds === 0 &&
    s.totals.rounds === 0 &&
    s.totals.goals === 0 &&
    s.totals.assists === 0;
  if (nothingRecorded) return 'void';
  return s.winners.length === 0 ? 'noTitles' : 'full';
}

/**
 * The season the screen opens on.
 *
 * Not simply the newest: if the newest is void, opening on it means opening on
 * nothing. The hero is the newest season that has something to show.
 */
export function heroSeasonId(list: readonly FinishedSeason[]): string | null {
  const real = list.find((s) => seasonCardVariant(s) === 'full');
  if (real) return real.seasonId;
  const played = list.find((s) => seasonCardVariant(s) === 'noTitles');
  return played?.seasonId ?? null;
}

/**
 * A season's headline winner.
 *
 * `mvp` first — it is the title that names a season. But a שחקן העונה shared
 * between five people is not a headline, it is a footnote with five names in
 * it, so past two holders the crown passes to the top scorer.
 */
const HERO_ORDER = ['mvp', 'topScorer', 'topWinner'] as const;
const MAX_SHARED_HERO = 2;

export function heroWinner(
  s: FinishedSeason,
): FinishedSeason['winners'][number] | null {
  for (const key of HERO_ORDER) {
    const w = s.winners.find((x) => x.key === key);
    if (w && w.names.length <= MAX_SHARED_HERO) return w;
  }
  // Nothing unshared to crown → the title the FEWEST people share, so the
  // poster still has a subject rather than an empty plate.
  //
  // It used to take `winners[0]`, which is canonical-order, not smallest: on a
  // timer-only club this fallback is the default poster, and the title that
  // lands first is routinely מלך ההתמדה, held jointly by everyone who turned
  // up. That is a 78-character list of the entire club as a 35pt headline.
  // Fewest-first at least crowns the closest thing the season has to a person;
  // the poster caps the names it prints on top of that.
  return (
    [...s.winners].sort((a, b) => a.names.length - b.names.length)[0] ?? null
  );
}
