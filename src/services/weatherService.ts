// weatherService — forecast lookup via Open-Meteo.
//
// Open-Meteo is keyless and free for non-commercial / low-volume use.
// We hit the hourly forecast endpoint, locate the hour that matches the
// game kickoff, and return temperature + rain probability + a WMO
// weather code. Failures and edge cases (no coords, past game, too far
// in the future) resolve to `null` so the UI can hide the chip cleanly.

import { Platform } from 'react-native';

export interface WeatherForecast {
  /** Rounded temperature in degrees Celsius. */
  tempC: number;
  /** Rain probability 0..100. */
  rainProb: number;
  /** WMO weather code (0=clear, 95=thunderstorm, etc). */
  weatherCode: number;
}

interface FetchOpts {
  lat?: number;
  lng?: number;
  /**
   * Free-text city used as a fallback when explicit coords aren't set.
   * Geocoded once per city via Open-Meteo's free geocoding API and
   * cached locally.
   */
  city?: string;
  /** ms epoch — the hour around this timestamp is the lookup target. */
  startsAt: number;
}

// Open-Meteo only serves up to ~16 days of forecast. Beyond that, no
// data — bail and let the caller hide the chip.
const MAX_FORECAST_DAYS = 14;

const memo = new Map<string, WeatherForecast | null>();
const geocodeMemo = new Map<string, { lat: number; lng: number } | null>();

/**
 * City → lat/lng lookup via Nominatim (OpenStreetMap). Chosen over
 * Open-Meteo's geocoder because the latter's database has English /
 * transliterated names only — `קרית עקרון` returns no results, while
 * Nominatim finds it instantly. Restricted to country=IL for speed
 * and to avoid colliding with similarly-named places elsewhere.
 *
 * Nominatim policy: include a descriptive User-Agent and cap calls to
 * ≤1/sec. Both are honoured here (the screen fetches once on mount
 * and the result is cached).
 */
async function geocodeCity(
  name: string,
): Promise<{ lat: number; lng: number } | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (geocodeMemo.has(trimmed)) return geocodeMemo.get(trimmed) ?? null;
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(trimmed)}` +
      `&format=json` +
      `&limit=1` +
      `&countrycodes=il`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Teamder/1.0 (studiogameslime@gmail.com)',
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      geocodeMemo.set(trimmed, null);
      return null;
    }
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const lat = hit?.lat ? parseFloat(hit.lat) : NaN;
    const lng = hit?.lon ? parseFloat(hit.lon) : NaN;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      geocodeMemo.set(trimmed, null);
      return null;
    }
    const out = { lat, lng };
    geocodeMemo.set(trimmed, out);
    return out;
  } catch (err) {
    if (__DEV__) console.warn('[weather] geocode failed', err);
    geocodeMemo.set(trimmed, null);
    return null;
  }
}

/**
 * Returns the forecast for the hour the game kicks off, or `null` when
 * nothing useful can be returned (missing coords, past game, network
 * fail, parse error, far-future game). Always swallows errors.
 */
export async function getForecastFor(
  opts: FetchOpts,
): Promise<WeatherForecast | null> {
  const { startsAt } = opts;

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (startsAt < now - day) return null; // past
  if (startsAt > now + MAX_FORECAST_DAYS * day) return null; // too far ahead

  // Resolve coords. Explicit lat/lng wins; fall back to geocoding the
  // city name when only that's available.
  let lat = opts.lat;
  let lng = opts.lng;
  if (
    (typeof lat !== 'number' || typeof lng !== 'number') &&
    opts.city &&
    opts.city.trim().length > 0
  ) {
    const geo = await geocodeCity(opts.city);
    if (geo) {
      lat = geo.lat;
      lng = geo.lng;
      if (__DEV__) {
        console.log('[weather] geocoded', opts.city, '→', geo);
      }
    } else if (__DEV__) {
      console.warn('[weather] geocode returned null for', opts.city);
    }
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    if (__DEV__) console.log('[weather] no coords, skipping fetch');
    return null;
  }

  const key = `${lat.toFixed(3)}:${lng.toFixed(3)}:${Math.floor(startsAt / (60 * 60 * 1000))}`;
  if (memo.has(key)) return memo.get(key) ?? null;

  const d = new Date(startsAt);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}` +
    `&longitude=${lng}` +
    `&hourly=temperature_2m,precipitation_probability,weather_code` +
    `&timezone=auto` +
    `&start_date=${date}` +
    `&end_date=${date}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      memo.set(key, null);
      return null;
    }
    const data = await res.json();
    const times: string[] = data?.hourly?.time ?? [];
    const temps: number[] = data?.hourly?.temperature_2m ?? [];
    const rains: number[] = data?.hourly?.precipitation_probability ?? [];
    const codes: number[] = data?.hourly?.weather_code ?? [];

    const targetHour = d.getHours();
    const idx = times.findIndex((t) => {
      // Time format is `YYYY-MM-DDTHH:00`.
      const hourPart = t.split('T')[1] ?? '';
      const h = parseInt(hourPart.slice(0, 2), 10);
      return h === targetHour;
    });
    if (idx < 0) {
      memo.set(key, null);
      return null;
    }

    const out: WeatherForecast = {
      tempC: Math.round(temps[idx] ?? 0),
      rainProb: Math.round(rains[idx] ?? 0),
      weatherCode: codes[idx] ?? 0,
    };
    memo.set(key, out);
    return out;
  } catch (err) {
    if (__DEV__) console.warn('[weather] fetch failed', err);
    memo.set(key, null);
    return null;
  }
}

/**
 * Map WMO weather codes to a single emoji icon. Ranges follow the
 * spec at <https://open-meteo.com/en/docs#weather_codes>; anything
 * unmapped falls back to a partly-cloudy face.
 */
export function weatherIcon(code: number): string {
  if (code === 0) return '☀️';
  if (code === 1 || code === 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌦️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '🌨️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌤️';
}

// Suppress the Platform import-level unused warning on engines where
// `fetch` is global (RN both iOS + Android). Kept around in case a
// future timeout/abort wrapper needs platform branching.
void Platform;
