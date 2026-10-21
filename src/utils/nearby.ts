import { observeCaughtError } from './errorObservation';
// nearby — resolve the viewer's location for the "near me" radius filters
// (communities feed + games list). Prefers live GPS (expo-location); falls
// back to a city name (reverse-geocoded, then the caller's saved city) so
// legacy rows without coords can still match by city.
//
// Shared by PublicGroupsFeedScreen and GamesListScreen so both "near me"
// filters behave identically.

import { Linking } from 'react-native';
import { appAlert } from '@/components/AppDialog';
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
/**
 * Coordinates ONLY if location permission was already granted — never prompts.
 *
 * The "מתאים לך" badge is a nicety; asking a user for GPS so a card can wear a
 * star would be a bad trade. Users who already granted location (the nearby
 * filter, the map) get the badge; everyone else simply doesn't, and the
 * resolver treats an unknown distance as unknown rather than far.
 */
export async function resolveLocationIfGranted(): Promise<
  { lat: number; lng: number } | null
> {
  let Location: typeof import('expo-location') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Location = require('expo-location');
  } catch (caughtError299f45d30b) {
    observeCaughtError(caughtError299f45d30b, {"source":"src/utils/nearby.ts","handler":"resolveLocationIfGranted","site":"nearby:299f45d30b"});
    return null;
  }
  if (!Location) return null;
  try {
    const cur = await Location.getForegroundPermissionsAsync();
    if (!cur.granted) return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch (caughtError67bb320a28) {
    observeCaughtError(caughtError67bb320a28, {"source":"src/utils/nearby.ts","handler":"resolveLocationIfGranted","site":"nearby:67bb320a28"});
    return null;
  }
}

export async function resolveNearbyLocation(
  fallbackCity: string | undefined,
): Promise<NearbyLocation> {
  let Location: typeof import('expo-location') | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Location = require('expo-location');
  } catch (caughtErrore94f516b1a) {
    observeCaughtError(caughtErrore94f516b1a, {"source":"src/utils/nearby.ts","handler":"resolveNearbyLocation","site":"nearby:e94f516b1a"});
    Location = null;
  }
  if (Location) {
    let canAskAgain = true;
    try {
      // Read the CURRENT status first (non-prompting). If it's already
      // granted we skip the prompt; if it's permanently denied we return
      // immediately — calling requestForegroundPermissionsAsync() in that
      // state can hang forever on some Android builds (it never resolves
      // because the OS won't show a prompt).
      const cur = await Location.getForegroundPermissionsAsync();
      let granted = cur.granted;
      canAskAgain = cur.canAskAgain;
      if (!granted && canAskAgain) {
        const req = await Location.requestForegroundPermissionsAsync();
        granted = req.granted;
        canAskAgain = req.canAskAgain;
      }
      if (granted) {
        // Cap the GPS fix so a slow/again-hanging sensor doesn't leave the
        // UI stuck on "locating…" — fall back to a city-only result.
        const pos = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (!pos) {
          return {
            latLng: null,
            city: fallbackCity?.trim() ?? null,
            granted: true,
            canAskAgain,
          };
        }
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
        } catch (caughtError88fb261f2f) {
    observeCaughtError(caughtError88fb261f2f, {"source":"src/utils/nearby.ts","handler":"resolveNearbyLocation","site":"nearby:88fb261f2f"});
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
    observeCaughtError(err, {"source":"src/utils/nearby.ts","handler":"resolveNearbyLocation","site":"nearby:afcac7d6dc"});
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
  appAlert(
    he.locationPermTitle,
    he.locationPermBody,
    canAskAgain
      ? [{ text: he.infoTipGotIt }]
      : [
          { text: he.cancel, style: 'cancel' },
          {
            text: he.locationPermOpenSettings,
            onPress: () => {
              Linking.openSettings().catch((caughtErrorb0d5e35fb0: unknown) => {
    observeCaughtError(caughtErrorb0d5e35fb0, {"source":"src/utils/nearby.ts","handler":"onPress","site":"nearby:b0d5e35fb0"});});
            },
          },
        ],
  );
}
