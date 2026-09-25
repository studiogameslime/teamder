// Handles taps on the action buttons we attach to `gameReminder`
// pushes — "אני בא" → JOIN_GAME, "לא בא" → CANCEL_GAME — and the
// `spotOffered` push (head of waitlist getting offered an open
// slot) — "מאשר" → CONFIRM_SPOT, "ויתור" → PASS_SPOT.
//
// Designed to run from a freshly-launched-in-background JS context,
// so the auth state is restored manually before any Firestore call.
// Errors are swallowed to a console.warn — the next reminder fires
// the same buttons, giving the user another shot.

import { waitForAuthRestore } from '@/firebase/auth';
import { gameService } from '@/services/gameService';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { logError } from '@/services/errorLog';

type Action = 'JOIN_GAME' | 'CANCEL_GAME';
type SpotAction = 'CONFIRM_SPOT' | 'PASS_SPOT';

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
      const res = await gameService.requestJoinGame(gameId, authUser.uid);
      logEvent(AnalyticsEvent.GameJoined, {
        gameId,
        viaNotificationAction: true,
        source: 'notification',
      });
      // The join ran in the BACKGROUND (no app launch) — post a local
      // notification so the user still gets a result (in / waitlist /
      // pending). Best-effort; never throws into the action flow.
      try {
        const Notifications = await import('expo-notifications');
        const body =
          res.bucket === 'players'
            ? 'אתה רשום למשחק — נתראה במגרש ⚽'
            : res.bucket === 'waitlist'
              ? 'נכנסת לרשימת ההמתנה — נעדכן אם יתפנה מקום'
              : 'הבקשה נשלחה — ממתינה לאישור המנהל';
        await Notifications.scheduleNotificationAsync({
          content: { title: 'Teamder', body, data: { type: 'gameReminder', gameId } },
          trigger: null,
        });
      } catch {
        // ignore — confirmation is a nicety, not required for the join
      }
    } else {
      await gameService.cancelGameV2(gameId, authUser.uid);
      logEvent(AnalyticsEvent.GameCancelled, {
        gameId,
        viaNotificationAction: true,
      });
    }
  } catch (err) {
    // REGISTRATION_CONFLICT is an EXPECTED outcome here, not a failure:
    // the user tapped "אני בא" from a reminder while already booked into
    // an overlapping game. The join is correctly refused server-side;
    // there's no background UI to resolve it, so we just drop it (the
    // user sees the real state next launch) WITHOUT logging it as an
    // error — otherwise it floods the error console as a false alarm.
    const code = (err as { code?: string })?.code;
    if (code === 'REGISTRATION_CONFLICT') {
      if (__DEV__) {
        console.warn('[notifAction] join conflict, ignored', gameId);
      }
      return;
    }
    // Other cases (network missing, game already started, capacity
    // full): real, but none should crash the background task — the
    // user will see the up-to-date state on the next app launch.
    logError('handleGameReminderAction', err, { action, gameId });
    if (__DEV__) {
      console.warn('[notifAction] failed', action, gameId, err);
    }
  }
}

export async function handleSpotOfferAction(
  action: SpotAction,
  gameId: string,
): Promise<void> {
  if (!gameId) return;
  try {
    const authUser = await waitForAuthRestore();
    if (!authUser) {
      if (__DEV__) {
        console.warn('[notifAction] no auth user; skipping', action, gameId);
      }
      return;
    }
    if (action === 'CONFIRM_SPOT') {
      await gameService.confirmSpotOffer(gameId, authUser.uid);
      logEvent(AnalyticsEvent.WaitlistPromoted, {
        gameId,
        viaNotificationAction: true,
      });
    } else {
      await gameService.passSpotOffer(gameId, authUser.uid);
      logEvent(AnalyticsEvent.GameCancelled, {
        gameId,
        viaNotificationAction: true,
        passedSpot: true,
      });
    }
    // The confirm/pass ran in the BACKGROUND (no app launch) — post a local
    // notification so the user still sees the result. Best-effort.
    try {
      const Notifications = await import('expo-notifications');
      const body =
        action === 'CONFIRM_SPOT'
          ? 'אישרת הגעה — נכנסת למשחק! נתראה במגרש ⚽'
          : 'ויתרת על המקום. ההצעה תעבור לבא בתור';
      await Notifications.scheduleNotificationAsync({
        content: { title: 'Teamder', body, data: { type: 'gameReminder', gameId } },
        trigger: null,
      });
    } catch {
      // ignore — confirmation is a nicety, not required for the action
    }
  } catch (err) {
    // EXPECTED outcomes — the offer simply isn't actionable anymore (it
    // passed/expired, was filled, the game closed, etc.). These are normal
    // product behaviour, not failures, so don't log them as errors (was
    // flooding the dev inbox — report 1o7twdp). The user sees the current
    // state when they next open the app.
    const code =
      typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : (err as { message?: string })?.message ?? '';
    const expected = [
      'STALE_OFFER',
      'GAME_NOT_OPEN',
      'GAME_STARTED',
      'GAME_LIVE',
    ].includes(code);
    if (!expected) {
      logError('handleSpotOfferAction', err, { action, gameId });
    }
    if (__DEV__) {
      console.warn('[notifAction] spot offer not actionable', action, gameId, code);
    }
  }
}

// ─── Filler opportunity action ──────────────────────────────────────
// Handles "מעוניין" (EXPRESS_FILLER_INTEREST) and "לא הפעם"
// (DISMISS_FILLER) buttons on the cross-community filler push.
//
// EXPRESS_FILLER_INTEREST: calls the `submitFillerInterest` callable
// which writes /games/{gid}/fillerInterests/{uid} with status='pending'.
// The on-create CF then pushes the game admin to review the
// candidate's profile.
//
// DISMISS_FILLER: silent no-op locally. We log analytics so we know
// how many candidates dismiss, but write nothing — the candidate
// can still tap a future opportunity in the app if they change
// their mind.

type FillerAction = 'EXPRESS_FILLER_INTEREST' | 'DISMISS_FILLER';

/** Where the tap came from. The helper was written for the push's action
 *  buttons and stamped every event `viaNotificationAction: true` — but the
 *  ONLY caller today is the banner on the match screen, so every filler
 *  event in the product has been reporting a notification that did not
 *  happen. The origin is a parameter now, and it defaults to `screen` —
 *  the truthful answer for every call site that exists. */
export type FillerOrigin = 'notification' | 'screen';

/**
 * Express interest in filling an empty slot.
 *
 * THROWS on failure, deliberately. The previous version swallowed every error
 * in its own `catch`, so the caller's `try` never saw one: the match screen
 * set its state to `sent`, showed "הבקשה נשלחה" and logged `game_joined` for
 * requests that had been rejected by the server. A person was told an admin
 * was considering them when nobody had been asked.
 *
 * Callers must handle the rejection. There is one, and it does.
 */
export async function handleFillerOpportunityAction(
  action: FillerAction,
  gameId: string,
  origin: FillerOrigin = 'screen',
): Promise<void> {
  if (!gameId) throw new Error('handleFillerOpportunityAction: gameId required');
  if (action === 'DISMISS_FILLER') {
    logEvent(AnalyticsEvent.GameViewed, {
      gameId,
      viaNotificationAction: origin === 'notification',
      fillerDismissed: true,
    });
    return;
  }

  // Mock mode has no callable to reach — `getFirebase()` throws by design.
  // Without this the whole flow is unQAable offline, which is how the guest
  // gate went unnoticed in the first place: the only way to see this CTA work
  // was to fire a real application at a real club.
  const { USE_MOCK_DATA } = await import('@/firebase/config');
  if (USE_MOCK_DATA) {
    logEvent(AnalyticsEvent.GameJoined, {
      gameId,
      viaNotificationAction: origin === 'notification',
      asFillerInterest: true,
      source: origin === 'notification' ? 'filler_push' : 'match_screen',
    });
    return;
  }

  const authUser = await waitForAuthRestore();
  if (!authUser) throw new Error('handleFillerOpportunityAction: not signed in');
  // A guest must never reach here: the screen gates on `isGuest` and the
  // callable rejects an anonymous provider server-side. This is the third
  // layer, and it is the cheap one.
  if (authUser.isAnonymous) {
    throw new Error('handleFillerOpportunityAction: anonymous session');
  }

  try {
    // Lazy-import the callable infra so the bundle stays lean.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { getFirebase } = await import('@/firebase/config');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'submitFillerInterest');
    await fn({ gameId });
  } catch (err) {
    // Logged here because this is where the context is, then RE-THROWN so the
    // caller can tell the person the truth. Common server answers: the game
    // filled up, the admin disabled fillers, interest was already submitted.
    logError('handleFillerInterestAction', err, { action, gameId, origin });
    if (__DEV__) {
      console.warn('[notifAction] filler interest failed', action, gameId, err);
    }
    throw err;
  }

  // Only after the server said yes.
  logEvent(AnalyticsEvent.GameJoined, {
    gameId,
    viaNotificationAction: origin === 'notification',
    asFillerInterest: true,
    source: origin === 'notification' ? 'filler_push' : 'match_screen',
  });
}
