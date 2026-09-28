// entryStore — what the first-run entry needs to know, and nothing else.
//
// Two things: whether this device still needs the entry flow, and whether the
// person arrived on somebody's invitation. Both start `null`/unresolved, which
// the gate renders as the splash — see `entryGate.ts` for why that third state
// is load-bearing rather than defensive.
//
// The chosen destination lives here too, as a one-shot. IntentScreen cannot
// navigate to it itself: the tabs it is addressing are not mounted while the
// entry stack is on screen. So the screen records the choice, flips the flag,
// and RootNavigator — which is what mounts MainTabs a render later — consumes
// it. Same shape as the deep-link consumer directly above it in that file.

import { create } from 'zustand';

import { storage } from '@/services/storage';
import { readPendingAction } from '@/services/pendingAction';
import { logError } from '@/services/errorLog';
import { inviteFromPending, type EntryInvite } from '@/navigation/entryGate';

export { inviteFromPending };
export type { EntryInvite, EntryInviteKind } from '@/navigation/entryGate';

/** The three standing cards, plus the invitation when there is one. */
export type EntryIntent = 'create_club' | 'find_game' | 'one_off_game' | 'invite';

interface EntryState {
  /** `null` until read from disk. */
  organicCompleted: boolean | null;
  /** The invitation this launch arrived on, or null. */
  invite: EntryInvite | null;
  /** Set by IntentScreen, consumed once by RootNavigator. */
  pendingIntent: EntryIntent | null;
  /**
   * The person chose something OTHER than their invitation, so the deep-link
   * consumer must not drag them to the target anyway.
   *
   * This is the whole point of the redesign. Somebody who downloaded Teamder
   * because a friend sent a match link, but who actually wants to start their
   * own club, taps "מקים מועדון" — and the automatic consumer would otherwise
   * fire a frame later and land them in the match.
   *
   * It suppresses NAVIGATION only. The stash is left completely alone, so
   * `applyInviteAttributionIfFresh` still credits the inviter at signup.
   */
  suppressAutoConsume: boolean;

  /**
   * An "התחברות לחשבון קיים" attempt is open.
   *
   * Set when the CTA opens the auth sheet, cleared when the journey ends. It
   * exists to SCOPE the return-to-intent behaviour below to this one path:
   * somebody who picked a card, hit the auth wall and turned out to be new
   * must resume their action, not be asked the question again.
   *
   * It is NOT an intent and NOT a pending action. Nothing is written to disk
   * for it, `organicCompleted` is untouched, and `suppressAutoConsume` stays
   * where it was — an invitation already on the disk survives it intact.
   */
  existingAccountAttempt: boolean;
  /**
   * That attempt found a brand-new identity: the person claimed an account and
   * does not have one.
   *
   * Latched by RootNavigator at the only moment it is knowable — a full
   * account that still owes onboarding — because the email provider leaves
   * the sheet before it can answer, and a flag set only by the sheet would be
   * true for Google and Apple and false for email.
   *
   * While it is set AND onboarding has since completed, the gate shows the
   * entry stack again: a new person does not get to skip the question either.
   */
  existingAccountWasNew: boolean;

  hydrate: () => Promise<void>;
  chooseIntent: (intent: EntryIntent) => Promise<void>;
  /** The CTA opened the sheet. */
  beginExistingAccountAttempt: () => void;
  /** The attempt's identity has no Teamder account behind it. */
  markExistingAccountWasNew: () => void;
  /** Cancelled, or finished — either way the attempt is over. */
  endExistingAccountAttempt: () => void;
  markAccountSeen: () => Promise<void>;
  takePendingIntent: () => EntryIntent | null;
}

export const useEntryStore = create<EntryState>((set, get) => ({
  organicCompleted: null,
  invite: null,
  pendingIntent: null,
  suppressAutoConsume: false,
  existingAccountAttempt: false,
  existingAccountWasNew: false,

  hydrate: async () => {
    // Two independent reads. A failure in either resolves to the SAFE value
    // rather than leaving the gate on `null` forever — an unresolved gate is a
    // permanent splash, which is worse than any decision it could make.
    let organicCompleted = false;
    try {
      organicCompleted = await storage.getEntryOrganicCompleted();
    } catch (err) {
      logError('entryHydrateFlag', err, {});
    }

    let invite: EntryInvite | null = null;
    try {
      invite = inviteFromPending(await readPendingAction());
    } catch (err) {
      // No card rather than a wrong card. The three standing choices still
      // work and the stash is untouched, so nothing is lost but one row.
      logError('entryHydrateInvite', err, {});
    }

    set({ organicCompleted, invite });
  },

  chooseIntent: async (intent) => {
    // The destination is recorded BEFORE the flag flips, so the render that
    // mounts the tabs already has somewhere to go.
    set({
      pendingIntent: intent,
      organicCompleted: true,
      suppressAutoConsume: intent !== 'invite',
      // Answering the question ends any existing-account journey: this is the
      // choice that journey was sent back here to make.
      existingAccountAttempt: false,
      existingAccountWasNew: false,
    });
    await storage.setEntryOrganicCompleted();
  },

  beginExistingAccountAttempt: () => set({ existingAccountAttempt: true }),
  markExistingAccountWasNew: () => {
    if (!get().existingAccountAttempt) return;
    set({ existingAccountWasNew: true });
  },
  endExistingAccountAttempt: () =>
    set({ existingAccountAttempt: false, existingAccountWasNew: false }),

  markAccountSeen: async () => {
    if (get().organicCompleted) return;
    set({ organicCompleted: true });
    await storage.setEntryOrganicCompleted();
  },

  takePendingIntent: () => {
    const intent = get().pendingIntent;
    if (intent) set({ pendingIntent: null });
    return intent;
  },
}));
