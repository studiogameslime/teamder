// Chat fan-out: on every new chat message, increment each recipient's
// per-chat unread counter and send ONE push per chat until they open it.
//
// "One push until opened" rule: we push a recipient only when their
// unread count was ZERO before this message. While count>0 they already
// have an un-opened push for this chat, so we stay quiet — the client
// resets the counter to 0 when the user opens the chat, which re-arms
// the next push.
//
// Shared data contract (defined elsewhere — conform, don't change):
//   • Messages:  /games/{gameId}/messages/{msgId}
//                /groups/{groupId}/messages/{msgId}
//     shape: { text, senderId, senderName, senderAvatarId?,
//              senderPhotoUrl?, createdAt }
//   • chatKey   = `${scope}__${parentId}`  (scope: 'game' | 'community')
//   • Unread:   /users/{uid}/chatUnread/{chatKey}
//               { count, lastMessageAt, lastText, lastSenderName,
//                 scope, parentId, title }
//   • Mute:     /users/{uid}/chatSettings/{chatKey}  { muted }
//   • Tokens:   /users/{uid}/private/push            { fcmTokens: string[] }

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

type ChatScope = 'game' | 'community' | 'dm';

interface ChatMessageData {
  text?: string;
  senderId?: string;
  senderName?: string;
  senderAvatarId?: string;
  senderPhotoUrl?: string;
  createdAt?: number;
}

// Keep the persisted preview + push body bounded.
const MAX_PREVIEW = 120;

function truncate(s: string, max = MAX_PREVIEW): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) : s;
}

function chatKeyFor(scope: ChatScope, parentId: string): string {
  return `${scope}__${parentId}`;
}

// FCM dead-token codes worth pruning (mirrors adminPush.ts + deliverBatch).
// Only codes that mean the token is permanently dead. 'invalid-argument' is
// often a message-level rejection, not a per-token one — pruning on it would
// delete valid tokens on one bad payload.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

/**
 * Read a single user's fcmTokens from /users/{uid}/private/push and send
 * the push via sendEachForMulticast — mirrors adminPush.ts, including
 * dead-token pruning. No tokens → no-op.
 */
async function sendChatPush(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const db = admin.firestore();
  const messaging = admin.messaging();

  const pushRef = db
    .collection('users')
    .doc(uid)
    .collection('private')
    .doc('push');

  let tokens: string[] = [];
  try {
    const snap = await pushRef.get();
    tokens = ((snap.data()?.fcmTokens as string[] | undefined) ?? []).filter(
      (t) => typeof t === 'string' && t.length > 0,
    );
  } catch (err) {
    console.warn('[chatPush] token read failed', { uid }, err);
    return;
  }
  if (tokens.length === 0) return;

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high', notification: { sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
    const dead = tokens.filter((_, i) => {
      const c = res.responses[i]?.error?.code;
      return c !== undefined && DEAD_TOKEN_CODES.has(c);
    });
    if (dead.length) {
      await pushRef
        .update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead),
        })
        .catch(() => undefined);
    }
  } catch (err) {
    console.error('[chatPush] send failed', { uid }, err);
  }
}

/**
 * Process ONE recipient: bump their unread counter, then push iff the
 * counter was zero AND the chat isn't muted. Fully defensive — a throw
 * here is logged and swallowed so one bad recipient never fails the
 * whole fan-out.
 */
async function handleRecipient(
  uid: string,
  scope: ChatScope,
  parentId: string,
  title: string,
  msg: ChatMessageData,
  isBlocked: boolean,
): Promise<void> {
  const db = admin.firestore();
  const chatKey = chatKeyFor(scope, parentId);

  try {
    // (0) Blocked sender? Resolved ONCE per message in handleChatMessage via a
    // single batched getAll (instead of one get per recipient). If this
    // recipient blocked the message's sender, skip them entirely — no push AND
    // no unread bump. (Skipping the unread bump matters: otherwise a blocked
    // message's 0→1 transition would consume the "push only on zero→one"
    // trigger and silence the next real message.)
    if (isBlocked) return;

    const unreadRef = db
      .collection('users')
      .doc(uid)
      .collection('chatUnread')
      .doc(chatKey);

    const senderName = (msg.senderName || '').trim() || 'שחקן';
    const text = msg.text || '';
    const lastMessageAt =
      typeof msg.createdAt === 'number' ? msg.createdAt : Date.now();
    // For DMs we also denormalise the sender's avatar onto the recipient's
    // entry — in a 1-on-1 the sender IS the other participant.
    const senderAvatarId =
      typeof msg.senderAvatarId === 'string' ? msg.senderAvatarId : '';
    const senderPhotoUrl =
      typeof msg.senderPhotoUrl === 'string' ? msg.senderPhotoUrl : '';

    // (a)+(b) atomically: read the prior count AND increment in ONE
    // transaction, so a rapid burst of messages to the same recipient can't
    // each read count==0 before the others' increments land — only the true
    // 0→1 transition returns wasZero=true, so exactly one push fires ("one push
    // until opened"). Without the transaction, parallel onDocumentCreated
    // invocations all saw wasZero and pushed duplicates.
    const wasZero = await db.runTransaction(async (tx) => {
      const existing = await tx.get(unreadRef);
      const data = existing.data() as { count?: number } | undefined;
      const priorZero = !existing.exists || (data?.count ?? 0) === 0;
      tx.set(
        unreadRef,
        {
          count: admin.firestore.FieldValue.increment(1),
          lastMessageAt,
          lastText: truncate(text),
          lastSenderName: senderName,
          scope,
          parentId,
          title,
          ...(scope === 'dm' && senderAvatarId ? { avatarId: senderAvatarId } : {}),
          ...(scope === 'dm' && senderPhotoUrl ? { photoUrl: senderPhotoUrl } : {}),
        },
        { merge: true },
      );
      return priorZero;
    });

    // (c) push only on the zero→one transition. When it wasn't a 0→1
    // transition we will NOT push regardless of mute state, so we skip the
    // chatSettings read entirely. In an active chat most recipients already
    // hold an un-opened message (count>0), so this eliminates the vast majority
    // of per-recipient settings reads. Muted recipients still had their unread
    // count bumped by the transaction above, exactly as before — muting only
    // suppresses the push, never the badge count.
    if (!wasZero) return;

    // (d) muted? Only reached for the rare genuine 0→1 recipient — read their
    // mute setting now (not for everyone) and stay quiet if muted.
    let muted = false;
    try {
      const settings = await db
        .collection('users')
        .doc(uid)
        .collection('chatSettings')
        .doc(chatKey)
        .get();
      muted = settings.data()?.muted === true;
    } catch (err) {
      console.warn('[chatPush] settings read failed', { uid, chatKey }, err);
    }
    if (muted) return;

    // (e) read the FCM token + push ONLY for this genuine recipient.
    const body = truncate(`${senderName}: ${text}`);
    await sendChatPush(uid, title, body, {
      type: 'chatMessage',
      scope,
      parentId,
      chatKey,
    });
  } catch (err) {
    console.error('[chatPush] recipient failed', { uid, chatKey }, err);
  }
}

/**
 * Resolve recipients + chat title from the parent doc, then fan out to
 * every recipient concurrently.
 */
async function handleChatMessage(
  scope: ChatScope,
  parentId: string,
  msg: ChatMessageData,
): Promise<void> {
  if (!parentId) return;
  const db = admin.firestore();
  const senderId = typeof msg.senderId === 'string' ? msg.senderId : '';

  let recipients: string[] = [];
  let title = '';

  try {
    if (scope === 'game') {
      const snap = await db.collection('games').doc(parentId).get();
      if (!snap.exists) return;
      const g = snap.data() as {
        players?: string[];
        createdBy?: string;
        title?: string;
      };
      title = (g.title || '').trim() || 'המשחק';
      const all = [...(g.players || [])];
      if (typeof g.createdBy === 'string' && g.createdBy) all.push(g.createdBy);
      recipients = Array.from(new Set(all));
    } else if (scope === 'dm') {
      // convId = sorted([uid1, uid2]).join('__'); the only recipient is the
      // OTHER participant (the sender is filtered out below). The recipient
      // sees the conversation titled by the sender's name.
      recipients = parentId.split('__');
      title = (typeof msg.senderName === 'string' ? msg.senderName : '').trim();
      // Defense-in-depth for the friends-only gate. Even though the message
      // rule now enforces it, suppress the push if the recipient restricts
      // DMs to friends and the sender isn't one — a message that slipped
      // through (legacy client / rules race) must not still buzz the victim.
      const other = recipients.find(
        (uid) => typeof uid === 'string' && uid && uid !== senderId,
      );
      if (other) {
        try {
          const uSnap = await db.collection('users').doc(other).get();
          const u = uSnap.data() as
            | { dmFriendsOnly?: boolean; friends?: string[] }
            | undefined;
          if (
            u?.dmFriendsOnly === true &&
            !(u.friends || []).includes(senderId)
          ) {
            return; // recipient blocks non-friend DMs
          }
        } catch (err) {
          console.warn('[chatPush] dm friends-only check failed', err);
        }
      }
    } else {
      const snap = await db.collection('groups').doc(parentId).get();
      if (!snap.exists) return;
      const grp = snap.data() as {
        playerIds?: string[];
        adminIds?: string[];
        name?: string;
      };
      title = (grp.name || '').trim() || 'הקהילה';
      recipients = Array.from(
        new Set([...(grp.playerIds || []), ...(grp.adminIds || [])]),
      );
    }
  } catch (err) {
    console.error('[chatPush] parent resolve failed', { scope, parentId }, err);
    return;
  }

  // Exclude the sender — they don't get a push/unread for their own message.
  const targets = recipients.filter(
    (uid) => typeof uid === 'string' && uid && uid !== senderId,
  );
  if (targets.length === 0) return;

  // PREFETCH (once per message, not once per recipient): resolve "did this
  // recipient block the sender?" for ALL targets in a single getAll round-trip
  // instead of a separate get inside every handleRecipient. Same billed reads,
  // but one round-trip and a single place to reason about the block gate.
  const blocked = new Set<string>();
  if (senderId) {
    try {
      const blockedRefs = targets.map((uid) =>
        db.collection('users').doc(uid).collection('blocked').doc(senderId),
      );
      const snaps = await db.getAll(...blockedRefs);
      snaps.forEach((s, i) => {
        if (s.exists) blocked.add(targets[i]);
      });
    } catch (err) {
      console.warn(
        '[chatPush] blocked prefetch failed',
        { scope, parentId },
        err,
      );
    }
  }

  await Promise.all(
    targets.map((uid) =>
      handleRecipient(uid, scope, parentId, title, msg, blocked.has(uid)),
    ),
  );
}

// ─── Triggers ──────────────────────────────────────────────────────────

export const onGameChatMessage = onDocumentCreated(
  'games/{gameId}/messages/{msgId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const gameId = event.params.gameId;
    await handleChatMessage('game', gameId, snap.data() as ChatMessageData);
  },
);

export const onCommunityChatMessage = onDocumentCreated(
  'groups/{groupId}/messages/{msgId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const groupId = event.params.groupId;
    await handleChatMessage(
      'community',
      groupId,
      snap.data() as ChatMessageData,
    );
  },
);

export const onDmChatMessage = onDocumentCreated(
  'dmConversations/{convId}/messages/{msgId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const convId = event.params.convId;
    await handleChatMessage('dm', convId, snap.data() as ChatMessageData);
  },
);
