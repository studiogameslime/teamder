// Handles taps on the action buttons we attach to `gameReminder`
// pushes — "אני בא" → JOIN_GAME, "לא בא" → CANCEL_GAME. Designed
// to run from a freshly-launched-in-background JS context, so the
// auth state is restored manually before any Firestore call. Errors
// are swallowed to a console.warn — the next reminder fires the
// same buttons, giving the user another shot.

import { waitForAuthRestore } from '@/firebase/auth';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

type Action = 'JOIN_GAME' | 'CANCEL_GAME';

export async function handleGameReminderAction(
  action: Action,
  gameId: string,
): Promise<void> {
  if (!gameId) return;
  try {
    // The OS may have launched us cold to process the action — wait
    // for Firebase Auth to rehydrate before any service call,
    // otherwise the read/write would error with "no current user".
    const authUser = await waitForAuthRestore();
    if (!authUser) {
      if (__DEV__) {
        console.warn('[notifAction] no auth user; skipping', action, gameId);
      }
      return;
    }
    if (action === 'JOIN_GAME') {
      await gameService.joinGameV2(gameId, authUser.uid);
      logEvent(AnalyticsEvent.GameJoined, {
        gameId,
        viaNotificationAction: true,
      });
    } else {
      await gameService.cancelGameV2(gameId, authUser.uid);
      logEvent(AnalyticsEvent.GameCancelled, {
        gameId,
        viaNotificationAction: true,
      });
    }
  } catch (err) {
    // Common cases: network missing, registration conflict, game
    // already started, capacity full. None should crash the
    // background task — the user will see the up-to-date state on
    // the next app launch.
    if (__DEV__) {
      console.warn('[notifAction] failed', action, gameId, err);
    }
  }
}
