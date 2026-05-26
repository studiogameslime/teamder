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
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
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
import { docs } from '@/firebase/firestore';
import {
  cooldownMsFor,
  dedupeIdFor,
  dedupeKeyFor,
  inferEntityFromPayload,
} from '@/services/notificationDedup';

// Mock-mode collection so the Settings screen and dispatch hooks work
// without a Firestore round-trip during development.
const mockNotifications: NotificationDoc[] = [];

// Notification doc schema version. Bumped each time the dedupe /
// payload contract changes incompatibly. Server-side bumps
// independently — keep them in lockstep.
const NOTIFICATION_SCHEMA_VERSION = 2;
const STALE_UNREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Types that should query for ANY unread doc with the same dedupeKey
// (across cooldown buckets) and skip the dispatch if found. Mirrors
// the server-side STRICT_UNREAD_DEDUP map.
const STRICT_UNREAD_DEDUP: Partial<Record<NotificationType, true>> = {
  gameCanceledOrUpdated: true,
};

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
    /** Optional override. Defaults are inferred from `(type, payload)`
     *  via `inferEntityFromPayload` — most callers don't need to set
     *  these explicitly. */
    entityType?: 'game' | 'group' | 'user';
    entityId?: string;
    reason?: string;
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
    // Deterministic-ID dedupe. Without this, every `dispatch` write
    // produced a new doc id → fired `onDocumentCreated` → produced a
    // new push, even if the same logical event was fired ten times in
    // a row (admin spamming "edit", race between groupStore +
    // groupService dispatching the same approval, retries on flaky
    // network). Now we compute a stable id; the second write inside
    // the cooldown bucket is just an UPDATE of the same doc, which
    // does NOT re-fire the trigger.
    //
    // We still BAIL OUT entirely if the doc already exists & is unread
    // (avoid even the silent overwrite — keeps the original payload
    // truthful for any consumers reading the doc directly, e.g. an
    // in-app inbox screen). If the previous notification was already
    // read, we delete & recreate so the trigger re-fires for the
    // fresh logical event.
    const inferred = inferEntityFromPayload(
      input.type,
      input.recipientId,
      input.payload || {},
    );
    const dedupeInput = {
      type: input.type,
      recipientId: input.recipientId,
      entityType: input.entityType ?? inferred.entityType,
      entityId: input.entityId ?? inferred.entityId,
      reason: input.reason ?? inferred.reason,
    };
    const id = dedupeIdFor(dedupeInput);
    const dedupeKey = dedupeKeyFor(dedupeInput);
    const now = Date.now();
    const { db: firestoreDb } = getFirebase();
    const ref = doc(firestoreDb, 'notifications', id);

    // PRIMARY (strict-unread types): if any unread doc already exists
    // for this dedupeKey, suppress. The user already has an unread
    // ping for this logical event — pushing a second one would just
    // multiply the badge count. Reading the first push unlocks the
    // next one. Stale unread docs (older than the TTL) are ignored.
    if (STRICT_UNREAD_DEDUP[input.type]) {
      try {
        const dup = await getDocs(
          query(
            collection(firestoreDb, 'notifications'),
            where('dedupeKey', '==', dedupeKey),
            where('read', '==', false),
            limit(1),
          ),
        );
        if (!dup.empty) {
          const dupData = dup.docs[0].data() as
            | { createdAtMs?: number }
            | undefined;
          const createdAtMs = Number(dupData?.createdAtMs) || 0;
          if (now - createdAtMs < STALE_UNREAD_TTL_MS) {
            return; // unread exists, not stale → suppress
          }
        }
      } catch (err) {
        // Index missing / permission blip — log and fall through.
        // The bucket-id check below still gives retry safety.
        if (__DEV__) {
          console.warn('[notifications] strict-unread query failed', err);
        }
      }
    }

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        const data = existing.data() as { read?: boolean } | undefined;
        if (!data?.read) {
          // Same logical event already pushed and not yet read — drop.
          return;
        }
        // Read previously; bucket rotation will produce a fresh id
        // once the cooldown elapses. Server-side does
        // delete-and-recreate; the client stays conservative.
        return;
      }
      await setDoc(ref, {
        type: input.type,
        recipientId: input.recipientId,
        entityType: dedupeInput.entityType,
        entityId: dedupeInput.entityId,
        reason: dedupeInput.reason,
        dedupeKey,
        payload: input.payload,
        createdAt: serverTimestamp(),
        createdAtMs: now,
        cooldownMs: cooldownMsFor(input.type),
        read: false,
        delivered: false,
        schemaVersion: NOTIFICATION_SCHEMA_VERSION,
      });
    } catch (err) {
      if (__DEV__) console.warn('[notifications] dispatch failed', err);
    }
  },

  /**
   * Notify the game admin that a player just cancelled. Routed through
   * a callable Cloud Function (instead of a direct /notifications
   * write) so the server can aggregate multiple cancellations into a
   * single unread notification, canonicalise the cancelling player's
   * name from /users, and dedupe identically against retries.
   *
   * Best-effort — failures log a warning but never throw, so a
   * notification miss won't block the actual cancel transaction
   * the caller is in the middle of.
   */
  async notifyPlayerCancelled(input: {
    gameId: string;
    reason?: string;
  }): Promise<void> {
    if (USE_MOCK_DATA || !input?.gameId) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { httpsCallable } = require('firebase/functions');
      const { functions } = getFirebase();
      const fn = httpsCallable(functions, 'notifyPlayerCancelled');
      await fn({ gameId: input.gameId, reason: input.reason ?? '' });
    } catch (err) {
      if (__DEV__) {
        console.warn('[notifications] notifyPlayerCancelled failed', err);
      }
    }
  },

  /**
   * Mark a notification as read. Used by the inbox screen + the
   * deeplink handler when the user taps a push to open the app.
   * Read state allows future dispatches with the SAME dedupeKey to
   * re-fire the trigger — without it, repeat events would be
   * suppressed for the full cooldown window even after the user has
   * already engaged.
   */
  async markRead(notificationId: string): Promise<void> {
    if (USE_MOCK_DATA || !notificationId) return;
    try {
      const { db: firestoreDb } = getFirebase();
      await updateDoc(doc(firestoreDb, 'notifications', notificationId), {
        read: true,
        readAt: Date.now(),
      });
    } catch (err) {
      if (__DEV__) console.warn('[notifications] markRead failed', err);
    }
  },

  /**
   * Save the user's per-type prefs. Writes to the SELF-ONLY private
   * subdoc /users/{uid}/private/push so other signed-in users can't
   * read which notification types this user has muted (they used to
   * be readable via the public /users/{uid} doc — Security Audit
   * Finding #1). The CF reads via Admin SDK and merges with the
   * legacy root-doc copy for users who haven't migrated yet.
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
      await setDoc(
        docs.userPrivatePush(uid),
        {
          notificationPrefs: prefs,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
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
   * Persist a push token under /users/{uid}/private/push.fcmTokens.
   * Multi-device: `arrayUnion` is idempotent so re-running this on app
   * boot won't accumulate duplicates of the same token.
   *
   * The token used to live on the public /users/{uid}.fcmTokens, where
   * any signed-in user could read it (Security Audit Finding #1).
   * Moved here behind self-only rules. The Cloud Function still reads
   * it via Admin SDK and falls back to the legacy public field for
   * users who haven't migrated yet — see `loadUsers` in
   * functions/src/index.ts.
   *
   * Mock mode: no-op.
   */
  async registerDeviceToken(uid: UserId, token: string): Promise<void> {
    if (USE_MOCK_DATA || !token) return;
    try {
      await setDoc(
        docs.userPrivatePush(uid),
        {
          fcmTokens: arrayUnion(token),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
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
   * Send a game invite via the trusted `sendGameInvite` Cloud Function.
   *
   * This used to write the notification doc directly from the client
   * with `inviterName` / `gameTitle` etc. supplied by the UI — which
   * let any signed-in client phish "מנהל הקבוצה" by writing whatever
   * display name they wanted.
   *
   * Now: client passes IDs only. The CF loads the sender + game
   * server-side, verifies permission, applies the server-side rate
   * limit, constructs the payload, and writes the notification.
   *
   * Throws a typed Error with a `code` matching the Firebase HttpsError
   * codes the function returns:
   *   • 'unauthenticated' / 'permission-denied'
   *   • 'invalid-argument'
   *   • 'failed-precondition'  (already registered, finished game)
   *   • 'resource-exhausted'   (rate limit hit)
   * Callers should branch on `err.code` to surface a useful message.
   */
  async inviteToGame(input: {
    recipientId: UserId;
    gameId: string;
    /** @deprecated kept for backwards-compat with old call sites. Server ignores. */
    gameTitle?: string;
    /** @deprecated kept for backwards-compat with old call sites. Server ignores. */
    inviterName?: string;
    /** @deprecated kept for backwards-compat with old call sites. Server ignores. */
    startsAt?: number;
    /** @deprecated kept for backwards-compat with old call sites. Server ignores. */
    inviterId?: UserId;
  }): Promise<void> {
    if (!input?.recipientId || !input?.gameId) {
      throw new Error('inviteToGame: missing recipientId or gameId');
    }
    if (USE_MOCK_DATA) {
      // Keep the dev/inspector flow working in mock mode.
      mockNotifications.push({
        id: `mn-${Date.now()}`,
        type: 'inviteToGame',
        recipientId: input.recipientId,
        payload: {
          gameId: input.gameId,
          gameTitle: input.gameTitle ?? '',
          inviterName: input.inviterName ?? '',
          startsAt: input.startsAt ?? 0,
        },
        createdAt: Date.now(),
        delivered: false,
      });
      return;
    }
    // Lazy-import the callable infra so the bundle stays lean for
    // mock-mode users.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { httpsCallable } = require('firebase/functions');
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'sendGameInvite');
    try {
      await fn({
        recipientId: input.recipientId,
        gameId: input.gameId,
      });
    } catch (err) {
      // Re-throw with the Firebase error code preserved so the UI can
      // distinguish rate-limit from permission from invalid-target.
      const e = err as { code?: string; message?: string; details?: unknown };
      const wrapped = new Error(e.message ?? 'inviteToGame failed') as Error & {
        code: string;
      };
      wrapped.code = (e.code ?? 'unknown').replace(/^functions\//, '');
      throw wrapped;
    }
  },

  /** Useful to inspect mock dispatches in dev — no-op in Firebase mode. */
  __getMockDispatches(): NotificationDoc[] {
    return mockNotifications.slice();
  },
};

// Re-export defaults for screens to import alongside the service.
export { defaultNotificationPrefs };
