// CreateGroupScreen — thin shell over GroupWizardForm. Translates the
// wizard's GroupFormValues into a `createGroup` call. Same wizard
// surface as CommunityEditScreen — only the initial values + submit
// label differ.

import React from 'react';
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
  GroupWizardForm,
  EMPTY_GROUP_FORM_VALUES,
  type GroupFormValues,
} from '@/screens/groups/GroupWizardForm';
import { pickRandomCoverId } from '@/data/coverImages';

export function CreateGroupScreen() {
  const nav = useNavigation<
    NativeStackNavigationProp<CommunitiesStackParamList, 'CommunitiesCreate'>
  >();
  const user = useUserStore((s) => s.currentUser);
  const createGroup = useGroupStore((s) => s.createGroup);

  const submit = async (v: GroupFormValues) => {
    if (!user) return;
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
        rules: v.rules.trim() || undefined,
        contactPhone: phone || undefined,
        city: cityVal || undefined,
        lat: coords?.lat,
        lng: coords?.lng,
        maxMembers: Number.isFinite(parsedMaxMembers)
          ? parsedMaxMembers
          : undefined,
        // Random cover from the built-in gallery — the admin can switch
        // to another gallery image or upload their own afterwards.
        coverImageId: pickRandomCoverId(),
        creator: user,
      });
      logEvent(AnalyticsEvent.GroupCreated, { groupId: group.id });
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
      logError('createGroup', e, {
        screen: 'CreateGroupScreen',
        code,
        platform: Platform.OS,
        appCheckSuspected: code === 'unauthenticated',
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

  return (
    <GroupWizardForm
      headerTitle={he.createGroupTitle}
      submitLabel={he.createGroupSubmit}
      initial={EMPTY_GROUP_FORM_VALUES}
      onSubmit={submit}
    />
  );
}
