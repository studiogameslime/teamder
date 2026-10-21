import { observeCaughtError } from './errorObservation';
// qaService — "משתמשי QA": the people who actually report (authors of the
// `feedback` collection). For each we roll up their reports + the errors
// attributed to them (errors.lastUserId), so tapping a QA user shows
// everything they hit.

import { listReports, type ReportItem } from './reportsService';
import { fetchErrors } from './errorsService';
import type { ErrorRecord } from '../types';

export interface QaUser {
  userId: string;
  userName: string;
  reports: number;
  openReports: number;
  errors: number;
  openErrors: number;
  lastAt: number;
}

export interface QaUserActivity {
  reports: ReportItem[];
  errors: ErrorRecord[];
}

/** Distinct reporters, each with report + error tallies. Most-pending first. */
export async function listQaUsers(): Promise<QaUser[]> {
  const [reports, errors] = await Promise.all([
    listReports().catch((caughtError8861c530f2: unknown) => { observeCaughtError(caughtError8861c530f2, {"source":"pulse/src/services/qaService.ts","handler":"listQaUsers","site":"qaService:8861c530f2"}); return [] as ReportItem[]; }),
    fetchErrors().catch((caughtError3e9fd48317: unknown) => { observeCaughtError(caughtError3e9fd48317, {"source":"pulse/src/services/qaService.ts","handler":"listQaUsers","site":"qaService:3e9fd48317"}); return [] as ErrorRecord[]; }),
  ]);

  const errByUser = new Map<string, { total: number; open: number }>();
  for (const e of errors) {
    if (!e.userId) continue;
    const m = errByUser.get(e.userId) ?? { total: 0, open: 0 };
    m.total += 1;
    if (e.status !== 'resolved') m.open += 1;
    errByUser.set(e.userId, m);
  }

  const map = new Map<string, QaUser>();
  for (const r of reports) {
    const id = r.userId || r.userName;
    if (!id) continue;
    let u = map.get(id);
    if (!u) {
      u = {
        userId: r.userId || id,
        userName: r.userName || 'משתמש',
        reports: 0,
        openReports: 0,
        errors: 0,
        openErrors: 0,
        lastAt: 0,
      };
      map.set(id, u);
    }
    u.reports += 1;
    if (r.status !== 'done') u.openReports += 1;
    u.lastAt = Math.max(u.lastAt, r.createdAt);
  }

  for (const u of map.values()) {
    const em = errByUser.get(u.userId);
    if (em) {
      u.errors = em.total;
      u.openErrors = em.open;
    }
  }

  return [...map.values()].sort(
    (a, b) =>
      b.openReports + b.openErrors - (a.openReports + a.openErrors) ||
      b.lastAt - a.lastAt,
  );
}

/** All reports + errors for one user, newest first. */
export async function userActivity(userId: string): Promise<QaUserActivity> {
  const [reports, errors] = await Promise.all([
    listReports().catch((caughtError53b3e74deb: unknown) => { observeCaughtError(caughtError53b3e74deb, {"source":"pulse/src/services/qaService.ts","handler":"userActivity","site":"qaService:53b3e74deb"}); return [] as ReportItem[]; }),
    fetchErrors().catch((caughtError142c2c4626: unknown) => { observeCaughtError(caughtError142c2c4626, {"source":"pulse/src/services/qaService.ts","handler":"userActivity","site":"qaService:142c2c4626"}); return [] as ErrorRecord[]; }),
  ]);
  return {
    reports: reports.filter((r) => r.userId === userId),
    errors: errors.filter((e) => e.userId === userId),
  };
}
