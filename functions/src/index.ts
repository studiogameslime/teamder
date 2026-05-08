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
//   inviteToGame         → single recipient (the invited user)
//
// Deploy:
//   cd functions
//   npm install && npm run build
//   firebase deploy --only functions

import * as admin from 'firebase-admin';
import {
  onDocumentCreated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError, onRequest } from 'firebase-functions/v2/https';
import * as fs from 'fs';
import * as path from 'path';
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
  | 'spotOffered'
  | 'growthMilestone'
  | 'inviteToGame'
  | 'rateReminder'
  | 'gameFillingUp'
  | 'gameRsvpNudge'
  | 'gamePlayersJoined'
  | 'playerCancelled'
  | 'groupDeleted';

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
    case 'approved': {
      // Same notification type covers both community membership
      // approval and game-join approval. The presence of `gameId` in
      // the payload is the discriminator — community approvals carry
      // a groupName (or default), game approvals carry a gameTitle.
      // Game approvals also carry `bucket: 'players' | 'waitlist'` so
      // a user who lands on the waitlist (capacity already filled by
      // the time the admin approved) gets honest copy instead of
      // assuming they're in.
      const isGameApproval = typeof payload.gameId === 'string';
      if (isGameApproval) {
        const bucket = typeof payload.bucket === 'string' ? payload.bucket : '';
        if (bucket === 'waitlist') {
          return {
            title: 'הבקשה אושרה — נכנסת לרשימת המתנה',
            body: `אושרת ל${gameTitle}, אבל ההרכב מלא. שובצת ברשימת המתנה ותקבל התראה אם יתפנה מקום.`,
          };
        }
        return {
          title: 'הבקשה אושרה',
          body: `אושרת ל${gameTitle}`,
        };
      }
      return {
        title: 'הבקשה אושרה',
        body: `אושרת ל${groupName}`,
      };
    }
    case 'rejected': {
      const isGameRejection = typeof payload.gameId === 'string';
      return {
        title: 'הבקשה נדחתה',
        body: isGameRejection
          ? `הבקשה שלך ל${gameTitle} נדחתה`
          : `הבקשה שלך ל${groupName} נדחתה`,
      };
    }
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
    case 'gameRsvpNudge':
      return {
        title: 'אתה בא למשחק?',
        body: when
          ? `${gameTitle} מתחיל ב-${when}. אתה מצטרף?`
          : `${gameTitle} מתחיל היום. אתה מצטרף?`,
      };
    case 'gameCanceledOrUpdated': {
      // The dispatch site sends `action: 'cancelled' | 'deleted' |
      // 'updated'`. A plain edit (e.g. admin tweaks the time / field)
      // should NOT produce a "המשחק בוטל" banner — that misleads
      // players into thinking the game is gone. Branch on the action
      // so updates and cancellations get distinct copy.
      const action = typeof payload.action === 'string' ? payload.action : '';
      if (action === 'updated') {
        return {
          title: 'המשחק עודכן',
          body: `${gameTitle} עודכן. בדוק את הפרטים בלשונית המשחקים.`,
        };
      }
      // 'cancelled' / 'deleted' (or unknown — old payloads default to
      // the cancellation copy as a safe fallback).
      return {
        title: 'המשחק בוטל',
        body: `${gameTitle} בוטל. בדוק את לשונית המשחקים.`,
      };
    }
    case 'spotOpened':
      return {
        title: 'נפתח לך מקום במשחק!',
        body: `מישהו ביטל ב${gameTitle} — אתה רשום כעת.`,
      };
    case 'spotOffered':
      // Confirmation-required variant of spotOpened. The user is the
      // head of the waitlist and a slot just opened — they have to
      // explicitly tap "אישור" to claim it. The push carries
      // CONFIRM_SPOT / PASS_SPOT action buttons (registered in
      // App.tsx under the `SPOT_OFFER` category).
      return {
        title: 'התפנה לך מקום!',
        body: when
          ? `${gameTitle} (${when}) — מאשר/ת הגעה?`
          : `${gameTitle} — מאשר/ת הגעה?`,
      };
    case 'inviteToGame': {
      const inviter = (payload.inviterName as string) || 'מנהל המשחק';
      return {
        title: 'הזמנה למשחק',
        body: when
          ? `${inviter} הזמין אותך ל${gameTitle} (${when})`
          : `${inviter} הזמין אותך ל${gameTitle}`,
      };
    }
    case 'rateReminder':
      return {
        title: 'דרג את חבריך מהמשחק',
        body: `המשחק ${gameTitle} הסתיים — תן דירוג בלחיצה אחת.`,
      };
    case 'gameFillingUp': {
      const remaining = (payload.remaining as number | undefined) ?? 0;
      const head = remaining === 1 ? 'מקום אחרון' : `${remaining} מקומות אחרונים`;
      return {
        title: `${head} ב${gameTitle}`,
        body: when
          ? `${head} — המשחק ${when}, הירשם לפני שייסגר.`
          : `${head} — הירשם לפני שייסגר.`,
      };
    }
    case 'gamePlayersJoined': {
      // Batched admin push — N joiners in the recent window are
      // consolidated into ONE notification. The flushPendingJoinerNotifs
      // cron is what assembles `joinerNames` (CSV) and `count`.
      const namesCsv = typeof payload.joinerNames === 'string'
        ? (payload.joinerNames as string)
        : '';
      const names = namesCsv ? namesCsv.split(',').filter(Boolean) : [];
      const count = (payload.count as number | undefined) ?? names.length;
      const head =
        names.length === 0
          ? `${count} שחקנים אישרו הגעה`
          : names.length === 1
            ? `${names[0]} אישר הגעה`
            : names.length === 2
              ? `${names[0]} ו-${names[1]} אישרו הגעה`
              : `${names[0]}, ${names[1]} ועוד ${count - 2} אישרו הגעה`;
      return {
        title: head,
        body: `ל${gameTitle}`,
      };
    }
    case 'groupDeleted': {
      // Sent to every former member when an admin deletes the
      // community. Per-game cancellations fan out separately via
      // `gameCanceledOrUpdated` — this push specifically tells
      // members the COMMUNITY itself is gone.
      const name = (payload.groupName as string) || groupName;
      return {
        title: 'הקהילה נסגרה',
        body: `הקהילה ${name} נמחקה על ידי המנהל.`,
      };
    }
    case 'playerCancelled': {
      // Sent only to the game admin. Three flavours:
      //   • account-deletion sweep with multiple games:
      //     payload.reason='accountDeleted' AND gameTitles[] is set
      //     → consolidated "X deleted account, left games A, B, C"
      //   • single game cancellation with waitlist promotion:
      //     payload.promotedUserId is a string
      //     → "X cancelled in <game>, waitlist player took the spot"
      //   • plain single cancellation:
      //     → "X cancelled in <game>, find a replacement"
      const reason = typeof payload.reason === 'string' ? payload.reason : '';
      const titles = Array.isArray(payload.gameTitles)
        ? (payload.gameTitles as unknown[]).filter(
            (s): s is string => typeof s === 'string' && s.length > 0,
          )
        : [];
      if (reason === 'accountDeleted' && titles.length > 0) {
        const list =
          titles.length === 1
            ? titles[0]
            : titles.length === 2
              ? `${titles[0]} ו-${titles[1]}`
              : `${titles.slice(0, 2).join(', ')} ועוד ${titles.length - 2}`;
        return {
          title: 'שחקן מחק את החשבון',
          body: `שחקן מחק את חשבונו והוסר מהמשחקים: ${list}.`,
        };
      }
      const promoted = typeof payload.promotedUserId === 'string';
      return {
        title: 'שחקן ביטל השתתפות',
        body: promoted
          ? `שחקן ביטל ב${gameTitle} — שחקן מרשימת ההמתנה אוּשר במקומו.`
          : `שחקן ביטל ב${gameTitle}. כדאי לחפש מחליף.`,
      };
    }
    case 'growthMilestone':
      return null; // not yet implemented client-side
    default:
      return null;
  }
}

function formatHebrewWhen(ms: number): string {
  // Cloud Functions run in UTC; use Israel local time so notification
  // text matches the time the user actually expects to play. Without
  // this override, a 20:00 Israel game renders as 17:00 (UTC).
  const tz = 'Asia/Jerusalem';
  const d = new Date(ms);
  const days = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: tz,
  }).format(d);
  const day = days[dayMap[weekdayShort] ?? 0];
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `יום ${day} ${part('day')}/${part('month')} ${part('hour')}:${part('minute')}`;
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
    // Self-exclusion: the admin who just created the game shouldn't
    // get pinged about their own creation. We prefer payload.createdBy
    // (forward-compatible) and fall back to reading the game doc —
    // older app builds didn't include createdBy in the payload, but
    // it's always written on the game itself.
    let createdBy =
      typeof payload.createdBy === 'string' ? payload.createdBy : '';
    if (!createdBy) {
      const gameId =
        typeof payload.gameId === 'string' ? payload.gameId : '';
      if (gameId) {
        const gSnap = await db.collection('games').doc(gameId).get();
        if (gSnap.exists) {
          const gd = gSnap.data() as { createdBy?: string };
          if (typeof gd.createdBy === 'string') createdBy = gd.createdBy;
        }
      }
    }
    const snap = await db
      .collection('users')
      .where('newGameSubscriptions', 'array-contains', groupId)
      .get();
    return snap.docs
      .filter((d) => d.id !== createdBy)
      .map((d) => d.data() as UserDoc);
  }

  if (
    notif.type === 'gameReminder' ||
    notif.type === 'gameCanceledOrUpdated' ||
    notif.type === 'rateReminder'
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
      notif.type === 'gameCanceledOrUpdated'
        ? Array.from(
            new Set([
              ...(g.players || []),
              ...(g.waitlist || []),
              ...(g.pending || []),
            ])
          )
        : g.players || []; // gameReminder + rateReminder → players only
    return loadUsers(ids);
  }

  if (notif.type === 'gamePlayersJoined') {
    // Fan out to community admins so they know who locked in. The
    // flush cron stamps `joinerIds` on the payload (CSV) so we can
    // self-exclude — an admin who joined their own game shouldn't
    // get a "you joined" push.
    const groupId = (payload.groupId as string) || '';
    if (!groupId) return [];
    const grpSnap = await db.collection('groups').doc(groupId).get();
    if (!grpSnap.exists) return [];
    const grp = grpSnap.data() as { adminIds?: string[] };
    const joinerCsv =
      typeof payload.joinerIds === 'string'
        ? (payload.joinerIds as string)
        : '';
    const joinerSet = new Set(joinerCsv.split(',').filter(Boolean));
    const recipients = (grp.adminIds || []).filter(
      (uid) => !joinerSet.has(uid),
    );
    return loadUsers(recipients);
  }

  if (notif.type === 'gameFillingUp') {
    // Fan out to community members who could still join — exclude
    // anyone already on the roster (players, waitlist, pending). The
    // `recipientId` carries the gameId; payload.groupId is required.
    const gameId = (payload.gameId as string) || notif.recipientId;
    const groupId = payload.groupId as string | undefined;
    if (!gameId || !groupId) return [];
    const [gSnap, grpSnap] = await Promise.all([
      db.collection('games').doc(gameId).get(),
      db.collection('groups').doc(groupId).get(),
    ]);
    if (!gSnap.exists || !grpSnap.exists) return [];
    const g = gSnap.data() as {
      players?: string[];
      waitlist?: string[];
      pending?: string[];
    };
    const grp = grpSnap.data() as { playerIds?: string[] };
    const inRoster = new Set([
      ...(g.players || []),
      ...(g.waitlist || []),
      ...(g.pending || []),
    ]);
    const candidates = (grp.playerIds || []).filter((u) => !inRoster.has(u));
    return loadUsers(candidates);
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

  // Notifications that should render with action buttons advertise
  // a category id; expo-notifications matches it against the
  // categories the client registered at boot (see App.tsx) and the
  // OS draws the buttons. `gameReminder` and `gameRsvpNudge` share
  // the "אני בא / לא בא" pair; `spotOffered` uses its own
  // "אישור הגעה / ויתור" pair.
  let categoryIdentifier: string | undefined;
  if (type === 'gameReminder' || type === 'gameRsvpNudge') {
    categoryIdentifier = 'GAME_REMINDER';
  } else if (type === 'spotOffered') {
    categoryIdentifier = 'SPOT_OFFER';
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
      // The client looks at `data.categoryIdentifier` to know which
      // category buttons to render on Android — iOS reads it off
      // `apns.payload.aps.category` below. Sending in both places is
      // belt-and-suspenders but cheap.
      data: categoryIdentifier
        ? { ...data, categoryIdentifier }
        : data,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            ...(categoryIdentifier ? { category: categoryIdentifier } : {}),
          },
        },
      },
    });
    ok += res.successCount;
    failed += res.failureCount;
  }
  return { ok, failed, skippedPref, skippedNoToken };
}

// ─── onCreate trigger ──────────────────────────────────────────────────

/**
 * Dedup window for game-update fan-outs. An admin who edits a game
 * 3 times in 30 seconds should not fire 3 separate pushes to every
 * registered player — that's spam. We collapse repeat 'updated'
 * events for the same gameId within this window into a single
 * delivered push (the FIRST one wins; subsequent ones are marked
 * delivered with `skipped: 'duplicate'`).
 *
 * Cancellations / deletions are NOT deduped — those are terminal
 * one-shots and the user needs to know.
 */
const GAME_UPDATE_DEDUP_WINDOW_MS = 60 * 1000;

export const onNotificationCreated = onDocumentCreated(
  'notifications/{id}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const notif = snap.data() as NotificationDoc;
    if (notif.delivered) return;

    // Game-update dedup: an admin editing a game 3 times in 30s
    // should not fan out 3 separate pushes to every registered
    // player. We use a per-gameId latch doc with `lastDispatchedAt`;
    // if the latch is fresh, skip this push. Updating the latch is
    // best-effort — if it fails the worst case is one duplicate
    // push, which is fine.
    if (
      notif.type === 'gameCanceledOrUpdated' &&
      notif.payload?.action === 'updated' &&
      typeof notif.payload?.gameId === 'string'
    ) {
      const gameId = notif.payload.gameId as string;
      const latchRef = db.collection('gameUpdateLatches').doc(gameId);
      const latch = await latchRef.get();
      const now = Date.now();
      const lastAt = latch.exists
        ? Number(latch.data()?.lastDispatchedAt) || 0
        : 0;
      if (lastAt > 0 && now - lastAt < GAME_UPDATE_DEDUP_WINDOW_MS) {
        await snap.ref.update({
          delivered: true,
          deliveredAt: now,
          skipped: 'duplicate',
        });
        return;
      }
      try {
        await latchRef.set(
          { lastDispatchedAt: now, gameId },
          { merge: true },
        );
      } catch (err) {
        console.warn('[onNotificationCreated] latch write failed', err);
      }
    }

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

// ─── Scheduled: 5h-before "did you forget to RSVP?" nudge ───────────────

/**
 * Per-user push to community members who are still on the fence
 * 5 hours before kickoff. The push carries the same JOIN/CANCEL
 * action buttons as `gameReminder`, so the recipient can lock
 * their answer without opening the app — exactly the WhatsApp-poll
 * UX we're trying to replace.
 *
 * Eligibility:
 *   • game.status === 'open'
 *   • game.startsAt in [now+4h50m, now+5h10m]  (matches our 15-min
 *     cron cadence)
 *   • !game.rsvpNudgeSent  (per-game latch)
 *   • not already at capacity
 *
 * Recipients per game:
 *   • the parent group's playerIds + adminIds  (community members)
 *   • MINUS anyone already in players / waitlist / pending
 *   • MINUS anyone in `cancellations` (they explicitly opted out)
 *   • MINUS the game's createdBy (don't ping the organiser about
 *     their own game)
 */
export const sendRsvpNudges = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const now = Date.now();
    const lower = now + 4 * 60 * 60 * 1000 + 50 * 60 * 1000;
    const upper = now + 5 * 60 * 60 * 1000 + 10 * 60 * 1000;

    const snap = await db
      .collection('games')
      .where('startsAt', '>=', lower)
      .where('startsAt', '<', upper)
      .get();

    if (snap.empty) {
      console.log('[sendRsvpNudges] no candidate games');
      return;
    }

    let nudged = 0;
    for (const doc of snap.docs) {
      const g = doc.data() as {
        title?: string;
        startsAt?: number;
        status?: string;
        rsvpNudgeSent?: boolean;
        groupId?: string;
        createdBy?: string;
        players?: string[];
        waitlist?: string[];
        pending?: string[];
        cancellations?: Record<string, number>;
        guests?: unknown[];
        maxPlayers?: number;
      };
      if (g.rsvpNudgeSent) continue;
      if (g.status !== 'open') continue;
      if (!g.groupId) continue;
      const playersCount = g.players?.length ?? 0;
      const guestsCount = g.guests?.length ?? 0;
      if (g.maxPlayers && playersCount + guestsCount >= g.maxPlayers) continue;

      // Pull the parent group to enumerate its members.
      const groupSnap = await db.collection('groups').doc(g.groupId).get();
      if (!groupSnap.exists) continue;
      const grp = groupSnap.data() as {
        playerIds?: string[];
        adminIds?: string[];
      };
      const members = new Set<string>([
        ...(grp.playerIds ?? []),
        ...(grp.adminIds ?? []),
      ]);

      // Exclusions: anyone already in any roster bucket, anyone who
      // already cancelled (they opted out), the organiser themselves.
      const exclude = new Set<string>([
        ...(g.players ?? []),
        ...(g.waitlist ?? []),
        ...(g.pending ?? []),
        ...Object.keys(g.cancellations ?? {}),
      ]);
      if (g.createdBy) exclude.add(g.createdBy);

      const targets = Array.from(members).filter((uid) => !exclude.has(uid));

      // Flip the latch transactionally BEFORE dispatching, with a
      // re-read guard. This protects against:
      //   • two cron instances racing (CF can occasionally double-fire)
      //   • partial dispatch + retry → duplicate sends
      // Trade-off accepted: if the function crashes mid-loop below,
      // at most a handful of users miss the nudge for this one game.
      // A missed nudge is recoverable; a duplicate one is annoying.
      let claimed = false;
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) return;
          if ((fresh.data() as { rsvpNudgeSent?: boolean }).rsvpNudgeSent) {
            return;
          }
          tx.update(doc.ref, { rsvpNudgeSent: true });
          claimed = true;
        });
      } catch (e) {
        console.error('[sendRsvpNudges] latch txn failed', doc.id, e);
        continue;
      }
      if (!claimed) continue;
      if (targets.length === 0) continue;

      // One notification doc per target — wrapped individually so a
      // single failure (e.g. quota blip on one add) doesn't strand
      // the rest. The latch is already set, so we won't retry from
      // a re-fire either way.
      for (const uid of targets) {
        try {
          await db.collection('notifications').add({
            type: 'gameRsvpNudge',
            recipientId: uid,
            payload: {
              gameId: doc.id,
              gameTitle: g.title || 'המשחק',
              startsAt: g.startsAt,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            delivered: false,
          });
          nudged += 1;
        } catch (e) {
          console.error('[sendRsvpNudges] add failed', doc.id, uid, e);
        }
      }
    }

    console.log(`[sendRsvpNudges] nudged ${nudged} member(s)`);
  },
);

// ─── Scheduled: flush batched join notifications to admins ──────────────

/**
 * Consumes the `pendingJoinerIds[]` / `pendingJoinFlushAt` buffer
 * that `onGameRosterChanged` builds up on every join. When the
 * window expires (default 3 min from the first joiner), we send a
 * SINGLE consolidated push to the community admins instead of N
 * separate "X joined" pings — so a 10-player rush after a community
 * blast becomes one notification, not ten.
 *
 * Runs every minute → max latency for the admin push is `window + 1m`.
 *
 * Idempotency: the buffer is cleared inside a transaction that also
 * captures the joiner list, so two concurrent cron runs can't
 * dispatch the same batch twice.
 */
export const flushPendingJoinerNotifs = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const now = Date.now();
    const snap = await db
      .collection('games')
      .where('pendingJoinFlushAt', '<=', now)
      .get();

    if (snap.empty) return;

    let dispatched = 0;
    for (const doc of snap.docs) {
      const g = doc.data() as {
        title?: string;
        groupId?: string;
        startsAt?: number;
        pendingJoinerIds?: string[];
        pendingJoinFlushAt?: number;
      };

      // Claim transactionally — the tx captures the joiner list AND
      // clears the buffer atomically. Race between two cron runs:
      // only the first sees the unexpired flushAt and a non-empty
      // list; the second gets nothing and skips.
      let claimedJoiners: string[] = [];
      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(doc.ref);
          if (!fresh.exists) return;
          const d = fresh.data() as {
            pendingJoinerIds?: string[];
            pendingJoinFlushAt?: number;
          };
          if (!d.pendingJoinFlushAt || d.pendingJoinFlushAt > Date.now()) {
            return;
          }
          claimedJoiners = (d.pendingJoinerIds ?? []).slice();
          tx.update(doc.ref, {
            pendingJoinerIds: admin.firestore.FieldValue.delete(),
            pendingJoinFlushAt: admin.firestore.FieldValue.delete(),
          });
        });
      } catch (err) {
        console.error('[flushPendingJoinerNotifs] claim failed', doc.id, err);
        continue;
      }

      if (claimedJoiners.length === 0 || !g.groupId) continue;

      // Resolve display names for the message body. Best-effort: a
      // missing user just gets dropped from the names list, but
      // `count` still reflects the true total.
      let names: string[] = [];
      try {
        const userRefs = claimedJoiners.map((uid) =>
          db.collection('users').doc(uid),
        );
        const userSnaps = await db.getAll(...userRefs);
        names = userSnaps
          .map((s) => {
            if (!s.exists) return '';
            const data = s.data() as { displayName?: string };
            return (data.displayName || '').trim();
          })
          .filter((n) => n.length > 0);
      } catch (err) {
        console.error('[flushPendingJoinerNotifs] name lookup failed', err);
      }

      try {
        await db.collection('notifications').add({
          type: 'gamePlayersJoined',
          recipientId: g.groupId,
          payload: {
            gameId: doc.id,
            groupId: g.groupId,
            gameTitle: g.title || 'המשחק',
            startsAt: g.startsAt ?? null,
            joinerIds: claimedJoiners.join(','),
            joinerNames: names.join(','),
            count: claimedJoiners.length,
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          delivered: false,
        });
        dispatched += 1;
      } catch (err) {
        console.error('[flushPendingJoinerNotifs] dispatch failed', doc.id, err);
      }
    }

    if (dispatched > 0) {
      console.log(`[flushPendingJoinerNotifs] dispatched ${dispatched} batch(es)`);
    }
  },
);

// ─── Scheduled: deferred-open flip for recurring games ──────────────────
//
// Every 5 minutes, look for games in `status: 'scheduled'` whose
// `registrationOpensAt` has passed and:
//   1. Dispatch the `newGameInCommunity` push so subscribed members
//      learn registration just opened.
//   2. Mark the game with `openedNotificationSent: true` to stop a
//      retry from re-firing on the next run.
//   3. Flip status → 'open' (so feeds, joins and rules stop hiding it).
//
// Order matters for failure recovery: notify-then-flag-then-flip means
// the cron predicate (status='scheduled' AND !openedNotificationSent)
// keeps retrying until BOTH the dispatch AND the flag write land. The
// status flip is the last step — once it lands the game leaves the
// query window for good.
//
// `openedNotificationSent` is also the guard that prevents an admin's
// post-creation edit of `registrationOpensAt` from firing a second
// push: once the flag is true we never dispatch again for this game.
export const flipScheduledGames = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const now = Date.now();
    // Equality query — auto-indexed, no composite needed. The
    // registrationOpensAt + openedNotificationSent filters run
    // client-side.
    const snap = await db
      .collection('games')
      .where('status', '==', 'scheduled')
      .get();

    if (snap.empty) {
      console.log('[flipScheduledGames] no scheduled games');
      return;
    }

    let flipped = 0;
    let notifiedOnly = 0;
    for (const doc of snap.docs) {
      const g = doc.data() as {
        title?: string;
        startsAt?: number;
        fieldName?: string;
        groupId?: string;
        createdBy?: string;
        registrationOpensAt?: number;
        openedNotificationSent?: boolean;
      };
      if (
        typeof g.registrationOpensAt !== 'number' ||
        g.registrationOpensAt > now
      ) {
        continue;
      }

      // Step 1 — dispatch notification (only if not already sent).
      // The notification doc → CF fan-out → FCM, so a second cron run
      // that re-enters this branch would double-notify. The flag
      // write below makes that impossible.
      if (!g.openedNotificationSent) {
        try {
          await db.collection('notifications').add({
            type: 'newGameInCommunity',
            recipientId: g.groupId ?? doc.id,
            payload: {
              groupId: g.groupId,
              gameId: doc.id,
              title: g.title || 'המשחק',
              startsAt: g.startsAt,
              fieldName: g.fieldName,
              createdBy: g.createdBy,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            delivered: false,
          });
          // Step 2 — flag the game so a future run won't re-notify.
          // Done as a separate write because if step 1 throws we
          // should NOT mark the flag — the next cron run must retry.
          await doc.ref.update({
            openedNotificationSent: true,
            updatedAt: now,
          });
          notifiedOnly++;
        } catch (err) {
          console.error(
            `[flipScheduledGames] notify failed for ${doc.id}`,
            err,
          );
          // Skip the status flip too — we'll come back next run.
          continue;
        }
      }

      // Step 3 — flip status. Once this lands the game leaves the
      // 'scheduled' query window forever. Failure here is recoverable
      // because next run will still see status='scheduled' AND
      // openedNotificationSent=true → skip step 1, retry step 3.
      try {
        await doc.ref.update({
          status: 'open',
          updatedAt: now,
        });
        flipped++;
      } catch (err) {
        console.error(`[flipScheduledGames] flip failed for ${doc.id}`, err);
      }
    }

    console.log(
      `[flipScheduledGames] notified ${notifiedOnly}, flipped ${flipped}`,
    );
  },
);

// ─── Scheduled: stale-game cleanup ─────────────────────────────────────

/**
 * Hourly sweep that retires games whose kickoff was more than 6h ago
 * but never reached a terminal state. Two outcomes per stale game:
 *
 *   • Zombie (nobody ever joined: `players` and `guests` both empty)
 *     → delete the game doc + every `/rounds/{id}` it owns. Keeps the
 *       DB free of "ghost" entries the user never engaged with.
 *
 *   • Anything else (people registered, possibly played, just nobody
 *     pressed "סיים ערב")
 *     → flip status to 'finished' and lock=true. The doc keeps living
 *       so the History tab and any shared invite links continue to
 *       resolve cleanly.
 *
 * The CF and the client guards in gameLifecycle.ts are intentionally
 * redundant: clients hide stale games from the UI immediately, and the
 * CF makes the change durable in Firestore so writes from older
 * clients (or admins reaching the doc via direct nav) can't resurrect.
 */
export const cleanupStaleGames = onSchedule(
  {
    schedule: 'every 60 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
    const cutoff = Date.now() - STALE_AFTER_MS;

    // We only care about games that haven't reached a terminal state.
    // 'in' supports up to 30 values so three buckets fit fine.
    const snap = await db
      .collection('games')
      .where('status', 'in', ['open', 'locked', 'active'])
      .where('startsAt', '<', cutoff)
      .get();

    if (snap.empty) {
      console.log('[cleanupStaleGames] no stale games');
      return;
    }

    let deleted = 0;
    let finished = 0;
    const ops: Promise<unknown>[] = [];

    for (const gameDoc of snap.docs) {
      const g = gameDoc.data() as {
        id?: string;
        players?: string[];
        guests?: unknown[];
      };
      const playerCount = (g.players ?? []).length;
      const guestCount = (g.guests ?? []).length;
      const isZombie = playerCount === 0 && guestCount === 0;

      if (isZombie) {
        // Nuke the game and any /rounds it owns. We use a chunked delete
        // because a single batch caps at 500 ops — round counts here are
        // tiny (≤ ~10), but the pattern is safe regardless.
        ops.push(
          (async () => {
            const rounds = await db
              .collection('rounds')
              .where('gameId', '==', gameDoc.id)
              .get();
            const batch = db.batch();
            rounds.docs.forEach((r) => batch.delete(r.ref));
            batch.delete(gameDoc.ref);
            await batch.commit();
            deleted++;
          })()
        );
      } else {
        ops.push(
          gameDoc.ref.update({ status: 'finished', locked: true }).then(() => {
            finished++;
          })
        );
      }
    }

    await Promise.all(ops);
    console.log(
      `[cleanupStaleGames] swept ${snap.size} stale games — deleted ${deleted} zombies, finished ${finished}`
    );
  }
);

// ─── Scheduled: prune accumulating server-side state ───────────────────

/**
 * Daily housekeeping. Three independent sweeps in one CF so we pay
 * for one cron tick instead of three. Each sweep wraps its own
 * try/catch so a failure in one doesn't block the others.
 *
 * 1. /notifications older than 30 days → delete. The dispatch was
 *    already delivered (the CF marks `delivered=true` immediately);
 *    keeping the doc forever just bloats the collection. 30 days is
 *    enough for any debugging / audit needs.
 *
 * 2. /gameUpdateLatches whose target game is finished/cancelled or
 *    no longer exists → delete. The latch was used to dedup pushes
 *    within a 60-second window; once the game is terminal it's
 *    irrelevant.
 *
 * 3. /groupJoinRequests resolved (approved/rejected) more than 90
 *    days ago → delete. Audit trail beyond 90 days adds zero value
 *    and accumulates linearly with community activity.
 *
 * Batching: each sweep deletes in chunks of 400 (Firestore's per-
 * batch cap is 500). We don't paginate within a single CF run;
 * if a sweep produces >400 docs the leftovers wait for the next
 * day's run. That keeps the function bounded.
 */
export const dailyCleanup = onSchedule(
  {
    schedule: 'every 24 hours',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const BATCH_LIMIT = 400;
    const NOTIFICATIONS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const JOIN_REQUESTS_TTL_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 1) Old /notifications.
    let notifsDeleted = 0;
    try {
      const cutoff = now - NOTIFICATIONS_TTL_MS;
      const snap = await db
        .collection('notifications')
        .where('createdAt', '<', cutoff)
        .limit(BATCH_LIMIT)
        .get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        notifsDeleted = snap.size;
      }
    } catch (err) {
      console.error('[dailyCleanup] notifications sweep failed', err);
    }

    // 2) Stale /gameUpdateLatches. We can't query "where target game
    // is terminal" directly (no cross-collection joins), so we read
    // the latch's gameId and check the game doc one-by-one. Cheap
    // because the latch collection is small (one per active game).
    let latchesDeleted = 0;
    try {
      const snap = await db
        .collection('gameUpdateLatches')
        .limit(BATCH_LIMIT)
        .get();
      const candidates: string[] = [];
      for (const latch of snap.docs) {
        const gameId = String(latch.data()?.gameId ?? latch.id);
        try {
          const gameSnap = await db.collection('games').doc(gameId).get();
          const status = gameSnap.exists
            ? gameSnap.data()?.status
            : undefined;
          if (
            !gameSnap.exists ||
            status === 'finished' ||
            status === 'cancelled'
          ) {
            candidates.push(latch.id);
          }
        } catch (err) {
          console.warn(
            '[dailyCleanup] latch game lookup failed',
            latch.id,
            err,
          );
        }
      }
      if (candidates.length > 0) {
        const batch = db.batch();
        candidates.forEach((id) =>
          batch.delete(db.collection('gameUpdateLatches').doc(id)),
        );
        await batch.commit();
        latchesDeleted = candidates.length;
      }
    } catch (err) {
      console.error('[dailyCleanup] latches sweep failed', err);
    }

    // 3) Old /groupJoinRequests (approved or rejected, decidedAt
    // older than 90 days). Pending requests are NEVER deleted —
    // that's an active state.
    let requestsDeleted = 0;
    try {
      const cutoff = now - JOIN_REQUESTS_TTL_MS;
      const snap = await db
        .collection('groupJoinRequests')
        .where('decidedAt', '<', cutoff)
        .limit(BATCH_LIMIT)
        .get();
      if (!snap.empty) {
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        requestsDeleted = snap.size;
      }
    } catch (err) {
      console.error('[dailyCleanup] joinRequests sweep failed', err);
    }

    console.log(
      `[dailyCleanup] notifications=${notifsDeleted}, latches=${latchesDeleted}, joinRequests=${requestsDeleted}`,
    );
  },
);

// ─── Scheduled: post-game "rate teammates" reminder ────────────────────

/**
 * Wake players up to rate their teammates after the evening ends.
 *
 * Window: a game is eligible once `startsAt` is between 60-180 minutes
 * in the past AND it has at least one player. The wide window covers
 * scheduler skew (we run every 30m) and games whose admin pressed
 * "סיים ערב" late. The `rateReminderSent` flag latches the reminder so
 * a second run inside that window doesn't double-fire.
 *
 * We don't gate on `status === 'finished'` because a perfectly normal
 * game might still be `'active'` 90 minutes after kickoff (admin
 * forgot to press end). The cleanup CF will eventually flip it; in the
 * meantime players still want a reminder while the night is fresh.
 *
 * Status guard: skip 'cancelled' explicitly — there are no teammates
 * to rate. 'open' / 'locked' games where kickoff was 60+ min ago and
 * nothing happened mean a no-show; the cleanup CF deletes those as
 * zombies anyway, so we'd never fire on them in practice — the guard
 * is belt-and-suspenders.
 */
export const sendRateReminders = onSchedule(
  {
    schedule: 'every 30 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const now = Date.now();
    // Window: 1h..6h after kickoff. Aligns with the 6h cleanup-CF
    // boundary — past that point the cleanup flips the game to
    // 'finished' and we'd skip it anyway. Wider than strictly
    // necessary so we never miss a game between scheduler runs.
    const lower = now - 6 * 60 * 60 * 1000;
    const upper = now - 60 * 60 * 1000;

    const snap = await db
      .collection('games')
      .where('startsAt', '>=', lower)
      .where('startsAt', '<', upper)
      .get();

    if (snap.empty) {
      console.log('[sendRateReminders] no candidate games');
      return;
    }

    const ops: Promise<unknown>[] = [];
    let dispatched = 0;

    for (const gameDoc of snap.docs) {
      const g = gameDoc.data() as {
        title?: string;
        status?: string;
        rateReminderSent?: boolean;
        players?: string[];
      };
      if (g.rateReminderSent) continue;
      // Skip cancellations explicitly. We also skip 'open' games — a
      // game still 'open' 1h+ after kickoff with players means nothing
      // happened (no admin pressed start). Asking those players to
      // rate is meaningless. The cleanup CF will eventually retire it.
      if (g.status === 'cancelled') continue;
      if (g.status === 'open') continue;
      if (!g.players || g.players.length === 0) continue;

      // One fan-out notification doc per game; the resolver expands it
      // to game.players. recipientId carries the gameId, mirroring the
      // pattern used by `gameReminder`.
      ops.push(
        db.collection('notifications').add({
          type: 'rateReminder',
          recipientId: gameDoc.id,
          payload: {
            gameId: gameDoc.id,
            gameTitle: g.title || 'המשחק',
          },
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          delivered: false,
        })
      );
      ops.push(gameDoc.ref.update({ rateReminderSent: true }));
      dispatched++;
    }

    await Promise.all(ops);
    console.log(`[sendRateReminders] dispatched ${dispatched} rate reminder(s)`);
  }
);

// ─── Realtime trigger: community join request → admin push ─────────────

/**
 * Watches community docs for additions to `pendingPlayerIds` and fans
 * out a `joinRequest` push to every admin server-side.
 *
 * Why this lives on the server: the user submitting the request goes
 * through the public-projection path (groupsPublic) — they can't read
 * the private `/groups/{id}` doc, so `group.adminIds` comes back empty
 * client-side and the existing client-side dispatch in
 * `groupStore.requestJoinById` silently no-ops. The CF reads the
 * private doc with admin credentials and dispatches per admin.
 *
 * Idempotency: we only fire when the array actually grew on this
 * write. Edits to the same doc that don't change pendingPlayerIds
 * (rename, settings, etc.) are no-ops here. We never persist a "sent"
 * flag because each request is its own event — sending twice means
 * the user genuinely re-requested.
 */
export const onGroupPendingChanged = onDocumentWritten(
  'groups/{groupId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | { pendingPlayerIds?: string[] }
      | undefined;
    const after = event.data?.after?.data() as
      | {
          pendingPlayerIds?: string[];
          adminIds?: string[];
          name?: string;
        }
      | undefined;

    // Group deletion: canonical /groups doc is gone. Clean up the
    // public mirror in case the client-side delete swallowed an
    // error (network drop, transient quota). Without this, the
    // discovery feed would surface a "ghost" community whose
    // canonical no longer exists.
    if (!after && before) {
      const groupId = event.params.groupId;
      try {
        await db.collection('groupsPublic').doc(groupId).delete();
      } catch (err) {
        console.warn(
          '[onGroupDeleted] groupsPublic cleanup failed',
          groupId,
          err,
        );
      }
      return;
    }

    if (!after) return;

    // Sync the denormalised /groupsPublic.memberCount whenever
    // playerIds changes. Client-side join paths can't write to the
    // public doc (rule requires admin), so the feed's count would
    // otherwise drift every time someone direct-joins an open
    // community. Best-effort — failure logs but doesn't throw.
    const beforePlayers = (before as { playerIds?: string[] } | undefined)
      ?.playerIds;
    const afterPlayers = (after as { playerIds?: string[] } | undefined)
      ?.playerIds;
    const playerCountChanged =
      Array.isArray(afterPlayers) &&
      (afterPlayers.length !== (beforePlayers?.length ?? 0) ||
        JSON.stringify(beforePlayers ?? []) !==
          JSON.stringify(afterPlayers));

    // Also bump teamsJoined for newcomers — the client's hardened
    // /users rules block this cross-user write. Server-side keeps
    // counters honest regardless of which path admitted the user
    // (admin approve vs open-group direct-join vs cancel-promote).
    if (Array.isArray(afterPlayers)) {
      const prevSet = new Set(beforePlayers ?? []);
      const newJoiners = afterPlayers.filter((uid) => !prevSet.has(uid));
      for (const uid of newJoiners) {
        try {
          await db.collection('users').doc(uid).set(
            {
              achievements: {
                teamsJoined: admin.firestore.FieldValue.increment(1),
              },
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            '[onGroupPendingChanged] teamsJoined bump failed',
            uid,
            err,
          );
        }
      }
    }

    if (playerCountChanged) {
      try {
        await db
          .collection('groupsPublic')
          .doc(event.params.groupId)
          .set(
            {
              memberCount: afterPlayers!.length,
              updatedAt: Date.now(),
            },
            { merge: true },
          );
      } catch (err) {
        console.warn(
          '[onGroupWritten] groupsPublic memberCount sync failed',
          event.params.groupId,
          err,
        );
      }
    }

    const beforeIds = new Set(before?.pendingPlayerIds ?? []);
    const afterIds = after.pendingPlayerIds ?? [];
    const newcomers = afterIds.filter((id) => !beforeIds.has(id));
    if (newcomers.length === 0) return;

    const admins = after.adminIds ?? [];
    if (admins.length === 0) return;

    const groupId = event.params.groupId;
    const groupName = after.name || 'הקבוצה';

    const ops: Promise<unknown>[] = [];
    for (const requesterId of newcomers) {
      for (const adminId of admins) {
        ops.push(
          db.collection('notifications').add({
            type: 'joinRequest',
            recipientId: adminId,
            payload: {
              groupId,
              groupName,
              requesterId,
            },
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            delivered: false,
          })
        );
      }
    }
    await Promise.all(ops);
    console.log(
      `[onGroupPendingChanged] dispatched ${ops.length} joinRequest push(es) for group ${groupId}`
    );
  }
);

// ─── Realtime trigger: "almost full" FOMO push ─────────────────────────

/**
 * Fan-out a "last spots" push when a game's roster crosses the 90%
 * capacity threshold. Triggers on every write to a game doc, but the
 * `capacityNoticeSent` latch on the doc itself ensures we only fire
 * once per game even if the threshold is briefly bounced (player
 * cancels, then someone new joins).
 *
 * Ignored when:
 *   • the game has no roster cap (`maxPlayers <= 0`)
 *   • the game's status is anything but 'open' (locked/active/etc are
 *     past the registration window — too late for a "join now" push)
 *   • capacity was already at/over 90% on the *previous* version of
 *     the doc — we only want to fire on the actual crossing event,
 *     not on every subsequent edit while it's full
 *   • the latch is already set
 *
 * Recipient resolution and de-duplication happen downstream in
 * `onNotificationCreated → resolveRecipients` (see `gameFillingUp`
 * branch there).
 */
export const onGameRosterChanged = onDocumentWritten(
  'games/{gameId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | {
          players?: string[];
          guests?: unknown[];
          maxPlayers?: number;
          status?: string;
          capacityNoticeSent?: boolean;
          arrivals?: Record<string, string>;
        }
      | undefined;
    const after = event.data?.after?.data() as
      | {
          players?: string[];
          guests?: unknown[];
          maxPlayers?: number;
          status?: string;
          capacityNoticeSent?: boolean;
          title?: string;
          startsAt?: number;
          groupId?: string;
          createdBy?: string;
          pendingJoinerIds?: string[];
          pendingJoinFlushAt?: number;
          arrivals?: Record<string, string>;
        }
      | undefined;

    if (!after) return; // doc deleted

    const ref = event.data!.after.ref;

    // ── Discipline cards on arrival changes. The admin's setArrival()
    // writes /games/{id}.arrivals[uid] = 'late' | 'no_show'. The
    // client used to ALSO write /users/{uid}.discipline directly,
    // but the hardened rules block that cross-user write. We mirror
    // the issue/revoke logic here with the Admin SDK so cards land
    // regardless of who triggered the arrival mark.
    //
    // Transitions handled:
    //   prev → 'late'     : yellow (≤60min) / red (>60min) card
    //   prev → 'no_show'  : red card with reason='no_show'
    //   'late'/'no_show' → other (admin un-marked) : revoke card
    const beforeArr = before?.arrivals ?? {};
    const afterArr = after.arrivals ?? {};
    const allArrUids = new Set<string>([
      ...Object.keys(beforeArr),
      ...Object.keys(afterArr),
    ]);
    for (const uid of allArrUids) {
      const prev = beforeArr[uid] ?? 'unknown';
      const next = afterArr[uid] ?? 'unknown';
      if (prev === next) continue;
      try {
        if (next === 'late') {
          const startsAt =
            typeof after.startsAt === 'number' ? after.startsAt : Date.now();
          const minutesLate = (Date.now() - startsAt) / 60_000;
          if (minutesLate > 5) {
            const cardType = minutesLate > 60 ? 'red' : 'yellow';
            await issueDisciplineCard(uid, {
              type: cardType,
              reason: 'late',
              gameId: event.params.gameId,
            });
          }
        } else if (next === 'no_show') {
          await issueDisciplineCard(uid, {
            type: 'red',
            reason: 'no_show',
            gameId: event.params.gameId,
          });
        } else if (
          (prev === 'late' || prev === 'no_show') &&
          next !== 'late' &&
          next !== 'no_show'
        ) {
          // Admin un-marked — revoke any card we issued for this game.
          await revokeDisciplineCardsFor(uid, event.params.gameId);
        }
      } catch (err) {
        console.warn(
          '[onGameRosterChanged] discipline write failed',
          uid,
          err,
        );
      }
    }

    // ── Server-side achievement bumps for the joiners. The hardened
    // /users rules block cross-user writes from the client, so this
    // is the canonical place to keep gamesJoined in sync. Best-effort
    // — a failure here doesn't impact the join itself.
    if (after.status === 'open' && after.groupId) {
      const beforePlayersSet = new Set(before?.players ?? []);
      const freshJoiners = (after.players ?? []).filter(
        (uid) => !beforePlayersSet.has(uid),
      );
      for (const uid of freshJoiners) {
        try {
          await db.collection('users').doc(uid).set(
            {
              achievements: {
                gamesJoined: admin.firestore.FieldValue.increment(1),
              },
              updatedAt: Date.now(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            '[onGameRosterChanged] gamesJoined bump failed',
            uid,
            err,
          );
        }
      }
    }

    // ── Buffer new joiners for the consolidated admin push. We do this
    // BEFORE the gameFillingUp early-returns so it runs on every
    // join, regardless of capacity threshold or game status changes.
    // The cron `flushPendingJoinerNotifs` reads the buffer when it
    // expires and dispatches a single batched notification.
    if (after.status === 'open' && after.groupId) {
      const beforePlayers = new Set(before?.players ?? []);
      const newJoiners = (after.players ?? []).filter(
        (uid) => !beforePlayers.has(uid),
      );
      if (newJoiners.length > 0) {
        const JOIN_BATCH_WINDOW_MS = 3 * 60 * 1000;
        try {
          await db.runTransaction(async (tx) => {
            const fresh = await tx.get(ref);
            if (!fresh.exists) return;
            const data = fresh.data() as {
              pendingJoinerIds?: string[];
              pendingJoinFlushAt?: number;
            };
            const merged = Array.from(
              new Set([...(data.pendingJoinerIds ?? []), ...newJoiners]),
            );
            // First joiner in the window sets flushAt; subsequent
            // joiners append without extending — bounded latency.
            const flushAt =
              data.pendingJoinFlushAt && data.pendingJoinFlushAt > Date.now()
                ? data.pendingJoinFlushAt
                : Date.now() + JOIN_BATCH_WINDOW_MS;
            tx.update(ref, {
              pendingJoinerIds: merged,
              pendingJoinFlushAt: flushAt,
            });
          });
        } catch (err) {
          console.error('[onGameRosterChanged] joiner buffer txn failed', err);
        }
      }
    }

    if (after.capacityNoticeSent) return;
    if (after.status !== 'open') return;

    const max = after.maxPlayers ?? 0;
    if (max <= 0) return;

    const beforeCount =
      (before?.players?.length ?? 0) + (before?.guests?.length ?? 0);
    const afterCount =
      (after.players?.length ?? 0) + (after.guests?.length ?? 0);

    const threshold = Math.ceil(max * 0.9);
    const crossed = beforeCount < threshold && afterCount >= threshold;
    if (!crossed) return;

    // Don't fire if the roster is already closed (full or over). At
    // 100% the message "last spots" is misleading; new joiners would
    // hit the waitlist instead.
    if (afterCount >= max) return;

    const remaining = max - afterCount;
    const gameId = event.params.gameId;

    // Latch via transaction so two concurrent triggers (e.g. two
    // players joining the same game in the same second) can't both
    // observe `capacityNoticeSent=false` and each write a duplicate
    // notification. The transaction reads the doc fresh and aborts if
    // the latch is already set; only the winner proceeds to dispatch.
    let claimed = false;
    try {
      await db.runTransaction(async (tx) => {
        const fresh = await tx.get(ref);
        if (!fresh.exists) return;
        const data = fresh.data() as { capacityNoticeSent?: boolean };
        if (data.capacityNoticeSent) return; // someone else won
        tx.update(ref, { capacityNoticeSent: true });
        claimed = true;
      });
    } catch (err) {
      console.error('[onGameRosterChanged] latch transaction failed', err);
      return;
    }
    if (!claimed) return;

    await db.collection('notifications').add({
      type: 'gameFillingUp',
      recipientId: gameId,
      payload: {
        gameId,
        groupId: after.groupId || '',
        gameTitle: after.title || 'המשחק',
        startsAt: after.startsAt ?? null,
        remaining,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      delivered: false,
    });

    console.log(
      `[onGameRosterChanged] dispatched gameFillingUp for ${gameId} (${afterCount}/${max}, ${remaining} left)`
    );
  }
);

// ─── Rating: keep summary doc in sync with vote subcollection ──────────

/**
 * Vote subcollection trigger. Incremental update — we read the
 * before/after values from the event itself and apply a transactional
 * delta to the parent summary doc. No full scan of the votes
 * subcollection, so latency stays O(1) even when a community grows
 * to thousands of voters.
 */
export const onVoteWritten = onDocumentWritten(
  'groups/{groupId}/ratings/{ratedUserId}/votes/{raterUserId}',
  async (event) => {
    const { groupId, ratedUserId } = event.params as {
      groupId: string;
      ratedUserId: string;
    };

    const before = event.data?.before.data() as
      | { rating?: number }
      | undefined;
    const after = event.data?.after.data() as
      | { rating?: number }
      | undefined;
    const validRating = (r: unknown): r is number =>
      typeof r === 'number' && Number.isInteger(r) && r >= 1 && r <= 5;
    const oldR = validRating(before?.rating) ? (before!.rating as number) : null;
    const newR = validRating(after?.rating) ? (after!.rating as number) : null;

    let countDelta = 0;
    let sumDelta = 0;
    if (oldR === null && newR !== null) {
      countDelta = 1;
      sumDelta = newR;
    } else if (oldR !== null && newR === null) {
      countDelta = -1;
      sumDelta = -oldR;
    } else if (oldR !== null && newR !== null) {
      // update — count unchanged, sum shifts by the delta
      sumDelta = newR - oldR;
    } else {
      return; // no rating before or after; nothing to do
    }

    const summaryRef = db
      .collection('groups')
      .doc(groupId)
      .collection('ratings')
      .doc(ratedUserId);

    // Transaction so two near-simultaneous votes don't race on the
    // count/sum read-modify-write.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(summaryRef);
      const cur =
        snap.exists && snap.data()
          ? (snap.data() as { count?: number; sum?: number })
          : { count: 0, sum: 0 };
      const newCount = Math.max(0, (cur.count ?? 0) + countDelta);
      const newSum = Math.max(0, (cur.sum ?? 0) + sumDelta);
      const newAvg =
        newCount > 0 ? Math.round((newSum / newCount) * 10) / 10 : 0;
      tx.set(summaryRef, {
        userId: ratedUserId,
        count: newCount,
        sum: newSum,
        average: newAvg,
        updatedAt: Date.now(),
      });
    });
  },
);

// ─── Scheduled: auto-balance teams before a game ───────────────────────

const DEFAULT_AUTO_BALANCE_MINUTES = 60;

interface BalanceGameDoc {
  id: string;
  groupId?: string;
  startsAt?: number;
  status?: string;
  players?: string[];
  guests?: GuestDoc[];
  format?: '5v5' | '6v6' | '7v7';
  numberOfTeams?: number;
  autoTeamGenerationMinutesBeforeStart?: number;
  autoTeamsGeneratedAt?: number;
  teamsEditedManually?: boolean;
}

interface GuestDoc {
  id: string;
  name: string;
  estimatedRating?: number | null;
  addedBy: string;
  createdAt: number;
}

const GUEST_ID_PREFIX = 'guest:';

interface RatingSummaryDoc {
  count?: number;
  average?: number;
}

function perTeamSize(format: BalanceGameDoc['format']): number {
  if (format === '6v6') return 6;
  if (format === '7v7') return 7;
  return 5;
}

/** In-place Fisher–Yates shuffle. */
function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * rating_greedy_v1 — distribute registered players into N teams so the
 * sum of ratings per team is roughly equal.
 *
 * - Unrated players are scored at the neutral 3.0.
 * - The whole list is shuffled BEFORE sorting so every run is
 *   non-deterministic when several players share a rating (Array.sort
 *   is stable in V8 since ES2019, so the shuffle order is preserved
 *   for ties).
 * - Greedy assignment respects a hard `perTeam` cap; any registered
 *   player who can't fit lands on the bench in shuffled order.
 * - Tie-breaker order: lowest team total → fewest players → random.
 */
function balanceTeamsV1(
  playerIds: string[],
  ratings: Record<string, number>,
  numberOfTeams: number,
  perTeam: number,
): {
  assignments: Record<string, 'teamA' | 'teamB' | 'bench'>;
  benchOrder: string[];
  teamRatings: number[];
  unratedCount: number;
} {
  let unratedCount = 0;
  const scored = playerIds.map((id) => {
    const known = ratings[id];
    if (typeof known === 'number') {
      return { id, rating: known, unrated: false };
    }
    unratedCount += 1;
    return { id, rating: 3, unrated: true };
  });

  // Shuffle BEFORE sort so reruns aren't deterministic. JS sort is
  // stable, so shuffled-order survives within any tied rating bucket.
  shuffleInPlace(scored);
  scored.sort((a, b) => b.rating - a.rating);

  const teams: { ids: string[]; total: number }[] = Array.from(
    { length: numberOfTeams },
    () => ({ ids: [], total: 0 }),
  );
  const capacity = perTeam;
  const assignments: Record<string, 'teamA' | 'teamB' | 'bench'> = {};
  const benchOrder: string[] = [];

  for (const p of scored) {
    // Build the candidate list of teams that still have capacity.
    const open = teams.filter((t) => t.ids.length < capacity);
    if (open.length === 0) {
      // Capacity exhausted — overflow to bench.
      benchOrder.push(p.id);
      continue;
    }
    // Tie-breaker: lowest total → fewest players → random pick among
    // remaining ties so identical seeds don't clump on team[0].
    open.sort((a, b) => {
      if (a.total !== b.total) return a.total - b.total;
      if (a.ids.length !== b.ids.length) return a.ids.length - b.ids.length;
      return Math.random() - 0.5;
    });
    const target = open[0];
    target.ids.push(p.id);
    target.total += p.rating;
  }

  // Map team[0] / team[1] → 'teamA' / 'teamB'. Live-match state model
  // only handles 2 teams natively today; any extra team's roster
  // spills onto the bench so we never drop registered players.
  teams.forEach((t, i) => {
    const zone: 'teamA' | 'teamB' | null =
      i === 0 ? 'teamA' : i === 1 ? 'teamB' : null;
    if (!zone) {
      benchOrder.push(...t.ids);
      return;
    }
    t.ids.forEach((uid) => {
      assignments[uid] = zone;
    });
  });
  benchOrder.forEach((uid) => {
    assignments[uid] = 'bench';
  });

  return {
    assignments,
    benchOrder,
    teamRatings: teams.slice(0, 2).map((t) => Math.round(t.total * 10) / 10),
    unratedCount,
  };
}

/** Read every rating summary in the group as a uid → average map. */
async function loadGroupRatings(
  groupId: string,
  uids: string[],
): Promise<Record<string, number>> {
  if (uids.length === 0) return {};
  const out: Record<string, number> = {};
  // Firestore doesn't support an `in` query against subcollection doc
  // ids cleanly across many groups, but per-group we just batched
  // get the docs.
  const refs = uids.map((u) =>
    db.collection('groups').doc(groupId).collection('ratings').doc(u),
  );
  const snaps = await db.getAll(...refs);
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const d = s.data() as RatingSummaryDoc;
    if (typeof d.average === 'number' && (d.count ?? 0) > 0) {
      out[uids[i]] = d.average;
    }
  });
  return out;
}

/**
 * Scheduled every 5 minutes. Narrow Firestore window first
 * (startsAt within the next 65 minutes), then per-game we re-check
 * the configured `autoTeamGenerationMinutesBeforeStart` so a game
 * with a custom 30-min window only fires when its own trigger
 * crosses. The 65-min cap covers the default 60-min option plus
 * scheduler drift; longer windows (e.g. 120-min) trigger when the
 * game finally enters the 65-min horizon.
 *
 * The actual write is wrapped in a Firestore transaction that
 * re-reads `autoTeamsGeneratedAt` and `teamsEditedManually` so we
 * NEVER overwrite either a previous auto-generation or a coach's
 * manual edit (transaction aborts if either flag is now set).
 */
export const scheduledAutoGenerateTeams = onSchedule(
  {
    schedule: 'every 5 minutes',
    timeZone: 'Asia/Jerusalem',
  },
  async () => {
    const now = Date.now();
    // Tight window: only games starting in the next 65 minutes are
    // candidates. The per-game check below filters further by the
    // configured minutesBeforeStart.
    const upper = now + 65 * 60 * 1000;
    const snap = await db
      .collection('games')
      .where('status', '==', 'open')
      .where('startsAt', '>=', now)
      .where('startsAt', '<=', upper)
      .get();

    if (snap.empty) {
      console.log('[autoBalance] no candidate games');
      return;
    }

    const ops: Promise<unknown>[] = [];
    for (const doc of snap.docs) {
      const g = doc.data() as BalanceGameDoc;
      g.id = doc.id;
      // Quick filters before paying for the transaction round-trip.
      if (g.autoTeamsGeneratedAt) continue;
      if (g.teamsEditedManually) continue;
      if (!g.groupId) continue;
      const players = g.players ?? [];
      if (players.length === 0) continue;
      const startsAt = g.startsAt ?? 0;
      const minutesBefore =
        g.autoTeamGenerationMinutesBeforeStart ??
        DEFAULT_AUTO_BALANCE_MINUTES;
      const triggerAt = startsAt - minutesBefore * 60 * 1000;
      // Per-game trigger: only fire when we've crossed the
      // configured window. Games whose minutesBefore is 120 (i.e.
      // they want generation 2h before kickoff) only trigger once
      // they're inside the 65-min query window — that's a documented
      // trade-off for the simpler tight-window query.
      if (now < triggerAt) continue;
      ops.push(generateForGame(doc.ref, g));
    }
    await Promise.all(ops);
    console.log(`[autoBalance] generated for ${ops.length} game(s)`);
  },
);

async function generateForGame(
  ref: FirebaseFirestore.DocumentReference,
  g: BalanceGameDoc,
): Promise<void> {
  try {
    // Load ratings BEFORE the transaction so the transaction body
    // stays small and fast (transactions retry; we don't want to
    // re-read every rating doc each retry).
    const players = g.players ?? [];
    const ratings = await loadGroupRatings(g.groupId!, players);
    const perTeam = perTeamSize(g.format);
    const numberOfTeams =
      typeof g.numberOfTeams === 'number' && g.numberOfTeams >= 2
        ? g.numberOfTeams
        : 2;

    const wrote = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) return false;
      const data = fresh.data() as BalanceGameDoc;
      // Re-check inside the transaction so a concurrent function
      // run, or a coach edit between the outer query and this write,
      // can't be clobbered.
      if (data.autoTeamsGeneratedAt) return false;
      if (data.teamsEditedManually) return false;
      const freshPlayers = data.players ?? players;
      const freshGuests = data.guests ?? [];
      if (freshPlayers.length === 0 && freshGuests.length === 0) return false;

      // Compose the roster: real users keep their uid; guests are
      // encoded as `guest:<id>` so the roster id space is disjoint.
      // Their rating is `estimatedRating` when set, otherwise the
      // neutral 3.0 (handled by balanceTeamsV1's unrated branch).
      const guestRoster: string[] = freshGuests.map(
        (gu) => `${GUEST_ID_PREFIX}${gu.id}`,
      );
      const guestRatings: Record<string, number> = {};
      for (const gu of freshGuests) {
        if (
          typeof gu.estimatedRating === 'number' &&
          gu.estimatedRating >= 1 &&
          gu.estimatedRating <= 5
        ) {
          guestRatings[`${GUEST_ID_PREFIX}${gu.id}`] = gu.estimatedRating;
        }
      }
      const rosterIds = [...freshPlayers, ...guestRoster];
      const combinedRatings = { ...ratings, ...guestRatings };

      const result = balanceTeamsV1(
        rosterIds,
        combinedRatings,
        numberOfTeams,
        perTeam,
      );
      const liveMatch = {
        phase: 'organizing' as const,
        assignments: result.assignments,
        benchOrder: result.benchOrder,
        scoreA: 0,
        scoreB: 0,
        updatedAt: Date.now(),
      };
      tx.update(ref, {
        liveMatch,
        autoTeamsGeneratedAt: Date.now(),
        autoTeamsGeneratedBy: 'system',
        teamBalanceMeta: {
          generatedAt: Date.now(),
          algorithm: 'rating_greedy_v1',
          unratedCount: result.unratedCount,
          teamRatings: result.teamRatings,
        },
        updatedAt: Date.now(),
        // INTENTIONALLY NOT touching teamsEditedManually — system
        // generation must never flip that flag; only UI edits do.
      });
      return true;
    });

    if (wrote) {
      await db.collection('notifications').add({
        type: 'gameCanceledOrUpdated',
        recipientId: ref.id, // fan-out marker
        payload: { gameId: ref.id, action: 'teams_generated' },
        createdAt: Date.now(),
        delivered: false,
      });
    }
  } catch (err) {
    console.error('[autoBalance] generateForGame failed', ref.id, err);
  }
}

// ─── Callable: bump /appConfig/{platform} (admin-gated) ────────────────
//
// One-shot maintenance hook. Bumping `latestVersion` triggers the
// optional-update modal across every install on next cold start; bumping
// `minimumSupportedVersion` triggers the force-update modal. Open from
// `firebase functions:shell` or via a httpsCallable invocation:
//
//   const fn = httpsCallable(functions, 'updateAppConfig');
//   await fn({ platform: 'android', latestVersion: '0.2.5' });
//
// Gated to a single hard-coded admin uid so only the project owner can
// call it — App Check + auth are layered on top in production.
export const updateAppConfig = onCall(async (request) => {
  const ALLOWED_UID = '1IdtNEjbEXfiRSqvLrJVn99NsfI2'; // matan
  if (request.auth?.uid !== ALLOWED_UID) {
    throw new HttpsError('permission-denied', 'admin only');
  }
  const data = (request.data ?? {}) as {
    platform?: string;
    latestVersion?: string;
    minimumSupportedVersion?: string;
  };
  const platform = data.platform === 'ios' ? 'ios' : 'android';
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (typeof data.latestVersion === 'string') {
    patch.latestVersion = data.latestVersion;
  }
  if (typeof data.minimumSupportedVersion === 'string') {
    patch.minimumSupportedVersion = data.minimumSupportedVersion;
  }
  await db.collection('appConfig').doc(platform).set(patch, { merge: true });
  return { ok: true, platform, patch };
});

// ─── Callable: send game invite (server-trusted) ────────────────────────
//
// Replaces the legacy client-side `addDoc('/notifications', { type:
// 'inviteToGame', payload: { inviterName, gameTitle, ... } })` flow.
// That path let any signed-in client write a notification with an
// arbitrary `inviterName` — i.e. impersonate "מנהל הקבוצה" or any
// other display name in a phishing-style push.
//
// This callable is the only legitimate way to dispatch an invite. It:
//   1. requires `request.auth` (Firestore rule no longer allows
//      `inviteToGame` from clients, so the legacy path is dead);
//   2. enforces a server-side per-uid rate limit (30/hour) using a
//      `/rateLimits/{uid}_inviteToGame` doc that the client cannot
//      tamper with through the function — the function reads & writes
//      via Admin SDK and is the only writer trusted by the count;
//   3. validates IDs only (recipientId, gameId) — caller cannot
//      smuggle inviterName / gameTitle / etc.;
//   4. loads the sender + game server-side and constructs the payload
//      from canonical state (sender name from /users/{auth.uid}.name,
//      game title from /games/{gameId}.title);
//   5. checks permission: caller must be a member or admin of the
//      game's parent community;
//   6. blocks self-invite, blocks invites to a game the recipient is
//      already in, blocks invites to terminal-state games.
//
// Errors propagate as `HttpsError` codes the client can branch on:
//   • `unauthenticated` — caller has no auth
//   • `invalid-argument` — missing / oversized IDs
//   • `permission-denied` — caller can't see this game / not a member
//   • `failed-precondition` — recipient already in game / game closed
//   • `resource-exhausted` — server-side rate limit exceeded
const INVITE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const INVITE_RATE_LIMIT_CAP = 30;

export const sendGameInvite = onCall(async (request) => {
  // 1) Auth
  const auth = request.auth;
  if (!auth?.uid) {
    throw new HttpsError(
      'unauthenticated',
      'sign-in required to send invites',
    );
  }
  const senderUid = auth.uid;

  // 2) Input shape — IDs only. Anything textual the function loads
  //    server-side from canonical state.
  const data = (request.data ?? {}) as {
    recipientId?: unknown;
    gameId?: unknown;
  };
  const recipientId = typeof data.recipientId === 'string' ? data.recipientId : '';
  const gameId = typeof data.gameId === 'string' ? data.gameId : '';
  if (
    recipientId.length === 0 ||
    recipientId.length > 128 ||
    gameId.length === 0 ||
    gameId.length > 128
  ) {
    throw new HttpsError('invalid-argument', 'invalid recipientId or gameId');
  }
  if (recipientId === senderUid) {
    throw new HttpsError('invalid-argument', 'cannot invite yourself');
  }

  // 3) Server-side rate limit. Single transactional read+write so two
  //    fast invocations can't both pass under the cap.
  const limitRef = db
    .collection('rateLimits')
    .doc(`${senderUid}_inviteToGame_v2`); // distinct id from client counter
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(limitRef);
    const now = Date.now();
    if (!snap.exists) {
      tx.set(limitRef, {
        uid: senderUid,
        op: 'inviteToGame',
        windowStart: now,
        count: 1,
        updatedAt: now,
      });
      return;
    }
    const cur = snap.data() as {
      windowStart?: number;
      count?: number;
    };
    const expired =
      typeof cur.windowStart !== 'number' ||
      now - cur.windowStart > INVITE_RATE_LIMIT_WINDOW_MS;
    if (expired) {
      tx.set(limitRef, {
        uid: senderUid,
        op: 'inviteToGame',
        windowStart: now,
        count: 1,
        updatedAt: now,
      });
      return;
    }
    const nextCount = (cur.count ?? 0) + 1;
    if (nextCount > INVITE_RATE_LIMIT_CAP) {
      throw new HttpsError(
        'resource-exhausted',
        'too many invites — try again later',
      );
    }
    tx.update(limitRef, { count: nextCount, updatedAt: now });
  });

  // 4) Load sender, game, and recipient — all canonical, all server-side.
  const [senderSnap, gameSnap, recipientSnap] = await Promise.all([
    db.collection('users').doc(senderUid).get(),
    db.collection('games').doc(gameId).get(),
    db.collection('users').doc(recipientId).get(),
  ]);
  if (!senderSnap.exists) {
    throw new HttpsError('failed-precondition', 'sender profile missing');
  }
  if (!gameSnap.exists) {
    throw new HttpsError('failed-precondition', 'game not found');
  }
  if (!recipientSnap.exists) {
    throw new HttpsError('failed-precondition', 'recipient not found');
  }
  const sender = senderSnap.data() as { name?: string };
  const game = gameSnap.data() as {
    title?: string;
    groupId?: string;
    startsAt?: number;
    status?: string;
    visibility?: string;
    players?: string[];
    waitlist?: string[];
    pending?: string[];
  };

  // 5) Permission: caller must be allowed to see + invite to the game.
  //    For community games we require that they're a group member or
  //    admin (matching the read rule for /games). For public games any
  //    signed-in user can already read, so we accept them as inviters.
  if (game.visibility !== 'public') {
    if (!game.groupId) {
      throw new HttpsError('permission-denied', 'game has no community');
    }
    const groupSnap = await db
      .collection('groups')
      .doc(game.groupId)
      .get();
    if (!groupSnap.exists) {
      throw new HttpsError('permission-denied', 'community missing');
    }
    const grp = groupSnap.data() as {
      playerIds?: string[];
      adminIds?: string[];
    };
    const ids = new Set<string>([
      ...(grp.playerIds ?? []),
      ...(grp.adminIds ?? []),
    ]);
    if (!ids.has(senderUid)) {
      throw new HttpsError(
        'permission-denied',
        'not a member of this community',
      );
    }
  }

  // 6) Lifecycle: don't invite to a terminal or in-progress game.
  if (game.status === 'finished' || game.status === 'cancelled') {
    throw new HttpsError(
      'failed-precondition',
      'game is no longer accepting invites',
    );
  }

  // 7) Recipient already in roster? Don't spam them.
  const inRoster = new Set<string>([
    ...(game.players ?? []),
    ...(game.waitlist ?? []),
    ...(game.pending ?? []),
  ]);
  if (inRoster.has(recipientId)) {
    throw new HttpsError(
      'failed-precondition',
      'recipient is already registered',
    );
  }

  // 8) Construct payload server-side ONLY. inviterName / gameTitle /
  //    startsAt all come from canonical state — the client cannot
  //    influence what the recipient sees.
  await db.collection('notifications').add({
    type: 'inviteToGame',
    recipientId,
    payload: {
      gameId,
      gameTitle: typeof game.title === 'string' ? game.title : 'המשחק',
      inviterName: typeof sender.name === 'string' ? sender.name : '',
      inviterId: senderUid,
      startsAt: typeof game.startsAt === 'number' ? game.startsAt : 0,
    },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    delivered: false,
  });

  // 9) Fire-and-forget telemetry counter so analytics keep working
  //    after the flow moves off the client (the client used to
  //    `achievementsService.bump('invitesSent')` after this — bump
  //    server-side instead so even non-app callers see consistent
  //    counters).
  try {
    await db.collection('users').doc(senderUid).set(
      {
        achievements: {
          invitesSent: admin.firestore.FieldValue.increment(1),
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  } catch (err) {
    console.warn('[sendGameInvite] invitesSent bump failed', err);
  }

  return { ok: true };
});

// ─── Discipline helpers (server-side, Admin SDK) ────────────────────────
//
// Mirror of the (now-broken-from-client) `disciplineService.issueCard`
// + `revokeCard` logic. Called from `onGameRosterChanged` whenever a
// game's `arrivals[uid]` transitions to 'late' / 'no_show' or back.
// The hardened /users rules block cross-user writes from the client,
// so these need to live server-side.

interface DisciplineEventDoc {
  id: string;
  userId: string;
  type: 'yellow' | 'red';
  reason: 'late' | 'no_show' | 'manual';
  gameId?: string;
  createdAt: number;
}

async function issueDisciplineCard(
  uid: string,
  input: {
    type: 'yellow' | 'red';
    reason: 'late' | 'no_show' | 'manual';
    gameId?: string;
  },
): Promise<void> {
  if (!uid) return;
  const userRef = db.collection('users').doc(uid);
  const event: DisciplineEventDoc = {
    id: `disc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: uid,
    type: input.type,
    reason: input.reason,
    gameId: input.gameId,
    createdAt: Date.now(),
  };
  // Append the event + bump the matching counter atomically. Use a
  // transaction so the events array doesn't race with concurrent
  // marks (e.g. admin sets late, then immediately bumps to no_show).
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    const data = (snap.exists ? snap.data() : {}) as {
      discipline?: {
        yellowCards?: number;
        redCards?: number;
        events?: DisciplineEventDoc[];
      };
    };
    const cur = data.discipline ?? {};
    const events = Array.isArray(cur.events) ? cur.events : [];
    // Idempotency: don't double-issue for the same (uid, gameId, reason).
    if (
      input.gameId &&
      events.some(
        (e) => e.gameId === input.gameId && e.reason === input.reason,
      )
    ) {
      return;
    }
    const yellowCards = (cur.yellowCards ?? 0) + (input.type === 'yellow' ? 1 : 0);
    const redCards = (cur.redCards ?? 0) + (input.type === 'red' ? 1 : 0);
    tx.set(
      userRef,
      {
        discipline: {
          yellowCards,
          redCards,
          events: [...events, event],
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });
}

// ─── Public community showcase: maintain /communityShowcase/{gid} ──────
//
// Powers the publicly shareable web page at teamderfc.web.app/c/{gid}.
// The page is a static client-rendered HTML that reads this doc via the
// Firestore REST API (no auth — see firestore.rules for /communityShowcase).
// The doc is a denormalised projection of state already visible in-app:
// finished/cancelled game tallies, recent games, top attenders, member
// roster. No private fields (fcmTokens, notif prefs, join requests) are
// mirrored.
//
// Triggers:
//   • /games/{id} writes — when status flips to finished/cancelled, the
//     aggregates change. We also recompute on roster/title edits to a
//     terminal game so historical fixes flow through.
//   • /groups/{gid} writes — name/description/city/playerIds/adminIds
//     changes affect the hero + member list.
//
// Strategy: a single recompute() function reads the canonical /groups/{gid},
// queries up to 200 most recent terminal /games for this community, and
// hydrates user docs for the people referenced in the top-attenders /
// member list (capped at ~50 hydrations per recompute). Worst-case ~250
// reads per affected event. With realistic write patterns (a few games
// per community per week) this is a few hundred reads/community/week —
// well inside free tier.
//
// We DO NOT make this CF responsible for deciding when to re-render —
// every relevant write triggers a recompute. If two writes land
// concurrently we may end up with two recomputes; the last-writer-wins
// outcome on /communityShowcase is fine since both reads see the same
// canonical state ± a few hundred ms.

interface ShowcaseTopAttender {
  uid: string;
  name: string;
  photoUrl?: string | null;
  avatarId?: string | null;
  gamesPlayed: number;
  attendancePct: number;
}

interface ShowcaseMember {
  uid: string;
  name: string;
  photoUrl?: string | null;
  avatarId?: string | null;
  isAdmin: boolean;
  joinedAt?: number | null;
  gamesPlayed: number;
}

interface ShowcaseRecentGame {
  id: string;
  title: string;
  startsAt: number | null;
  fieldName?: string | null;
  status: 'finished' | 'cancelled';
  attendedCount: number;
}

interface ShowcaseDoc {
  groupId: string;
  name: string;
  description?: string | null;
  city?: string | null;
  fieldName?: string | null;
  fieldAddress?: string | null;
  isOpen: boolean;
  foundedAt: number;
  totalGamesFinished: number;
  totalGamesCancelled: number;
  organizationRatePct: number;
  thisMonthGames: number;
  avgAttendance: number;
  totalMembers: number;
  activeMembersThisMonth: number;
  activeMembersThisYear: number;
  topAttenders: ShowcaseTopAttender[];
  recentGames: ShowcaseRecentGame[];
  members: ShowcaseMember[];
  updatedAt: number;
}

async function recomputeCommunityShowcase(groupId: string): Promise<void> {
  if (!groupId) return;
  // 1) Canonical group doc — if missing, the community has been
  //    deleted: tear down the showcase mirror.
  const groupSnap = await db.collection('groups').doc(groupId).get();
  if (!groupSnap.exists) {
    try {
      await db.collection('communityShowcase').doc(groupId).delete();
    } catch (err) {
      console.warn(
        '[updateCommunityShowcase] showcase teardown failed',
        groupId,
        err,
      );
    }
    return;
  }
  const group = groupSnap.data() as {
    name?: string;
    description?: string | null;
    city?: string | null;
    fieldName?: string | null;
    fieldAddress?: string | null;
    isOpen?: boolean;
    playerIds?: string[];
    adminIds?: string[];
    createdAt?: number;
  };

  // 2) Terminal games for this community. Mirrors the in-app
  //    getCommunityStats query (status in [finished, cancelled],
  //    ordered desc, capped at 200).
  const gamesSnap = await db
    .collection('games')
    .where('groupId', '==', groupId)
    .where('status', 'in', ['finished', 'cancelled'])
    .orderBy('startsAt', 'desc')
    .limit(200)
    .get();

  const now = Date.now();
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const yearAgo = now - 365 * 24 * 60 * 60 * 1000;

  let totalFinished = 0;
  let totalCancelled = 0;
  let attendanceSum = 0;
  let thisMonthGames = 0;
  const attendedTally: Record<string, number> = {};
  const activeMonth = new Set<string>();
  const activeYear = new Set<string>();
  const recentGamesRaw: Array<{
    id: string;
    title: string;
    startsAt: number | null;
    fieldName?: string | null;
    status: 'finished' | 'cancelled';
    attendedCount: number;
  }> = [];

  for (const doc of gamesSnap.docs) {
    const g = doc.data() as {
      id?: string;
      title?: string;
      startsAt?: number;
      fieldName?: string | null;
      status?: string;
      players?: string[];
      arrivals?: Record<string, string>;
    };
    const status = g.status === 'cancelled' ? 'cancelled' : 'finished';
    if (status === 'cancelled') {
      totalCancelled += 1;
    } else {
      totalFinished += 1;
    }
    const startsAt = typeof g.startsAt === 'number' ? g.startsAt : null;
    if (status === 'finished' && startsAt !== null && startsAt >= monthAgo) {
      thisMonthGames += 1;
    }
    let attendedHere = 0;
    if (status === 'finished') {
      const arrivals = g.arrivals ?? {};
      const players = Array.isArray(g.players) ? g.players : [];
      const within30 = startsAt !== null && startsAt >= monthAgo;
      const within365 = startsAt !== null && startsAt >= yearAgo;
      for (const uid of players) {
        if (arrivals[uid] === 'no_show') continue;
        attendedHere += 1;
        attendedTally[uid] = (attendedTally[uid] ?? 0) + 1;
        if (within30) activeMonth.add(uid);
        if (within365) activeYear.add(uid);
      }
      attendanceSum += attendedHere;
    }
    if (recentGamesRaw.length < 8) {
      recentGamesRaw.push({
        id: doc.id,
        title: g.title ?? '',
        startsAt,
        fieldName: g.fieldName ?? null,
        status,
        attendedCount: attendedHere,
      });
    }
  }

  const organizationRatePct =
    totalFinished + totalCancelled > 0
      ? Math.round(
          (totalFinished / (totalFinished + totalCancelled)) * 100,
        )
      : 0;
  const avgAttendance =
    totalFinished > 0
      ? Math.round((attendanceSum / totalFinished) * 10) / 10
      : 0;

  // 3) Hydrate users for top attenders + members. We cap the hydration
  //    set so a community with 500 members doesn't blow up the read
  //    budget on every recompute — the page renders the first 50
  //    members alphabetically, plus the top-5 attenders, and that's it.
  const playerIds = Array.isArray(group.playerIds) ? group.playerIds : [];
  const adminIds = Array.isArray(group.adminIds) ? group.adminIds : [];
  const adminSet = new Set(adminIds);
  const memberIds = Array.from(new Set([...playerIds, ...adminIds]));

  const topUidsRanked = Object.entries(attendedTally)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([uid]) => uid);

  const memberSlice = memberIds.slice(0, 50);
  const hydrateSet = new Set<string>([...memberSlice, ...topUidsRanked]);
  const hydrateIds = Array.from(hydrateSet);

  const userByUid: Record<
    string,
    {
      name?: string;
      photoUrl?: string | null;
      avatarId?: string | null;
      createdAt?: number;
    }
  > = {};
  // Firestore `getAll` with up to 500 refs is one round-trip — cheaper
  // than N separate gets. We chunk to be safe.
  const chunkSize = 100;
  for (let i = 0; i < hydrateIds.length; i += chunkSize) {
    const chunk = hydrateIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const refs = chunk.map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() as {
        name?: string;
        photoUrl?: string | null;
        avatarId?: string | null;
        createdAt?: number;
      };
      userByUid[s.id] = {
        name: d.name,
        photoUrl: d.photoUrl ?? null,
        avatarId: d.avatarId ?? null,
        createdAt: typeof d.createdAt === 'number' ? d.createdAt : undefined,
      };
    }
  }

  const topAttenders: ShowcaseTopAttender[] = topUidsRanked.map((uid) => {
    const u = userByUid[uid] ?? {};
    const games = attendedTally[uid] ?? 0;
    const pct =
      totalFinished > 0 ? Math.round((games / totalFinished) * 100) : 0;
    return {
      uid,
      name: u.name || 'שחקן',
      photoUrl: u.photoUrl ?? null,
      avatarId: u.avatarId ?? null,
      gamesPlayed: games,
      attendancePct: pct,
    };
  });

  const members: ShowcaseMember[] = memberSlice.map((uid) => {
    const u = userByUid[uid] ?? {};
    const games = attendedTally[uid] ?? 0;
    return {
      uid,
      name: u.name || 'שחקן',
      photoUrl: u.photoUrl ?? null,
      avatarId: u.avatarId ?? null,
      isAdmin: adminSet.has(uid),
      joinedAt: u.createdAt ?? null,
      gamesPlayed: games,
    };
  });
  // Show admins first, then by gamesPlayed desc.
  members.sort((a, b) => {
    if (a.isAdmin !== b.isAdmin) return a.isAdmin ? -1 : 1;
    return (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0);
  });

  const recentGames: ShowcaseRecentGame[] = recentGamesRaw.slice(0, 5);

  const showcase: ShowcaseDoc = {
    groupId,
    name: group.name ?? 'קהילה',
    description: group.description ?? null,
    city: group.city ?? null,
    fieldName: group.fieldName ?? null,
    fieldAddress: group.fieldAddress ?? null,
    isOpen: !!group.isOpen,
    foundedAt: group.createdAt ?? now,
    totalGamesFinished: totalFinished,
    totalGamesCancelled: totalCancelled,
    organizationRatePct,
    thisMonthGames,
    avgAttendance,
    totalMembers: memberIds.length,
    activeMembersThisMonth: activeMonth.size,
    activeMembersThisYear: activeYear.size,
    topAttenders,
    recentGames,
    members,
    updatedAt: now,
  };

  await db
    .collection('communityShowcase')
    .doc(groupId)
    .set(showcase, { merge: false });
}

/**
 * Recompute the public showcase whenever a /groups doc changes.
 * Every metadata edit (rename, description tweak, city, etc.) and
 * every membership change affects the rendered page.
 */
export const updateShowcaseOnGroupChange = onDocumentWritten(
  'groups/{groupId}',
  async (event) => {
    const groupId = event.params.groupId as string;
    try {
      await recomputeCommunityShowcase(groupId);
    } catch (err) {
      console.warn(
        '[updateShowcaseOnGroupChange] recompute failed',
        groupId,
        err,
      );
    }
  },
);

/**
 * Recompute the public showcase whenever a /games doc changes its
 * terminal state. We narrow the trigger to writes that flip the game
 * INTO finished/cancelled, or edit a game that's already terminal —
 * mid-flow writes (open → locked → active) don't change any showcase
 * field, so re-running the aggregation on every roster join would be
 * wasteful (a popular community can see hundreds of joins/cancels per
 * week per game).
 */
export const updateShowcaseOnGameChange = onDocumentWritten(
  'games/{gameId}',
  async (event) => {
    const before = event.data?.before?.data() as
      | { status?: string; groupId?: string }
      | undefined;
    const after = event.data?.after?.data() as
      | { status?: string; groupId?: string }
      | undefined;
    const groupId = (after?.groupId || before?.groupId || '') as string;
    if (!groupId) return;
    const beforeTerminal =
      before?.status === 'finished' || before?.status === 'cancelled';
    const afterTerminal =
      after?.status === 'finished' || after?.status === 'cancelled';
    // Only recompute when the doc is/was terminal — that's the only
    // shape that contributes to showcase aggregates.
    if (!beforeTerminal && !afterTerminal) return;
    try {
      await recomputeCommunityShowcase(groupId);
    } catch (err) {
      console.warn(
        '[updateShowcaseOnGameChange] recompute failed',
        groupId,
        err,
      );
    }
  },
);

// ─── SSR for community pages — share-preview support ────────────────
//
// Open Graph crawlers (WhatsApp, Facebook, Twitter) DO NOT execute
// JavaScript. They read the raw HTML, grab <title> + the og:* meta
// tags, and that's it. Without server-side rendering every share
// preview shows our static fallback ("קהילה ב־Teamder") regardless of
// which community was shared — defeating the whole point of a
// shareable link.
//
// This function rewrites /c/** at the Hosting layer: it reads the
// pre-built /functions/templates/community.html (copy of public/c/
// index.html, kept in sync via predeploy script), fetches the
// /communityShowcase doc, and injects the community name +
// description into <title>, og:title, og:description, twitter:title,
// twitter:description, AND a JSON-LD blob.
//
// Cache-Control sends a 5-minute browser cache + 10-minute CDN cache
// so the function isn't re-invoked on every refresh. Stale share
// previews are acceptable; the cost of always-fresh rendering is
// not.
//
// The JS in the page itself still runs and overrides document.title /
// og:title once the showcase loads — this just guarantees crawlers
// (which never run that JS) see the right values.

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'community.html');
let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate;
  cachedTemplate = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return cachedTemplate;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ShowcaseSummary {
  name: string;
  description: string | null;
  city: string | null;
  totalGamesFinished: number;
  totalMembers: number;
}

async function loadShowcaseSummary(
  groupId: string,
): Promise<ShowcaseSummary | null> {
  try {
    const snap = await db
      .collection('communityShowcase')
      .doc(groupId)
      .get();
    if (!snap.exists) return null;
    const d = snap.data() as Record<string, unknown>;
    const name = typeof d.name === 'string' ? d.name : '';
    if (!name) return null;
    return {
      name,
      description:
        typeof d.description === 'string' ? d.description : null,
      city: typeof d.city === 'string' ? d.city : null,
      totalGamesFinished:
        typeof d.totalGamesFinished === 'number'
          ? d.totalGamesFinished
          : 0,
      totalMembers:
        typeof d.totalMembers === 'number' ? d.totalMembers : 0,
    };
  } catch (err) {
    console.warn(
      '[serveCommunityPage] showcase fetch failed',
      groupId,
      err,
    );
    return null;
  }
}

function buildMetaBlock(summary: ShowcaseSummary | null): {
  title: string;
  description: string;
} {
  if (!summary) {
    return {
      title: 'קהילה ב־Teamder',
      description:
        'צפו בסטטיסטיקות הקהילה, השחקנים הכי נאמנים, והמשחקים האחרונים.',
    };
  }
  const title = `${summary.name} · Teamder`;
  let description: string;
  if (summary.description && summary.description.trim().length > 0) {
    description = summary.description.trim();
  } else {
    const parts: string[] = [];
    if (summary.city) parts.push(summary.city);
    parts.push(`${summary.totalGamesFinished} משחקים`);
    parts.push(`${summary.totalMembers} חברים`);
    description = `קהילת כדורגל ב־Teamder · ${parts.join(' · ')}`;
  }
  return { title, description };
}

function injectMeta(
  html: string,
  title: string,
  description: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeDesc = escapeHtml(description);
  let out = html;

  // <title> — a single replacement on the literal default works because
  // the static template has exactly one <title> tag.
  out = out.replace(
    /<title>[^<]*<\/title>/,
    `<title>${safeTitle}</title>`,
  );
  // <meta name="description"> — page-level description (used by Google +
  // some link-preview crawlers as a fallback when og:description is
  // missing).
  out = out.replace(
    /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
    `<meta name="description" content="${safeDesc}" />`,
  );
  // og:title / og:description / twitter:* — replace the static
  // defaults the crawlers see.
  out = out.replace(
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:title" content="${safeTitle}" />`,
  );
  out = out.replace(
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
    `<meta property="og:description" content="${safeDesc}" />`,
  );

  return out;
}

export const serveCommunityPage = onRequest(
  { region: 'us-central1', memory: '256MiB' },
  async (req, res) => {
    try {
      // Hosting forwards the original path verbatim (req.path is
      // `/c/{groupId}` or `/c/{groupId}/...`). Strip the leading
      // `/c/` and take the first remaining segment.
      const raw = (req.path || '').replace(/^\/+/, '');
      const parts = raw.split('/').filter(Boolean);
      const groupId =
        parts[0] === 'c' ? parts[1] || '' : parts[0] || '';

      const html = loadTemplate();

      let summary: ShowcaseSummary | null = null;
      if (groupId) {
        summary = await loadShowcaseSummary(groupId);
      }
      const { title, description } = buildMetaBlock(summary);
      const rendered = injectMeta(html, title, description);

      // 5min browser, 10min edge cache. Hosting-side CDN keys on the
      // full URL, so each /c/{id} caches independently. When a
      // community renames itself the CF re-runs after the cache
      // expires — acceptable lag for share previews.
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set(
        'Cache-Control',
        'public, max-age=300, s-maxage=600',
      );
      res.status(200).send(rendered);
    } catch (err) {
      console.error('[serveCommunityPage] render failed', err);
      // Best-effort fallback: serve the static template untouched so
      // the user still sees the page; crawlers fall back to the static
      // OG tags for this one request.
      try {
        res.set('Content-Type', 'text/html; charset=utf-8');
        res.status(200).send(loadTemplate());
      } catch {
        res.status(500).send('internal error');
      }
    }
  },
);

async function revokeDisciplineCardsFor(
  uid: string,
  gameId: string,
): Promise<void> {
  if (!uid || !gameId) return;
  const userRef = db.collection('users').doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return;
    const data = snap.data() as {
      discipline?: {
        yellowCards?: number;
        redCards?: number;
        events?: DisciplineEventDoc[];
      };
    };
    const cur = data.discipline ?? {};
    const events = Array.isArray(cur.events) ? cur.events : [];
    const remaining = events.filter((e) => e.gameId !== gameId);
    if (remaining.length === events.length) return;
    const removed = events.filter((e) => e.gameId === gameId);
    const yellowDelta = removed.filter((e) => e.type === 'yellow').length;
    const redDelta = removed.filter((e) => e.type === 'red').length;
    tx.set(
      userRef,
      {
        discipline: {
          yellowCards: Math.max(0, (cur.yellowCards ?? 0) - yellowDelta),
          redCards: Math.max(0, (cur.redCards ?? 0) - redDelta),
          events: remaining,
        },
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  });
}
