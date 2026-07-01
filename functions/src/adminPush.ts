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
      return (
        c === 'messaging/registration-token-not-registered' ||
        c === 'messaging/invalid-argument'
      );
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
