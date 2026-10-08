// Release log — the single source of truth for "what was fixed / added and
// in which version". Stored in Firestore at appConfig/releaseLog so it can be
// updated without rebuilding Pulse. The "גרסאות" screen joins this editorial
// changelog with the LIVE store states (App Store Connect + Google Play).
//
// Shape of appConfig/releaseLog:
//   {
//     items:    [ { title, kind: 'fix'|'feature', version: '1.0.5' | 'next' }, ... ],
//     versions: { '1.0.4': { releasedAt: <ms> }, '1.0.5': { releasedAt: null }, ... }
//   }
// Every fix/feature gets one item; `version: 'next'` means done but not yet
// shipped (waiting for the next build).

import { getDoc } from './firestoreRest';

export type ItemKind = 'fix' | 'feature';
export const PENDING = 'next';

export interface ReleaseItem {
  title: string;
  kind: ItemKind;
  version: string; // '1.0.5' | 'next'
  area?: string; // topic / screen group, e.g. 'תצוגה (RTL)', 'משחק חי'
  /** Optional proof screenshot — id of a doc in `releaseShots`. Attached
   *  only to upcoming ('next') items and cleared on release. */
  shotId?: string;
}

export const DEFAULT_AREA = 'כללי';

export interface ReleaseLog {
  items: ReleaseItem[];
  versions: Record<string, { releasedAt?: number; submittedAt?: number }>;
}

export async function fetchReleaseLog(): Promise<ReleaseLog> {
  const doc = await getDoc('appConfig/releaseLog').catch(() => null);
  const items: ReleaseItem[] = Array.isArray(doc?.items)
    ? (doc!.items as any[]).map((i) => ({
        title: String(i.title ?? ''),
        kind: i.kind === 'feature' ? 'feature' : 'fix',
        version: String(i.version ?? PENDING),
        area: i.area ? String(i.area) : undefined,
        shotId: i.shotId ? String(i.shotId) : undefined,
      }))
    : [];
  const versions =
    doc?.versions && typeof doc.versions === 'object'
      ? (doc.versions as Record<string, { releasedAt?: number; submittedAt?: number }>)
      : {};
  return { items, versions };
}

/** A proof screenshot stored as a raw base64 JPEG in `releaseShots/{id}`,
 *  mirroring how pulseFeatures stores its images (no Storage bucket needed).
 *  Returns the base64 string, or null when missing. */
export async function fetchReleaseShot(id: string): Promise<string | null> {
  const doc = await getDoc(`releaseShots/${id}`).catch(() => null);
  const b64 = doc?.b64;
  return typeof b64 === 'string' && b64.length > 0 ? b64 : null;
}

// ── store state → friendly Hebrew ──
export interface StatusHe {
  he: string;
  live: boolean; // currently available to download
  inReview: boolean; // sitting in the store's review queue
}

export function appleStateHe(state: string): StatusHe {
  switch (state) {
    case 'READY_FOR_SALE':
      return { he: 'באוויר', live: true, inReview: false };
    case 'PENDING_DEVELOPER_RELEASE':
      return { he: 'אושרה — ממתינה לשחרור', live: false, inReview: false };
    case 'IN_REVIEW':
      return { he: 'בבדיקה', live: false, inReview: true };
    case 'WAITING_FOR_REVIEW':
      return { he: 'ממתינה לבדיקה', live: false, inReview: true };
    case 'PROCESSING_FOR_APP_STORE':
      return { he: 'בעיבוד', live: false, inReview: true };
    case 'PREPARE_FOR_SUBMISSION':
      return { he: 'בהכנה', live: false, inReview: false };
    case 'DEVELOPER_REJECTED':
    case 'REJECTED':
      return { he: 'נדחתה', live: false, inReview: false };
    case 'METADATA_REJECTED':
      return { he: 'נדחתה — צריך לתקן פרטים', live: false, inReview: false };
    default:
      return { he: state || '—', live: false, inReview: false };
  }
}

export function playStatusHe(status: string): StatusHe {
  switch (status) {
    case 'completed':
      return { he: 'באוויר', live: true, inReview: false };
    case 'inProgress':
      return { he: 'באוויר (פריסה הדרגתית)', live: true, inReview: false };
    case 'halted':
      return { he: 'הופסקה', live: false, inReview: false };
    case 'draft':
      return { he: 'ממתינה לבדיקה', live: false, inReview: true };
    default:
      return { he: status || '—', live: false, inReview: false };
  }
}

// Items belonging to a specific version, features first.
export function itemsForVersion(log: ReleaseLog, version: string): ReleaseItem[] {
  return log.items
    .filter((i) => i.version === version)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'feature' ? -1 : 1));
}

export interface AreaGroup {
  area: string;
  items: ReleaseItem[];
}

// Group a version's items by their `area` (screen/topic), features first
// inside each group. Areas are ordered by first appearance.
export function itemsByArea(items: ReleaseItem[]): AreaGroup[] {
  const order: string[] = [];
  const map = new Map<string, ReleaseItem[]>();
  for (const it of items) {
    const a = it.area || DEFAULT_AREA;
    if (!map.has(a)) {
      map.set(a, []);
      order.push(a);
    }
    map.get(a)!.push(it);
  }
  return order.map((area) => ({
    area,
    items: map
      .get(area)!
      .slice()
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'feature' ? -1 : 1)),
  }));
}

export function dateHe(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// How long something has been pending, in friendly Hebrew ("3 ימים", "5 שעות").
export function durationHe(sinceMs?: number): string {
  if (!sinceMs) return '';
  const ms = Date.now() - sinceMs;
  if (ms < 0) return '';
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'פחות משעה';
  if (hours < 24) return hours === 1 ? 'שעה' : `${hours} שעות`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'יום' : `${days} ימים`;
}
