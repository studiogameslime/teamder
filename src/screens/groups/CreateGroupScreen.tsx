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
import {
  GroupWizardForm,
  EMPTY_GROUP_FORM_VALUES,
  type GroupFormValues,
} from '@/screens/groups/GroupWizardForm';
import { createClubFromValues } from '@/services/clubCreation';

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
  // The screen's save. The creation itself lives in `clubCreation.ts` so the
  // resumer can run it when this screen is gone — see the note there. What
  // stays here is the part that needs a UI: the error dialogs and the
  // celebrate navigation.
  const createFromValues = async (v: GroupFormValues) => {
    const me = useUserStore.getState().currentUser;
    if (!me || me.isGuest === true) return;
    try {
      const { groupId, seasonsFailed } = await createClubFromValues(v, me);
      if (seasonsFailed) appAlert(he.error, he.newClubSeasonsFailed);
      (nav as { replace: (s: string, p: unknown) => void }).replace(
        'CommunityDetails',
        { groupId, celebrate: true },
      );
    } catch (e) {
      // Two practical failure modes, both worth their own message:
      //   `unauthenticated`  — the App Check / Play Integrity gate rejected the
      //                        callable. Common on an emulator, or before the
      //                        production keystore's SHA-256 is registered.
      //   `resource-exhausted` — the daily rate limit (5/day).
      const err = e as { code?: string; message?: string };
      const code = String(err.code ?? '').replace(/^functions\//, '');
      // A VALIDATION_ERROR is the form telling the person they left the name
      // empty — the guard working, not the app failing. It used to reach the
      // production error panel as "יצירת מועדון נכשלה" and read like a defect.
      if (code !== 'VALIDATION_ERROR') {
        logError('createGroup', e, {
          screen: 'CreateGroupScreen',
          code,
          platform: Platform.OS,
          appCheckSuspected: code === 'unauthenticated',
        });
      }
      logEvent(AnalyticsEvent.GroupCreateFailed, { code, platform: Platform.OS });
      let msg: string = he.createGroupGenericError;
      if (code === 'unauthenticated') msg = he.createGroupAuthError;
      else if (code === 'resource-exhausted') msg = err.message || he.createGroupRateLimitError;
      else if (err.message) msg = err.message;
      appAlert(he.error, msg);
    }
  };

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
