// useAuthenticatedAction — the one thing a screen calls to do a gated action.
//
// Five screens needed "run this, but sign the person in first if they are a
// guest, and then run it". Written five times that is five slightly different
// answers to what cancel does, what a waitlist means, and whether the draft
// survives. Written once it is a contract.
//
// The screen supplies WHAT to do; this owns WHEN, and `actionCoordinator` owns
// the persistence and the lock. The screen renders `<sheet />` wherever it
// likes and otherwise does not think about authentication at all.
//
//   const join = useAuthenticatedAction();
//   …
//   <Button onPress={() => join.request({
//     kind: 'join_game',
//     targetId: game.id,
//     execute: async () => { … },
//   })} />
//   {join.sheet}

import React, { useCallback, useState } from 'react';

import {
  requestAction,
  resumePendingAction,
  type ActionRequest,
  type ActionResult,
} from '@/services/actionCoordinator';
import {
  ContextualAuthSheet,
  type AuthPromptReason,
} from '@/components/auth/ContextualAuthSheet';
import { useUserStore } from '@/store/userStore';
import { logError } from '@/services/errorLog';
import { reportResumeOutcome } from '@/services/resumeFeedback';

export interface UseAuthenticatedAction {
  /** Ask for the action. Resolves once it has either run or been parked. */
  request: (req: ActionRequest) => Promise<ActionResult | null>;
  /**
   * Ask for an ACCOUNT, with nothing waiting behind it.
   *
   * For the "register" buttons that are not gating anything — the guest
   * profile, the guest player card. They used to call `signOut()`, on the
   * theory that dropping the anonymous session would reveal the auth stack.
   * It does not: `signOut` leaves `currentUser` null with `guestInitFailed`
   * false, `hydrate` does not run again in the same session, and RootNavigator
   * has no branch for that pair — so the app sat on the splash until it was
   * force-closed. Opening the sheet keeps the session, keeps the screen, and
   * keeps the person exactly where they were if they back out.
   *
   * Deliberately NOT routed through `requestAction`: there is no intent to
   * persist and no resumer to run. A fake PendingAction would outlive the
   * sheet and be resumed later by something that has nothing to do.
   */
  requestAuth: () => void;
  /** Render this somewhere in the screen's tree. */
  sheet: React.ReactNode;
  /** True while the action itself is running (not while authenticating). */
  busy: boolean;
}

export function useAuthenticatedAction(): UseAuthenticatedAction {
  const [pendingKind, setPendingKind] = useState<AuthPromptReason | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [busy, setBusy] = useState(false);

  const request = useCallback(async (req: ActionRequest) => {
    setBusy(true);
    let out;
    try {
      out = await requestAction(req);
    } finally {
      setBusy(false);
    }
    if (out.status === 'done') return out.result;
    if (out.status === 'busy') return null;

    setHasDraft(!!req.draft);
    setPendingKind(req.kind);
    return null;
  }, []);

  const requestAuth = useCallback(() => {
    setHasDraft(false);
    setPendingKind('account_upgrade');
  }, []);

  // Backed out. The pending action and the draft stay on disk, the sheet
  // closes, and — deliberately — nothing re-opens it. Somebody who declined
  // once must not be asked again by the app's own initiative; the next prompt
  // comes from them tapping the action again.
  const onCancel = useCallback(() => {
    setPendingKind(null);
  }, []);

  const onAuthenticated = useCallback(
    async ({ isNewAccount }: { uid: string; isNewAccount: boolean }) => {
      // Close FIRST. A sheet still mounted while the profile screen appears is
      // a modal over a modal, and on iOS the second one silently never shows.
      setPendingKind(null);

      // Tell the store who is signed in now, BEFORE anything else runs.
      //
      // `upgradeAnonymous` links or switches the Firebase session directly and
      // returns an outcome; it never touched `currentUser`. So the store still
      // held the GUEST object after a successful upgrade, `useIsGuest()` stayed
      // true, and the gate that had just been satisfied opened this sheet again
      // on the very next press — for ever. Reported from production as "creating
      // a club or a game asks me to sign in, then asks again, and I cannot get
      // past it".
      //
      // Before the resume, not after: the resumer and every screen behind the
      // sheet read the store, and they must see the real account.
      await useUserStore.getState().refreshFromSession();

      // A brand-new account owes a name and an avatar. RootNavigator's gate
      // already renders `PostSignInOnboardingScreen` for exactly that state —
      // `hasCompletedOnboarding()` is false — so the resume is left to the
      // coordinator's boot pass, which runs after that screen saves. Doing it
      // here would race the navigator swap.
      if (isNewAccount) return;

      // An existing account is ready now — resume through the REGISTERED
      // RESUMER, never by replaying the request the screen handed in.
      //
      // Reached from `requestAuth` too, and correctly: there is usually
      // nothing stashed, in which case this returns `none` and does nothing.
      // When something IS stashed — the person hit a wall earlier, backed out,
      // and has now registered from the profile — finishing it is exactly what
      // they asked for the first time.
      //
      // That distinction is the whole correctness of this path. A screen's
      // executor is written for the case where the person is already signed in,
      // and for the guest branch it is a placeholder that never runs. Replaying
      // it here would report success without doing anything: the stash would be
      // cleared and the person would never have joined the game. The resumer, by
      // contrast, asks the server again — which is also the only way to get the
      // CURRENT answer after time has passed inside a provider's sheet.
      try {
        const out = await resumePendingAction();
        // Say what it actually got them. Only one caller of
        // `resumePendingAction` can win the lock for a given action, so this
        // is the whole of the "exactly once" guarantee for the message too.
        if (out.status === 'ran') reportResumeOutcome(out.kind, out.result);
      } catch (err) {
        logError('authenticatedActionResume', err, {});
      }
    },
    [],
  );

  const sheet = pendingKind ? (
    <ContextualAuthSheet
      visible
      kind={pendingKind}
      hasDraft={hasDraft}
      onCancel={onCancel}
      onAuthenticated={(r) => void onAuthenticated(r)}
    />
  ) : null;

  return { request, requestAuth, sheet, busy };
}

/**
 * Is the current viewer a guest?
 *
 * Exported here so screens stop reaching for `currentUser.isGuest` themselves —
 * `me` is TRUTHY for a guest, and every place that checked `!me` to mean
 * "signed out" was wrong the moment the silent session shipped.
 */
export function useIsGuest(): boolean {
  return useUserStore((s) => s.currentUser?.isGuest === true);
}
