import { httpsCallable } from '@/services/diagnosticCallable';
import { getDoc, doc } from 'firebase/firestore';
import { getFirebase } from '@/firebase/config';
import { col } from '@/firebase/firestore';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { StaleSessionError } from './staleSession';
import { retryRead } from './readRetry';
import { mapConcurrent } from '@/utils/mapConcurrent';
import type { User } from '@/types';

/** Identity only. Never substitute this response for a private user record. */
export type PlayerIdentity = Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl' | 'createdAt'>;

// Share only work that is still running. A subsequent visit must read again,
// and a replacement auth session must never inherit another session's read.
const identityReads = new WeakMap<object, Map<string, Promise<unknown>>>();
/** Profile edits invalidate active identity reads without caching old values. */
export function invalidatePlayerIdentityReads(): void {
  const session = getFirebase().auth.currentUser;
  if (session) identityReads.get(session)?.clear();
}

function shareIdentityRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const { auth } = getFirebase();
  const session = auth.currentUser;
  if (!session) return read();
  const owner = session.uid;
  let pending = identityReads.get(session);
  if (!pending) identityReads.set(session, pending = new Map());
  const existing = pending.get(key);
  if (existing) return existing as Promise<T>;
  const request = read().then(value => {
    if (auth.currentUser !== session || auth.currentUser.uid !== owner) {
      throw new StaleSessionError(owner, auth.currentUser?.uid ?? '');
    }
    return value;
  }).finally(() => { if (pending.get(key) === request) pending.delete(key); });
  pending.set(key, request);
  return request;
}

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
  return shareIdentityRead(`roster:${getFirebase().auth.currentUser?.isAnonymous === true}:${JSON.stringify(ids)}`, () => loadPlayerIdentities(ids));
}

async function loadPlayerIdentities(ids: string[]): Promise<PlayerIdentity[]> {
  const owner = getFirebase().auth.currentUser?.uid;
  if (getFirebase().auth.currentUser?.isAnonymous) {
    const snaps = await withAuthRaceRetry(() => { assertReadOwner(owner); return Promise.all(ids.map(id => getDoc(doc(col.usersPublic(), id)))); }, { retryTransientReads: true });
    assertReadOwner(owner);
    return snaps.filter(s => s.exists()).map(s => ({ ...s.data()!, createdAt: 0 }));
  }
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    batches.push(ids.slice(offset, offset + 100));
  }
  // Large rosters need several allowlisted reads; keep order without a
  // network round trip per page or unbounded concurrent server requests.
  const pages = await mapConcurrent(batches, 4, userIds =>
    playerReadCall<PlayerIdentity[]>('getPlayerIdentities', { userIds }, owner));
  assertReadOwner(owner);
  return pages.flat();
}

/** Most name-only consumers resolve one existing mirror, without a callable
 * per table row. A missing legacy mirror falls back to the server allowlist. */
export async function readPlayerIdentity(id: string): Promise<PlayerIdentity | null> {
  return shareIdentityRead(`player:${getFirebase().auth.currentUser?.isAnonymous === true}:${id}`, () => loadPlayerIdentity(id));
}

async function loadPlayerIdentity(id: string): Promise<PlayerIdentity | null> {
  const owner = getFirebase().auth.currentUser?.uid;
  const snap = await withAuthRaceRetry(() => { assertReadOwner(owner); return getDoc(doc(col.usersPublic(), id)); }, { retryTransientReads: true });
  assertReadOwner(owner);
  if (snap.exists()) return { ...snap.data(), createdAt: 0 };
  if (getFirebase().auth.currentUser?.isAnonymous) return null;
  const rows = await playerReadCall<PlayerIdentity[]>('getPlayerIdentities', { userIds: [id] }, owner);
  assertReadOwner(owner);
  return rows[0] ?? null;
}
