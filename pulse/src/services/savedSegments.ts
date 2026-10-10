// Saved segment library. The admin builds a named segment once (filters
// + AND/OR), then reuses it when creating push / popup campaigns. Stored
// in `segments/{id}`; the campaign embeds a COPY of the def at send time
// so edits to a saved segment never retroactively change a sent campaign.

import { patchDoc, listAll, deleteDoc, type FsDoc } from './firestoreRest';
import type { SegmentDef } from './segments';
import { cached, invalidate } from './cache';

export interface SavedSegment {
  id: string;
  name: string;
  def: SegmentDef;
  audience?: number; // last computed count (cached for display)
  createdAt: number;
}

export async function createSegment(name: string, def: SegmentDef, audience?: number): Promise<boolean> {
  const id = `seg_${Date.now()}_${Math.floor(Math.random() * 9000 + 1000)}`;
  invalidate('segments');
  return patchDoc(`segments/${id}`, {
    name,
    combinator: def.combinator,
    rules: def.rules,
    ...(audience != null ? { audience } : {}),
    createdAt: Date.now(),
  });
}

export async function deleteSegment(id: string): Promise<boolean> {
  invalidate('segments');
  return deleteDoc(`segments/${id}`);
}

export async function listSegments(force = false): Promise<SavedSegment[]> {
  return cached('segments', listSegmentsUncached, { force });
}

async function listSegmentsUncached(): Promise<SavedSegment[]> {
  const docs = await listAll('segments');
  return docs
    .map((d: FsDoc) => ({
      id: d.id,
      name: String(d.name ?? 'ללא שם'),
      def: {
        combinator: d.combinator === 'any' ? 'any' : 'all',
        rules: Array.isArray(d.rules) ? d.rules : [],
      } as SegmentDef,
      audience: d.audience != null ? Number(d.audience) : undefined,
      createdAt: Number(d.createdAt ?? 0),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
