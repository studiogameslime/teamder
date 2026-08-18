// Which single card the home screen leads with.
//
// The hero used to have exactly two states — a game I'm in, else a game whose
// registration hasn't opened yet — and a game that is OPEN RIGHT NOW but that I
// haven't joined fell between them. It appeared nowhere, so at the one moment
// the screen most needs to push a registration, it advertised next week instead.
//
// Seen in production on 18.08: registration for the next night opened at 10:00
// and filled 11 of 15 places within nine minutes, while every member who had not
// yet joined — 17 of the club's 28 — was shown a "coming soon" teaser for a game
// eight days out.
//
// Pure so the ordering is testable without a renderer.

export type HomeHero =
  | { kind: 'mine'; game: unknown }
  | { kind: 'openToJoin'; game: unknown }
  | { kind: 'scheduled'; game: unknown }
  | { kind: 'none' };

/**
 * @param mine      games I'm registered to or created, soonest first
 * @param openToJoin games in my clubs open for registration that I'm NOT in,
 *                   soonest first
 * @param scheduled games in my clubs whose registration hasn't opened yet
 */
export function pickHomeHero<T>(
  mine: readonly T[],
  openToJoin: readonly T[],
  scheduled: readonly T[],
): { kind: HomeHero['kind']; game: T | null } {
  // A game I'm in always wins — even a month out. It is the one with a
  // commitment attached.
  if (mine.length > 0) return { kind: 'mine', game: mine[0] };
  // Then a game I could still join TODAY. This is the rung that was missing.
  if (openToJoin.length > 0) return { kind: 'openToJoin', game: openToJoin[0] };
  // Only then "a game is on the way".
  if (scheduled.length > 0) return { kind: 'scheduled', game: scheduled[0] };
  return { kind: 'none', game: null };
}
