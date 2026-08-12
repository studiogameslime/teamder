// gamesFeedDiscovery — the one place that decides how "full" the matches tab
// feels, and therefore how much discovery content sits below the game list.
//
// The matches tab has to work on day 1 (nobody has opened a public game yet)
// and on day 1000 (the list scrolls forever). Rather than three screens, one
// screen reads its density here and renders conditionally:
//
//   many  → games only. Discovery would steal focus from real, joinable games.
//   few   → games, then area demand, then nearby clubs.
//   none  → a one-line "nothing open right now", then the same two sections.
//
// Every number is a Remote Config knob with a local default, so the thresholds
// can follow real supply as the app grows without shipping a build. Nothing
// here invents content: the demand numbers come from players who actually
// declared availability, and the clubs come from the public club directory.

import { rcNumber } from '@/services/remoteConfigService';
import { GAMES_FEED_DEFAULTS } from '@/utils/feedDensity';

export { GAMES_FEED_DEFAULTS, feedDensity, type FeedDensity } from '@/utils/feedDensity';


export interface GamesFeedConfig {
  richMin: number;
  demandMin: number;
  clubsMax: number;
  clubsRadiusKm: number;
  clubsMinMembers: number;
}

/** Read a Remote Config number, falling back to the local default when the
 *  remote value is missing or nonsensical (0/negative/NaN). */
function num(
  key: 'games_feed_rich_min' | 'games_feed_demand_min' | 'games_feed_clubs_max'
    | 'games_feed_clubs_radius_km' | 'games_feed_clubs_min_members',
  fallback: number,
): number {
  const v = rcNumber(key);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function gamesFeedConfig(): GamesFeedConfig {
  return {
    richMin: num('games_feed_rich_min', GAMES_FEED_DEFAULTS.richMin),
    demandMin: num('games_feed_demand_min', GAMES_FEED_DEFAULTS.demandMin),
    clubsMax: num('games_feed_clubs_max', GAMES_FEED_DEFAULTS.clubsMax),
    clubsRadiusKm: num(
      'games_feed_clubs_radius_km',
      GAMES_FEED_DEFAULTS.clubsRadiusKm,
    ),
    clubsMinMembers: num(
      'games_feed_clubs_min_members',
      GAMES_FEED_DEFAULTS.clubsMinMembers,
    ),
  };
}

