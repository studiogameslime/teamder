// notificationsService — push-notification dispatch + per-user prefs.
//
// Architecture:
//   client → /notifications/{id}                  (this service writes)
//                       ↓ (Cloud Function trigger)
//                  firebase-admin → FCM           (server-only, has the
//                                                  FCM server key)
//                       ↓
//                  recipient device(s)            (via fcmTokens on the
//                                                  user doc)
//
// The Cloud Function is NOT in this repo. It's expected to:
//   1. onCreate /notifications/{id}
//   2. read /users/{recipientId}.fcmTokens + .notificationPrefs
//   3. respect the per-type pref (skip if false)
//   4. for type === 'newGameInCommunity' also fan out to every user
//      where /users/{uid}.newGameSubscriptions includes payload.groupId
//   5. send via firebase-admin messaging.sendEachForMulticast
//   6. update /notifications/{id} with delivered=true, deliveredAt=now
//
// Until the function is deployed, dispatch() writes accumulate in the
// collection but no actual push is sent. That's fine — the client UX
// (prefs screen, per-community toggle) works regardless.

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  GroupId,
  NotificationDoc,
  NotificationPrefs,
  NotificationType,
  UserId,
  defaultNotificationPrefs,
} from '@/types';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { col, docs } from '@/firebase/firestore';

// Mock-mode collection so the Settings screen and dispatch hooks work
// without a Firestore round-trip during development.
const mockNotifications: NotificationDoc[] = [];

export const notificationsService = {
  /**
   * Write a notification doc that a Cloud Function will pick up.
   * Best-effort — failures are logged, never thrown, so a missed push
   * never blocks the originating user action (join request, approval,
   * etc.) from succeeding.
   *
   * Defensive: malformed input is silently dropped with a dev warning
   * rather than tossed to the user as an error. The most common cause
   * is an upstream race that picked up a half-loaded game/group.
   */
  async dispatch(input: {
    type: NotificationType;
    recipientId: UserId;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (!input?.type || !input?.recipientId) {
      if (__DEV__) {
        console.warn('[notifications] dispatch: missing type/recipientId', input);
      }
      return;
    }
    if (USE_MOCK_DATA) {
      mockNotifications.push({
        id: `mn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: input.type,
        recipientId: input.recipientId,
        payload: input.payload,
        createdAt: Date.now(),
        delivered: false,
      });
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log('[notifications] dispatch (mock)', input.type, input);
      }
      return;
    }
    try {
      await addDoc(col.notifications(), {
        type: input.type,
        recipientId: input.recipientId,
        payload: input.payload,
        createdAt: serverTimestamp(),
        delivered: false,
      });
    } catch (err) {
      if (__DEV__) console.warn('[notifications] dispatch failed', err);
    }
  },

  /**
   * Save the user's per-type prefs. Merges into /users/{uid} via a
   * partial update so other user fields stay untouched.
   */
  async savePreferences(uid: UserId, prefs: NotificationPrefs): Promise<void> {
    if (USE_MOCK_DATA) {
      // The userStore's currentUser holds the truth in mock mode; the
      // calling screen should also call userService.updateProfile-style
      // to mirror it locally. We just no-op here to keep the contract
      // identical.
      return;
    }
    try {
      await updateDoc(docs.user(uid), {
        notificationPrefs: prefs,
        updatedAt: Date.now(),
      });
    } catch (err) {
      if (__DEV__) console.warn('[notifications] savePreferences failed', err);
    }
  },

  /**
   * Toggle whether the user wants "new game opened" pings for a
   * specific community. Implemented as add/remove on the
   * `newGameSubscriptions` array on the user doc so the CF can
   * fan out without reading every user's prefs.
   */
  async setCommunitySubscription(
    uid: UserId,
    groupId: GroupId,
    on: boolean
  ): Promise<void> {
    if (USE_MOCK_DATA) return;
    try {
      await updateDoc(docs.user(uid), {
        newGameSubscriptions: on
          ? arrayUnion(groupId)
          : arrayRemove(groupId),
        updatedAt: Date.now(),
      });
    } catch (err) {
      if (__DEV__) {
        console.warn('[notifications] setCommunitySubscription failed', err);
      }
    }
  },

  /**
   * Persist a push token under /users/{uid}.fcmTokens. Multi-device:
   * `arrayUnion` is idempotent so re-running this on app boot won't
   * accumulate duplicates of the same token. Mock mode: no-op.
   */
  async registerDeviceToken(uid: UserId, token: string): Promise<void> {
    if (USE_MOCK_DATA || !token) return;
    try {
      await updateDoc(docs.user(uid), {
        fcmTokens: arrayUnion(token),
        updatedAt: Date.now(),
      });
    } catch (err) {
      if (__DEV__) console.warn('[notifications] registerDeviceToken', err);
    }
  },

  /**
   * Full request-permission + get-token + persist flow. Safe to call
   * multiple times (e.g. on every cold start after sign-in) — the
   * permission prompt only shows the first time, and the token write
   * is idempotent.
   *
   * Behaviour:
   *   - Mock mode: no-op, returns null
   *   - Permission denied: returns null, no write
   *   - Native module unavailable (e.g. running in Expo Go): returns
   *     null with a dev warning. The app keeps working — push delivery
   *     just doesn't happen until the dev client is rebuilt.
   *   - Success: returns the FCM/APNs token string
   *
   * On Android, `getDevicePushTokenAsync` returns the FCM registration
   * token directly (because google-services.json is wired up). On iOS
   * it returns the raw APNs token; the Cloud Function consumer will
   * need to convert via firebase-admin if you ever target iOS.
   */
  async requestAndRegisterPushToken(uid: UserId): Promise<string | null> {
    if (USE_MOCK_DATA) return null;
    // Push tokens require a native module that is NOT bundled in Expo Go
    // (SDK 49+). Bail out early so we never trigger the throw — and so
    // Metro's LogBox doesn't surface the caught-but-noisy red overlay.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    if (
      Constants?.appOwnership === 'expo' ||
      Constants?.executionEnvironment === 'storeClient'
    ) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.log(
          '[notifications] skipping push-token registration (Expo Go has no native module).',
        );
      }
      return null;
    }
    let Notifications: typeof import('expo-notifications') | null = null;
    try {
      // Lazy require so the bundle doesn't fail when the native module
      // isn't linked into the running binary (fresh dev clients before
      // the post-install rebuild, etc.).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      Notifications = require('expo-notifications');
    } catch (err) {
      if (__DEV__) {
        console.warn(
          '[notifications] expo-notifications not available — skipping token registration. Rebuild the dev client to enable.',
          err
        );
      }
      return null;
    }
    if (!Notifications) return null;
    try {
      const existing = await Notifications.getPermissionsAsync();
      let granted = existing.granted;
      if (!granted && existing.canAskAgain) {
        const req = await Notifications.requestPermissionsAsync();
        granted = req.granted;
      }
      if (!granted) {
        if (__DEV__) console.log('[notifications] permission not granted');
        return null;
      }
      const tokenObj = await Notifications.getDevicePushTokenAsync();
      const token = tokenObj?.data;
      if (typeof token !== 'string' || token.length === 0) return null;
      await this.registerDeviceToken(uid, token);
      return token;
    } catch (err) {
      if (__DEV__) {
        console.warn('[notifications] requestAndRegisterPushToken failed', err);
      }
      return null;
    }
  },

  /**
   * Phase E.2.2 — single-shot invite of a user to a specific game.
   * Thin wrapper around dispatch so screens have a typed helper instead
   * of building the payload inline.
   */
  async inviteToGame(input: {
    recipientId: UserId;
    gameId: string;
    gameTitle: string;
    inviterName: string;
    startsAt: number;
  }): Promise<void> {
    return this.dispatch({
      type: 'inviteToGame',
      recipientId: input.recipientId,
      payload: {
        gameId: input.gameId,
        gameTitle: input.gameTitle,
        inviterName: input.inviterName,
        startsAt: input.startsAt,
      },
    });
  },

  /** Useful to inspect mock dispatches in dev — no-op in Firebase mode. */
  __getMockDispatches(): NotificationDoc[] {
    return mockNotifications.slice();
  },
};

// Re-export defaults for screens to import alongside the service.
export { defaultNotificationPrefs };
