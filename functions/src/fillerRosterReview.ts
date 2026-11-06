import type { DocumentReference, Firestore, Timestamp } from 'firebase-admin/firestore';

type Roster = { players?: string[]; waitlist?: string[]; pending?: string[]; acceptsFillers?: boolean };
const members = (g: Roster) => new Set([...(g.players ?? []), ...(g.waitlist ?? []), ...(g.pending ?? [])]);

/** Resolve only applications that existed at the actual roster write.
 * Firestore events can arrive late, out of order or multiple times. */
export async function retireJoinedFillerRequests(db: Firestore, ref: DocumentReference, before: Roster, after: Roster, joinedAt: Timestamp) {
  if (!after.acceptsFillers && !before.acceptsFillers) return;
  const previous = members(before);
  const entered = [...members(after)].filter(uid => !previous.has(uid));
  await Promise.all(entered.map(uid => db.runTransaction(async tx => {
    const interest = await tx.get(ref.collection('fillerInterests').doc(uid));
    const updated = interest.updateTime;
    if (interest.get('status') === 'pending' && updated && (updated.seconds < joinedAt.seconds ||
      (updated.seconds === joinedAt.seconds && updated.nanoseconds <= joinedAt.nanoseconds))) {
      tx.update(interest.ref, { status: 'superseded', updatedAt: Date.now() });
    }
  })));
}
