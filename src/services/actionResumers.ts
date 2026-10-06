// actionResumers — what each action kind does when it is resumed after a sign-in.
//
// Registered at module scope, imported once from App.tsx. Deliberately NOT in
// the screens, and this is the correction that matters: an earlier version had
// the create screens hand their submit in while mounted, which meant the
// handler was null in exactly the two cases a resume happens. Signing into an
// existing account replaces the session and remounts the navigator; a brand-new
// account renders the profile confirmation over everything. Both unmount the
// screen. A club promised after sign-in was therefore held indefinitely — no
// error, no club.
//
// So the business logic is in `gameCreation.ts` / `clubCreation.ts`, the screens
// call it, and these call the same functions. Navigation afterwards goes through
// `navigationRef`, which exists for precisely this: acting on the navigator from
// outside the tree.
//
// ─── Re-validation is the point ──────────────────────────────────────────
//
// Every resumer asks the SERVER again. The world moved while the person was in
// a provider's sheet: the last seat can be taken, the game can start, a club can
// be deleted, an admin can approve or reject. The existing service functions
// already answer all of that — a resumer's job is to ask them and map the
// answer onto terminal / retryable / needs-correction.

import { registerResumer, type ActionResult } from '@/services/actionCoordinator';
import type { PendingAction } from '@/services/pendingAction';
import { draftStore } from '@/services/draftStore';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { persistAvailability } from '@/services/availabilitySave';
import { createGameFromValues } from '@/services/gameCreation';
import { createClubFromValues } from '@/services/clubCreation';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { navigateAfterCreate } from '@/navigation/navigationRef';
import { failureReasonFromCode, isPresentButUnreadable } from '@/utils/pendingActionMachine';
import { logError } from '@/services/errorLog';
import { EMPTY_GROUP_FORM_VALUES, type GroupFormValues } from '@/screens/groups/GroupWizardForm';
import type { GameFormValues } from '@/screens/games/GameWizardForm';
import type { UserAvailability } from '@/types';

/** The FULL account, or null. A guest can never resume anything. */
function fullUser() {
  const u = useUserStore.getState().currentUser;
  return u && u.isGuest !== true ? u : null;
}

/** Turn a thrown error into a decision. Only a transport hiccup or a rate limit
 *  is worth keeping the stash for; anything else is an answer about the world
 *  that will not change by asking again. */
function fromError(
  err: unknown,
  where: string,
  /** The outcome this kind would have reached. Carried so a failure reads as
   *  a failure OF THE RIGHT THING — a filler application that could not be
   *  sent is not a join that did not happen. `reason` is what stops any of
   *  these being reported as a success, whatever the outcome says. */
  outcome: ActionResult['outcome'] = 'joined',
): ActionResult {
  const code = (err as { code?: string })?.code ?? '';
  if (isPresentButUnreadable(code)) {
    // The document is there, we just cannot read it. The target screen has a
    // view for that, so the intent is satisfied.
    return { outcome: 'navigated', terminal: true };
  }
  const reason = failureReasonFromCode(code);
  const retryable = reason === 'network_unavailable' || reason === 'rate_limited';
  if (!retryable) logError(where, err, { code });
  return { outcome, terminal: !retryable, reason };
}

// ─── join_game ────────────────────────────────────────────────────────────

registerResumer('join_game', async (action: PendingAction): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'joined', terminal: false, reason: 'unknown' };
  const gameId = 'targetId' in action ? action.targetId : undefined;
  if (!gameId) return { outcome: 'joined', terminal: true, reason: 'target_deleted' };

  try {
    // Asked fresh. If the last seat went while the person was authenticating
    // this returns `waitlist` — a RESULT, not a failure. Reporting it as an
    // error is how somebody who just got in line is told the app broke.
    const { bucket } = await gameService.requestJoinGame(gameId, me.id, 'deep_link');
    return {
      outcome:
        bucket === 'waitlist'
          ? 'waitlisted'
          : bucket === 'pending'
            ? 'approval_pending'
            : 'joined',
      terminal: true,
    };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    // Signing into an account that had already joined is an ordinary thing to
    // do, not a failure.
    if (code === 'GAME_JOIN_REJECTED') {
      return { outcome: 'joined', terminal: true, reason: 'game_join_rejected' };
    }
    return fromError(err, 'resumeJoinGame');
  }
});

// ─── apply_filler ─────────────────────────────────────────────────────────

registerResumer('apply_filler', async (action: PendingAction): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'approval_pending', terminal: false, reason: 'unknown' };
  const gameId = 'targetId' in action ? action.targetId : undefined;
  if (!gameId) {
    return { outcome: 'approval_pending', terminal: true, reason: 'target_deleted' };
  }

  try {
    // Asked fresh, through the same helper the screen uses — which now throws
    // rather than swallowing, so a refusal reaches this catch instead of being
    // reported as a success. The callable re-validates everything: the match
    // may have filled, been cancelled, or had fillers switched off while the
    // person was inside a provider's sheet.
    // Imported dynamically: `notificationActionService` reaches
    // `@/firebase/auth`, whose native module graph cannot be loaded under
    // jest's node environment. A static import here breaks every test that
    // touches the resumers — the same trap `notificationOffer` avoids the
    // same way.
    const { handleFillerOpportunityAction } = await import(
      '@/services/notificationActionService'
    );
    await handleFillerOpportunityAction('EXPRESS_FILLER_INTEREST', gameId, 'screen');
    // There is only ever one outcome. A filler application does not grant a
    // place; it puts the person in front of an admin.
    return { outcome: 'approval_pending', terminal: true };
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    // `already-exists` means the interest is already on record — which is the
    // state the person was asking for. Not a failure.
    if (code === 'functions/already-exists' || code === 'already-exists') {
      return { outcome: 'approval_pending', terminal: true };
    }
    return fromError(err, 'resumeApplyFiller', 'approval_pending');
  }
});

// ─── join_club ────────────────────────────────────────────────────────────

registerResumer('join_club', async (action: PendingAction): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'joined', terminal: false, reason: 'unknown' };
  const groupId = 'targetId' in action ? action.targetId : undefined;
  if (!groupId) return { outcome: 'joined', terminal: true, reason: 'target_deleted' };

  // Already a member — what happens when a guest taps join and then signs into
  // an account that is already in the club. Terminal success, nothing to do.
  //
  // ⚠️ Only trustworthy once the store has HYDRATED. This resumer runs in the
  // seconds right after a sign-in, which is exactly when the club list is
  // still empty — and an empty list is not "no clubs", it is "not asked yet".
  // Read as the former it sent a join request for a club the person was
  // already in, which the rules deny, correctly, and which surfaced as
  // `resumeJoinClub · permission-denied` from a member of the club he was
  // "joining" (30.09). Wait for the answer before acting on it.
  const groupState = useGroupStore.getState();
  // Best-effort, and tolerant of a store that cannot answer: this is a guard
  // against acting on a half-loaded list, not a dependency.
  if (!groupState.hydrated && typeof groupState.hydrate === 'function') {
    await groupState.hydrate(me.id).catch(() => {});
  }
  if (useGroupStore.getState().groups.some((g) => g.id === groupId)) {
    return { outcome: 'joined', terminal: true };
  }

  try {
    const { status } = await groupService.requestJoinById(groupId, me.id);
    if (status === 'not_found') {
      return { outcome: 'joined', terminal: true, reason: 'target_deleted' };
    }
    return {
      outcome: status === 'pending' ? 'approval_pending' : 'joined',
      terminal: true,
    };
  } catch (err) {
    return fromError(err, 'resumeJoinClub');
  }
});

// ─── create_club ──────────────────────────────────────────────────────────

registerResumer('create_club', async (): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'created', terminal: false, reason: 'unknown' };

  const draft = await draftStore.read('club');
  if (!draft) {
    // Expired or discarded. Terminal — there is nothing left to create, and
    // holding would keep offering a club nobody typed.
    return { outcome: 'created', terminal: true, reason: 'draft_expired' };
  }

  // Merged onto the CURRENT defaults rather than trusted whole: a field the
  // wizard no longer has must not come back from a stale draft.
  const values = draftStore.merge(
    EMPTY_GROUP_FORM_VALUES as unknown as Record<string, unknown>,
    draft.values,
  ) as unknown as GroupFormValues;

  // ── A draft that cannot become a club ────────────────────────────────
  //
  // Somebody opened the wizard, filled in something that is not the name — a
  // city, a note — and met the auth wall before typing one. The draft is
  // saved, and `createClubFromValues` then throws "יש להזין שם המועדון" every
  // time it is resumed.
  //
  // That threw twice into the error inbox, but the count is the small half of
  // it: a validation failure is not retryable, so the coordinator kept the
  // action stashed and tried again on EVERY launch, forever, for anyone whose
  // draft had no name. Checking here makes it terminal on the first attempt
  // and reports it as the expired draft it effectively is — nothing was typed
  // that can be built, and re-offering it is offering a club nobody named.
  if (!values.name || !values.name.trim()) {
    await draftStore.discard('club');
    return { outcome: 'created', terminal: true, reason: 'draft_expired' };
  }

  try {
    const { groupId } = await createClubFromValues(values, me);
    // Land them on the club they just made, celebrating — the same arrival the
    // screen's own submit produces.
    navigateAfterCreate({ type: 'club', id: groupId });
    return { outcome: 'created', terminal: true };
  } catch (err) {
    return fromError(err, 'resumeCreateClub');
  }
});

// ─── create_game ──────────────────────────────────────────────────────────

registerResumer('create_game', async (action: PendingAction): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'created', terminal: false, reason: 'unknown' };

  const draft = await draftStore.read('game');
  if (!draft) return { outcome: 'created', terminal: true, reason: 'draft_expired' };

  // A club game carries its groupId on the action; a standalone one does not,
  // and `createGameFromValues` provisions the personal group under THIS uid.
  const groupId = 'targetId' in action ? (action.targetId ?? null) : null;

  // Authorisation can have lapsed while they were authenticating: the club may
  // be gone, or this account may not administer it. Checked before creating
  // rather than discovered as a rules denial.
  let groupName: string | undefined;
  if (groupId) {
    const club = useGroupStore.getState().groups.find((g) => g.id === groupId);
    if (!club) {
      // Not a member of it (or it is gone). Nothing retryable about that — the
      // draft is kept so the values are not lost, but the intent cannot stand.
      return { outcome: 'created', terminal: true, reason: 'target_deleted' };
    }
    if (!club.adminIds?.includes(me.id)) {
      return { outcome: 'created', terminal: true, reason: 'game_join_rejected' };
    }
    groupName = club.name;
  }

  // The kick-off may have passed while they were away. Do NOT create, and do
  // NOT invent a replacement date — the person has to choose. `needsAttention`
  // makes this a NEEDS-CORRECTION outcome: non-terminal, so the draft and the
  // intent both survive and the form reopens filled in.
  const restored = draftStore.restoreGameValues(
    draft.values as Record<string, unknown>,
    draft.values as Record<string, unknown>,
    Date.now(),
  );
  if (restored.needsAttention.length > 0) {
    return { outcome: 'created', terminal: false, reason: 'draft_expired' };
  }

  try {
    const { gameId } = await createGameFromValues({
      values: restored.values as unknown as GameFormValues,
      uid: me.id,
      groupId,
      groupName,
    });
    navigateAfterCreate({ type: 'game', id: gameId });
    return { outcome: 'created', terminal: true };
  } catch (err) {
    // A VALIDATION failure is not a failure of the resumer.
    //
    // `createGameFromValues` throws a plain Error with a Hebrew message when
    // a required field is empty — "יש להזין שם המגרש" was logged to the error
    // inbox as "פעולה נכשלה", which is the same mistake as filing a dropped
    // network as a bug: it is a draft that needs one more field, and the
    // person is right there to supply it.
    //
    // These errors carry no `code`, which is exactly what separates them from
    // the Firestore / callable failures `fromError` is built to classify. So
    // they take the same non-terminal path an expired draft already takes:
    // the stash survives and the form reopens filled in.
    const code = (err as { code?: string })?.code ?? '';
    if (!code) {
      return { outcome: 'created', terminal: false, reason: 'draft_expired' };
    }
    return fromError(err, 'resumeCreateGame');
  }
});

// ─── save_availability ────────────────────────────────────────────────────
//
// Availability lives ON the user document, which is what made this the last one
// to connect: a guest has no such document, so "save it now and reconcile later"
// is not available. The answer is that a guest's availability is a LOCAL DRAFT
// and nothing else — no `/users/{anonymousUid}` is written, which the tightened
// rules also refuse.
//
// Ordering is the subtle part. For a new account the profile confirmation must
// complete FIRST, because `updateAvailability` writes onto a document that
// `completeOnboarding` creates. The coordinator's resume pass is gated on
// `hasCompletedOnboarding` in RootNavigator, so by the time this runs the
// document exists.

registerResumer('save_availability', async (): Promise<ActionResult> => {
  const me = fullUser();
  if (!me) return { outcome: 'created', terminal: false, reason: 'unknown' };

  const draft = await draftStore.read('availability');
  if (!draft) return { outcome: 'created', terminal: true, reason: 'draft_expired' };

  // `persistAvailability` is the screen's own write, extracted — same payload,
  // same auth-race retry, and the same recovery for the one account in
  // production that had no /users document at all. Coords ride in the draft
  // because geocoding happened while the person was still on the screen.
  const { availability, coords } = draft.values as unknown as {
    availability: UserAvailability;
    coords: { lat: number; lng: number } | null;
  };
  try {
    await persistAvailability(me.id, availability, coords ?? null);
    return { outcome: 'created', terminal: true };
  } catch (err) {
    return fromError(err, 'resumeSaveAvailability');
  }
});

/** Imported for its side effects. Named so the import cannot look accidental. */
export const actionResumersRegistered = true;
