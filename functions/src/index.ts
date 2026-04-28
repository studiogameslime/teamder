// Cloud Functions consumer for the /notifications outbound queue + a
// scheduled reminder job for upcoming games.
//
// Triggers:
//   1. onCreate /notifications/{id}        → build + send FCM payload
//   2. onSchedule every 15m                 → write reminder notifications
//                                            for games starting ~1h away
//
// Per-type behaviour (Phase E.2.2):
//   joinRequest          → single recipient (the admin)
//   approved / rejected  → single recipient (the player)
//   newGameInCommunity   → fan-out: users where newGameSubscriptions
//                          array-contains payload.groupId
//   gameReminder         → fan-out: game.players (read from games/{gameId})
//   gameCanceledOrUpdated→ fan-out: game.players + waitlist + pending
//   spotOpened           → single recipient (the promoted user)
//   imLate               → single recipient (the organizer)
//   inviteToGame         → single recipient (the invited user)
//
// Deploy:
//   cd functions
//   npm install && npm run build
//   firebase deploy --only functions

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

// ─── Types (loose — Firestore docs are dynamic) ────────────────────────

type NotificationType =
  | 'joinRequest'
  | 'approved'
  | 'rejected'
  | 'newGameInCommunity'
  | 'gameReminder'
  | 'gameCanceledOrUpdated'
  | 'spotOpened'
  | 'imLate'
  | 'growthMilestone'
  | 'inviteToGame';

interface NotificationDoc {
  type: NotificationType;
  recipientId: string;
  payload?: Record<string, unknown>;
  delivered?: boolean;
}

interface UserDoc {
  fcmTokens?: string[];
  notificationPrefs?: Partial<Record<NotificationType, boolean>>;
  newGameSubscriptions?: string[];
}

// ─── Default Hebrew messages per type ──────────────────────────────────

function buildMessage(
  type: NotificationType,
  payload: Record<string, unknown>
): { title: string; body: string } | null {
  const groupName = (payload.groupName as string) || 'הקבוצה';
  const gameTitle = (payload.gameTitle as string) || (payload.title as string) || 'המשחק';
  const startsAt = payload.startsAt as number | undefined;
  const when = startsAt ? formatHebrewWhen(startsAt) : '';

  switch (type) {
    case 'joinRequest':
      return {
        title: 'בקשת הצטרפות חדשה',
        body: `מישהו מבקש להצטרף ל${groupName}`,
      };
    case 'approved':
      return { title: 'הבקשה אושרה', body: `אושרת ל${groupName}` };
    case 'rejected':
      return {
        title: 'הבקשה נדחתה',
        body: `הבקשה שלך ל${groupName} נדחתה`,
      };
    case 'newGameInCommunity': {
      const title = (payload.title as string) || groupName;
      return {
        title: `משחק חדש: ${title}`,
        body: when ? `${title} · ${when}` : `נפתח משחק חדש ב${title}`,
      };
    }
    case 'gameReminder':
      return {
        title: 'תזכורת למשחק',
        body: when
          ? `${gameTitle} מתחיל ב-${when}`
          : `${gameTitle} מתחיל בקרוב`,
      };
    case 'gameCanceledOrUpdated':
      return {
        title: 'המשחק בוטל',
        body: `${gameTitle} בוטל. בדוק את לשונית המשחקים.`,
      };
    case 'spotOpened':
      return {
        title: 'נפתח לך מקום במשחק!',
        body: `מישהו ביטל ב${gameTitle} — אתה רשום כעת.`,
      };
    case 'imLate': {
      const lateName = (payload.lateUserName as string) || 'שחקן';
      return {
        title: 'שחקן מאחר',
        body: `${lateName} הודיע שיאחר ל${gameTitle}`,
      };
    }
    case 'inviteToGame': {
      const inviter = (payload.inviterName as string) || 'מאמן המשחק';
      return {
        title: 'הזמנה למשחק',
        body: when
          ? `${inviter} הזמין אותך ל${gameTitle} (${when})`
          : `${inviter} הזמין אותך ל${gameTitle}`,
      };
    }
    case 'growthMilestone':
      return null; // not yet implemented client-side
    default:
      return null;
  }
}

function formatHebrewWhen(ms: number): string {
  const d = new Date(ms);
  const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const day = days[d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `יום ${day} ${dd}/${mm} ${hh}:${mi}`;
}

// ─── Recipient resolution ──────────────────────────────────────────────

async function loadUsers(uids: string[]): Promise<UserDoc[]> {
  if (uids.length === 0) return [];
  // De-dupe (game arrays can drift) and use db.getAll for a single
  // batched read instead of an `in` query that's capped at 30.
  const unique = Array.from(new Set(uids));
  const refs = unique.map((u) => db.collection('users').doc(u));
  const snaps = await db.getAll(...refs);
  const out: UserDoc[] = [];
  for (const snap of snaps) {
    if (snap.exists) out.push(snap.data() as UserDoc);
  }
  return out;
}

async function resolveRecipients(
  notif: NotificationDoc
): Promise<UserDoc[]> {
  const payload = notif.payload || {};

  if (notif.type === 'newGameInCommunity') {
    const groupId = (payload.groupId as string) || notif.recipientId;
    if (!groupId) return [];
    const snap = await db
      .collection('users')
      .where('newGameSubscriptions', 'array-contains', groupId)
      .get();
    return snap.docs.map((d) => d.data() as UserDoc);
  }

  if (
    notif.type === 'gameReminder' ||
    notif.type === 'gameCanceledOrUpdated'
  ) {
    const gameId = (payload.gameId as string) || notif.recipientId;
    if (!gameId) return [];
    const gSnap = await db.collection('games').doc(gameId).get();
    if (!gSnap.exists) return [];
    const g = gSnap.data() as {
      players?: string[];
      waitlist?: string[];
      pending?: string[];
    };
    const ids =
      notif.type === 'gameReminder'
        ? g.players || []
        : Array.from(
            new Set([
              ...(g.players || []),
              ...(g.waitlist || []),
              ...(g.pending || []),
            ])
          );
    return loadUsers(ids);
  }

  // Single recipient.
  const snap = await db.collection('users').doc(notif.recipientId).get();
  if (!snap.exists) return [];
  return [snap.data() as UserDoc];
}

// ─── Delivery ──────────────────────────────────────────────────────────

async function deliverBatch(
  type: NotificationType,
  recipients: UserDoc[],
  message: { title: string; body: string },
  data: Record<string, string>
): Promise<{ ok: number; failed: number; skippedPref: number; skippedNoToken: number }> {
  // Aggregate tokens across all recipients into a Set so a user with
  // the same device registered twice (or two recipients sharing a
  // token, which shouldn't happen but cheap to guard) doesn't get a
  // duplicate push for one logical notification.
  const tokens = new Set<string>();
  let skippedPref = 0;
  let skippedNoToken = 0;
  for (const user of recipients) {
    if (user.notificationPrefs?.[type] === false) {
      skippedPref++;
      continue;
    }
    const userTokens = (user.fcmTokens || []).filter(
      (t) => typeof t === 'string' && t.length > 0
    );
    if (userTokens.length === 0) {
      skippedNoToken++;
      continue;
    }
    userTokens.forEach((t) => tokens.add(t));
  }

  if (skippedPref > 0) {
    console.log(
      `[notifications] ${type}: skipped ${skippedPref} user(s) — pref off`
    );
  }
  if (skippedNoToken > 0) {
    console.log(
      `[notifications] ${type}: skipped ${skippedNoToken} user(s) — no fcm token`
    );
  }

  if (tokens.size === 0) {
    return { ok: 0, failed: 0, skippedPref, skippedNoToken };
  }

  // sendEachForMulticast is capped at 500 tokens per call.
  const all = Array.from(tokens);
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < all.length; i += 500) {
    const chunk = all.slice(i, i + 500);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification: { title: message.title, body: message.body },
      data,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    ok += res.successCount;
    failed += res.failureCount;
  }
  return { ok, failed, skippedPref, skippedNoToken };
}

// ─── onCreate trigger ──────────────────────────────────────────────────

export const onNotificationCreated = onDocumentCreated(
  'notifications/{id}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const notif = snap.data() as NotificationDoc;
    if (notif.delivered) return;

    const message = buildMessage(notif.type, notif.payload || {});
    if (!message) {
      await snap.ref.update({
        delivered: true,
        deliveredAt: Date.now(),
        skipped: 'type-not-implemented',
      });
      return;
    }

    let totalOk = 0;
    let totalFailed = 0;
    let skippedPref = 0;
    let skippedNoToken = 0;
    try {
      const recipients = await resolveRecipients(notif);
      const data: Record<string, string> = {
        type: notif.type,
        ...Object.fromEntries(
          Object.entries(notif.payload || {}).map(([k, v]) => [k, String(v)])
        ),
      };
      const res = await deliverBatch(notif.type, recipients, message, data);
      totalOk = res.ok;
      totalFailed = res.failed;
      skippedPref = res.skippedPref;
      skippedNoToken = res.skippedNoToken;
    } catch (err) {
      console.error('[onNotificationCreated] delivery failed', err);
    }

    await snap.ref.update({
      delivered: true,
      deliveredAt: Date.now(),
      stats: {
        ok: totalOk,
        failed: totalFailed,
        skippedPref,
        skippedNoToken,
      },
    });
  }
);

// ─── Scheduled: 1h-before reminders ────────────────────────────────────

export const sendGameReminders = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    // Look for games starting in [now+50, now+70] minutes that haven't
    // had a reminder dispatched yet. The 20-minute window covers slack
    // around our 15-minute cadence — a game is found in exactly one run.
    const now = Date.now();
    const lower = now + 50 * 60 * 1000;
    const upper = now + 70 * 60 * 1000;

    const snap = await db
      .collection('games')
      .where('startsAt', '>=', lower)
      .where('startsAt', '<', upper)
      .get();

    if (snap.empty) {
      console.log('[sendGameReminders] no candidate games');
      return;
    }

    const ops: Promise<unknown>[] = [];
    for (const doc of snap.docs) {
      const g = doc.data() as {
        title?: string;
        startsAt?: number;
        status?: string;
        reminderSent?: boolean;
        players?: string[];
      };
      if (g.reminderSent) continue;
      if (g.status && g.status !== 'open' && g.status !== 'locked') continue;
      if (!g.players || g.players.length === 0) continue;

      // Write the notification + flip reminderSent atomically. A failure
      // mid-write at worst skips the reminder for this game; not double.
      ops.push(
        db.collection('notifications').add({
          type: 'gameReminder',
          recipientId: doc.id, // fan-out marker
          payload: {
            gameId: doc.id,
            gameTitle: g.title || 'המשחק',
            startsAt: g.startsAt,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          delivered: false,
        })
      );
      ops.push(doc.ref.update({ reminderSent: true }));
    }

    await Promise.all(ops);
    console.log(`[sendGameReminders] dispatched ${ops.length / 2} reminder(s)`);
  }
);
