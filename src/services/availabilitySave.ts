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
import { availabilityFeedService } from '@/services/availabilityFeedService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { useUserStore } from '@/store/userStore';
import type { UserAvailability } from '@/types';

/**
 * Exactly what gets written, built once.
 *
 * Returned as well as written, because the local state this function is now
 * responsible for updating must be patched with the SAME values rather than
 * with a re-read — see `applyLocally`.
 */
function buildSaved(
  availability: UserAvailability,
  coords: { lat: number; lng: number } | null,
): UserAvailability {
  // The grid itself, not only what was derived from it. Bounded on the way
  // out: seven days, closed bucket set — a malformed local state must not
  // write an unbounded map into a document every availability query reads.
  const slots: Record<string, string[]> = {};
  for (const [day, buckets] of Object.entries(availability.availabilitySlots ?? {})) {
    const n = Number(day);
    if (!Number.isInteger(n) || n < 0 || n > 6) continue;
    if (Array.isArray(buckets) && buckets.length > 0) {
      slots[String(n)] = buckets.filter((b) => typeof b === 'string').slice(0, 8);
    }
  }
  return {
    preferredDays: availability.preferredDays,
    preferredTimes: availability.preferredTimes ?? [],
    availabilitySlots: slots,
    preferredCity: availability.preferredCity ?? undefined,
    cities: Array.isArray(availability.cities) ? availability.cities : [],
    homeCity: availability.homeCity ?? undefined,
    homeCityLat: coords?.lat,
    homeCityLng: coords?.lng,
    availabilityRadiusKm:
      typeof availability.availabilityRadiusKm === 'number'
        ? availability.availabilityRadiusKm
        : 15,
    isAvailableForInvites: availability.isAvailableForInvites !== false,
    acceptsFillerPush: availability.acceptsFillerPush === true,
  };
}

/**
 * Make the app's own state agree with what was just saved.
 *
 * ─── Why this lives HERE ─────────────────────────────────────────────────
 *
 * It used to live in `AvailabilityEditScreen`, which meant it happened only
 * when a screen was on the stack. The guest path has no screen: a guest fills
 * the grid, meets the auth sheet, signs in, and the RESUMER writes the
 * document from a place where that component is long gone. So the write
 * succeeded and `currentUser.availability` stayed whatever it was before —
 * and the first consumer to ask, the notification-offer bridge reading
 * `acceptsFillerPush`, got a stale answer and silently declined to offer.
 *
 * That bridge was the symptom. The defect is that a domain operation left its
 * own invariant to a caller, so every future consumer of availability had the
 * same trap waiting. Saving availability is what makes availability true;
 * making the app agree is part of saving it.
 *
 * ─── Patch, not re-read ──────────────────────────────────────────────────
 *
 * With the exact map that was just written, a re-fetch would cost a document
 * read to learn something we already know — and open a read-after-write window
 * where it could answer with the previous value. The screen's own
 * `reloadUser()` did exactly that on every save; it is gone now.
 */
function applyLocally(uid: string, saved: UserAvailability): void {
  try {
    // One save, one event — from the values that were written rather than
    // from a screen's local state. It lived in `AvailabilityEditScreen`, so
    // the resumed save (the guest path) was measured as nothing at all: the
    // availability funnel simply had no denominator for the people the whole
    // guest refactor exists for. Every parameter below is derivable from what
    // was saved, which is why this could move without inventing anything.
    logEvent(AnalyticsEvent.AvailabilitySet, {
      days: (saved.preferredDays ?? []).join(','),
      times: (saved.preferredTimes ?? []).join(','),
      radiusKm: saved.availabilityRadiusKm,
      locationEnabled: String(typeof saved.homeCityLat === 'number'),
      acceptsFillerPush: String(saved.acceptsFillerPush === true),
      geocoded: !!saved.homeCity,
    });
  } catch {
    // Telemetry never fails a save.
  }
  try {
    const cur = useUserStore.getState().currentUser;
    // Only the account that was written to. A patch applied to somebody else's
    // session would be worse than the staleness it is fixing.
    if (cur && cur.id === uid) {
      useUserStore.setState({
        currentUser: { ...cur, availability: saved, updatedAt: Date.now() },
      });
    }
    // The viewer's radius/location just changed → drop the home-calendar cache
    // so "פנויים לשחק לידך" recounts on the next open. Also a screen-side
    // effect until now, and just as absent from the resume path.
    availabilityFeedService.invalidate();
  } catch {
    // Local consistency is best-effort: the write succeeded, and the person's
    // availability IS saved. Throwing here would report a failure that did not
    // happen.
  }
}

export async function persistAvailability(
  uid: string,
  availability: UserAvailability,
  coords: { lat: number; lng: number } | null,
): Promise<UserAvailability> {
  const saved = buildSaved(availability, coords);

  if (USE_MOCK_DATA) {
    const json = await storage.getAuthUserJson();
    if (json) {
      try {
        const cur = JSON.parse(json);
        await storage.setAuthUserJson(
          JSON.stringify({ ...cur, availability: saved, updatedAt: Date.now() }),
        );
      } catch {
        /* corrupt cache — leave alone */
      }
    }
    // Mock mode patches the store too. QA runs here, and a mock that behaves
    // differently from production on the exact invariant under test is worse
    // than no mock — this is the environment the staleness was found in.
    applyLocally(uid, saved);
    return saved;
  }
  // `availabilitySlots` — the precise per-day answer, "Tuesday evenings and
  // Friday mornings" — is built by `buildSaved` above and written here. The
  // server has a whole matching branch for it (`availabilityCovers`, which
  // prefers the grid and falls back to the coarse preferredDays ×
  // preferredTimes cross-product). It used to be built and never written, so
  // that branch could not fire for anybody: every user matched on the
  // cross-product, which says Friday EVENINGS too. And because it was never
  // written it was never read back, so reopening the screen rebuilt the grid
  // from the coarse values and quietly lost the distinction the user had just
  // drawn.
  const write = () =>
    withAuthRaceRetry(() =>
      updateDoc(docs.user(uid), {
        // Firestore wants explicit nulls where the local shape uses
        // `undefined`; the VALUES are the same ones `applyLocally` patches in,
        // which is what makes the patch a statement of fact rather than a
        // guess about what the server now holds.
        availability: {
          ...saved,
          preferredCity: saved.preferredCity ?? null,
          homeCity: saved.homeCity ?? null,
          homeCityLat: saved.homeCityLat ?? null,
          homeCityLng: saved.homeCityLng ?? null,
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

  // ONLY after a write that actually landed. Every path above that fails
  // throws, so local state is never told about a save that did not happen.
  applyLocally(uid, saved);
  return saved;
}
