// geocodeService — client-side city → lat/lng lookup.
//
// Used by the AvailabilityEditScreen on save: when the user picks
// their home city from the autocomplete, we geocode it once and
// store the coords on the user doc so the CF matcher can compute
// distance to nearby games without re-resolving.
//
// Implementation notes:
//   • Nominatim (OpenStreetMap) over Open-Meteo's geocoder. The
//     latter has English/transliterated names only, while Nominatim
//     handles Hebrew (`קרית עקרון`, `אור יהודה`, etc.) cleanly.
//   • Restricted to country=il for speed + to avoid collisions with
//     same-named cities elsewhere.
//   • Nominatim policy: include a descriptive User-Agent and cap
//     calls to ≤1/sec. The user only saves their home city
//     occasionally, so the rate limit is a non-issue here.
//   • In-memory memo deduplicates repeated saves with the same
//     city in one app session. The CF caches independently in
//     /cityGeocode/{normName} — no need to share state with the
//     server.

import { logError } from './errorLog';
import { searchPlaces } from './govmapService';

const memo = new Map<string, { lat: number; lng: number } | null>();

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'Teamder/1.0 (studiogameslime@gmail.com)';

/**
 * Best-effort lookup. Returns `null` on:
 *   • empty input
 *   • network error
 *   • Nominatim returning no hits
 *   • a hit without parsable coords
 *
 * Callers should treat `null` as "we don't know, save without
 * coords" — the matcher will gracefully degrade.
 */
/**
 * Geocode a specific field/pitch location for the games map. Composes the
 * address parts into one Nominatim query (`<address>, <city>`) so the pin
 * lands on the actual pitch rather than the city centre. Falls back to the
 * city alone when there's no address, and returns `null` (caller saves
 * without coords) on any miss. Reuses `geocodeCity`'s free-text query +
 * memo + Israel restriction.
 */
export async function geocodeAddress(
  fieldAddress: string | undefined,
  city: string | undefined,
  fieldName?: string,
): Promise<{ lat: number; lng: number } | null> {
  const name = (fieldName ?? '').trim();
  const addr = (fieldAddress ?? '').trim();
  const town = (city ?? '').trim();

  // Prefer govmap (מפ"י): it indexes named POIs (schools, parks) — where
  // pitches actually are — and has far better Hebrew coverage than the OSM
  // geocoder. Try the most specific identifier first (venue name, then
  // street address), each scoped to the city.
  for (const q of [
    [name, town].filter(Boolean).join(' '),
    [addr, town].filter(Boolean).join(' '),
  ]) {
    if (!q) continue;
    try {
      const hits = await searchPlaces(q, 1);
      if (hits.length) return { lat: hits[0].lat, lng: hits[0].lng };
    } catch {
      /* fall through to OSM */
    }
  }

  // OSM/Nominatim fallback (original behaviour) when govmap finds nothing.
  const query = [addr, town].filter(Boolean).join(', ');
  if (!query) return town ? geocodeCity(town) : null;
  return (await geocodeCity(query)) ?? (town ? geocodeCity(town) : null);
}

export async function geocodeCity(
  name: string,
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (memo.has(trimmed)) return memo.get(trimmed) ?? null;

  try {
    const url =
      `${NOMINATIM_BASE}` +
      `?q=${encodeURIComponent(trimmed)}` +
      `&format=json` +
      `&limit=1` +
      `&countrycodes=il`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      memo.set(trimmed, null);
      return null;
    }
    const data = (await res.json()) as Array<{ lat?: string; lon?: string }>;
    const hit = Array.isArray(data) ? data[0] : null;
    const lat = hit?.lat ? parseFloat(hit.lat) : NaN;
    const lng = hit?.lon ? parseFloat(hit.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      memo.set(trimmed, null);
      return null;
    }
    const out = { lat, lng };
    memo.set(trimmed, out);
    return out;
  } catch (err) {
    logError('geocodeCity', err, { name: trimmed });
    if (__DEV__) console.warn('[geocode] failed', err);
    memo.set(trimmed, null);
    return null;
  }
}
