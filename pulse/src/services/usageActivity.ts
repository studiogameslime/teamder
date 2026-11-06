import { pulseFetch as fetch } from './adminTransport';
import { googleAccessToken } from './auth';
import { config } from '../config';
import { parseFields, getDoc } from './firestoreRest';
import { recordRead } from './readMeter';
import type { UsageEvent } from './usageActivityCatalog';

export type UsageRow = UsageEvent & { id: string; uid: string; receivedAt: number; sortAt: number; source: 'app' | 'server'; registrationState?: string; labelSnapshot: string; labelStatus: string; timeQuality: string };
export type UsageVisit = { id: string; uid: string; visitId: string; startedAt: number; lastActivityAt: number; updatedAt: number; eventCount: number; screenEntries: number; distinctScreens: number; distinctGames: number; distinctGroups: number; confirmedRegistrations: number; waitlistRegistrations: number; partial: boolean; platform: string; appVersion: string };
export type UsageCursor = { values: Record<string, unknown>[]; readTime: string };
export type UsagePage<T> = { rows: T[]; cursor: UsageCursor | null; fetchedAt: number };
const base = () => `https://firestore.googleapis.com/v1/projects/${config.firebase.projectId}/databases/(default)/documents`;
const field = (fieldPath: string, op: string, value: unknown) => ({ fieldFilter: { field: { fieldPath }, op, value: typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value } } });

/** Server order plus a database snapshot cursor. Inserts/updates cannot move a later page. */
async function page<T>(collection: string, filters: unknown[], order: string, descending: boolean, size: number, cursor?: UsageCursor | null): Promise<UsagePage<T>> {
  const token = await googleAccessToken('https://www.googleapis.com/auth/datastore');
  const direction = descending ? 'DESCENDING' : 'ASCENDING';
  const response = await fetch(`${base()}:runQuery`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({
    ...(cursor ? { readTime: cursor.readTime } : {}), structuredQuery: {
      from: [{ collectionId: collection }], where: { compositeFilter: { op: 'AND', filters } },
      orderBy: [{ field: { fieldPath: order }, direction }, { field: { fieldPath: '__name__' }, direction }],
      ...(cursor ? { startAt: { values: cursor.values, before: false } } : {}), limit: size + 1,
    },
  }) });
  if (!response.ok) throw new Error(`USAGE_READ_FAILED_${response.status}`);
  const raw = await response.json() as Array<{ document?: { name: string; fields: Record<string, any> }; readTime?: string }>;
  const docs = raw.filter(row => row.document).map(row => row.document!);
  recordRead(collection, Math.max(1, docs.length));
  const shown = docs.slice(0, size), last = shown[shown.length - 1];
  const readTime = cursor?.readTime ?? raw.reduce<string | undefined>((latest, row) => row.readTime ?? latest, undefined);
  if (!readTime) throw new Error('USAGE_SNAPSHOT_MISSING');
  return { rows: shown.map(doc => ({ ...parseFields(doc.fields), id: doc.name.split('/').pop()! }) as T), fetchedAt: Date.now(),
    cursor: docs.length > size && last ? { values: [last.fields[order], { referenceValue: last.name }], readTime } : null };
}
export function fetchUsageVisits(uid: string, cutoff: number, cursor?: UsageCursor | null) {
  return page<UsageVisit>('usageSessions', [field('uid', 'EQUAL', uid), field('lastActivityAt', 'GREATER_THAN_OR_EQUAL', cutoff)], 'lastActivityAt', true, 20, cursor);
}
export function fetchUsageEvents(uid: string, visitId: string, cursor?: UsageCursor | null) {
  return page<UsageRow>('usageActivity', [field('uid', 'EQUAL', uid), field('visitId', 'EQUAL', visitId)], 'sequence', false, 50, cursor);
}
export async function fetchUsageCoverage(uid: string): Promise<{ enabled: boolean | null; lastReceivedAt?: number; appVersion?: string }> {
  const doc = await getDoc(`usageCoverage/${encodeURIComponent(uid)}`);
  return doc ? { enabled: typeof doc.enabled === 'boolean' ? doc.enabled : null, lastReceivedAt: doc.lastReceivedAt, appVersion: doc.appVersion } : { enabled: null };
}
/** Jerusalem calendar day even when Pulse runs on a device in another time zone. */
export function usageCutoff(period: string, now = Date.now()): number {
  if (period === 'week') return now - 7 * 86400000;
  if (period === 'month') return now - 30 * 86400000;
  if (period === 'quarter') return now - 90 * 86400000;
  const parts = (at: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const p = Object.fromEntries(parts(now).map(v => [v.type, v.value]));
  const date = Date.UTC(+p.year, +p.month - 1, +p.day);
  let guess = date;
  for (let i = 0; i < 3; i++) {
    const local = Object.fromEntries(parts(guess).map(v => [v.type, v.value]));
    guess += date - Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second);
  }
  return guess;
}
export function usageTime(at: number, full = false): string {
  return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', ...(full ? { day: '2-digit', month: '2-digit' } : {}), hour: '2-digit', minute: '2-digit' }).format(at);
}
