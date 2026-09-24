// clubCreation — making a club, without a screen.
//
// Same reason as `gameCreation`: the resumer has to run when
// `CreateGroupScreen` is gone, and it is gone in exactly the two cases a resume
// happens. Registering the creation path from the screen meant the handler was
// null precisely when it was needed, so a club promised after sign-in was held
// indefinitely — no error, no club.
//
// What stayed in the screen: the error dialogs and the celebrate navigation.
// Both need a UI.

import { groupService } from '@/services/groupService';
import { seasonService } from '@/services/seasonService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { newClubSeasonsArgs } from '@/utils/newClubSeasons';
import type { GroupFormValues } from '@/screens/groups/GroupWizardForm';
import type { User } from '@/types';
import { pickRandomCoverId } from '@/data/coverImages';

export interface CreatedClub {
  groupId: string;
  /** True when the club was created with seasons on but the enable call failed
   *  — recoverable in one tap from the edit screen, and worth telling the
   *  person rather than failing the whole creation over. */
  seasonsFailed: boolean;
}

/**
 * Create the club. The same argument mapping the wizard's submit used, moved
 * rather than rewritten.
 *
 * The city geocode is raced against a 7s cap exactly as before: the "near me"
 * radius filter wants coords from day one, but a slow link must not gate the
 * creation. Failure degrades to a city-name match, which is what the filter
 * already falls back to.
 */
export async function createClubFromValues(
  v: GroupFormValues,
  creator: User,
): Promise<CreatedClub> {
  const cityVal = v.city.trim();
  const phone = v.contactPhone.trim();
  const parsedMaxMembers = parseInt(v.maxMembers, 10);

  let coords: { lat: number; lng: number } | null = null;
  if (cityVal) {
    try {
      const { geocodeCity } = await import('@/services/geocodeService');
      coords = await Promise.race([
        geocodeCity(cityVal),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
      ]);
    } catch {
      coords = null;
    }
  }

  const group = await groupService.createGroup({
    name: v.name.trim(),
    description: v.description.trim() || undefined,
    isOpen: v.isOpen,
    internalRating: v.internalRating,
    hideInternalRating: v.internalRating ? v.hideInternalRating : undefined,
    cardsEnabled: v.cardsEnabled,
    // Validity is persisted regardless of the master switch — `cardsEnabled`
    // gates enforcement, so keeping the days lets a later re-enable restore the
    // config instead of resurrecting cards via a nulled expiry.
    yellowCardValidityDays: (() => {
      const n = parseInt(v.yellowCardValidityDays, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    redCardValidityDays: (() => {
      const n = parseInt(v.redCardValidityDays, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    rules: v.rules.trim() || undefined,
    contactPhone: phone || undefined,
    city: cityVal || undefined,
    lat: coords?.lat,
    lng: coords?.lng,
    maxMembers:
      Number.isFinite(parsedMaxMembers) && parsedMaxMembers > 0 ? parsedMaxMembers : undefined,
    coverImageId: pickRandomCoverId(),
    creator,
  });
  logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });

  // Seasons AFTER the club exists, and deliberately not blocking on it: a
  // season is a server callable against a groupId, so there is nothing to call
  // until this point. A failure leaves a club with seasons off — one tap to fix
  // — whereas failing the whole creation would throw away a filled-in form.
  //
  // `historyChoice` is not passed and must not be: it decides what to do with
  // evenings already played, and a club created a second ago has none.
  let seasonsFailed = false;
  if (v.seasons.enabled) {
    try {
      await seasonService.enable(newClubSeasonsArgs(v.seasons, group.id)!);
    } catch (seasonErr) {
      seasonsFailed = true;
      logError('createGroupSeasons', seasonErr, { groupId: group.id });
    }
  }

  return { groupId: group.id, seasonsFailed };
}
