import * as admin from 'firebase-admin';

/** Recoverable publication. Called only after lifecycle advance; title keys
 * and notification keys are deterministic, so retry cannot duplicate them. */
export async function publishSeason(db: admin.firestore.Firestore, groupId: string, seasonId: string): Promise<boolean> {
  const ref = db.collection('seasonSummary').doc(`${groupId}__${seasonId}`), snap = await ref.get();
  if (!snap.exists || !snap.get('zeroedAt') || snap.get('nonSeason')) return false;
  const club = await db.collection('groups').doc(groupId).get();
  if (club.get('seasons.currentId') === seasonId || (club.get('seasons.count') ?? 0) < snap.get('no')) return false;
  const data = snap.data()!;
  let batch = db.batch(), ops = 0;
  for (const [titleKey, award] of Object.entries(data.awards ?? {}) as [string, { winners: string[]; value: number; valueUnit?: 'percent' } | null][]) {
    if (!award) continue;
    for (const winner of award.winners) for (const uid of winner.split('__')) {
      if (!uid || uid.startsWith('guest:')) continue;
      batch.set(db.doc(`users/${uid}/seasonTitles/${groupId}__${seasonId}__${titleKey}`), {
        groupId, groupName: data.groupName ?? '', seasonId, seasonNo: data.no, titleKey, value: award.value, ...(award.valueUnit === 'percent' ? { valueUnit: 'percent' } : {}), at: data.endsAt,
      }, { merge: true });
      if (++ops === 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
  }
  if (ops) await batch.commit();
  const final = db.batch();
  final.update(ref, { publicationPending: false });
  final.set(db.doc(`seasonCards/${groupId}__${seasonId}`), { publicationPending: false }, { merge: true });
  await final.commit();
  return true;
}
