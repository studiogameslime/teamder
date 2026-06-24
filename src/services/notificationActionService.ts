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
      });
      // The join ran in the BACKGROUND (no app launch) — post a local
      // notification so the user still gets a result (in / waitlist /
      // pending). Best-effort; never throws into the action flow.
      try {
        const Notifications = await import('expo-notifications');
        const body =
          res.bucket === 'players'
            ? 'נרשמת למשחק! נתראה במגרש ⚽'
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

export async function handleFillerOpportunityAction(
  action: FillerAction,
  gameId: string,
): Promise<void> {
  if (!gameId) return;
  if (action === 'DISMISS_FILLER') {
    logEvent(AnalyticsEvent.GameViewed, {
      gameId,
      viaNotificationAction: true,
      fillerDismissed: true,
    });
    return;
  }
  try {
    const authUser = await waitForAuthRestore();
    if (!authUser) {
      if (__DEV__) {
        console.warn('[notifAction] no auth user; skipping', action, gameId);
      }
      return;
    }
    // Lazy-import the callable infra so the bundle stays lean.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { getFirebase } = await import('@/firebase/config');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'submitFillerInterest');
    await fn({ gameId });
    logEvent(AnalyticsEvent.GameJoined, {
      gameId,
      viaNotificationAction: true,
      asFillerInterest: true,
    });
  } catch (err) {
    // Common failure modes: game already filled, admin disabled
    // fillers, candidate already submitted interest. All resolved
    // by the CF returning a typed HttpsError; we swallow because
    // the candidate can still see status in-app on next open.
    logError('handleFillerInterestAction', err, { action, gameId });
    if (__DEV__) {
      console.warn(
        '[notifAction] filler interest failed',
        action,
        gameId,
        err,
      );
    }
  }
}
