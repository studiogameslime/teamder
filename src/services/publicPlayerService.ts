import { httpsCallable } from 'firebase/functions';
import { getDoc, doc } from 'firebase/firestore';
import { getFirebase } from '@/firebase/config';
import { col } from '@/firebase/firestore';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { StaleSessionError } from './staleSession';
import { retryRead } from './readRetry';
import type { User } from '@/types';

/** Identity only. Never substitute this response for a private user record. */
export type PlayerIdentity = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl' | 'createdAt'>;

function assertReadOwner(owner: string | undefined): void {
  const current = getFirebase().auth.currentUser?.uid;
  if (current !== owner) throw new StaleSessionError(owner ?? '', current ?? '');
}

export async function playerReadCall<T>(name: string, data: unknown, expectedOwner = getFirebase().auth.currentUser?.uid): Promise<T> {
  const { auth, functions } = getFirebase();
  const owner = expectedOwner;
  assertReadOwner(owner);
  if (!owner || auth.currentUser?.isAnonymous) throw new Error('Full account required');
  const check = () => {
    if (auth.currentUser?.uid !== owner) throw new StaleSessionError(owner, auth.currentUser?.uid ?? '');
  };
  const result = await withAuthRaceRetry(() => retryRead(() => { check(); return httpsCallable(functions, name)(data); }, check), { retryTransientReads: true });
  check();
  return result.data as T;
}

export async function readPlayerIdentities(userIds: readonly string[]): Promise<PlayerIdentity[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const owner = getFirebase().auth.currentUser?.uid;
  if (getFirebase().auth.currentUser?.isAnonymous) {
    const snaps = await withAuthRaceRetry(() => { assertReadOwner(owner); return Promise.all(ids.map(id => getDoc(doc(col.usersPublic(), id)))); }, { retryTransientReads: true });
    assertReadOwner(owner);
    return snaps.filter(s => s.exists()).map(s => ({ ...s.data()!, createdAt: 0 }));
  }
  const rows: PlayerIdentity[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    rows.push(...await playerReadCall<PlayerIdentity[]>('getPlayerIdentities', { userIds: ids.slice(offset, offset + 100) }, owner));
  }
  assertReadOwner(owner);
  return rows;
}

/** Most name-only consumers resolve one existing mirror, without a callable
 * per table row. A missing legacy mirror falls back to the server allowlist. */
export async function readPlayerIdentity(id: string): Promise<PlayerIdentity | null> {
  const owner = getFirebase().auth.currentUser?.uid;
  const snap = await withAuthRaceRetry(() => { assertReadOwner(owner); return getDoc(doc(col.usersPublic(), id)); }, { retryTransientReads: true });
  assertReadOwner(owner);
  if (snap.exists()) return { ...snap.data(), createdAt: 0 };
  if (getFirebase().auth.currentUser?.isAnonymous) return null;
  const rows = await playerReadCall<PlayerIdentity[]>('getPlayerIdentities', { userIds: [id] }, owner);
  assertReadOwner(owner);
  return rows[0] ?? null;
}
