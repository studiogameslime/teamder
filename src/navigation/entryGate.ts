// entryGate — "does this person still need the first-run entry experience?"
//
// One pure decision, kept out of RootNavigator so it can be asserted directly
// instead of inferred from a rendered tree.
//
// ─── The semantics, because the name of the flag is the whole design ─────
//
// `organicCompleted` means "this DEVICE no longer needs the first-run entry
// experience". It does not mean "has seen Welcome".
//
// Two rules, and the code below is exactly them:
//
//   1  a full (non-anonymous) account never sees it — they are past it;
//   2  a guest who answered the intent question never sees it again.
//
// ─── A deep link no longer skips it ─────────────────────────────────────
//
// It used to. The earlier design treated "this launch already knows where it
// is going" as a reason to send somebody straight to the match or club they
// tapped, and `computeEntryBypass` lived here to work that out.
//
// That is now wrong, deliberately. A new person who followed a friend's link
// still meets Welcome and still meets the intent question — the difference is
// that the intent question KNOWS they were invited and offers the invitation
// as a fourth choice at the top. The old behaviour trapped them in the
// inviter's path: somebody who downloaded Teamder because Eliran sent a match
// link, but actually wants to start their own club, had to find their way out
// of a match screen to do it.
//
// The link is not lost by this. It stays in `pendingAction` exactly as before
// — attribution still reads it at signup — and the intent screen renders it as
// the invite card. Nothing about the stash, the draft store or the resume
// changed; only who decides when the target opens, and that is now the person.
//
// ─── Why there is a third state ─────────────────────────────────────────
//
// `organicCompleted` is read from AsyncStorage and the navigator renders
// before it lands. Defaulting the unknown either way flashes a screen: guess
// "show" and a returning guest sees Welcome for a frame, guess "skip" and a
// fresh install sees the tabs. `null` is a real state here, not a missing
// value, and it renders the splash the app is already showing.

import type { PendingAction } from '@/services/pendingAction';

/** Which invitation brought this person here, if any. */
export type EntryInviteKind = 'game' | 'club' | 'referral';

export interface EntryInvite {
  kind: EntryInviteKind;
  /** The game or club the link named. Absent for a general referral. */
  targetId?: string;
  /** The inviter's uid. The NAME is resolved at display time from
   *  `/usersPublic` — it is not in the stash and never was. */
  invitedBy?: string;
}

/**
 * Read an invitation out of whatever is stashed.
 *
 * Pure and exported so the mapping is assertable without a store.
 *
 * ─── The two judgement calls ──────────────────────────────────────────
 *
 * A game or club link with NO inviter still gets a card. It is a shared link
 * rather than a personal invitation, so the card carries no "invited by" tag —
 * but dropping it would strand the person: the entry flow no longer skips to
 * the target, so the card is the only way back to the thing they tapped.
 *
 * An `open_invite` with no inviter gets NOTHING. That is not an invitation at
 * all: the Play Install Referrer resolves to `{type:'app',
 * source:'google-play'}` on an ordinary store install, and rendering "הוזמנת
 * על ידי" for somebody who simply downloaded the app is the app inventing a
 * friend. The consumer in RootNavigator draws the same line.
 */
export function inviteFromPending(pending: PendingAction | null): EntryInvite | null {
  if (!pending) return null;
  if (pending.kind === 'open_game') {
    return { kind: 'game', targetId: pending.targetId, invitedBy: pending.invitedBy };
  }
  if (pending.kind === 'open_club') {
    return { kind: 'club', targetId: pending.targetId, invitedBy: pending.invitedBy };
  }
  if (pending.kind === 'open_invite' && pending.invitedBy) {
    return { kind: 'referral', invitedBy: pending.invitedBy };
  }
  return null;
}

export type EntryDecision =
  /** Still resolving. Render the splash — never Welcome, never the tabs. */
  | 'unknown'
  /** Show the Welcome → Intent stack. */
  | 'entry'
  /** Straight through to the app. */
  | 'app';

export function decideEntry(args: {
  isGuest: boolean;
  /** `null` while the read is in flight. */
  organicCompleted: boolean | null;
  /**
   * An "התחברות לחשבון קיים" attempt found a brand-new identity.
   *
   * See `entryStore.existingAccountWasNew`. Paired with `hasCompletedOnboarding`
   * below, which is what separates "on the way to the profile screen" from
   * "back from it".
   */
  existingAccountWasNew?: boolean;
  /** `/users/{uid}.onboardingCompleted`. Only read for the rule above. */
  hasCompletedOnboarding?: boolean;
}): EntryDecision {
  // Rule 0. Somebody who said "I already have an account", did not, and has
  // since finished the profile screen comes BACK here to answer the question —
  // a new person does not get to skip it by claiming to be an old one.
  //
  // Deliberately narrower than "any new account owes the question": a person
  // who picked a card, hit the auth wall and turned out to be new has already
  // said what they came for, and must resume that instead. The flag is only
  // ever set on the CTA's own journey.
  //
  // `hasCompletedOnboarding` is what holds this back until the profile is in:
  // without it the rule would fire the instant the account became full and
  // would replace the profile screen with the question.
  if (
    !args.isGuest &&
    args.existingAccountWasNew === true &&
    args.hasCompletedOnboarding === true
  ) {
    return 'entry';
  }
  // Rule 1. Checked FIRST and without touching storage: a signed-in person
  // must never be held on a splash waiting for a flag that cannot change the
  // answer. This is also what keeps every existing account out of the new
  // flow on upgrade.
  if (!args.isGuest) return 'app';
  if (args.organicCompleted === null) return 'unknown';
  // Rule 2.
  if (args.organicCompleted) return 'app';
  return 'entry';
}
