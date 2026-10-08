// Reads the Teamder app's `errors` collection (auto-captured failures /
// crashes / silent post-condition violations) AND the `feedback` collection
// (user-submitted bug reports + feature suggestions), and lets the dashboard
// triage them — all in one unified panel.

import { has } from '../secrets';
import type { ErrorRecord, ErrorStatus } from '../types';
import { listAll, patchDoc, type FsDoc } from './firestoreRest';
import { cached, invalidate } from './cache';

function mapError(d: FsDoc): ErrorRecord {
  return {
    id: d.id,
    operation: d.operation ?? 'unknown',
    title: (d.title as string) ?? undefined,
    category: (d.category as ErrorRecord['category']) ?? undefined,
    coll: 'errors',
    count: Number(d.count ?? 1),
    status: (d.status as ErrorStatus) ?? 'new',
    firstSeen: Number(d.firstSeen ?? 0),
    lastSeen: Number(d.lastSeen ?? 0),
    message: d.lastMessage ?? '',
    code: d.lastCode ?? undefined,
    stack: d.lastStack ?? undefined,
    context: (d.lastContext as Record<string, unknown>) ?? {},
    userId: d.lastUserId ?? undefined,
    screen: d.lastScreen ?? undefined,
    platform: d.platform ?? undefined,
    osVersion: d.osVersion ?? undefined,
    appVersion: d.appVersion ?? undefined,
  };
}

// A user-submitted feedback doc → the same ErrorRecord shape so it flows
// through the unified panel under its own category.
function mapFeedback(d: FsDoc): ErrorRecord {
  const type = d.type === 'suggestion' ? 'suggestion' : 'bug';
  const at = Number(d.createdAt ?? 0);
  return {
    id: d.id,
    operation: type === 'suggestion' ? 'userSuggestion' : 'userBugReport',
    title: undefined, // catalog derives a friendly title from category
    category: type === 'suggestion' ? 'suggestion' : 'report',
    coll: 'feedback',
    count: 1,
    status: (d.status as ErrorStatus) ?? 'new',
    firstSeen: at,
    lastSeen: at,
    message: d.message ?? '', // the user's own words — the main content
    context: {
      userName: d.userName ?? undefined,
      screen: d.screen ?? undefined,
    },
    userId: d.userId ?? undefined,
    screen: d.screen ?? undefined,
    platform: d.platform ?? undefined,
    appVersion: d.appVersion ?? undefined,
  };
}

function sortIssues(list: ErrorRecord[]): ErrorRecord[] {
  return list.sort((a, b) => {
    const rank = (s: ErrorStatus) => (s === 'resolved' ? 1 : 0);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return b.lastSeen - a.lastSeen;
  });
}

// Raw doc caches — each collection is read ONCE per TTL no matter how many
// derived views (errors list / unified issues / reports / QA users) ask for it.
export const rawErrors = (force = false) =>
  cached('raw:errors', () => listAll('errors'), { force });
export const rawFeedback = (force = false) =>
  cached('raw:feedback', () => listAll('feedback'), { force });

export async function fetchErrors(force = false): Promise<ErrorRecord[]> {
  if (!has.firebase()) return [];
  const docs = await rawErrors(force).catch(() => [] as FsDoc[]);
  return sortIssues(docs.map(mapError));
}

// Errors + user feedback, merged into one triage list.
export async function fetchIssues(force = false): Promise<ErrorRecord[]> {
  if (!has.firebase()) return [];
  const [errs, feedback] = await Promise.all([
    rawErrors(force).then((d) => d.map(mapError)).catch(() => [] as ErrorRecord[]),
    rawFeedback(force).then((d) => d.map(mapFeedback)).catch(() => [] as ErrorRecord[]),
  ]);
  return sortIssues([...errs, ...feedback]);
}

export async function setErrorStatus(
  id: string,
  status: ErrorStatus,
  coll: 'errors' | 'feedback' = 'errors',
): Promise<boolean> {
  const ok = await patchDoc(`${coll}/${id}`, { status });
  // Reflect the change without waiting for the TTL.
  invalidate(coll === 'errors' ? 'raw:errors' : 'raw:feedback');
  return ok;
}
