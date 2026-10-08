// reportsService — user-authored bug reports / suggestions from the app's
// `feedback` collection, INCLUDING the screenshot the user attached (the
// screenshot-to-report flow writes a base64 `image` field). Read + status +
// delete, via the same datastore.user service-account token as everything
// else (bypasses rules).

import { patchDoc, deleteDoc, type FsDoc } from './firestoreRest';
import { screenHe } from './screenNames';
import { invalidate } from './cache';
import { rawFeedback } from './errorsService';

export type ReportType = 'bug' | 'suggestion';
export type ReportStatus = 'new' | 'reviewed' | 'done';

export interface ReportItem {
  id: string;
  type: ReportType;
  message: string;
  userName: string;
  userId: string;
  screen?: string;
  appVersion?: string;
  platform?: string;
  /** Base64 JPEG screenshot (no data: prefix), when the user attached one. */
  image?: string;
  createdAt: number;
  status: ReportStatus;
  /** Owner flagged this report for Claude to fix (processed on command). */
  fixRequested: boolean;
}

/** A rolled-up bucket of reports (by reporter OR by screen). */
export interface ReportGroup {
  key: string;
  label: string;
  reports: ReportItem[];
  total: number;
  fixed: number; // status === 'done'
  fixRequested: number;
}

const STATUSES: ReportStatus[] = ['new', 'reviewed', 'done'];

export async function listReports(force = false): Promise<ReportItem[]> {
  const docs = await rawFeedback(force).catch(() => [] as FsDoc[]);
  return docs
    .map((d): ReportItem => ({
      id: d.id,
      type: d.type === 'suggestion' ? 'suggestion' : 'bug',
      message: String(d.message ?? ''),
      userName: String(d.userName ?? ''),
      userId: String(d.userId ?? ''),
      screen: d.screen ? String(d.screen) : undefined,
      appVersion: d.appVersion ? String(d.appVersion) : undefined,
      platform: d.platform ? String(d.platform) : undefined,
      image:
        typeof d.image === 'string' && d.image.length > 0 ? d.image : undefined,
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
      status: STATUSES.includes(d.status as ReportStatus)
        ? (d.status as ReportStatus)
        : 'new',
      fixRequested: d.fixRequested === true,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function groupBy(
  items: ReportItem[],
  keyOf: (r: ReportItem) => string,
  labelOf: (r: ReportItem) => string,
): ReportGroup[] {
  const map = new Map<string, ReportGroup>();
  for (const r of items) {
    const key = keyOf(r);
    let g = map.get(key);
    if (!g) {
      g = { key, label: labelOf(r), reports: [], total: 0, fixed: 0, fixRequested: 0 };
      map.set(key, g);
    }
    g.reports.push(r);
    g.total += 1;
    if (r.status === 'done') g.fixed += 1;
    if (r.fixRequested && r.status !== 'done') g.fixRequested += 1;
  }
  // Most-pending / most-active buckets first.
  return [...map.values()].sort(
    (a, b) => b.fixRequested - a.fixRequested || b.total - a.total,
  );
}

/** Group reports by reporter, with per-user fixed/total/flagged counts. */
export function groupByReporter(items: ReportItem[]): ReportGroup[] {
  return groupBy(
    items,
    (r) => r.userId || r.userName || 'unknown',
    (r) => r.userName || 'משתמש',
  );
}

/** Group reports by the screen they were sent from. */
export function groupByScreen(items: ReportItem[]): ReportGroup[] {
  return groupBy(
    items,
    (r) => r.screen || '—',
    (r) => screenHe(r.screen),
  );
}

export async function setReportStatus(
  id: string,
  status: ReportStatus,
): Promise<boolean> {
  invalidate('raw:feedback'); // feeds reports, the unified issues list, and QA
  return patchDoc(`feedback/${id}`, { status });
}

export async function setReportFixRequested(
  id: string,
  fixRequested: boolean,
): Promise<boolean> {
  invalidate('raw:feedback');
  return patchDoc(`feedback/${id}`, { fixRequested });
}

export async function deleteReport(id: string): Promise<boolean> {
  invalidate('raw:feedback');
  return deleteDoc(`feedback/${id}`);
}
