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
 */
export function ensureNotGuest(body?: string): boolean {
  if (!isGuestSession()) return true;
  appAlert(he.guestRegisterTitle, body ?? he.guestRegisterBody, [
    { text: he.cancel, style: 'cancel' },
    {
      text: he.guestRegisterCta,
      onPress: () => {
        void useUserStore.getState().signOut();
      },
    },
  ]);
  return false;
}
