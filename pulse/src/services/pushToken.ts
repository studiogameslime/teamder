import { observeCaughtError } from './errorObservation';
// Registers this device's native FCM token in Firestore (adminConfig/push) so
// the Teamder `onNewUserJoined` Cloud Function can push a real-time
// "מישהו נרשם!" alert here. Read-modify-write the small token list via the
// service account (bypasses rules — adminConfig is client-locked).

import { getDevicePushToken } from './notify';
import { getDoc, patchDoc } from './firestoreRest';
import { has } from '../capabilities';

export async function registerForRealtimeAlerts(): Promise<void> {
  try {
    if (!has.firebase()) return;
    const token = await getDevicePushToken();
    if (!token) return;
    const doc = await getDoc('adminConfig/push').catch((caughtError39450b5b1e: unknown) => { observeCaughtError(caughtError39450b5b1e, {"source":"pulse/src/services/pushToken.ts","handler":"registerForRealtimeAlerts","site":"pushToken:39450b5b1e"}); return null; });
    const existing: string[] = Array.isArray(doc?.tokens)
      ? (doc!.tokens as string[]).filter((t) => typeof t === 'string')
      : [];
    if (existing.includes(token)) return; // already registered
    // Keep the list small (a founder has a handful of devices).
    const next = [...existing, token].slice(-10);
    await patchDoc('adminConfig/push', { tokens: next });
  } catch (caughtError93b2700bfa) {
    observeCaughtError(caughtError93b2700bfa, {"source":"pulse/src/services/pushToken.ts","handler":"registerForRealtimeAlerts","site":"pushToken:93b2700bfa"});
    /* never block startup */
  }
}
