import * as admin from 'firebase-admin';

/** Extra pair pages use the existing archive collection and its existing access policy. */
export async function readArchiveData(
  db: admin.firestore.Firestore,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const ids = Array.isArray(data.pairPages) ? data.pairPages : [];
  const pairs = { ...(data.pairs as Record<string, unknown> ?? {}) };
  for (const id of ids) {
    if (typeof id !== 'string') throw new Error('Invalid season pair page');
    const page = await db.collection('seasonSummary').doc(id).get();
    if (!page.exists || page.get('groupId') !== data.groupId || page.get('seasonId') !== data.seasonId) {
      throw new Error('Missing season pair page');
    }
    Object.assign(pairs, page.get('pairs') ?? {});
  }
  return { ...data, pairs };
}
