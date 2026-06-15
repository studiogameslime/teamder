"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.onCommunityChatMessage = exports.onGameChatMessage = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
// Keep the persisted preview + push body bounded.
const MAX_PREVIEW = 120;
function truncate(s, max = MAX_PREVIEW) {
    if (!s)
        return '';
    return s.length > max ? s.slice(0, max) : s;
}
function chatKeyFor(scope, parentId) {
    return `${scope}__${parentId}`;
}
// FCM dead-token codes worth pruning (mirrors adminPush.ts + deliverBatch).
const DEAD_TOKEN_CODES = new Set([
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
]);
/**
 * Read a single user's fcmTokens from /users/{uid}/private/push and send
 * the push via sendEachForMulticast — mirrors adminPush.ts, including
 * dead-token pruning. No tokens → no-op.
 */
async function sendChatPush(uid, title, body, data) {
    const db = admin.firestore();
    const messaging = admin.messaging();
    const pushRef = db
        .collection('users')
        .doc(uid)
        .collection('private')
        .doc('push');
    let tokens = [];
    try {
        const snap = await pushRef.get();
        tokens = (snap.data()?.fcmTokens ?? []).filter((t) => typeof t === 'string' && t.length > 0);
    }
    catch (err) {
        console.warn('[chatPush] token read failed', { uid }, err);
        return;
    }
    if (tokens.length === 0)
        return;
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
    }
    catch (err) {
        console.error('[chatPush] send failed', { uid }, err);
    }
}
/**
 * Process ONE recipient: bump their unread counter, then push iff the
 * counter was zero AND the chat isn't muted. Fully defensive — a throw
 * here is logged and swallowed so one bad recipient never fails the
 * whole fan-out.
 */
async function handleRecipient(uid, scope, parentId, title, msg) {
    const db = admin.firestore();
    const chatKey = chatKeyFor(scope, parentId);
    try {
        // (0) Blocked sender? If this recipient has blocked the message's sender,
        // skip them entirely — no push AND no unread bump. (Skipping the unread
        // bump matters: otherwise a blocked message's 0→1 transition would consume
        // the "push only on zero→one" trigger and silence the next real message.)
        const senderId = typeof msg.senderId === 'string' ? msg.senderId : '';
        if (senderId) {
            const blockedSnap = await db
                .collection('users')
                .doc(uid)
                .collection('blocked')
                .doc(senderId)
                .get();
            if (blockedSnap.exists)
                return;
        }
        const unreadRef = db
            .collection('users')
            .doc(uid)
            .collection('chatUnread')
            .doc(chatKey);
        // (a) was the counter zero before this message?
        const existing = await unreadRef.get();
        const data = existing.data();
        const wasZero = !existing.exists || (data?.count ?? 0) === 0;
        const senderName = (msg.senderName || '').trim() || 'שחקן';
        const text = msg.text || '';
        const lastMessageAt = typeof msg.createdAt === 'number' ? msg.createdAt : Date.now();
        // (b) increment + write the preview fields.
        await unreadRef.set({
            count: admin.firestore.FieldValue.increment(1),
            lastMessageAt,
            lastText: truncate(text),
            lastSenderName: senderName,
            scope,
            parentId,
            title,
        }, { merge: true });
        // (c) muted?
        let muted = false;
        try {
            const settings = await db
                .collection('users')
                .doc(uid)
                .collection('chatSettings')
                .doc(chatKey)
                .get();
            muted = settings.data()?.muted === true;
        }
        catch (err) {
            console.warn('[chatPush] settings read failed', { uid, chatKey }, err);
        }
        // (d) push only on the zero→one transition, and only if not muted.
        if (!wasZero || muted)
            return;
        const body = truncate(`${senderName}: ${text}`);
        await sendChatPush(uid, title, body, {
            type: 'chatMessage',
            scope,
            parentId,
            chatKey,
        });
    }
    catch (err) {
        console.error('[chatPush] recipient failed', { uid, chatKey }, err);
    }
}
/**
 * Resolve recipients + chat title from the parent doc, then fan out to
 * every recipient concurrently.
 */
async function handleChatMessage(scope, parentId, msg) {
    if (!parentId)
        return;
    const db = admin.firestore();
    const senderId = typeof msg.senderId === 'string' ? msg.senderId : '';
    let recipients = [];
    let title = '';
    try {
        if (scope === 'game') {
            const snap = await db.collection('games').doc(parentId).get();
            if (!snap.exists)
                return;
            const g = snap.data();
            title = (g.title || '').trim() || 'המשחק';
            const all = [...(g.players || [])];
            if (typeof g.createdBy === 'string' && g.createdBy)
                all.push(g.createdBy);
            recipients = Array.from(new Set(all));
        }
        else {
            const snap = await db.collection('groups').doc(parentId).get();
            if (!snap.exists)
                return;
            const grp = snap.data();
            title = (grp.name || '').trim() || 'הקהילה';
            recipients = Array.from(new Set([...(grp.playerIds || []), ...(grp.adminIds || [])]));
        }
    }
    catch (err) {
        console.error('[chatPush] parent resolve failed', { scope, parentId }, err);
        return;
    }
    // Exclude the sender — they don't get a push/unread for their own message.
    const targets = recipients.filter((uid) => typeof uid === 'string' && uid && uid !== senderId);
    if (targets.length === 0)
        return;
    await Promise.all(targets.map((uid) => handleRecipient(uid, scope, parentId, title, msg)));
}
// ─── Triggers ──────────────────────────────────────────────────────────
exports.onGameChatMessage = (0, firestore_1.onDocumentCreated)('games/{gameId}/messages/{msgId}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const gameId = event.params.gameId;
    await handleChatMessage('game', gameId, snap.data());
});
exports.onCommunityChatMessage = (0, firestore_1.onDocumentCreated)('groups/{groupId}/messages/{msgId}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const groupId = event.params.groupId;
    await handleChatMessage('community', groupId, snap.data());
});
