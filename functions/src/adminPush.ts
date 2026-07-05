// Shared FCM sender for founder alerts. Honors the per-type on/off toggles the
// Pulse dashboard writes to adminConfig/prefs (server-side filtering, because
// the push fires even when the app is closed). Default = enabled.

import * as admin from 'firebase-admin';

export type NotifType =
  | 'newUser' | 'review' | 'error' | 'bug' | 'suggestion'
  | 'gameJoin' | 'gameCreate' | 'communityCreate' | 'communityJoin'
  | 'availabilityUpdate';

export async function pushToAdmins(
  type: NotifType,
  title: string,
  body: string,
  data: Record<string, string> = {},
): Promise<void> {
  const db = admin.firestore();
  const messaging = admin.messaging();

  // Per-type mute switch (default on when missing).
  try {
    const prefs = (await db.collection('adminConfig').doc('prefs').get()).data() as
      | Record<string, boolean>
      | undefined;
    if (prefs && prefs[type] === false) return;
  } catch {
    /* default enabled */
  }

  // Flood guard: collapse a burst of the SAME alert type to at most one push
  // per window. Without this, an unauthenticated /errors write-loop, a
  // self-toggled availability loop, or scripted game/community creates could
  // flood the founder's device and rack up send cost at ~zero attacker cost.
  // Distinct legitimate events of one type are sparse enough to pass; a flood
  // is capped. Different types use different latches, so mixed real activity
  // is unaffected.
  const THROTTLE_MS = 20_000;
  try {
    const latchRef = db.collection('adminPushLatches').doc(type);
    const dropped = await db.runTransaction(async (tx) => {
      const snap = await tx.get(latchRef);
      const last = Number(snap.data()?.lastSentAt) || 0;
      const now = Date.now();
      if (now - last < THROTTLE_MS) return true; // within window → drop
      tx.set(latchRef, { lastSentAt: now, type }, { merge: true });
      return false;
    });
    if (dropped) return;
  } catch (err) {
    // Fail-open: a throttle-check failure shouldn't silently swallow a real
    // alert. Worst case is one un-throttled send.
    console.warn('[pushToAdmins] throttle check failed', err);
  }

  let tokens: string[] = [];
  try {
    const cfg = await db.collection('adminConfig').doc('push').get();
    tokens = ((cfg.data()?.tokens as string[] | undefined) ?? []).filter(Boolean);
  } catch (err) {
    console.warn('[pushToAdmins] token read failed', err);
  }
  if (!tokens.length) return;

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: { ...data, type },
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const dead = tokens.filter((_, i) => {
      const c = res.responses[i]?.error?.code;
      // Only prune permanently-dead tokens; 'invalid-argument' can be a
      // message-level error and must not delete otherwise-valid tokens.
      return c === 'messaging/registration-token-not-registered';
    });
    if (dead.length) {
      await db
        .collection('adminConfig')
        .doc('push')
        .update({ tokens: admin.firestore.FieldValue.arrayRemove(...dead) });
    }
  } catch (err) {
    console.error('[pushToAdmins] send failed', err);
  }
}
