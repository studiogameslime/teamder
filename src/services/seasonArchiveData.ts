import { doc, getDoc, type Firestore } from 'firebase/firestore';
import { mapConcurrent } from '@/utils/mapConcurrent';

/** A missing page is a failed read, never a partially correct lifetime total. */
export async function readSeasonArchiveData(db: Firestore, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ids = Array.isArray(data.pairPages) ? data.pairPages : [];
  const pairs = { ...(data.pairs as Record<string, unknown> ?? {}) };
  if (ids.some(id => typeof id !== 'string')) throw new Error('Invalid season pair page');
  const pages = await mapConcurrent(ids, 4, async (id) => {
    const page = await getDoc(doc(db, 'seasonSummary', id));
    const row = page.data();
    if (!row || row.groupId !== data.groupId || row.seasonId !== data.seasonId) throw new Error('Missing season pair page');
    return row.pairs ?? {};
  });
  for (const page of pages) Object.assign(pairs, page);
  return { ...data, pairs };
}
