// The guest's join request, built in one place.
//
// This exists because the two screens that offer "join this match" drifted.
// `MatchDetailsScreen` gated on `isGuest` and handed the intent to the
// coordinator; `GamesListScreen` had no gate at all — not one `isGuest` in the
// file — so a guest tapping the CTA on a card went straight to
// `requestJoinGame` with an anonymous uid. Same product action, two
// implementations, and only one of them knew about the last three rounds of
// work.
//
// So the request is a value now, not a block of code copied between screens.
// A third join surface gets it right by construction, and the `execute` that
// must never run is written once.

import type { ActionRequest } from '@/services/actionCoordinator';

/**
 * What a guest's "join this match" means to the coordinator.
 *
 * No business logic lives here and none should: the coordinator persists the
 * intent, the sheet asks for an identity, and `actionResumers` asks the SERVER
 * again afterwards. That last part is why `execute` throws rather than
 * joining — by the time somebody is back from a provider's sheet the last seat
 * may be gone, and replaying a closure captured before the sign-in would
 * report a success that never happened.
 */
export function guestJoinGameRequest(gameId: string): ActionRequest {
  return {
    kind: 'join_game',
    targetId: gameId,
    origin: 'in_app',
    execute: async () => {
      throw new Error('unreachable: guest actions resume via their resumer');
    },
  };
}
