// Geo utilities — Haversine distance in kilometres on the WGS-84
// sphere (good enough for "nearby" filtering at city / country scale).
//
// We keep this dependency-light: no `geolib`, no PostGIS — every call
// is pure arithmetic so it tree-shakes cleanly into the public-feed
// bundle and runs in the millisecond range for 200+ groups.

/** Earth's mean radius in kilometres. */
const EARTH_R_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Great-circle distance between two points in kilometres.
 *
 * Returns +Infinity if either point is missing a coordinate so a
 * radius check uniformly excludes incomparable rows ("don't know
 * how far this is → it's not near").
 */
export function haversineKm(a: LatLng | null | undefined,
                            b: LatLng | null | undefined): number {
  if (!a || !b) return Infinity;
  if (!Number.isFinite(a.lat) || !Number.isFinite(a.lng)) return Infinity;
  if (!Number.isFinite(b.lat) || !Number.isFinite(b.lng)) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_R_KM * c;
}

/**
 * Format a distance for the UI — "13 ק״מ" / "פחות מ־1 ק״מ" /
 * "1.2 ק״מ". Negative or NaN → "—".
 */
export function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 1) return 'פחות מ־1 ק״מ';
  if (km < 10) return `${km.toFixed(1)} ק״מ`;
  return `${Math.round(km)} ק״מ`;
}
