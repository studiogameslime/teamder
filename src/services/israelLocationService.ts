// israelLocationService — autocomplete for Israeli cities and streets,
// backed by data.gov.il's CKAN-style datastore_search endpoint.
//
//   GET https://data.gov.il/api/action/datastore_search
//        ?resource_id=<id>&q=<query>&limit=<n>
//
// The cities resource_id is well-known and inlined below. The streets
// resource_id is provided via env so it can be swapped without a code
// change — at the time of writing the canonical streets dataset on
// data.gov.il is not yet pinned in this project.
//
//   EXPO_PUBLIC_ISRAEL_STREETS_RESOURCE_ID=<uuid>
//
// TODO(streets): set EXPO_PUBLIC_ISRAEL_STREETS_RESOURCE_ID once the
// correct dataset is identified. Common candidate: the "רחובות בישראל"
// table on data.gov.il. Until then `searchStreets` returns [] and the
// CreateGroupScreen falls back to free text typing for the street.
//
// Behaviour notes:
//   - Both functions resolve to [] on network failure or empty input — the
//     consumer must treat empty results as "no suggestions, use whatever
//     the user typed". Errors are logged in __DEV__ but not propagated, so
//     a flaky network never blocks form submission.
//   - Results are cached in memory keyed by query (+ city for streets);
//     cache survives until app restart. Good enough for a typing session.

const BASE_URL = 'https://data.gov.il/api/action/datastore_search';

const CITIES_RESOURCE_ID = 'b7cf8f14-64a2-4b33-8d4b-edb286fdbd37';
const STREETS_RESOURCE_ID = (
  process.env.EXPO_PUBLIC_ISRAEL_STREETS_RESOURCE_ID ?? ''
).trim();

/** Minimum characters before we issue a network request. */
export const MIN_AUTOCOMPLETE_CHARS = 2;

const cityCache = new Map<string, string[]>();
const streetCache = new Map<string, Map<string, string[]>>();

interface DatastoreResponse {
  success?: boolean;
  result?: {
    records?: Record<string, unknown>[];
  };
}

async function fetchRecords(
  resourceId: string,
  q: string,
  limit = 25
): Promise<Record<string, unknown>[]> {
  const url =
    `${BASE_URL}?resource_id=${encodeURIComponent(resourceId)}` +
    `&q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`data.gov.il responded ${res.status}`);
  const json = (await res.json()) as DatastoreResponse;
  return json?.result?.records ?? [];
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
export async function searchCities(query: string): Promise<string[]> {
  const q = query.trim();
  if (q.length < MIN_AUTOCOMPLETE_CHARS) return [];
  const cached = cityCache.get(q);
  if (cached) return cached;
  try {
    // CKAN's tsquery requires WHOLE-word matches: a query of "אור יהו"
    // returns 0 hits because "יהו" isn't a complete token of any
    // city's name. We work around this by sending only the longest
    // word to the server (which surfaces broad candidates) and then
    // filtering client-side, where every user-typed word must appear
    // as a *prefix* of some word in the city name. Result: typing
    // "אור יהו" still surfaces "אור יהודה".
    const userWords = q.split(/\s+/).filter((w) => w.length > 0);
    const longest = userWords.reduce(
      (a, b) => (b.length > a.length ? b : a),
      userWords[0] ?? '',
    );

    const records = await fetchRecords(CITIES_RESOURCE_ID, longest, 50);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const r of records) {
      const name = pickStringField(r, ['שם_ישוב', 'שם_ישוב_לועזי', 'name']);
      if (!name) continue;
      const nameWords = name.split(/\s+/).filter((w) => w.length > 0);
      const matchesAll = userWords.every((uw) =>
        nameWords.some((nw) => nw.startsWith(uw)),
      );
      if (!matchesAll) continue;
      uniquePush(out, seen, name);
    }
    cityCache.set(q, out);
    return out;
  } catch (err) {
    if (__DEV__) console.warn('[israelLocation] searchCities failed', err);
    return [];
  }
}

/**
 * Autocomplete street names within a previously selected city. The city
 * name is sent as a filter when supported; otherwise it's combined into
 * the free-text query so the dataset's full-text search narrows by city.
 *
 * Returns [] when EXPO_PUBLIC_ISRAEL_STREETS_RESOURCE_ID is not set or on
 * any error — the consumer must accept the user's typed value verbatim
 * in that case.
 */
export async function searchStreets(
  cityName: string,
  query: string
): Promise<string[]> {
  if (!STREETS_RESOURCE_ID) return [];
  const q = query.trim();
  if (q.length < MIN_AUTOCOMPLETE_CHARS) return [];
  const city = cityName.trim();
  if (!city) return [];

  let perCity = streetCache.get(city);
  if (perCity?.has(q)) return perCity.get(q)!;

  try {
    // CKAN's `q` matches only whole words, so we send the longest
    // user-typed token to the server (broad recall) and re-filter
    // client-side: city must match exactly, and every user-typed
    // word must appear as a *prefix* of some word in the street name.
    // This makes "אשכ" / "אשכול" / "נווה אש" all surface "נווה אשכול".
    const userWords = q.split(/\s+/).filter((w) => w.length > 0);
    const longest = userWords.reduce(
      (a, b) => (b.length > a.length ? b : a),
      userWords[0] ?? '',
    );

    const collect = (records: Record<string, unknown>[]): string[] => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (const r of records) {
        const recCity = pickStringField(r, ['שם_ישוב', 'city_name']);
        if (recCity !== city) continue;
        const street = pickStringField(r, ['שם_רחוב', 'street_name', 'name']);
        if (!street) continue;
        const streetWords = street.split(/\s+/).filter((w) => w.length > 0);
        const matchesAll = userWords.every((uw) =>
          streetWords.some((sw) => sw.startsWith(uw)),
        );
        if (!matchesAll) continue;
        uniquePush(out, seen, street);
      }
      return out;
    };

    // Pass 1: server-narrow on city + longest user word. Pass 2
    // (broad) widens the search if the precise pass returned little —
    // catches edge cases where the city tokens don't index cleanly.
    const combined = await fetchRecords(
      STREETS_RESOURCE_ID,
      `${city} ${longest}`,
      100,
    );
    let out = collect(combined);

    if (out.length < 5) {
      const broad = await fetchRecords(STREETS_RESOURCE_ID, longest, 200);
      const merged = new Set(out);
      for (const s of collect(broad)) merged.add(s);
      out = Array.from(merged);
    }

    if (!perCity) {
      perCity = new Map();
      streetCache.set(city, perCity);
    }
    perCity.set(q, out);
    return out;
  } catch (err) {
    if (__DEV__) console.warn('[israelLocation] searchStreets failed', err);
    return [];
  }
}

export const israelLocationService = {
  searchCities,
  searchStreets,
};
