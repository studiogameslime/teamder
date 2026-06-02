// israelLocationService — autocomplete for Israeli city names, backed by
// data.gov.il's CKAN-style datastore_search endpoint.
//
//   GET https://data.gov.il/api/action/datastore_search
//        ?resource_id=<id>&q=<query>&limit=<n>
//
// Behaviour notes:
//   - searchCities resolves to [] on network failure or empty input — the
//     consumer must treat empty results as "no suggestions, use whatever
//     the user typed". Errors are logged in __DEV__ but not propagated, so
//     a flaky network never blocks form submission.
//   - Results are cached in memory keyed by query; cache survives until app
//     restart. Good enough for a typing session.

const BASE_URL = 'https://data.gov.il/api/action/datastore_search';

const CITIES_RESOURCE_ID = 'b7cf8f14-64a2-4b33-8d4b-edb286fdbd37';

/** Minimum characters before we issue a network request. */
export const MIN_AUTOCOMPLETE_CHARS = 2;

const cityCache = new Map<string, string[]>();

interface DatastoreResponse {
  success?: boolean;
  result?: {
    records?: Record<string, unknown>[];
  };
}

function pickStringField(
  record: Record<string, unknown>,
  candidates: readonly string[]
): string {
  for (const key of candidates) {
    const v = record[key];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return '';
}

function uniquePush(out: string[], seen: Set<string>, value: string) {
  if (!value) return;
  const key = value;
  if (seen.has(key)) return;
  seen.add(key);
  out.push(key);
}

/**
 * Autocomplete city names from data.gov.il.
 * Returns an empty array on failure or when query is shorter than the
 * minimum threshold — UI should fall back to letting the user type freely.
 */
// The cities dataset is small (~1,300 localities), so we fetch the full
// name list ONCE and filter client-side from then on. This fixes two
// problems with the old per-keystroke CKAN query:
//   1. Speed — typing no longer fires a network request on every
//      keystroke; after the first load, suggestions are instant.
//   2. Multi-word matches — CKAN's full-text search is WHOLE-WORD, so a
//      mid-typed token like "יהוד" returned nothing from the server and
//      "אור יהודה" looked broken (only "אור" or the complete "יהודה"
//      found it). With the full list in memory we prefix-match every
//      typed word against the city's words, so "אור יהוד" — and the
//      full "אור יהודה" — both surface "אור יהודה".
let allCities: string[] | null = null;
let allCitiesPromise: Promise<string[]> | null = null;

async function loadAllCities(): Promise<string[]> {
  if (allCities) return allCities;
  if (allCitiesPromise) return allCitiesPromise;
  allCitiesPromise = (async () => {
    const url =
      `${BASE_URL}?resource_id=${encodeURIComponent(CITIES_RESOURCE_ID)}` +
      `&limit=2000&fields=${encodeURIComponent('שם_ישוב')}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`data.gov.il responded ${res.status}`);
    const json = (await res.json()) as DatastoreResponse;
    const records = json?.result?.records ?? [];
    const names: string[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      uniquePush(
        names,
        seen,
        pickStringField(r, ['שם_ישוב', 'שם_ישוב_לועזי', 'name']),
      );
    }
    allCities = names;
    return names;
  })().catch((err) => {
    // Reset so a transient network failure can be retried next keystroke.
    allCitiesPromise = null;
    throw err;
  });
  return allCitiesPromise;
}

export async function searchCities(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < MIN_AUTOCOMPLETE_CHARS) return [];
  const cached = cityCache.get(q);
  if (cached) return cached;
  try {
    const all = await loadAllCities();
    const userWords = q.split(/\s+/).filter((w) => w.length > 0);
    const out: string[] = [];
    for (const name of all) {
      const nameWords = name.split(/\s+/).filter((w) => w.length > 0);
      // Every word the user typed must be a prefix of SOME word in the
      // city name (order-independent), so partial multi-word queries
      // still match.
      const matchesAll = userWords.every((uw) =>
        nameWords.some((nw) => nw.startsWith(uw)),
      );
      if (matchesAll) out.push(name);
    }
    // Rank: names that start with the full query first, then shortest.
    out.sort((a, b) => {
      const aStarts = a.startsWith(q) ? 0 : 1;
      const bStarts = b.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.length - b.length;
    });
    const limited = out.slice(0, 30);
    cityCache.set(q, limited);
    return limited;
  } catch (err) {
    if (__DEV__) console.warn('[israelLocation] searchCities failed', err);
    return [];
  }
}

export const israelLocationService = {
  searchCities,
};
