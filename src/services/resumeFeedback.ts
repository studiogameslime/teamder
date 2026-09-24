// Telling somebody what their resumed action actually got them.
//
// `actionResumers` has always returned a precise outcome — joined, waitlisted,
// approval_pending, or a reason it could not happen. Both callers of
// `resumePendingAction` threw it away. So a person who tapped Join, signed in,
// and landed on a WAITLIST because the last seat went while they were in a
// provider's sheet was told nothing at all, and had every reason to believe
// they were in the squad.
//
// That is the exact failure the resumer's own comment warns about from the
// other direction: "a full game reported as a failure is how somebody who just
// got in line is told the app is broken". Silence is the other half of it.
//
// ─── Two rules ───────────────────────────────────────────────────────────
//
// Never a generic success. The message is chosen from the outcome the server
// actually returned, and a result carrying a `reason` is not a success in any
// form — `join_game` can return `{outcome:'joined', reason:'game_join_rejected'}`
// and saying "הצטרפת למחזור" to that person would be a lie.
//
// Never part of the transaction. This runs after the outcome is terminal and
// the stash is cleared; it cannot throw, and nothing waits for it.

import { toast } from '@/components/Toast';
import { he } from '@/i18n/he';
import type { ActionResult } from '@/services/actionCoordinator';
import type { PendingActionKind } from '@/services/pendingAction';

/**
 * Say what happened, once.
 *
 * Called by whichever caller of `resumePendingAction` won the lock — only one
 * can get `status:'ran'` for a given action, which is what keeps this to a
 * single message.
 */
export function reportResumeOutcome(
  kind: PendingActionKind,
  result: ActionResult,
): void {
  try {
    // ── Nothing was achieved ──────────────────────────────────────────
    //
    // A `reason` means the outcome was not reached, whatever the `outcome`
    // field says. Retryable failures keep the stash and will run again on the
    // next launch, so a message here would be wrong twice: it would report a
    // failure that has not finished failing, and then report it again.
    if (result.reason) {
      if (result.terminal && result.reason === 'target_deleted') {
        toast.info(he.resumeTargetGone);
      }
      return;
    }
    if (!result.terminal) return;

    if (kind === 'join_game') {
      if (result.outcome === 'waitlisted') toast.info(he.resumeJoinedWaitlist);
      else if (result.outcome === 'approval_pending') toast.info(he.resumeJoinedPending);
      else if (result.outcome === 'joined') toast.success(he.toastGameJoined);
      return;
    }

    if (kind === 'join_club') {
      // The club's own copy, because the meaning is identical to the direct
      // path: a request was sent, or membership happened.
      if (result.outcome === 'approval_pending') toast.success(he.toastJoinRequestSent);
      else if (result.outcome === 'joined') toast.success(he.toastJoinedGroup);
      return;
    }

    // The creates and the availability save say nothing here ON PURPOSE.
    // `create_club` and `create_game` navigate to the thing they just made,
    // celebrating — a toast on top of that arrival is noise. `save_availability`
    // is followed by the notification offer, which is its own acknowledgement.
    // Their destinations ARE the feedback; only the joins had none.
  } catch {
    // Feedback can never fail an action that already succeeded.
  }
}
