import { FieldValue } from 'firebase-admin/firestore';
import type { Firestore, DocumentReference, DocumentData } from 'firebase-admin/firestore';

const PAGE_SIZE = 200;
const alive = (data: DocumentData | undefined) => !!data && !data.deletedAt;

/** Stop orphaned series even when their next scheduled occurrence is far away. */
export async function stopOrphanSeries(db: Firestore, seriesRef: DocumentReference, groupId: string, now: number): Promise<boolean> {
  const orphaned = await db.runTransaction(async tx => {
    const [club, series] = await Promise.all([tx.get(db.doc(`groups/${groupId}`)), tx.get(seriesRef)]);
    if (series.exists && series.data()?.groupId !== groupId) return false;
    if (alive(club.data())) return false;
    return true;
  });
  if (orphaned) await cancelDeletedClubActivity(db, groupId, now);
  return orphaned;
}

/** A transactional club read prevents a concurrent deletion from creating a new round. */
export async function createSeriesOccurrence(db: Firestore, seriesRef: DocumentReference, game: DocumentData, now: number, expectedAnchor: number): Promise<boolean> {
  return db.runTransaction(async tx => {
    const [club, series] = await Promise.all([tx.get(db.doc(`groups/${game.groupId}`)), tx.get(seriesRef)]);
    if (!series.exists || series.data()?.active !== true || series.data()?.groupId !== game.groupId) return false;
    if (!alive(club.data())) {
      tx.update(seriesRef, { active: false, updatedAt: now });
      return false;
    }
    // A stale worker must not recreate an occurrence deleted after another
    // worker already advanced the series, nor undo a manual anchor adjustment.
    if (series.data()?.lastOccurrenceAt !== expectedAnchor) return false;
    // Recognise existing occurrences with either random or deterministic IDs.
    const existing = await tx.get(db.collection('games').where('seriesId', '==', seriesRef.id).where('startsAt', '==', game.startsAt).limit(1));
    if (existing.empty) tx.create(db.collection('games').doc(`${seriesRef.id}_${game.startsAt}`), game);
    tx.update(seriesRef, { lastOccurrenceAt: game.startsAt });
    return existing.empty;
  });
}

export async function createLegacyOccurrence(db: Firestore, source: DocumentReference, target: DocumentReference, game: DocumentData, now: number): Promise<'created' | 'exists' | 'stopped'> {
  return db.runTransaction(async tx => {
    const [club, previous, next] = await Promise.all([
      typeof game.groupId === 'string' && game.groupId ? tx.get(db.doc(`groups/${game.groupId}`)) : Promise.resolve(undefined),
      tx.get(source), tx.get(target),
    ]);
    if (!previous.exists || previous.data()?.recurring !== true || previous.data()?.status === 'cancelled') return 'stopped';
    if (!alive(club?.data())) {
      tx.update(source, { recurring: false, updatedAt: now });
      return 'stopped';
    }
    if (previous.data()?.recurringNextCreatedAt) return 'exists';
    if (!next.exists) tx.create(target, game);
    tx.update(source, { recurringNextCreatedAt: now, updatedAt: now });
    return next.exists ? 'exists' : 'created';
  });
}

/** Cancel operations and remove the public projection; retain rosters and archives. */
export async function cancelDeletedClubActivity(db: Firestore, groupId: string, now: number): Promise<void> {
  const club = await db.doc(`groups/${groupId}`).get();
  if (club.exists && !club.data()?.deletedAt) throw new Error('CLUB_DELETE_TARGET_EXISTS');
  // Page through all states without a status index and preserve finished evenings.
  let after: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = db.collection('games').where('groupId', '==', groupId).orderBy('__name__').limit(PAGE_SIZE);
    if (after) query = query.startAfter(after);
    const page = await query.get();
    // Re-read state transactionally so a finished evening is never overwritten.
    for (const doc of page.docs) await db.runTransaction(async tx => {
      const current = await tx.get(doc.ref);
      const data = current.data();
      if (!data) return;
      const patch: DocumentData = {};
      if (data.recurring === true) patch.recurring = false;
      if (data.status !== 'finished' && data.status !== 'cancelled') patch.status = 'cancelled';
      if (Object.keys(patch).length) tx.update(doc.ref, { ...patch, updatedAt: now });
    });
    if (page.size < PAGE_SIZE) break;
    after = page.docs[page.docs.length - 1];
  }
  // Pending membership and new-round subscriptions must no longer remain active.
  // Keep both the user documents and the request decision history.
  for (;;) {
    const page = await db.collection('groupJoinRequests').where('groupId', '==', groupId).where('status', '==', 'pending').limit(PAGE_SIZE).get();
    if (page.empty) break;
    const batch = db.batch();
    page.docs.forEach(doc => batch.update(doc.ref, { status: 'rejected', decidedAt: now, decidedBy: 'system:club-deleted' }));
    await batch.commit();
  }
  for (;;) {
    const page = await db.collection('users').where('newGameSubscriptions', 'array-contains', groupId).limit(PAGE_SIZE).get();
    if (page.empty) break;
    const batch = db.batch();
    page.docs.forEach(doc => batch.update(doc.ref, { newGameSubscriptions: FieldValue.arrayRemove(groupId) }));
    await batch.commit();
  }
  // The public discovery projection must disappear with its canonical club.
  // This is derived display data, not the historical statistics or game records.
  await db.doc(`communityShowcase/${groupId}`).delete();
  // Last step for legacy orphans: a failed cleanup remains in the active scan
  // for the next cron attempt. The transactional creation guards already block it.
  for (;;) {
    const page = await db.collection('gameSeries').where('groupId', '==', groupId).where('active', '==', true).limit(PAGE_SIZE).get();
    if (page.empty) break;
    const batch = db.batch();
    page.docs.forEach(doc => batch.update(doc.ref, { active: false, updatedAt: now }));
    await batch.commit();
  }
}
