// Feature/bug inbox — ideas the owner jots down (free text + screenshots),
// stored in Firestore `pulseFeatures`. Claude reads this collection on
// demand, implements each open item, and flips its status to 'done'.
//
// Images are kept as compressed base64 right on the doc (the dashboard's
// service account has Firestore write but NOT Storage, so this avoids a
// Storage dependency). Each image is downscaled before save, so a handful
// fit comfortably under Firestore's ~1MB/doc limit.

import { has } from '../secrets';
import { listAll, patchDoc, deleteDoc } from './firestoreRest';
import { cached, invalidate } from './cache';
import { readClaude, type ClaudeCompletion } from './claudeWork';

export type FeatureKind = 'feature' | 'bug';
export type FeatureStatus = 'new' | 'in-progress' | 'done';

export interface FeatureItem {
  id: string;
  kind: FeatureKind;
  text: string;
  status: FeatureStatus;
  images: string[]; // raw base64 JPEG (no data: prefix)
  createdAt: number; // ms epoch
  /** Claude's handover, when it marked this done (see ./claudeWork). */
  claude: ClaudeCompletion | null;
}

const COLL = 'pulseFeatures';
const STATUSES: FeatureStatus[] = ['new', 'in-progress', 'done'];

export async function listFeatures(force = false): Promise<FeatureItem[]> {
  if (!has.firebase()) return [];
  return cached('pulseFeatures', listFeaturesUncached, { force });
}

async function listFeaturesUncached(): Promise<FeatureItem[]> {
  const docs = await listAll(COLL);
  return docs
    .map((d) => ({
      id: d.id,
      kind: (d.kind === 'bug' ? 'bug' : 'feature') as FeatureKind,
      text: typeof d.text === 'string' ? d.text : '',
      status: STATUSES.includes(d.status as FeatureStatus)
        ? (d.status as FeatureStatus)
        : 'new',
      images: Array.isArray(d.images)
        ? (d.images.filter((x: unknown) => typeof x === 'string') as string[])
        : [],
      createdAt: Number(d.createdAt ?? 0),
      claude: readClaude(d),
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function createFeature(input: {
  kind: FeatureKind;
  text: string;
  images: string[];
  now: number; // pass Date.now() from the caller
}): Promise<boolean> {
  const rnd = Math.floor(input.now % 1e6).toString(36) + input.images.length;
  const id = `feat-${input.now}-${rnd}`;
  invalidate('pulseFeatures');
  return patchDoc(`${COLL}/${id}`, {
    kind: input.kind,
    text: input.text,
    status: 'new',
    images: input.images,
    createdAt: input.now,
  });
}

export function setFeatureStatus(
  id: string,
  status: FeatureStatus,
): Promise<boolean> {
  invalidate('pulseFeatures');
  return patchDoc(`${COLL}/${id}`, { status });
}

export function deleteFeature(id: string): Promise<boolean> {
  invalidate('pulseFeatures');
  return deleteDoc(`${COLL}/${id}`);
}
