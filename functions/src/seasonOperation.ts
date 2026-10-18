import * as admin from 'firebase-admin';
import { HttpsError } from 'firebase-functions/v2/https';
import { randomUUID } from 'node:crypto';

/** Serialises lifecycle mutations; pendingClose already blocks starts in the deployed rules. */
export async function acquireSeasonOperation(
  db: admin.firestore.Firestore,
  ref: admin.firestore.DocumentReference,
  expected: unknown,
  kind: string,
  intent?: unknown,
): Promise<{ token: string; markMutating: () => Promise<void>; finish: (succeeded: boolean) => Promise<void> }> {
  const token = randomUUID();
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v);
  const intentKey = canonical(intent ?? null);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const sea = snap.get('seasons') ?? {};
    if (sea.operation?.until > Date.now() || (sea.operation?.failed && sea.operation.kind !== kind)) throw new HttpsError('failed-precondition', 'season-operation:busy');
    if (sea.operation?.phase && sea.operation.kind !== kind) throw new HttpsError('failed-precondition', 'season-operation:busy');
    if (sea.operation?.phase && sea.operation.intent !== intentKey) throw new HttpsError('failed-precondition', 'season-operation:stale');
    // A stale request may not alter a newer season or target.
    const clean = (x: unknown) => { const v = { ...(x as object ?? {}) } as Record<string, unknown>; delete v.operation; return canonical(v); };
    if (clean(sea) !== clean(expected)) throw new HttpsError('failed-precondition', 'season-operation:stale');
    const at = Date.now();
    tx.set(ref, { seasons: {
      operation: { token, kind, until: at + 20 * 60 * 1000, phase: sea.operation?.phase === true, failed: false, intent: intentKey },
      pendingClose: sea.pendingClose ?? { seasonId: sea.currentId ?? 'activation', dueAt: at, closeAt: at, reason: 'rounds' },
    } }, { merge: true });
  });
  return { token, markMutating: async () => {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get('seasons.operation.token') !== token) throw new HttpsError('failed-precondition', 'season-operation:stale');
      tx.set(ref, { seasons: { operation: { phase: true } } }, { merge: true });
    });
  }, finish: async (succeeded) => {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get('seasons.operation.token') !== token) return;
      const sea = snap.get('seasons') ?? {};
      const interrupted = !succeeded && sea.operation?.phase === true;
      const patch: Record<string, unknown> = { operation: interrupted
        ? { ...sea.operation, token, kind, until: 0, failed: true }
        : admin.firestore.FieldValue.delete() };
      if (interrupted) {
        tx.set(ref, { seasons: patch }, { merge: true });
        return;
      }
      // If the action did not replace/delete the temporary window, restore it.
      const p = snap.get('seasons.pendingClose');
      if (p && p.dueAt === p.closeAt) patch.pendingClose = admin.firestore.FieldValue.delete();
      tx.set(ref, { seasons: patch }, { merge: true });
    });
  } };
}
