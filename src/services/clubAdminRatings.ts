import { httpsCallable } from '@/services/diagnosticCallable';
import { getFirebase } from '@/firebase/config';
import type { Group } from '@/types';
import { StaleSessionError } from './staleSession';
import { retryRead } from './readRetry';

const ratingReads = new WeakMap<object, Map<string, Promise<Record<string, number> | undefined>>>();

/** Reads after a local rating write must not join work begun before it. */
export function invalidateClubAdminRatingRead(groupId: string): void {
  const session = getFirebase().auth.currentUser;
  if (session) ratingReads.get(session)?.delete(groupId);
}

function readRatings(groupId: string, session: NonNullable<ReturnType<typeof getFirebase>['auth']['currentUser']>): Promise<Record<string, number> | undefined> {
  const { auth, functions } = getFirebase(), uid = session.uid;
  let pending = ratingReads.get(session);
  if (!pending) ratingReads.set(session, pending = new Map());
  const previous = pending.get(groupId);
  if (previous) return previous;
  const check = () => { if (auth.currentUser !== session || auth.currentUser.uid !== uid) throw new StaleSessionError(uid, auth.currentUser?.uid ?? ''); };
  const request = retryRead(() => {
    check();
    return httpsCallable<{groupId: string}, {ratings: Record<string, number>}>(functions, 'getClubAdminRatings')({groupId});
  }, check).then(response => {
    check();
    const data = response.data.ratings;
    return data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5)) as Record<string, number> : undefined;
  }).finally(() => { if (pending.get(groupId) === request) pending.delete(groupId); });
  pending.set(groupId, request);
  return request;
}

/** Server authorizes ratings; staged releases keep the legacy storage until migration. */
export async function hydrateClubAdminRatings(group: Group): Promise<Group> {
  const { auth } = getFirebase(), session = auth.currentUser, uid = session?.uid;
  if (!session || !uid) throw new StaleSessionError('', '');
  const allowed = group.adminIds.includes(uid) || (group.hideInternalRating !== true && group.playerIds.includes(uid));
  if (!allowed) return { ...group, adminRatings: undefined };
  const ratings = await readRatings(group.id, session);
  return { ...group, adminRatings: ratings };
}
