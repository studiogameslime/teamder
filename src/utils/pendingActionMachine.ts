// pendingActionMachine — the behaviour of "I tried to do something, I wasn't
// signed in, and now I'm back".
//
// A PURE module. It performs no navigation, touches no Firebase, reads no
// AsyncStorage and holds no React state. Given a context and an event it
// answers three questions and nothing else:
//
//   • what state are we in now,
//   • what must happen to the persisted pending action,
//   • what must happen to the persisted draft.
//
// That purity is not a style preference. `jest.config.js` sets
// `testEnvironment: 'node'`, so a module that imports React Native or Expo
// fails to load before a single case runs — the same reason `src/utils/appLinks.ts`
// is hand-written rather than built on expo-linking. Every transition below is
// therefore directly testable, which is the whole point of putting the
// behaviour here instead of inside the navigator.
//
// The caller owns the side effects. It reads `pendingAction` / `draft` off the
// returned transition and calls pendingAction.ts / draftStore.ts accordingly.

import type { PendingActionKind } from '@/services/pendingAction';

// ─── States ───────────────────────────────────────────────────────────────

export type MachineState =
  /** Signed in anonymously (or not yet acting), free to look around. */
  | 'ANONYMOUS_BROWSING'
  /** The person asked for something; we have not yet checked who they are. */
  | 'ACTION_REQUESTED'
  /** They are a guest and the action needs an account. The sheet is up. */
  | 'AUTH_REQUIRED'
  /** A provider was chosen and we are waiting on it. */
  | 'AUTH_IN_PROGRESS'
  /** Brand-new account: name + avatar still to confirm. */
  | 'PROFILE_REQUIRED'
  /** Replaying the original action now that they are somebody. */
  | 'RESUMING_ACTION'
  /** The action completed. Includes waitlisted / awaiting-approval. */
  | 'SUCCESS'
  /** The action cannot complete. Terminal for this attempt. */
  | 'FAILURE';

// ─── Events ───────────────────────────────────────────────────────────────

/** Why a resume could not complete.
 *
 *  The codes are not invented here — `joinGameV2` already throws a closed set
 *  (see the `[...].includes(e.code)` list in `src/services/gameService.ts`),
 *  and these are those codes plus the three the consumer itself discovers. */
export type FailureReason =
  | 'target_deleted'
  | 'draft_expired'
  | 'network_unavailable'
  | 'game_overlap'
  | 'registration_conflict'
  | 'game_not_open'
  | 'game_started'
  | 'game_live'
  | 'game_join_rejected'
  | 'group_full'
  | 'stale_offer'
  | 'rate_limited'
  | 'unknown';

/** Failures worth another attempt with the same stash. Anything else is a
 *  statement about the world that will not change by retrying. */
const RETRYABLE: ReadonlySet<FailureReason> = new Set<FailureReason>([
  'network_unavailable',
  'rate_limited',
]);

/** How a resume finished. All of these are SUCCESS — a waitlist place and a
 *  pending approval are outcomes, not errors, and reporting them as failures
 *  is how a full game ends up looking broken to the person who just got in
 *  line for it. */
export type ResumeOutcome =
  | 'joined'
  | 'waitlisted'
  | 'approval_pending'
  | 'created'
  /** Navigate-only kinds — including a target we cannot read but can show a
   *  blocked-access screen for. */
  | 'navigated';

export type MachineEvent =
  /** The person tapped the thing. */
  | { type: 'ACTION_TAPPED'; kind: PendingActionKind }
  /** Identity resolved at the action site. */
  | { type: 'IS_GUEST' }
  | { type: 'IS_AUTHED' }
  /** A provider button in the sheet. */
  | { type: 'PROVIDER_PICKED' }
  | { type: 'AUTH_OK'; isNewAccount: boolean }
  | { type: 'AUTH_CANCELLED' }
  | { type: 'AUTH_FAILED' }
  | { type: 'PROFILE_CONFIRMED' }
  | { type: 'RESUME_OK'; outcome: ResumeOutcome }
  | { type: 'RESUME_FAILED'; reason: FailureReason }
  /** A fresh process found something on disk. `hasDraft` is only meaningful
   *  when there is no pending action — a draft with no action is a "continue
   *  where you left off" offer, never an automatic resume. */
  | {
      type: 'REHYDRATE';
      pending: { kind: PendingActionKind } | null;
      hasDraft: boolean;
    };

// ─── Output ───────────────────────────────────────────────────────────────

/** What the caller must do to a persisted slot. `save` means "write what is
 *  in hand"; the machine never says what the contents are. */
export type StashOp = 'keep' | 'save' | 'clear';

/** Something the person should be told. The machine names the situation; the
 *  caller owns the wording (`src/i18n/he.ts`) — a pure module has no business
 *  holding copy. */
export type NoticeKind =
  | 'target_gone'
  | 'draft_expired'
  | 'waitlisted'
  | 'approval_pending'
  | 'retry_network'
  | 'resume_failed'
  | 'auth_failed'
  | 'offer_draft_continue';

export interface MachineContext {
  state: MachineState;
  /** What is being attempted. Null whenever no action is in flight — which is
   *  why it is on the context and not on the state: the draft/stash decisions
   *  below differ between a targeted kind and a drafted one. */
  kind: PendingActionKind | null;
}

export interface Transition {
  ctx: MachineContext;
  pendingAction: StashOp;
  draft: StashOp;
  notice: NoticeKind | null;
  /** True when the event was not legal in the current state. The context is
   *  returned UNCHANGED — an unexpected event must never invent a state. */
  ignored: boolean;
}

export const INITIAL_CONTEXT: MachineContext = {
  state: 'ANONYMOUS_BROWSING',
  kind: null,
};

/** Kinds whose work lives in a draft rather than in a target id. */
const DRAFTED_KINDS: ReadonlySet<PendingActionKind> = new Set<PendingActionKind>([
  'create_club',
  'create_game',
  'save_availability',
]);

export function isDraftedKind(kind: PendingActionKind | null): boolean {
  return kind != null && DRAFTED_KINDS.has(kind);
}

// ─── Transitions ──────────────────────────────────────────────────────────

function ignore(ctx: MachineContext): Transition {
  return { ctx, pendingAction: 'keep', draft: 'keep', notice: null, ignored: true };
}

function go(
  ctx: MachineContext,
  state: MachineState,
  kind: PendingActionKind | null,
  pendingAction: StashOp,
  draft: StashOp,
  notice: NoticeKind | null = null,
): Transition {
  return {
    ctx: { state, kind },
    pendingAction,
    draft,
    notice,
    ignored: false,
  };
}

/**
 * One step. Total over (state, event): every combination returns a transition,
 * and an illegal one is reported as `ignored` with the context untouched.
 */
export function step(ctx: MachineContext, event: MachineEvent): Transition {
  const { state, kind } = ctx;

  // REHYDRATE is legal from anywhere: a process that has just been recreated
  // has no idea what it was doing, and the disk is the only truth left.
  if (event.type === 'REHYDRATE') {
    if (event.pending) {
      // There is an action to finish. Straight back into the queue — the
      // consumer will check identity and either resume or re-prompt.
      return go(ctx, 'ACTION_REQUESTED', event.pending.kind, 'keep', 'keep');
    }
    if (event.hasDraft) {
      // Work in progress but no committed intent. Offer it; do NOT open the
      // form. Forcing a half-filled wizard onto someone who opened the app to
      // look at tonight's game is a worse outcome than losing the draft.
      return go(ctx, 'ANONYMOUS_BROWSING', null, 'keep', 'keep', 'offer_draft_continue');
    }
    return go(ctx, 'ANONYMOUS_BROWSING', null, 'keep', 'keep');
  }

  switch (state) {
    case 'ANONYMOUS_BROWSING':
    case 'SUCCESS':
    case 'FAILURE': {
      // A finished attempt is a fine place to start another one.
      if (event.type === 'ACTION_TAPPED') {
        return go(ctx, 'ACTION_REQUESTED', event.kind, 'keep', 'keep');
      }
      return ignore(ctx);
    }

    case 'ACTION_REQUESTED': {
      if (event.type === 'IS_AUTHED') {
        return go(ctx, 'RESUMING_ACTION', kind, 'keep', 'keep');
      }
      if (event.type === 'IS_GUEST') {
        // The wall. Persist BOTH before the sheet opens: on the fallback path
        // in `upgradeAnonymous` the session is replaced, which unmounts the
        // screen, and an await after that races the teardown.
        return go(
          ctx,
          'AUTH_REQUIRED',
          kind,
          'save',
          isDraftedKind(kind) ? 'save' : 'keep',
        );
      }
      // Retry of a previously-retryable failure comes back through here.
      if (event.type === 'ACTION_TAPPED') {
        return go(ctx, 'ACTION_REQUESTED', event.kind, 'keep', 'keep');
      }
      return ignore(ctx);
    }

    case 'AUTH_REQUIRED': {
      if (event.type === 'PROVIDER_PICKED') {
        return go(ctx, 'AUTH_IN_PROGRESS', kind, 'keep', 'keep');
      }
      if (event.type === 'AUTH_CANCELLED') {
        // Backing out is a legitimate answer, not an error. Keep everything:
        // they may tap again in ten seconds, and there is nothing to apologise
        // for in the meantime.
        return go(ctx, 'ANONYMOUS_BROWSING', kind, 'keep', 'keep');
      }
      return ignore(ctx);
    }

    case 'AUTH_IN_PROGRESS': {
      if (event.type === 'AUTH_OK') {
        // A brand-new account confirms name + avatar first; an existing one
        // has both already and must not be asked again.
        return event.isNewAccount
          ? go(ctx, 'PROFILE_REQUIRED', kind, 'keep', 'keep')
          : go(ctx, 'RESUMING_ACTION', kind, 'keep', 'keep');
      }
      if (event.type === 'AUTH_CANCELLED') {
        return go(ctx, 'ANONYMOUS_BROWSING', kind, 'keep', 'keep');
      }
      if (event.type === 'AUTH_FAILED') {
        // Back to the sheet with the error showing, not out of the flow. The
        // provider failed; the intent did not.
        return go(ctx, 'AUTH_REQUIRED', kind, 'keep', 'keep', 'auth_failed');
      }
      return ignore(ctx);
    }

    case 'PROFILE_REQUIRED': {
      if (event.type === 'PROFILE_CONFIRMED') {
        return go(ctx, 'RESUMING_ACTION', kind, 'keep', 'keep');
      }
      if (event.type === 'AUTH_CANCELLED') {
        return go(ctx, 'ANONYMOUS_BROWSING', kind, 'keep', 'keep');
      }
      return ignore(ctx);
    }

    case 'RESUMING_ACTION': {
      if (event.type === 'RESUME_OK') {
        const notice: NoticeKind | null =
          event.outcome === 'waitlisted'
            ? 'waitlisted'
            : event.outcome === 'approval_pending'
              ? 'approval_pending'
              : null;
        // Done means done for both slots, whatever the outcome.
        return go(ctx, 'SUCCESS', kind, 'clear', 'clear', notice);
      }
      if (event.type === 'RESUME_FAILED') {
        if (RETRYABLE.has(event.reason)) {
          // A dead network is the one case where clearing the stash is itself
          // the bug: the intent is still valid and will succeed on a train
          // platform ten minutes from now.
          return go(ctx, 'ACTION_REQUESTED', kind, 'keep', 'keep', 'retry_network');
        }
        if (event.reason === 'target_deleted') {
          return go(ctx, 'FAILURE', kind, 'clear', 'clear', 'target_gone');
        }
        if (event.reason === 'draft_expired') {
          return go(ctx, 'FAILURE', kind, 'clear', 'clear', 'draft_expired');
        }
        // A real answer about the world — the game started, the club is full,
        // this person was rejected. Drop the stash; keep a DRAFT, because the
        // typed-in work is still theirs and a different target may accept it.
        return go(
          ctx,
          'FAILURE',
          kind,
          'clear',
          isDraftedKind(kind) ? 'keep' : 'clear',
          'resume_failed',
        );
      }
      return ignore(ctx);
    }
  }
}

/** Fold a sequence of events. Convenience for tests and for replaying a
 *  recreated process; identical to calling `step` in a loop. */
export function run(
  events: readonly MachineEvent[],
  from: MachineContext = INITIAL_CONTEXT,
): MachineContext {
  let ctx = from;
  for (const e of events) ctx = step(ctx, e).ctx;
  return ctx;
}

function normaliseCode(code: string | undefined | null): string {
  return (code ?? '').replace(/^functions\//, '');
}

/**
 * `ACCESS_BLOCKED` is NOT a failure, and this predicate exists so a caller
 * cannot accidentally treat it as one.
 *
 * `gameService.getGameById` throws it when the document is there but the rules
 * deny the read — the usual case being a community-only game opened by a
 * non-member. The target screen has a dedicated blocked-access view, so the
 * right answer is to navigate anyway and let it explain itself. Reporting
 * "this link is invalid" instead tells the person something false about a game
 * that exists and that their friend is playing in. The consumer in
 * `RootNavigator` already draws this distinction; keeping it here means every
 * future caller inherits it.
 *
 * So: check this FIRST, and dispatch `RESUME_OK { outcome: 'navigated' }` when
 * it is true — never `RESUME_FAILED`.
 */
export function isPresentButUnreadable(code: string | undefined | null): boolean {
  return normaliseCode(code) === 'ACCESS_BLOCKED';
}

/**
 * Map a thrown error code onto a reason.
 *
 * Deliberately a total function with an `unknown` fallback: a code we have
 * never seen must degrade to a generic failure, never to `undefined` flowing
 * into a switch that then does nothing at all.
 */
export function failureReasonFromCode(code: string | undefined | null): FailureReason {
  switch (normaliseCode(code)) {
    case 'GAME_OVERLAP':
      return 'game_overlap';
    case 'REGISTRATION_CONFLICT':
      return 'registration_conflict';
    case 'GAME_NOT_OPEN':
      return 'game_not_open';
    case 'GAME_STARTED':
      return 'game_started';
    case 'GAME_LIVE':
      return 'game_live';
    case 'GAME_JOIN_REJECTED':
      return 'game_join_rejected';
    case 'GROUP_FULL':
      return 'group_full';
    case 'STALE_OFFER':
      return 'stale_offer';
    case 'resource-exhausted':
      return 'rate_limited';
    case 'unavailable':
    case 'deadline-exceeded':
      return 'network_unavailable';
    default:
      return 'unknown';
  }
}
