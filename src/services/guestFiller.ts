// The guest's filler application, built in one place.
//
// Same shape as `guestJoin`, and for the same reason: the request is a value,
// so a second filler surface gets it right by construction and the `execute`
// that must never run is written once.
//
// WHY A SEPARATE KIND. Applying as a filler is not joining. A join is a client
// transaction on the roster and ends in a seat, a waitlist place, or a pending
// membership; a filler application is a callable that writes an interest
// document and ends, always, in "an admin will decide". The two are open to
// different people — filler is for NON-members of the club, a join is not —
// and they carry different copy. Folding them into one kind would leave the
// resumer guessing which of the two the person actually asked for.

import type { ActionRequest } from '@/services/actionCoordinator';

/**
 * What a guest's "apply to fill a slot" means to the coordinator.
 *
 * `execute` throws on purpose. The intent is persisted, the sheet asks for an
 * identity, and `actionResumers` calls the SERVER again afterwards — which is
 * the only way to get the current answer once time has passed inside a
 * provider's sheet. Replaying a closure captured before the sign-in would
 * report success for an application the server may since have refused.
 */
export function guestApplyFillerRequest(gameId: string): ActionRequest {
  return {
    kind: 'apply_filler',
    targetId: gameId,
    origin: 'in_app',
    execute: async () => {
      throw new Error('unreachable: guest actions resume via their resumer');
    },
  };
}
