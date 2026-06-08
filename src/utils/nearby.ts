// nearby — resolve the viewer's location for the "near me" radius filters
// (communities feed + games list). Prefers live GPS (expo-location); falls
// back to a city name (reverse-geocoded, then the caller's saved city) so
// legacy rows without coords can still match by city.
//
// Shared by PublicGroupsFeedScreen and GamesListScreen so both "near me"
// filters behave identically.

import { Alert, Linking } from 'react-native';
import { he } from '@/i18n/he';

export interface NearbyLocation {
  /** GPS coords — the preferred input for radius (haversine) matching. */
  latLng: { lat: number; lng: number } | null;
  /** City name — fallback for rows that still lack lat/lng. */
  city: string | null;
  /** Whether the user granted foreground location permission. Callers
   *  use this to prompt the user instead of silently showing nothing. */
  granted: boolean;
  /** False when the OS won't show the prompt again (permanently denied) —
   *  the caller should send the user to Settings rather than re-asking. */
  canAskAgain: boolean;
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
    let canAskAgain = true;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      canAskAgain = perm.canAskAgain;
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
        return {
          latLng,
          city: city ?? fallbackCity?.trim() ?? null,
          granted: true,
          canAskAgain,
        };
      }
      // Permission denied by the user.
      return {
        latLng: null,
        city: fallbackCity?.trim() ?? null,
        granted: false,
        canAskAgain,
      };
    } catch (err) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.warn('[nearby] location resolve failed', err);
      }
      return {
        latLng: null,
        city: fallbackCity?.trim() ?? null,
        granted: false,
        canAskAgain,
      };
    }
  }
  // expo-location module unavailable — treat as not granted.
  return {
    latLng: null,
    city: fallbackCity?.trim() ?? null,
    granted: false,
    canAskAgain: true,
  };
}

/**
 * Tell the user the "near me" filter needs location access. When the OS
 * can still prompt, a simple heads-up; when permanently denied, offer to
 * jump to the app's settings. Callers should turn their "near me" toggle
 * back off after calling this so the list isn't left silently empty.
 */
export function promptLocationDenied(canAskAgain: boolean): void {
  Alert.alert(
    he.locationPermTitle,
    he.locationPermBody,
    canAskAgain
      ? [{ text: he.infoTipGotIt }]
      : [
          { text: he.cancel, style: 'cancel' },
          {
            text: he.locationPermOpenSettings,
            onPress: () => {
              Linking.openSettings().catch(() => {});
            },
          },
        ],
  );
}
