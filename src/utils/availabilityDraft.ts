// Reading back an availability draft — the whole of it.
//
// The draft is parked as `{ availability, coords }`: the coords sit BESIDE the
// availability object because the reverse-geocode that produced them happened
// while the person was still on the screen, and re-deriving them after a
// sign-in would mean asking for location again.
//
// `AvailabilityEditScreen` read only the first half. The second half is what
// decides whether the home area is on — the screen derives that from
// `homeCityLat/Lng`, which live nowhere else in the draft. So a guest who
// pinned a home area, met the auth sheet and came back found the toggle off,
// and the next save wrote `acceptsFillerPush: false`.
//
// Which broke the rule the whole refactor rests on: authentication in the
// middle of an action does not lose anything already entered.
//
// This lives here rather than in the screen because it is a question about
// DATA — given what was parked, what should the form hold? — and because a
// derivation that only exists inside a 900-line component is one nobody tests.

import type { UserAvailability } from '@/types';

/** The map's opening view. Coords sitting exactly on it are the fingerprint of
 *  an old bug that stamped 'בני ברק' on anyone who never touched the map; a
 *  real pin-drop, city search or GPS fix never lands on it to six decimals. */
export const DEFAULT_CENTER = { lat: 32.0719, lng: 34.8417 };

export function isDefaultCenter(lat?: number | null, lng?: number | null): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Math.abs(lat - DEFAULT_CENTER.lat) < 1e-6 &&
    Math.abs(lng - DEFAULT_CENTER.lng) < 1e-6
  );
}

/** Exactly what was parked. Not a new representation — the same two keys the
 *  save writes. */
export interface AvailabilityDraftValues {
  availability?: UserAvailability;
  coords?: { lat?: unknown; lng?: unknown } | null;
}

export interface RestoredAvailabilityDraft {
  /** The parked availability with the coords merged back onto it, so it is the
   *  identical shape the account's own document has — the form does not need
   *  to know where it came from. */
  availability: UserAvailability;
  /** Is the home-area section on? Derived, never stored. */
  locationEnabled: boolean;
  /** Did the person actually choose this pin, as opposed to it being the map's
   *  opening view? Only a chosen one may be persisted. */
  locationPicked: boolean;
}

/** A pair of real, finite numbers, or nothing. Strings, NaN and half-pairs are
 *  all "no home area" — inventing one from a malformed draft would put a
 *  location on somebody's account that they never picked. */
function usableCoords(
  coords: AvailabilityDraftValues['coords'],
): { lat: number; lng: number } | null {
  const lat = coords?.lat;
  const lng = coords?.lng;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng)
  ) {
    return null;
  }
  return { lat, lng };
}

/**
 * Turn parked draft values into the state the form should open with.
 *
 * Returns null when there is nothing to restore. Backward-safe by
 * construction rather than by versioning: a draft from before coords were
 * parked simply has none, and "no coords" already means "no home area" — the
 * same answer somebody who never picked one gets. Nothing is inferred to fill
 * the gap, and nothing here can throw.
 */
export function restoreAvailabilityDraft(
  values: AvailabilityDraftValues | null | undefined,
): RestoredAvailabilityDraft | null {
  const availability = values?.availability;
  if (!availability) return null;

  const coords = usableCoords(values?.coords);
  if (!coords) {
    return { availability, locationEnabled: false, locationPicked: false };
  }
  return {
    availability: {
      ...availability,
      homeCityLat: coords.lat,
      homeCityLng: coords.lng,
    },
    locationEnabled: true,
    // A restored pin counts as chosen — the person chose it before they signed
    // in. Unless it is the opening view, which nobody chose.
    locationPicked: !isDefaultCenter(coords.lat, coords.lng),
  };
}
