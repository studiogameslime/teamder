// nearbyClubsService — clubs to suggest on the matches tab when there aren't
// enough open matches to fill it.
//
// Reads ONLY the public club directory (`/groupsPublic` via
// groupService.listPublicGroups). That mirror is the sanctioned public face of
// a club — name, cover, city, member count, description — and by construction
// carries NOTHING about the club's matches. A closed club's fixtures, roster
// counts and venues stay invisible to non-members because they were never in
// this collection to begin with.
//
// Distance uses the viewer's SAVED home coords, never a live GPS read: this
// runs on screen load, and a permission prompt the user didn't ask for would
// be a hostile way to fill a list. Clubs that predate geocoding fall back to
// an exact city-name match, the same fallback the communities feed uses.

import { groupService } from '@/services/groupService';
import { haversineKm } from '@/utils/geo';
import { logError } from '@/services/errorLog';
import type { GroupPublic, User } from '@/types';

export interface NearbyClubsResult {
  clubs: GroupPublic[];
  /** 'nearby' — filtered by the viewer's home area. 'all' — the viewer has no
   *  home area, so these are simply the most active clubs. The caller titles
   *  the section accordingly rather than claiming "in your area" falsely. */
  scope: 'nearby' | 'all';
}

// The public directory is a whole-collection read and this section mounts on
// every focus of the matches tab. A short TTL collapses those into one read
// per window; club listings change on the order of days, not seconds.
const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; value: GroupPublic[] } | null = null;
let inFlight: Promise<GroupPublic[]> | null = null;

async function loadDirectory(): Promise<GroupPublic[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const list = await groupService.listPublicGroups();
      cached = { at: Date.now(), value: list };
      return list;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Drop the cache — for pull-to-refresh. */
export function invalidateNearbyClubs(): void {
  cached = null;
}

function viewerHome(user: User | null): {
  latLng: { lat: number; lng: number } | null;
  city: string | null;
} {
  const av = user?.availability;
  const lat = av?.homeCityLat;
  const lng = av?.homeCityLng;
  const city = (av?.homeCity ?? av?.preferredCity ?? av?.cities?.[0] ?? '').trim();
  return {
    latLng:
      typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
    city: city.length > 0 ? city : null,
  };
}

export const nearbyClubsService = {
  /**
   * Clubs near the viewer that they could actually join.
   *
   * Drops: clubs they're already in or awaiting approval for, their own hidden
   * personal group, and clubs that are full (a join CTA that can't succeed is
   * worse than no card).
   */
  async getNearbyClubs(
    user: User | null,
    opts: {
      excludeGroupIds: Set<string>;
      radiusKm: number;
      limit: number;
      /** Squad-size floor — a club below it isn't a community to join. */
      minMembers: number;
    },
  ): Promise<NearbyClubsResult> {
    if (!user) return { clubs: [], scope: 'all' };
    let directory: GroupPublic[];
    try {
      directory = await loadDirectory();
    } catch (err) {
      logError('getNearbyClubs', err, { userId: user.id });
      return { clubs: [], scope: 'all' };
    }

    const home = viewerHome(user);
    const joinable = directory.filter((g) => {
      if (!g?.id) return false;
      if (opts.excludeGroupIds.has(g.id)) return false;
      if (user.personalGroupId && g.id === user.personalGroupId) return false;
      // Full club → the join CTA would only ever fail.
      if (typeof g.maxMembers === 'number' && g.memberCount >= g.maxMembers) {
        return false;
      }
      // Too small to be a community. Shipped without this and the section
      // recommended one-person clubs under a subtitle promising "קהילות
      // שמשחקות בקביעות" — a claim those rows plainly didn't meet (user
      // report, 1.0.90). Applies to the "most active" fallback too.
      if (g.memberCount < opts.minMembers) return false;
      return true;
    });

    // Most active clubs, used whenever we can't honestly say "near you" —
    // either no home area on file, or an area that matched nothing.
    const mostActive = (): NearbyClubsResult => ({
      clubs: [...joinable]
        .sort((a, b) => b.memberCount - a.memberCount || a.id.localeCompare(b.id))
        .slice(0, opts.limit),
      scope: 'all',
    });

    if (!home.latLng && !home.city) return mostActive();

    const withDistance = joinable.flatMap((g) => {
      if (home.latLng && typeof g.lat === 'number' && typeof g.lng === 'number') {
        const km = haversineKm(home.latLng, { lat: g.lat, lng: g.lng });
        return km <= opts.radiusKm ? [{ g, km }] : [];
      }
      // Legacy club with no coords — exact city match, same fallback the
      // communities "near me" filter applies. Sorted after the geocoded ones.
      if (home.city && g.city) {
        const same =
          g.city.trim().toLowerCase() === home.city.trim().toLowerCase();
        return same ? [{ g, km: Number.MAX_SAFE_INTEGER }] : [];
      }
      return [];
    });

    // Nothing in radius. That's common for a viewer whose profile only has a
    // legacy city name (no coords), where matching degrades to an exact
    // city-string compare — a club one town over would be dropped. Since the
    // whole point of this section is to give an empty screen somewhere to go,
    // fall back to the active clubs and re-title honestly rather than
    // rendering nothing.
    if (withDistance.length === 0) return mostActive();

    return {
      clubs: withDistance
        .sort(
          (a, b) =>
            a.km - b.km ||
            b.g.memberCount - a.g.memberCount ||
            a.g.id.localeCompare(b.g.id),
        )
        .slice(0, opts.limit)
        .map((x) => x.g),
      scope: 'nearby',
    };
  },
};
