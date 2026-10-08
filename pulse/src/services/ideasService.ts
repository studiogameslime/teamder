// Ideas inbox — a backlog the owner jots down (free text + optional
// screenshots), stored in Firestore `pulseIdeas`. Each idea moves through
// three owner-controlled statuses:
//
//   idea  (רעיון)   — just captured, parked.
//   spec  (לאיפיון) — owner wants Claude to write a spec for it.
//   build (לביצוע)  — spec approved; ready to be built.
//   done  (בוצע)    — shipped. The list had no terminal state at all, so a
//                     built idea either sat among the open ones forever or had
//                     to be DELETED to get out of the way — losing the record
//                     of what was asked and why. It stays, greyed and last.
//
// Workflow: owner flips an idea to "spec" → Claude writes the spec and, once
// the owner approves it, records it on the idea via `setIdeaSpec` (shown under
// the idea). Owner then flips it to "build" (or just tells Claude to build).
//
// Images/spec are kept right on the doc (the dashboard service account has
// Firestore write but not Storage); images are downscaled before save so a
// handful stay under Firestore's ~1MB/doc limit.

import { has } from '../secrets';
import { listAll, patchDoc, deleteDoc } from './firestoreRest';
import { cached, invalidate } from './cache';
import { readClaude, type ClaudeCompletion } from './claudeWork';

export type IdeaStatus = 'idea' | 'spec' | 'build' | 'done';

export interface IdeaItem {
  id: string;
  text: string;
  images: string[]; // raw base64 JPEG (no data: prefix)
  status: IdeaStatus;
  spec?: string; // the characterization Claude records once approved
  createdAt: number; // ms epoch
  /** Claude's handover, when it marked this done (see ./claudeWork). */
  claude: ClaudeCompletion | null;
}

const COLL = 'pulseIdeas';
const STATUSES: IdeaStatus[] = ['idea', 'spec', 'build', 'done'];
// Surface what needs action first: ready-to-build, then to-spec, then parked.
const RANK: Record<IdeaStatus, number> = { build: 0, spec: 1, idea: 2, done: 3 };

export async function listIdeas(force = false): Promise<IdeaItem[]> {
  if (!has.firebase()) return [];
  return cached('pulseIdeas', listIdeasUncached, { force });
}

async function listIdeasUncached(): Promise<IdeaItem[]> {
  const docs = await listAll(COLL);
  return docs
    .map((d) => ({
      id: d.id,
      text: typeof d.text === 'string' ? d.text : '',
      images: Array.isArray(d.images)
        ? (d.images.filter((x: unknown) => typeof x === 'string') as string[])
        : [],
      status: STATUSES.includes(d.status as IdeaStatus)
        ? (d.status as IdeaStatus)
        : 'idea',
      spec: typeof d.spec === 'string' && d.spec ? d.spec : undefined,
      createdAt: Number(d.createdAt ?? 0),
      claude: readClaude(d),
    }))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || b.createdAt - a.createdAt);
}

export function createIdea(input: {
  text: string;
  images: string[];
  now: number; // pass Date.now() from the caller
}): Promise<boolean> {
  const rnd = Math.floor(input.now % 1e6).toString(36) + input.images.length;
  const id = `idea-${input.now}-${rnd}`;
  invalidate('pulseIdeas');
  return patchDoc(`${COLL}/${id}`, {
    text: input.text,
    images: input.images,
    status: 'idea',
    createdAt: input.now,
  });
}

export function setIdeaStatus(id: string, status: IdeaStatus): Promise<boolean> {
  invalidate('pulseIdeas');
  return patchDoc(`${COLL}/${id}`, { status });
}

/** Record (or update) the spec Claude wrote for an idea, once approved. */
export function setIdeaSpec(id: string, spec: string): Promise<boolean> {
  invalidate('pulseIdeas');
  return patchDoc(`${COLL}/${id}`, { spec });
}

export function deleteIdea(id: string): Promise<boolean> {
  invalidate('pulseIdeas');
  return deleteDoc(`${COLL}/${id}`);
}
