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

/** A season that opened and closed inside two days did not have a season in it. */
const VOID_SPAN_MS = 48 * 60 * 60 * 1000;

export function seasonCardVariant(s: FinishedSeason): SeasonCardVariant {
  // NOT keyed on `totals.rounds`. Mini-games exist only in advanced mode, so a
  // timer-only club — the common case — records 0 משחקונים for every season it
  // ever plays. Keying the void state on that would erase real seasons.
  const nothingRecorded =
    s.players === 0 &&
    s.winners.length === 0 &&
    s.totals.goals === 0 &&
    s.totals.assists === 0;
  if (!nothingRecorded) {
    return s.winners.length === 0 ? 'noTitles' : 'full';
  }
  // A club CAN legitimately record nothing: an admin closes a season early,
  // the week after it opened, before anyone played. That is still void.
  // But a long season with people in it that reports nothing is a data
  // problem, not an empty season, and hiding it would hide the problem.
  const span = s.endsAt > 0 && s.startsAt > 0 ? s.endsAt - s.startsAt : 0;
  return span > 0 && span <= VOID_SPAN_MS ? 'void' : 'noTitles';
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
  // Nothing unshared to crown → the first title the season did award, so the
  // poster still has a subject rather than falling back to an empty plate.
  return s.winners[0] ?? null;
}
