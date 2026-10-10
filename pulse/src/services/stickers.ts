// stickers — the physical sticker-campaign map. Each sticker is a pin on the
// map at the spot it was stuck. Locations arrive as WhatsApp/Google-Maps
// locations (a link or raw coordinates), which we parse to lat/lng. Stored in
// Firestore `stickers/{id}`; the map screen reads them and drops a pin each.

import { listAll, patchDoc, deleteDoc } from './firestoreRest';

export interface Sticker {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  createdAt: number;
}

const COLL = 'stickers';

export async function fetchStickers(): Promise<Sticker[]> {
  const docs = await listAll(COLL).catch(() => []);
  return docs
    .map((d) => ({
      id: d.id,
      lat: Number((d as any).lat),
      lng: Number((d as any).lng),
      label: (d as any).label ? String((d as any).label) : undefined,
      createdAt: Number((d as any).createdAt) || 0,
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function addSticker(input: {
  lat: number;
  lng: number;
  label?: string;
}): Promise<string | null> {
  const id = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const ok = await patchDoc(`${COLL}/${id}`, {
    lat: input.lat,
    lng: input.lng,
    ...(input.label ? { label: input.label } : {}),
    createdAt: Date.now(),
  });
  return ok ? id : null;
}

export async function deleteSticker(id: string): Promise<boolean> {
  return deleteDoc(`${COLL}/${id}`);
}

// ── Location parsing ────────────────────────────────────────────────────────

export interface ParsedLoc {
  lat: number;
  lng: number;
}

/** Rough Israel bounding box — a sanity check so a mis-parse (or a location
 *  abroad) is flagged rather than silently dropped on the map. */
export function inIsrael(lat: number, lng: number): boolean {
  return lat >= 29.0 && lat <= 33.6 && lng >= 34.0 && lng <= 36.1;
}

function validCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Pull lat/lng out of a Google-Maps URL or free text. Tries the most precise
 *  patterns first (place `!3d!4d`, `@lat,lng`), then query params, then a bare
 *  "lat, lng" pair. */
function coordsFromText(text: string): ParsedLoc | null {
  const tries: RegExp[] = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, // place marker
    /@(-?\d+\.\d+),(-?\d+\.\d+)/, // /@lat,lng,zoom
    /[?&](?:q|ll|query|destination|center|sll)=(?:loc:)?(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
    /\bloc:(-?\d+\.\d+),\s*(-?\d+\.\d+)/i,
    /(-?\d{1,2}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})/, // bare "lat, lng"
  ];
  for (const re of tries) {
    const m = text.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (validCoord(lat, lng)) return { lat, lng };
    }
  }
  return null;
}

function firstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s]+/i);
  return m ? m[0] : null;
}

function isShortLink(url: string): boolean {
  return /maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs/i.test(url);
}

/** Follow a shortened maps link to its expanded URL (which carries the
 *  coordinates). Best-effort: returns the original on any failure. */
async function expandShortLink(url: string): Promise<string> {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    // React Native's fetch exposes the final URL after redirects.
    const finalUrl = (res as any).url || url;
    if (finalUrl && finalUrl !== url) return finalUrl;
    // Some links only reveal coords in the body — scan it too.
    const body = await res.text().catch(() => '');
    return body ? `${finalUrl} ${body.slice(0, 4000)}` : finalUrl;
  } catch {
    return url;
  }
}

/** Geocode a free-text address/place in Israel via Nominatim (best-effort). */
async function geocodeAddress(q: string): Promise<ParsedLoc | null> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=il&q=' +
      encodeURIComponent(q);
    const res = await fetch(url, { headers: { 'User-Agent': 'TeamderPulse/1.0' } });
    const arr = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (arr && arr[0]) {
      const lat = parseFloat(arr[0].lat);
      const lng = parseFloat(arr[0].lon);
      if (validCoord(lat, lng)) return { lat, lng };
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Parse whatever the user pasted (a WhatsApp location = a Google-Maps link or
 * raw coords, or an address) into a single lat/lng. Resolves shortened links
 * over the network first. Returns null when nothing usable was found.
 */
export async function parseLocationInput(raw: string): Promise<ParsedLoc | null> {
  const text = (raw || '').trim();
  if (!text) return null;

  // 1) Coords / long Google-Maps URL already in the text.
  const direct = coordsFromText(text);
  if (direct) return direct;

  // 2) A shortened maps link → expand it, then re-scan.
  const url = firstUrl(text);
  if (url && isShortLink(url)) {
    const expanded = await expandShortLink(url);
    const fromExpanded = coordsFromText(expanded);
    if (fromExpanded) return fromExpanded;
  }

  // 3) Fall back to geocoding the text as an address/place.
  return geocodeAddress(text);
}
