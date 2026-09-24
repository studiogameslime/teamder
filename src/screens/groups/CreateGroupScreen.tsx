// CreateGroupScreen — thin shell over GroupWizardForm. Translates the
// wizard's GroupFormValues into a `createGroup` call. Same wizard
// surface as CommunityEditScreen — only the initial values + submit
// label differ.

import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CommunitiesStackParamList } from '@/navigation/CommunitiesStack';

import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';
import { he } from '@/i18n/he';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import {
  useAuthenticatedAction,
  useIsGuest,
} from '@/hooks/useAuthenticatedAction';
import { draftStore } from '@/services/draftStore';
import { setCreateClubHandler } from '@/services/actionResumers';
import {
  GroupWizardForm,
  EMPTY_GROUP_FORM_VALUES,
  type GroupFormValues,
} from '@/screens/groups/GroupWizardForm';
import { pickRandomCoverId } from '@/data/coverImages';
import { seasonService } from '@/services/seasonService';
import { newClubSeasonsArgs } from '@/utils/newClubSeasons';

export function CreateGroupScreen() {
  // One draft id per visit to this screen. Stable across re-renders so an
  // overwrite of the same draft keeps its `createdAt` — which is what makes
  // editing extend a draft's life rather than restart its age.
  const draftIdRef = useRef(`club-${Date.now()}`);
  const isGuest = useIsGuest();
  const authAction = useAuthenticatedAction();
  /** Restored values, or null while we look. `undefined` initial value would
   *  make the wizard mount with empty fields and then swap them under the
   *  person's hands; the screen waits instead. */
  const [restored, setRestored] = useState<GroupFormValues | null>(null);
  const [checkedDraft, setCheckedDraft] = useState(false);
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesCreate'>
  >();
  const user = useUserStore((s) => s.currentUser);
  const createGroup = useGroupStore((s) => s.createGroup);

  // The whole of `submit` below is what the resumer runs too — handed over by
  // `setCreateClubHandler`, so a club created after signing in goes through the
  // SAME geocoding, the same seasons call and the same celebrate navigation as
  // one created by somebody already signed in. Re-implementing it in the
  // resumer would give the product a second way to make a club.
  const createFromValues = async (v: GroupFormValues) => {
    const user = useUserStore.getState().currentUser;
    if (!user || user.isGuest === true) return;
    const cityVal = v.city.trim();
    const phone = v.contactPhone.trim();
    const parsedMaxMembers = parseInt(v.maxMembers, 10);
    // Geocode the city the moment the group is created so the new
    // "nearby" radius filter sees this group with coords from day 1.
    // Failure is non-fatal — the filter degrades to city-name match
    // for any row that lacks lat/lng. We don't block submit on the
    // network call; it's a quick one but a slow link shouldn't gate
    // group creation.
    let coords: { lat: number; lng: number } | null = null;
    if (cityVal) {
      try {
        const { geocodeCity } = await import('@/services/geocodeService');
        // 7s cap (was 3.5s) so the city reliably resolves to coords on a
        // slow link — the group needs them for the "near me" radius filter.
        coords = await Promise.race([
          geocodeCity(cityVal),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 7000)),
        ]);
      } catch {
        coords = null;
      }
    }
    try {
      const group = await createGroup({
        name: v.name.trim(),
        description: v.description.trim() || undefined,
        isOpen: v.isOpen,
        internalRating: v.internalRating,
        hideInternalRating: v.internalRating ? v.hideInternalRating : undefined,
        cardsEnabled: v.cardsEnabled,
        // Persist validity regardless of the master switch — cardsEnabled gates
        // enforcement, so keeping the days lets a later re-enable restore config
        // instead of resurrecting/immortalizing cards via a nulled expiry.
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
          Number.isFinite(parsedMaxMembers) && parsedMaxMembers > 0
            ? parsedMaxMembers
            : undefined,
        // Random cover from the built-in gallery — the admin can switch
        // to another gallery image or upload their own afterwards.
        coverImageId: pickRandomCoverId(),
        creator: user,
      });
      logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });
      // Seasons, if the admin asked for them on step 2.
      //
      // AFTER the club exists and deliberately not blocking on it: a season is
      // a server callable against a groupId, so there is nothing to call until
      // this point. A failure here leaves a club that was created with seasons
      // off — recoverable in one tap from the edit screen — whereas failing the
      // whole creation over it would throw away a filled-in form.
      //
      // `historyChoice` is not passed and must not be: it decides what to do
      // with evenings already played, and a club created a second ago has
      // none. The server reads an absent history as zero and opens season 1
      // clean, which is the only honest answer here.
      if (v.seasons.enabled) {
        try {
          // Built by `newClubSeasonsArgs`, not inline — the shape is the
          // contract, and tests/logic/newClubSeasons holds it to it.
          await seasonService.enable(newClubSeasonsArgs(v.seasons, group.id)!);
        } catch (seasonErr) {
          logError('createGroupSeasons', seasonErr, { groupId: group.id });
          appAlert(he.error, he.newClubSeasonsFailed);
        }
      }
      (nav as { replace: (s: string, p: unknown) => void }).replace(
        'CommunityDetails',
        { groupId: group.id, celebrate: true },
      );
    } catch (e) {
      // Surface a human-readable Hebrew message instead of dumping the
      // raw error text. The two practical failure modes:
      //   1. `unauthenticated` — the server-side App Check / Play
      //      Integrity gate rejected the request. Common when running
      //      on an emulator or before the production keystore's
      //      SHA-256 has been registered in Firebase App Check.
      //   2. `resource-exhausted` — daily rate limit (5/day) hit.
      // Anything else falls back to a generic create-failed toast.
      const err = e as { code?: string; message?: string };
      const code = String(err.code ?? '').replace(/^functions\//, '');
      // Log to the panel BEFORE branching the UI message. This catch used
      // to only show an Alert, so App-Check-blocked creations (code
      // 'unauthenticated' — e.g. iOS App Attest not attesting) never
      // reached the errors collection. `unauthenticated` on iOS almost
      // always means the App Check gate rejected the callable, NOT a
      // missing auth session — capture platform + code so the panel can
      // tell them apart.
      // A VALIDATION_ERROR is the form telling the user they left the name
      // empty — the guard working, not the app failing. It reached the
      // production error panel as "יצירת מועדון נכשלה" and read like a defect;
      // the user still sees the message, it just is not filed as a fault.
      if (code !== 'VALIDATION_ERROR') {
        logError('createGroup', e, {
          screen: 'CreateGroupScreen',
          code,
          platform: Platform.OS,
          appCheckSuspected: code === 'unauthenticated',
        });
      }
      logEvent(AnalyticsEvent.GroupCreateFailed, {
        code,
        platform: Platform.OS,
      });
      let msg: string = he.createGroupGenericError;
      if (code === 'unauthenticated') {
        msg = he.createGroupAuthError;
      } else if (code === 'resource-exhausted') {
        msg = err.message || he.createGroupRateLimitError;
      } else if (err.message) {
        msg = err.message;
      }
      appAlert(he.error, msg);
    }
  };

  // Hand the real creation path to the resumer while this screen is mounted,
  // and take it back on unmount so a stale closure can never be called.
  useEffect(() => {
    setCreateClubHandler(async (values) => {
      await createFromValues(values as unknown as GroupFormValues);
    });
    return () => setCreateClubHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Look for a draft ONCE, on mount. Merged onto the CURRENT defaults rather
  // than trusted whole, so a field the wizard no longer has cannot come back
  // from a stale draft — see draftStore.mergeDraftValues.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const d = await draftStore.read('club');
        if (!alive) return;
        if (d) {
          draftIdRef.current = d.id;
          setRestored(
            draftStore.merge(
              EMPTY_GROUP_FORM_VALUES as unknown as Record<string, unknown>,
              d.values,
            ) as unknown as GroupFormValues,
          );
          logEvent(AnalyticsEvent.DraftRestored, {
            kind: 'club',
            age_ms: Math.max(0, Date.now() - d.updatedAt),
          });
        }
      } finally {
        if (alive) setCheckedDraft(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // The save gate. Validation has already run inside the wizard by the time
  // this is called, so what a guest loses by signing in here is nothing.
  const submit = async (v: GroupFormValues) => {
    if (isGuest) {
      // The draft is written by the coordinator BEFORE the sheet opens, because
      // the existing-account path replaces the session and unmounts this screen
      // — an await after that races the teardown, and the thing being awaited is
      // the only copy of what they typed.
      await authAction.request({
        kind: 'create_club',
        origin: 'in_app',
        draft: { kind: 'club', id: draftIdRef.current, values: v as unknown as Record<string, unknown> },
        // Never called: this branch only runs for a guest, and the coordinator
        // parks rather than executing. The real work is the registered resumer,
        // which asks the server fresh after authentication. Throwing makes a
        // future mistake loud instead of silently reporting success.
        execute: async () => {
          throw new Error('unreachable: guest actions resume via their resumer');
        },
      });
      return;
    }
    await createFromValues(v);
  };

  // Wait for the draft check before mounting the wizard. Rendering empty fields
  // and then swapping in restored values would have somebody typing into a form
  // that changes under them.
  if (!checkedDraft) return null;

  return (
    <>
    {authAction.sheet}
    <GroupWizardForm
      headerTitle={he.createGroupTitle}
      submitLabel={he.createGroupSubmit}
      // `key` forces a remount when a restored draft lands, because
      // GroupWizardForm seeds its state from `initial` on FIRST mount only —
      // the same reason GameCreateScreen keys on `initialKey`.
      key={restored ? draftIdRef.current : 'fresh'}
      initial={restored ?? EMPTY_GROUP_FORM_VALUES}
      onSubmit={submit}
      // The seasons question belongs to creation. The edit screen has the full
      // settings block instead — it can also end a season and decide what to
      // do with a history, neither of which exists here.
      askSeasons
      // Confirm before leaving with filled-in fields instead of discarding
      // them silently (Pulse #9).
      enableUnsavedGuard
    />
    </>
  );
}
