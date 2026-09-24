// actionResumers — what each action kind does when it is resumed after a sign-in.
//
// Registered at module scope, imported once from App.tsx. Deliberately NOT in
// the screens: by the time a resume runs, the screen that started it may have
// been unmounted and remounted (the existing-account path replaces the session,
// which swaps the whole navigator). A resumer that closed over screen state
// would be resuming into a component that no longer exists.
//
// ─── Re-validation is the point ──────────────────────────────────────────
//
// Every resumer calls the SERVER again. None of them trusts a snapshot taken
// before authentication, because the world moved while the person was in
// Google's sheet: the last seat can be taken, the game can start, the club can
// fill, an admin can approve or reject. The existing service functions already
// answer all of that correctly — the resumer's job is to ask them again and
// map the answer onto a terminal/retryable decision.

import { registerResumer, type ActionResult } from '@/services/actionCoordinator';
import { isDrafted, type PendingAction } from '@/services/pendingAction';
import { draftStore } from '@/services/draftStore';
import { gameService } from '@/services/gameService';
import { groupService } from '@/services/groupService';
import { useUserStore } from '@/store/userStore';
import { useGroupStore } from '@/store/groupStore';
import { failureReasonFromCode, isPresentButUnreadable } from '@/utils/pendingActionMachine';
import { logError } from '@/services/errorLog';

function uid(): string | null {
  const u = useUserStore.getState().currentUser;
  return u && u.isGuest !== true ? u.id : null;
}

/** Turn a thrown error into a decision. Only a network hiccup or a rate limit
 *  is worth keeping the stash for; everything else is an answer about the
 *  world that will not change by asking again. */
function fromError(err: unknown, where: string): ActionResult {
  const code = (err as { code?: string })?.code ?? '';
  if (isPresentButUnreadable(code)) {
    // The document is there, we just cannot read it. The screen has a view for
    // that, so the intent is satisfied.
    return { outcome: 'navigated', terminal: true };
  }
  const reason = failureReasonFromCode(code);
  const retryable = reason === 'network_unavailable' || reason === 'rate_limited';
  if (!retryable) logError(where, err, { code });
  return { outcome: 'joined', terminal: !retryable, reason };
}

// ─── join_game ────────────────────────────────────────────────────────────

registerResumer('join_game', async (action: PendingAction): Promise<ActionResult> => {
  const me = uid();
  if (!me) return { outcome: 'joined', terminal: false, reason: 'unknown' };
  const gameId = 'targetId' in action ? action.targetId : undefined;
  if (!gameId) return { outcome: 'joined', terminal: true, reason: 'target_deleted' };

  try {
    // Asked fresh. If the last seat went while the person was authenticating,
    // this returns `waitlist` — which is a RESULT, not a failure. Reporting it
    // as an error is how somebody who just got in line is told the app broke.
    const { bucket } = await gameService.requestJoinGame(gameId, me, 'deep_link');
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
    // Already in the game is NOT a failure. Signing into an account that had
    // already joined is a perfectly ordinary thing to do, and the existing
    // service answers it with the bucket the person is already in.
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'GAME_JOIN_REJECTED') {
      return { outcome: 'joined', terminal: true, reason: 'game_join_rejected' };
    }
    return fromError(err, 'resumeJoinGame');
  }
});

// ─── join_club ────────────────────────────────────────────────────────────

registerResumer('join_club', async (action: PendingAction): Promise<ActionResult> => {
  const me = uid();
  if (!me) return { outcome: 'joined', terminal: false, reason: 'unknown' };
  const groupId = 'targetId' in action ? action.targetId : undefined;
  if (!groupId) return { outcome: 'joined', terminal: true, reason: 'target_deleted' };

  // Already a member — which is exactly what happens when a guest taps join and
  // then signs into an account that is already in the club. Terminal success,
  // nothing to do.
  if (useGroupStore.getState().groups.some((g) => g.id === groupId)) {
    return { outcome: 'joined', terminal: true };
  }

  try {
    const { status } = await groupService.requestJoinById(groupId, me);
    if (status === 'not_found') {
      return { outcome: 'joined', terminal: true, reason: 'target_deleted' };
    }
    // `already_member` and `joined` are both "you are in"; `pending` means an
    // admin has to approve, which is still a completed REQUEST.
    return {
      outcome: status === 'pending' ? 'approval_pending' : 'joined',
      terminal: true,
    };
  } catch (err) {
    return fromError(err, 'resumeJoinClub');
  }
});

// ─── create_club ──────────────────────────────────────────────────────────
//
// The draft holds the form values; the club is created from them by the same
// `createGroup` the wizard's own submit calls. The screen is NOT involved —
// its `submit` closure is gone by now.

type CreateClubHandler = (values: Record<string, unknown>) => Promise<void>;
let createClubHandler: CreateClubHandler | null = null;

/**
 * The create screen hands its submit in, so the resumer runs the SAME code path
 * a signed-in person's tap runs — geocoding, seasons, the celebrate navigation
 * and all. Re-implementing it here would give the product a second, subtly
 * different way to make a club.
 */
export function setCreateClubHandler(fn: CreateClubHandler | null): void {
  createClubHandler = fn;
}

registerResumer('create_club', async (): Promise<ActionResult> => {
  const me = uid();
  if (!me) return { outcome: 'created', terminal: false, reason: 'unknown' };

  const draft = await draftStore.read('club');
  if (!draft) {
    // Expired or discarded. Terminal — there is nothing left to create, and
    // holding the action would keep offering a club nobody typed.
    return { outcome: 'created', terminal: true, reason: 'draft_expired' };
  }
  if (!createClubHandler) {
    // The screen has not mounted yet. HELD, not failed: the values are still on
    // disk and the next visit picks them up.
    return { outcome: 'created', terminal: false, reason: 'unknown' };
  }
  try {
    await createClubHandler(draft.values);
    return { outcome: 'created', terminal: true };
  } catch (err) {
    return fromError(err, 'resumeCreateClub');
  }
});

// ─── create_game — DELIBERATELY NOT RESUMED THIS ROUND ────────────────────
//
// The auth boundary and the draft ARE wired (see GameCreateScreen): a guest can
// fill the whole wizard, tap save, authenticate, and come back to a form that
// still has everything in it. What is NOT wired is the automatic completion.
//
// Why, precisely: `GameCreateScreen` provisions a hidden personal group through
// the `ensurePersonalGroup` callable in an effect ON MOUNT — before the person
// has typed anything — because the quick-game wizard needs a group to exist
// before it can render in quick mode. So for a guest the only reachable path is
// the standalone one (they are in no clubs, having never been able to join one),
// and that path has already had a server-side side effect by the time the save
// boundary is reached.
//
// Resuming it properly means either deferring that provisioning until after
// authentication, or threading `selectedGroup` / `isOrphan` / `isRecurring` /
// the route params out of the screen and into a resumer. Both are real
// refactors of a screen this round was told not to redesign, and a
// half-connected version — auto-creating a game against a group provisioned
// under an abandoned anonymous uid — is worse than asking the person to press
// save once more with their form already filled.
//
// Registering no resumer is the correct expression of that: `resumePendingAction`
// answers `held`, nothing is logged as a failure, the draft stays on disk, and
// the screen restores it on the next visit. Reported for the next round.

/**
 * Kept so `GameCreateScreen` can hand its creation path over the moment the
 * resumer is wired, without another round of plumbing. Unused today by design.
 */
type CreateGameHandler = (
  values: Record<string, unknown>,
  needsAttention: string[],
) => Promise<void>;
let createGameHandler: CreateGameHandler | null = null;
export function setCreateGameHandler(fn: CreateGameHandler | null): void {
  createGameHandler = fn;
}
/** Read once so the binding is not flagged unused; the resumer that will use it
 *  arrives next round. */
export function hasCreateGameHandler(): boolean {
  return createGameHandler !== null;
}

/** Imported for its side effects. Named so the import cannot look accidental. */
export const actionResumersRegistered = true;

/** Only used by the two setters above; re-exported for the drafted-kind guard
 *  in tests. */
export { isDrafted };
