import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';

/** Existing queue entries belong to the first tap, even across devices. A
 * completed receipt can only be replaced after the player has actually left.
 * Rules allow a new create but never let a client update a receipt. */
export async function enqueueGameJoin(db: Firestore, gameId: string, uid: string, tappedAt: number) {
  const game = doc(db, 'games', gameId);
  const request = doc(game, 'joinRequests', uid);
  const entry = { uid, tappedAt, requestedAt: serverTimestamp(), state: 'queued' };
  const result = await runTransaction(db, async tx => {
    const receipt = await tx.get(request);
    if (!receipt.exists()) {
      tx.set(request, entry);
      return 'created' as const;
    }
    if (receipt.get('state') === 'queued') return 'listen' as const;
    const roster = await tx.get(game);
    for (const bucket of ['players', 'waitlist', 'pending'] as const) {
      if (roster.get(bucket)?.includes(uid)) return bucket;
    }
    tx.delete(request);
    return 'replace' as const;
  });
  if (result !== 'replace') return result;

  // The delete must commit before the create under the existing rules. If
  // another device won that create, listen to its receipt without changing it.
  return runTransaction(db, async tx => {
    if ((await tx.get(request)).exists()) return 'listen' as const;
    tx.set(request, entry);
    return 'created' as const;
  });
}
