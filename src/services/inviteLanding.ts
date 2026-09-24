// Has this personal invite already been landed on?
//
// ─── Why this is not just "clear the stash" ──────────────────────────────
//
// It is what every other one-shot consumer in this app does, and here it
// would destroy the referral.
//
// `clearPendingAction()` removes BOTH the new key and `footy.invite.pending`
// — and the legacy one is what `applyInviteAttributionIfFresh` and
// `applyAcquisitionIfFresh` read, at SIGNUP, inside userService. Before the
// guest refactor those two things happened in the same breath: you opened a
// link, you were sent to sign in, you signed up, attribution landed, and only
// then did anything get cleared.
//
// A guest changes the order. The sequence is now: link → stash → silent
// anonymous session → consumer runs → (clear) → browse for a while → tap
// something → sign up. The signup that reads the stash happens LONG after the
// consumer that cleared it, so `getPendingInvite()` returns null and the
// invite is credited to nobody. Silent, and it applies to every personal
// invite opened by a person who does not already have an account — which is
// the entire audience for personal invites.
//
// So navigation and attribution get separate lifetimes. This latch says "the
// landing has been shown"; the stash keeps saying "this person came from
// Eliran" until a signup consumes it or a newer link replaces it.

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Remembers WHICH invite was landed on, not merely that one was — a second,
 *  different link arriving later must open its own landing. */
const KEY = 'footy.invite.landingShown';

/** The identity of a personal invite, for latch purposes. Two links from the
 *  same person are the same invitation; a link from somebody else is not. */
function latchValue(invitedBy: string | undefined): string {
  return invitedBy && invitedBy.length > 0 ? `by:${invitedBy}` : 'anonymous';
}

/**
 * Has the landing for this invite already been shown on this device?
 *
 * False on any read failure: showing a landing twice is a small annoyance,
 * never showing it is the feature not existing.
 */
export async function wasLandingShown(invitedBy?: string): Promise<boolean> {
  try {
    const seen = await AsyncStorage.getItem(KEY);
    return seen === latchValue(invitedBy);
  } catch {
    return false;
  }
}

/** Record that the landing has been shown. Best-effort — a failure here costs
 *  a repeat landing, not a lost invite. */
export async function markLandingShown(invitedBy?: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, latchValue(invitedBy));
  } catch {
    // Ignored on purpose; see above.
  }
}

/** Visible for tests, and for a sign-out that should let a fresh person on the
 *  same device meet their own invitation. */
export async function resetLanding(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Ignored on purpose.
  }
}
