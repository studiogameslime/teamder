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

export async function searchPlaces(query: string, maxResults = 8): Promise<GovmapPlace[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const res = await fetch(AUTOCOMPLETE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ searchText: q, language: 'he', isAccurate: false, maxResults }),
    });
    if (!res.ok) throw new Error(`govmap autocomplete ${res.status}`);
    const json = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const out: GovmapPlace[] = [];
    for (const r of json.results ?? []) {
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
  } catch (err) {
    if (!isExpectedDenial(err)) logError('govmapSearch', err, { query: q });
    return []; // graceful: the field still works as free text
  }
}

// Coordinates for a label the user selected from a previous searchPlaces call.
export function coordsForLabel(label: string): { lat: number; lng: number } | null {
  const p = lastResults.get(label);
  return p ? { lat: p.lat, lng: p.lng } : null;
}
