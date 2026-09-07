// Guest gating — guests (anonymous "browse" sessions) can explore public
// communities + games, but any ACCOUNT action (join, create, RSVP, chat)
// must prompt them to register first (App Store guideline 5.1.1(v): browsing
// is free, account features require sign-up).
//
// Usage at an action site:
//   if (!ensureNotGuest()) return;   // guest → shows the register prompt
//
// "Register" ends the anonymous session (signOut), which drops the user back
// to the Sign-In screen where they can sign in with Google/Apple/email.

import { appAlert } from '@/components/AppDialog';
import { useUserStore } from '@/store/userStore';
import { storage, type PendingInvite } from '@/services/storage';
import { he } from '@/i18n/he';

/** True if the current session is an anonymous guest. */
export function isGuestSession(): boolean {
  return useUserStore.getState().currentUser?.isGuest === true;
}

/**
 * Returns true if the user is a real (registered) account and the caller may
 * proceed. If the user is a guest, shows a "register to continue" prompt and
 * returns false so the caller bails out of the account action.
 *
 * @param body Optional custom prompt body (e.g. "כדי להצטרף למשחק…").
 * @param returnTo Where the user was heading when they hit this wall. Choosing
 *   "register" SIGNS THE GUEST OUT, which swaps the whole navigator for the
 *   auth stack and unmounts the screen they were on — so without this the
 *   context of the action is simply gone, and after signing up they land on the
 *   games feed with no memory of the game they were trying to join (audit
 *   P1-8). Stashing it hands the target to the pending-invite consumer in
 *   RootNavigator, which is already the single place in the app that navigates
 *   after auth: it waits for the account to be ready, pre-flights that the
 *   target still exists, and clears the stash once. Reusing that path rather
 *   than adding a second one is what keeps this free of redirect loops.
 */
export function ensureNotGuest(body?: string, returnTo?: PendingInvite): boolean {
  if (!isGuestSession()) return true;
  appAlert(he.guestRegisterTitle, body ?? he.guestRegisterBody, [
    { text: he.cancel, style: 'cancel' },
    {
      text: he.guestRegisterCta,
      onPress: () => {
        void (async () => {
          // Stash BEFORE signing out: the sign-out is what tears the screen
          // down, and an await afterwards would race the unmount. A failure
          // here must not block registration — losing the return target is a
          // worse outcome than nothing only if it also blocks sign-up.
          if (returnTo) {
            try {
              await storage.setPendingInvite(returnTo);
            } catch (err) {
              if (__DEV__) console.warn('[guestGate] could not stash return target', err);
            }
          }
          await useUserStore.getState().signOut();
        })();
      },
    },
  ]);
  return false;
}
