// Which completed actions earn the notification question.
//
// A separate file from both sides on purpose. `actionCoordinator` owns
// exactly-once and cleanup and should not grow a second concern;
// `notificationOffer` owns eligibility and should not know what a
// `PendingActionKind` is. This is the two-line translation between them, and
// having it somewhere nameable is what stops the mapping being repeated at
// each of the coordinator's two completion points.
//
// Only three kinds map. `create_club` and `create_game` deliberately do not —
// see the note on `OfferContext`.

import {
  announceCompleted,
  type OfferContext,
} from '@/services/notificationOffer';
import type { PendingActionKind } from '@/services/pendingAction';
import type { ActionResult } from '@/services/actionCoordinator';
import { useUserStore } from '@/store/userStore';

/** The kinds that have a notification behind them. */
const CONTEXT_FOR: Partial<Record<PendingActionKind, OfferContext>> = {
  join_game: 'join_game',
  join_club: 'join_club',
  save_availability: 'availability',
};

/**
 * Outcomes that mean "you are in, and things will now happen that you would
 * want to hear about".
 *
 * `joined` and `created` qualify. `waitlisted` and `approval_pending` do too,
 * and arguably more: being told a place opened up, or that an admin approved
 * you, is the whole reason those two states are bearable. `navigated` does
 * not — nothing was joined.
 */
function isWorthAsking(result: ActionResult): boolean {
  if (!result.terminal) return false;
  if (result.reason) return false;
  return (
    result.outcome === 'joined' ||
    result.outcome === 'created' ||
    result.outcome === 'waitlisted' ||
    result.outcome === 'approval_pending'
  );
}

/**
 * Announce a completed action, if it is one of the three.
 *
 * Fire-and-forget by contract: no return value, no throw, never awaited. The
 * caller has already finished the person's business.
 */
export function announceOfferFor(
  kind: PendingActionKind,
  result: ActionResult,
): void {
  const context = CONTEXT_FOR[kind];
  if (!context) return;
  if (!isWorthAsking(result)) return;

  // Availability carries its own precondition. `fillerOpportunity` — the push
  // the copy promises — only ever goes to users with
  // `availability.acceptsFillerPush === true`, so somebody who turned it off
  // must not be told we will invite them to matches.
  const applicable =
    context === 'availability'
      ? useUserStore.getState().currentUser?.availability?.acceptsFillerPush === true
      : true;

  announceCompleted(context, { applicable });
}
