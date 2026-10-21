import { observedRejection, observeCaughtError } from '../utils/errorObservation';

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Stable content encoding; undefined object fields are omitted like JSON. */
export function creationPayload(value: unknown): string {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)]));
    }
    return item;
  };
  return JSON.stringify(canonical(value));
}

interface Attempt<T, R> {
  version: 1;
  uid: string;
  kind: 'club' | 'game';
  draftId: string;
  fingerprint: string;
  id: string;
  prepared?: T;
  completed?: { result: R };
}

let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, observedRejection(work, {"source":"src/services/creationAttempt.ts","handler":"serialize","site":"creationAttempt:b23d67eb5d"}));
  queue = next.catch((caughtError9ee15de635: unknown) => {
    observeCaughtError(caughtError9ee15de635, {"source":"src/services/creationAttempt.ts","handler":"serialize","site":"creationAttempt:9ee15de635"});});
  return next;
}

async function scopeKey(kind: 'club' | 'game', uid: string, draftId: string): Promise<string> {
  const crypto = require('expo-crypto') as typeof import('expo-crypto');
  return 'footy.creationScope.' + await crypto.digestStringAsync(
    crypto.CryptoDigestAlgorithm.SHA256, creationPayload([uid, kind, draftId]),
  );
}

/** A submitted draft must keep its original time/content, even after kickoff. */
export async function hasDraftCreationAttempt(kind: 'club' | 'game', uid: string, draftId: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(await scopeKey(kind, uid, draftId));
  if (!raw) return false;
  const records: unknown = JSON.parse(raw);
  if (!Array.isArray(records) || records.some(key => typeof key !== 'string' || !key.startsWith('footy.creation.'))) {
    throw new Error('לא ניתן לשחזר את מצב ניסיון היצירה');
  }
  return records.length > 0;
}

/** Persist BEFORE sending. Failed/ambiguous attempts never expire silently. */
export async function runCreationAttempt<T, R>(
  context: { kind: 'club' | 'game'; uid: string; draftId?: string; values: unknown; assertOwner?: () => void },
  prepare: () => Promise<T>,
  create: (prepared: T, attemptId?: string) => Promise<R>,
): Promise<R> {
  // Legacy/background callers retain their existing contract. All wizard and
  // auth-resume entry points supply the persisted draft id.
  context.assertOwner?.();
  if (!context.draftId) {
    const prepared = await prepare();
    context.assertOwner?.();
    const result = await create(prepared);
    context.assertOwner?.();
    return result;
  }
  const crypto = require('expo-crypto') as typeof import('expo-crypto');
  const fingerprint = await crypto.digestStringAsync(
    crypto.CryptoDigestAlgorithm.SHA256, creationPayload(context.values),
  );
  const key = 'footy.creation.' + await crypto.digestStringAsync(
    crypto.CryptoDigestAlgorithm.SHA256,
    creationPayload([context.uid, context.kind, context.draftId, fingerprint]),
  );
  const indexKey = await scopeKey(context.kind, context.uid, context.draftId);
  const attempt = await serialize(async (): Promise<Attempt<T, R>> => {
    const indexAttempt = async () => {
      const rawIndex = await AsyncStorage.getItem(indexKey);
      const index: unknown = rawIndex ? JSON.parse(rawIndex) : [];
      if (!Array.isArray(index) || index.some(entry => typeof entry !== 'string')) {
        throw new Error('לא ניתן לשחזר את מצב ניסיון היצירה');
      }
      if (!index.includes(key)) await AsyncStorage.setItem(indexKey, JSON.stringify([...index, key]));
    };
    context.assertOwner?.();
    const raw = await AsyncStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as Attempt<T, R>;
      // A damaged local record must fail closed instead of creating a second
      // remote document under a replacement token.
      if (saved.version !== 1 || saved.uid !== context.uid || saved.kind !== context.kind ||
          saved.draftId !== context.draftId || saved.fingerprint !== fingerprint ||
          typeof saved.id !== 'string' || !saved.id || (!saved.completed && !saved.prepared)) {
        throw new Error('לא ניתן לשחזר בבטחה את ניסיון היצירה. נסו שוב לאחר שחזור האחסון.');
      }
      await indexAttempt();
      context.assertOwner?.();
      return saved;
    }
    const prepared = await prepare();
    context.assertOwner?.();
    const record: Attempt<T, R> = {
      version: 1, uid: context.uid, kind: context.kind, draftId: context.draftId!,
      fingerprint, id: crypto.randomUUID(), prepared,
    };
    await AsyncStorage.setItem(key, JSON.stringify(record));
    await indexAttempt();
    context.assertOwner?.();
    return record;
  });
  context.assertOwner?.();
  if (attempt.completed) return attempt.completed.result;
  const result = await create(attempt.prepared!, attempt.id);
  context.assertOwner?.();
  const { prepared: _prepared, ...receipt } = attempt;
  await AsyncStorage.setItem(key, JSON.stringify({ ...receipt, completed: { result } }));
  context.assertOwner?.();
  return result;
}
