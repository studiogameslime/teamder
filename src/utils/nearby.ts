// nearby — resolve the viewer's location for the "near me" radius filters
// (communities feed + games list). Prefers live GPS (expo-location); falls
// back to a city name (reverse-geocoded, then the caller's saved city) so
// legacy rows without coords can still match by city.
//
// Shared by PublicGroupsFeedScreen and GamesListScreen so both "near me"
// filters behave identically.

export interface NearbyLocation {
  /** GPS coords — the preferred input for radius (haversine) matching. */
  latLng: { lat: number; lng: number } | null;
  /** City name — fallback for rows that still lack lat/lng. */
  city: string | null;
}

/**
 * Resolve where the viewer is, for the "near me" filters.
 *
 * Returns:
 *   • `{ latLng, city }` — GPS granted; radius matching available.
 *   • `{ latLng: null, city }` — GPS denied/unavailable; city-only fallback.
 *   • `{ latLng: null, city: null }` — nothing to match on; caller shows empty.
 */
export async function resolveNearbyLocation(
  fallbackCity: string | undefined,
): Promise<NearbyLocation> {
  let Location: typeof import('expo-location') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Location = require('expo-location');
  } catch {
    Location = null;
  }
  if (Location) {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const latLng = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        // Best-effort reverse-geocode for the fallback city — failures are
        // non-fatal because latLng alone is enough for the radius check.
        let city: string | null = null;
        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
          const place = places[0];
          city =
            (place?.city || place?.subregion || place?.region || '').trim() ||
            null;
        } catch {
          // ignore
        }
        return { latLng, city: city ?? fallbackCity?.trim() ?? null };
      }
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[nearby] location resolve failed', err);
      }
    }
  }
  // GPS unavailable / denied → city-only fallback.
  return { latLng: null, city: fallbackCity?.trim() ?? null };
}
