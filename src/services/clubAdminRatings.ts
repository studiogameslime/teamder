import { httpsCallable } from '@/services/diagnosticCallable';
import { getFirebase } from '@/firebase/config';
import type { Group } from '@/types';
import { StaleSessionError } from './staleSession';
import { retryRead } from './readRetry';

/** Server authorizes ratings; staged releases keep the legacy storage until migration. */
export async function hydrateClubAdminRatings(group: Group): Promise<Group> {
  const { auth, functions } = getFirebase(), uid = auth.currentUser?.uid;
  if (!uid) throw new StaleSessionError('', '');
  const allowed = group.adminIds.includes(uid) || (group.hideInternalRating !== true && group.playerIds.includes(uid));
  if (!allowed) return { ...group, adminRatings: undefined };
  const check = () => { if (auth.currentUser?.uid !== uid) throw new StaleSessionError(uid, auth.currentUser?.uid ?? ''); };
  const response = await retryRead(() => httpsCallable<{groupId: string}, {ratings: Record<string, number>}>(functions, 'getClubAdminRatings')({groupId: group.id}), check);
  if (auth.currentUser?.uid !== uid) throw new StaleSessionError(uid, auth.currentUser?.uid ?? '');
  const data = response.data.ratings;
  const ratings = data && typeof data === 'object' && !Array.isArray(data) ? Object.fromEntries(Object.entries(data).filter(([, n]) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 5)) as Record<string, number> : undefined;
  return { ...group, adminRatings: ratings };
}
