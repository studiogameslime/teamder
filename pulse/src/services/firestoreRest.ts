// Firestore REST client (read-only). Uses the service-account OAuth token
// (datastore scope) to read the app's database directly from the device —
// bypasses security rules via IAM (roles/datastore.viewer). Bundled key, so
// this is fine for a personal dashboard.

import { config } from '../config';
import { googleAccessToken } from './auth';
import { recordRead } from './readMeter';

const SCOPE = 'https://www.googleapis.com/auth/datastore';

// First path segment = the collection the read hit (e.g. "users/abc" → "users").
const collOf = (path: string) => path.split('/')[0] || path;

function base(): string {
  return (
    `https://firestore.googleapis.com/v1/projects/` +
    `${config.firebase.projectId}/databases/(default)/documents`
  );
}

// ── Firestore REST value → plain JS ────────────────────────────────
export function parseValue(v: any): any {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return new Date(v.timestampValue).getTime();
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return parseFields(v.mapValue?.fields ?? {});
  if ('arrayValue' in v)
    return (v.arrayValue?.values ?? []).map(parseValue);
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  return null;
}

export function parseFields(fields: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(fields)) out[k] = parseValue(fields[k]);
  return out;
}

export interface FsDoc {
  id: string;
  [k: string]: any;
}

function parseDoc(doc: any): FsDoc {
  const id = String(doc.name ?? '').split('/').pop() ?? '';
  return { id, ...parseFields(doc.fields ?? {}) };
}

/**
 * List every document in a collection, following pagination.
 *
 * `fields` is a projection — pass the field paths you actually need and the
 * server sends only those. This matters far more than it sounds: Pulse stores
 * screenshots as base64 ON the documents (no Storage bucket), so a plain list
 * of `feedback` pulls ~25MB of JPEG that a list view never renders. Measured
 * across the five work-list collections: 34.8MB total, of which 33.6MB — 96% —
 * was image data. Projecting the images away is the difference between a
 * screen that takes ten seconds and one that takes half of one.
 *
 * Omit `fields` to get whole documents, which is what every existing caller
 * still does.
 */
export async function listAll(
  collection: string,
  maxDocs = 5000,
  fields?: readonly string[],
): Promise<FsDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const out: FsDoc[] = [];
  const mask = (fields ?? [])
    .map((f) => `&mask.fieldPaths=${encodeURIComponent(f)}`)
    .join('');
  let pageToken: string | undefined;
  do {
    const url =
      `${base()}/${collection}?pageSize=300${mask}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`Firestore ${collection} ${res.status}: ${await res.text()}`);
    }
    const json = await res.json();
    (json.documents ?? []).forEach((d: any) => out.push(parseDoc(d)));
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < maxDocs);
  recordRead(collection, Math.max(1, out.length));
  return out;
}

// Read a single document by path (e.g. "users/abc123").
export async function getDoc(path: string): Promise<FsDoc | null> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  recordRead(collOf(path), 1);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get ${path} ${res.status}`);
  return parseDoc(await res.json());
}

// Run a structured query with a single array-contains filter (auto-indexed).
export async function queryArrayContains(
  collection: string,
  field: string,
  value: string,
  limit = 200,
): Promise<FsDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'ARRAY_CONTAINS',
            value: { stringValue: value },
          },
        },
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore query ${collection} ${res.status}`);
  const arr: any[] = await res.json();
  const docs = arr.filter((x) => x.document).map((x) => parseDoc(x.document));
  recordRead(collection, Math.max(1, docs.length));
  return docs;
}

// Read only the docs where `field == value` — reads exactly the matches
// instead of the whole collection (the key saving for per-user lookups like
// "feedback by this user" or "users this person invited").
export async function queryEquals(
  collection: string,
  field: string,
  value: string,
  limit = 500,
): Promise<FsDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore eq ${collection}.${field} ${res.status}`);
  const arr: any[] = await res.json();
  const docs = arr.filter((x) => x.document).map((x) => parseDoc(x.document));
  recordRead(collection, Math.max(1, docs.length));
  return docs;
}

// Boolean variant of queryEquals — e.g. users where
// `availability.isAvailableForInvites == true`. Reads ONLY the matches, so the
// cost scales with the number of available users, not the whole collection.
export async function queryEqualsBool(
  collection: string,
  field: string,
  value: boolean,
  limit = 1000,
): Promise<FsDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: { booleanValue: value },
          },
        },
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore eqBool ${collection}.${field} ${res.status}`);
  const arr: any[] = await res.json();
  const docs = arr.filter((x) => x.document).map((x) => parseDoc(x.document));
  recordRead(collection, Math.max(1, docs.length));
  return docs;
}

// Encode a JS scalar into a Firestore REST typed Value.
function toValue(v: unknown): any {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    const fields: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val !== undefined) fields[k] = toValue(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// Patch specific fields on a doc (write — needs datastore.user IAM).
export async function patchDoc(
  path: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const token = await googleAccessToken(SCOPE);
  const keys = Object.keys(fields);
  const mask = keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const body = { fields: Object.fromEntries(keys.map((k) => [k, toValue(fields[k])])) };
  const res = await fetch(`${base()}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

// Delete a document by path (needs datastore.user IAM).
export async function deleteDoc(path: string): Promise<boolean> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

// Read only the docs whose `createdAt` falls in [startMs, endMs]. Reads
// exactly the matching documents instead of the whole collection — the key
// saving for short ranges (today/7d). `valueType` must match how the field
// is stored: games/groups/users use integer (ms), notifications use timestamp.
export async function queryByCreatedAt(
  collection: string,
  startMs: number,
  endMs: number,
  valueType: 'integer' | 'timestamp' = 'integer',
  limit = 12000,
): Promise<FsDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const mk = (ms: number) =>
    valueType === 'timestamp'
      ? { timestampValue: new Date(ms).toISOString() }
      : { integerValue: String(Math.floor(ms)) };
  const res = await fetch(`${base()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: mk(startMs) } },
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN_OR_EQUAL', value: mk(endMs) } },
            ],
          },
        },
        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
        limit,
      },
    }),
  });
  if (!res.ok) throw new Error(`Firestore range ${collection} ${res.status}: ${await res.text()}`);
  const arr: any[] = await res.json();
  const docs = arr.filter((x) => x.document).map((x) => parseDoc(x.document));
  recordRead(collection, Math.max(1, docs.length));
  return docs;
}

// A doc returned from a COLLECTION GROUP query — carries its full path so the
// caller can recover which parent (game/group) it lives under.
export interface FsGroupDoc extends FsDoc {
  /** Path under /documents, e.g. "games/{gameId}/messages/{msgId}". */
  _path: string;
  /** The immediate parent collection ("games" | "groups"). */
  _parentColl: string;
  /** The parent doc id (gameId | groupId). */
  _parentId: string;
}

// Most-recent docs from a COLLECTION GROUP (every subcollection named
// `collectionId`, anywhere in the tree), ordered by `orderField` DESC. Used to
// stream chat messages that live in /games/*/messages and /groups/*/messages
// without knowing every parent id. Needs the (auto-created) collection-group
// single-field index on `orderField`.
export async function queryGroupRecent(
  collectionId: string,
  orderField = 'createdAt',
  limit = 40,
): Promise<FsGroupDoc[]> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId, allDescendants: true }],
        orderBy: [{ field: { fieldPath: orderField }, direction: 'DESCENDING' }],
        limit,
      },
    }),
  });
  if (!res.ok)
    throw new Error(`Firestore group ${collectionId} ${res.status}: ${await res.text()}`);
  const arr: any[] = await res.json();
  const out = arr
    .filter((x) => x.document)
    .map((x) => {
      const doc = parseDoc(x.document);
      const path = String(x.document.name ?? '').split('/documents/')[1] ?? '';
      const segs = path.split('/');
      return {
        ...doc,
        _path: path,
        _parentColl: segs[0] ?? '',
        _parentId: segs[1] ?? '',
      };
    });
  recordRead(`${collectionId} (צ׳אט)`, Math.max(1, out.length));
  return out;
}

// Cheap server-side count via aggregation query (no full read).
export async function countCollection(collection: string): Promise<number> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runAggregationQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: collection }] },
        aggregations: [{ alias: 'c', count: {} }],
      },
    }),
  });
  if (!res.ok) return 0;
  const json = await res.json();
  // A count() aggregation bills 1 read per up-to-1000 index entries — cheap.
  recordRead(`${collection} (ספירה)`, 1);
  const v = json?.[0]?.result?.aggregateFields?.c;
  return v ? Number(v.integerValue ?? 0) : 0;
}

// count() with a single equality filter — e.g. how many docs have
// status=='resolved'. One read, regardless of collection size.
export async function countWhereEquals(
  collection: string,
  field: string,
  value: string,
): Promise<number> {
  const token = await googleAccessToken(SCOPE);
  const res = await fetch(`${base()}:runAggregationQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: {
          from: [{ collectionId: collection }],
          where: {
            fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: { stringValue: value } },
          },
        },
        aggregations: [{ alias: 'c', count: {} }],
      },
    }),
  });
  if (!res.ok) return 0;
  const json = await res.json();
  recordRead(`${collection} (ספירה)`, 1);
  const v = json?.[0]?.result?.aggregateFields?.c;
  return v ? Number(v.integerValue ?? 0) : 0;
}
