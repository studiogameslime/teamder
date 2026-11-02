import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

type Guard = { state?: 'open' | 'removing' | 'removed'; active?: Record<string, number>; operationId?: string };

/** No lease expiry: a crashed worker blocks administrative erasure until an
 * operator verifies it has stopped. Expiring a lock could admit an old writer. */
function readGuard(value: Guard | undefined): Guard {
  if (value && (!['open', 'removing', 'removed'].includes(value.state ?? '') ||
    !value.active || typeof value.active !== 'object' || Array.isArray(value.active) ||
    Object.values(value.active).some(at => typeof at !== 'number' || !Number.isFinite(at)))) {
    throw new Error('Invalid game processing guard');
  }
  return value ?? { state: 'open', active: {} };
}

export class GameProcessingBusyError extends Error {
  readonly code = 'game-processing-busy';
  constructor() { super('Game processing is still active; removal is blocked'); }
}

/** Read inside the caller's transaction, before any writes. The reservation
 * changes this same document, so an in-flight sync retries against the fence. */
export async function gameRemovalBlocksWrite(tx: Transaction, db: Firestore, gameId: string): Promise<boolean> {
  const snapshot = await tx.get(db.doc(`gameProcessingGuards/${gameId}`));
  return readGuard(snapshot.data() as Guard | undefined).state !== 'open';
}

/** Every non-delete roster event holds a lease for its entire execution.
 * Reserving removal and acquiring a lease serialize on the same document. */
export async function withGameProcessingGuard(db: Firestore, gameId: string, work: () => Promise<void>): Promise<void> {
  const game = db.doc(`games/${gameId}`), ref = db.doc(`gameProcessingGuards/${gameId}`);
  const token = randomUUID();
  const acquired = await db.runTransaction(async tx => {
    const [parent, snapshot] = await Promise.all([tx.get(game), tx.get(ref)]);
    const guard = readGuard(snapshot.data() as Guard | undefined);
    if (!parent.exists || guard.state !== 'open') return false;
    tx.set(ref, { ...guard, active: { ...guard.active, [token]: Date.now() } });
    return true;
  });
  if (!acquired) return;
  try { await work(); }
  finally {
    await db.runTransaction(async tx => {
      const guard = readGuard((await tx.get(ref)).data() as Guard | undefined);
      if (!Object.prototype.hasOwnProperty.call(guard.active, token)) throw new Error('Game processing lease disappeared');
      const active = { ...guard.active }; delete active[token];
      tx.update(ref, { active });
    });
  }
}

/** Administrative preparation only. The erasure commit must include this
 * reserved document with an updateTime precondition, changing state to removed.
 * Never delete this tombstone or any additive-stage idempotence markers. */
export async function reserveGameRemoval(db: Firestore, gameId: string, operationId: string): Promise<void> {
  if (!operationId.trim()) throw new Error('Removal operation id is required');
  const ref = db.doc(`gameProcessingGuards/${gameId}`);
  await db.runTransaction(async tx => {
    const [parent, snapshot, complete] = await Promise.all([
      tx.get(db.doc(`games/${gameId}`)), tx.get(ref), tx.get(db.doc(`games/${gameId}/finishStages/complete`)),
    ]);
    const guard = readGuard(snapshot.data() as Guard | undefined);
    if (!parent.exists) throw new Error('Game is missing; do not prepare another removal');
    if (parent.data()?.status !== 'finished' || !complete.exists) throw new Error('Only a fully settled finished game may be reserved for removal');
    if (Object.keys(guard.active ?? {}).length) throw new GameProcessingBusyError();
    if (guard.state !== 'open' && !(guard.state === 'removing' && guard.operationId === operationId)) {
      throw new Error('Game removal is already reserved by another operation');
    }
    tx.set(ref, { state: 'removing', active: {}, operationId });
  });
}
