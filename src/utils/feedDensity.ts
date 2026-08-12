// Feed density — how full the matches tab is.
//
// Split out of gamesFeedDiscovery so it carries no Remote Config (and therefore
// no Firebase) import: this is the rule that decides whether the tab gets
// discovery content at all, and it should be testable on its own.

/** How full the visible game list is. Drives the conditional rendering. */
export type FeedDensity = 'none' | 'few' | 'many';

/** Local fallbacks — used before Remote Config activates, and as the clamp
 *  floor if a bad remote value ever lands. */
export const GAMES_FEED_DEFAULTS = {
  /** At/above this many visible games the tab stands on its own. */
  richMin: 5,
  /** Below this many available players a slot isn't a signal — hide the row
   *  rather than dress up a "1 player is free" as demand. */
  demandMin: 3,
  /** Max nearby clubs to surface. Enough to choose from, not a second feed. */
  clubsMax: 3,
  /** Radius (km) for "clubs in your area", matched against the viewer's saved
   *  home coords. */
  clubsRadiusKm: 30,
  /** Minimum squad size for a club to be worth suggesting. A one-person club
   *  is not a community, and recommending it contradicts the section's own
   *  subtitle. 10 covers a 5v5. */
  clubsMinMembers: 10,
} as const;

/**
 * Classify the tab by how many game cards are actually on screen.
 *
 * The count deliberately includes the viewer's OWN games and the "בקרוב"
 * teasers, not just the public ones: a user looking at six of their own
 * matches has a full, useful screen and doesn't need us padding it out. The
 * emptiness we're solving for is visual, not a property of the open-games
 * query alone.
 */
export function feedDensity(visibleGames: number, richMin: number): FeedDensity {
  if (visibleGames <= 0) return 'none';
  return visibleGames >= richMin ? 'many' : 'few';
}
