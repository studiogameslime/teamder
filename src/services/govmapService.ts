// govmapService — address / POI autocomplete via govmap (מפ"י), the official
// Israeli mapping service. Free, no API key, and unlike a plain street geocoder
// it indexes NAMED places too (schools, community centres, parks) — which is
// where neighbourhood pitches actually are ("בית ספר רמון", not "הרצל 50").
//
// Each result carries coordinates, so selecting one gives an exact map pin
// with no separate (and for Hebrew, unreliable) geocoding step.

import { logError, isExpectedDenial } from '@/services/errorLog';

const AUTOCOMPLETE_URL = 'https://www.govmap.gov.il/api/search-service/autocomplete';

export interface GovmapPlace {
  label: string; // display text, e.g. "בית ספר - רמון רחובות"
  type: 'address' | 'street' | 'poi' | 'institutes' | string;
  lat: number;
  lng: number;
}

// govmap returns coordinates as WKT POINT in EPSG:3857 (Web Mercator).
function mercatorToLatLng(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / 20037508.34) * 180;
  let lat = (y / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return { lat, lng };
}

function parsePoint(shape: unknown): { lat: number; lng: number } | null {
  if (typeof shape !== 'string') return null;
  const m = shape.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return mercatorToLatLng(x, y);
}

// Most-recent results, keyed by label, so a string-based autocomplete can
// recover the coordinates of the item the user tapped.
const lastResults = new Map<string, GovmapPlace>();

/** Give up on a single attempt — govmap has no SLA and an unanswered request
 *  used to hang the autocomplete spinner indefinitely. */
const TIMEOUT_MS = 6000;
/** One short backoff before the single retry. */
const RETRY_DELAY_MS = 600;

export interface GovmapSearchResult {
  places: GovmapPlace[];
  /**
   * The service never answered — timeout, 5xx, or no network. NOT the same as
   * "answered, nothing matched", and the sheet says something different for
   * each: "no results, tap the map" is wrong and confusing advice when the
   * search itself is down.
   */
  unavailable: boolean;
}

/**
 * Their problem, not ours: upstream is overloaded, slow, or unreachable.
 *
 * govmap is a free public service with no uptime promise, and it does go down
 * — the production log took four `govmapSearch` errors in a minute, all 504,
 * for a search that was a typo anyway. Logging those as app errors buries real
 * failures under noise we can do nothing about. A 4xx or a malformed body is a
 * different matter: that means THEY changed and WE have to follow, so it is
 * still reported.
 */
export function isUpstreamDown(err: unknown): boolean {
  const e = err as { name?: string; message?: string; status?: number };
  if (e?.name === 'AbortError') return true; // our own timeout
  const msg = String(e?.message ?? '');
  // React Native's fetch reports a dead network as a plain TypeError.
  if (/network request failed|timeout|timed out/i.test(msg)) return true;
  const m = msg.match(/govmap autocomplete (\d{3})/);
  if (!m) return false;
  const status = Number(m[1]);
  return status >= 500 || status === 408 || status === 429;
}

async function fetchOnce(
  q: string,
  maxResults: number,
): Promise<Array<Record<string, unknown>>> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchText: q, language: 'he', isAccurate: false, maxResults }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`govmap autocomplete ${res.status}`);
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    return json.results ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function toPlaces(rows: Array<Record<string, unknown>>): GovmapPlace[] {
  const out: GovmapPlace[] = [];
  for (const r of rows) {
    const coords = parsePoint(r.shape);
    const label = typeof r.text === 'string' ? r.text : '';
    if (!coords || !label) continue;
    const place: GovmapPlace = {
      label,
      type: (typeof r.type === 'string' ? r.type : 'poi') as GovmapPlace['type'],
      lat: coords.lat,
      lng: coords.lng,
    };
    out.push(place);
    lastResults.set(label, place);
  }
  return out;
}

export async function searchPlaces(
  query: string,
  maxResults = 8,
): Promise<GovmapSearchResult> {
  const q = query.trim();
  if (q.length < 2) return { places: [], unavailable: false };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { places: toPlaces(await fetchOnce(q, maxResults)), unavailable: false };
    } catch (err) {
      if (isUpstreamDown(err)) {
        // One retry — a 504 from an overloaded public service is usually over
        // by the next request.
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
      } else if (!isExpectedDenial(err)) {
        logError('govmapSearch', err, { query: q });
      }
      // Graceful either way: the field still works as free text.
      return { places: [], unavailable: true };
    }
  }
  return { places: [], unavailable: true };
}

// Coordinates for a label the user selected from a previous searchPlaces call.
export function coordsForLabel(label: string): { lat: number; lng: number } | null {
  const p = lastResults.get(label);
  return p ? { lat: p.lat, lng: p.lng } : null;
}
