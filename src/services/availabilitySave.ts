// availabilitySave — writing somebody's availability onto their user document.
//
// Extracted verbatim from `AvailabilityEditScreen` so the resumer can use it.
// A guest's availability is a LOCAL DRAFT and nothing else: there is no
// `/users/{anonymousUid}` to write onto, and the tightened rules refuse one
// anyway. So the save happens after authentication, from here, with the same
// payload and the same two recovery paths the screen has always had.
//
// Not a rewrite. Every comment below was earned by a production report and is
// kept with the code it explains.

import { updateDoc } from 'firebase/firestore';

import { USE_MOCK_DATA } from '@/firebase/config';
import { docs } from '@/firebase/firestore';
import { withAuthRaceRetry } from '@/firebase/authRace';
import { storage } from '@/services/storage';
import { userService } from '@/services/userService';
import type { UserAvailability } from '@/types';

export async function persistAvailability(
  uid: string,
  availability: UserAvailability,
  coords: { lat: number; lng: number } | null,
): Promise<void> {
  if (USE_MOCK_DATA) {
    const json = await storage.getAuthUserJson();
    if (!json) return;
    try {
      const cur = JSON.parse(json);
      const merged: UserAvailability = {
        ...availability,
        homeCityLat: coords?.lat,
        homeCityLng: coords?.lng,
      };
      const next = { ...cur, availability: merged, updatedAt: Date.now() };
      await storage.setAuthUserJson(JSON.stringify(next));
    } catch {
      /* corrupt cache — leave alone */
    }
    return;
  }
  // The grid itself, not only what was derived from it.
  //
  // `availabilitySlots` is the precise per-day answer this screen collects —
  // "Tuesday evenings and Friday mornings" — and the server has a whole
  // matching branch for it (`availabilityCovers`, which prefers the grid and
  // falls back to the coarse preferredDays × preferredTimes cross-product).
  // It was built in the object above, passed in here, and never written, so
  // that branch could not fire for anybody: every user matched on the
  // cross-product, which says Friday EVENINGS too. And because the field was
  // never written it was never read back either, so reopening the screen
  // rebuilt the grid from the coarse values and quietly lost the distinction
  // the user had just drawn.
  //
  // Bounded on the way out: seven days, and the buckets are a closed set, so a
  // malformed local state cannot write an unbounded map into a document every
  // availability query reads.
  const slots: Record<string, string[]> = {};
  for (const [day, buckets] of Object.entries(availability.availabilitySlots ?? {})) {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0 || n > 6) continue;
    if (Array.isArray(buckets) && buckets.length > 0) {
      slots[String(n)] = buckets.filter((b) => typeof b === 'string').slice(0, 8);
    }
  }
  // Through the auth-race retry. "שמירת זמינות נכשלה" arrived four times from
  // one user with permission-denied, and the /users update rule admits this
  // exact payload — proved against both the current ruleset and the one that
  // was live at the moment it failed (tests/rules/availabilitySave.test.mjs,
  // nine shapes, all allowed).
  //
  // That left two candidates for a denial the rules do not explain: the token
  // not having landed, which this wrapper covers, and the document not being
  // there at all, which it cannot — see the catch below, which is what the
  // reporting account turned out to need.
  //
  // The retry matters more here than on a read: a read that loses the race
  // shows an empty list for a moment, and this one throws away a grid the user
  // has just spent a minute filling in.
  const write = () =>
    withAuthRaceRetry(() =>
      updateDoc(docs.user(uid), {
        availability: {
          preferredDays: availability.preferredDays,
          preferredTimes: availability.preferredTimes ?? [],
          availabilitySlots: slots,
          preferredCity: availability.preferredCity ?? null,
          cities: Array.isArray(availability.cities) ? availability.cities : [],
          homeCity: availability.homeCity ?? null,
          homeCityLat: coords?.lat ?? null,
          homeCityLng: coords?.lng ?? null,
          availabilityRadiusKm:
            typeof availability.availabilityRadiusKm === 'number'
              ? availability.availabilityRadiusKm
              : 15,
          isAvailableForInvites: availability.isAvailableForInvites !== false,
          acceptsFillerPush: availability.acceptsFillerPush === true,
        },
        updatedAt: Date.now(),
      }),
    );

  try {
    await write();
  } catch (err) {
    // The denial that is not a denial.
    //
    // The four production reports came from ONE account, and that account has
    // no /users document at all — verified against production. The update rule
    // reads `resource.data`, so with no document there is nothing for any
    // payload to satisfy and Firestore answers permission-denied. No number of
    // auth-race retries can fix that: the token was never the problem, and the
    // user just watched a grid they spent a minute filling in fail four times.
    //
    // So on a denial we ask once whether the document is actually there.
    // `ensureUserDoc` rebuilds it through the documented lazy-create path and
    // says so; if it is there, or it could not tell, nothing was recovered and
    // the original error surfaces untouched — a real rules denial must never
    // be swallowed by a retry.
    if ((err as { code?: string })?.code !== 'permission-denied') throw err;
    const restored = await userService.ensureUserDoc();
    if (!restored) throw err;
    await write();
  }
}
