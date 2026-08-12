// "3 חברים שלך כאן" on a club the user hasn't joined.
//
// This can't be answered on the client: /groups/{id} is readable only by its
// own members, so `playerIds` is out of reach for exactly the clubs the badge
// is for. The `getFriendsInClubs` callable resolves it with the Admin SDK and
// returns only the caller's OWN friends — nothing else about the roster.

import { httpsCallable } from 'firebase/functions';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import type { ClubFriend } from '@/utils/clubCard';

export interface ClubFriendsEntry {
  /** The real number, which may exceed `friends.length`. */
  total: number;
  friends: ClubFriend[];
}

/** Callable input cap — mirrored server-side, kept here to avoid a wasted trip. */
const MAX_IDS = 30;

/**
 * Friends-in-club for a batch of club ids. Returns an empty map on any
 * failure: the row is decoration on a card that must render regardless, so a
 * failed lookup degrades to "no friends shown" rather than a broken feed.
 */
export async function fetchFriendsInClubs(
  groupIds: string[],
): Promise<Record<string, ClubFriendsEntry>> {
  if (USE_MOCK_DATA || groupIds.length === 0) return {};
  try {
    const { functions } = getFirebase();
    const call = httpsCallable<
      { groupIds: string[] },
      { clubs: Record<string, { total?: number; friends?: unknown[] }> }
    >(functions, 'getFriendsInClubs');
    const res = await call({ groupIds: groupIds.slice(0, MAX_IDS) });
    const out: Record<string, ClubFriendsEntry> = {};
    for (const [gid, v] of Object.entries(res.data?.clubs ?? {})) {
      const friends = Array.isArray(v?.friends)
        ? (v.friends as Record<string, unknown>[])
            .filter((f) => f && typeof f.id === 'string')
            .map((f) => ({
              id: f.id as string,
              name: typeof f.name === 'string' ? f.name : '',
              ...(typeof f.photoUrl === 'string' ? { photoUrl: f.photoUrl } : {}),
              ...(typeof f.avatarId === 'string' ? { avatarId: f.avatarId } : {}),
            }))
        : [];
      out[gid] = {
        total: typeof v?.total === 'number' ? v.total : friends.length,
        friends,
      };
    }
    return out;
  } catch (err) {
    logError('fetchFriendsInClubs', err, { count: groupIds.length });
    return {};
  }
}
