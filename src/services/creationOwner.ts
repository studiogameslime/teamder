import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { StaleSessionError } from '@/services/staleSession';

export function assertCreationOwner(uid: string): void {
  if (USE_MOCK_DATA) return;
  const actual = getFirebase().auth.currentUser?.uid ?? '';
  if (actual !== uid) throw new StaleSessionError(uid, actual);
}
