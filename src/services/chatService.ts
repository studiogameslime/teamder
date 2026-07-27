// chatService — realtime messaging for the two chat scopes (game +
// community). Both map onto the same /…/messages subcollection shape, so
// one service + one screen serve both.
//
// Access (read AND write) is members-only and enforced in firestore.rules
// — this service does NOT re-check membership; the caller decides whether
// to mount the chat at all. A non-member's listener/write is rejected by
// the rules.

import {
  addDoc,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from 'firebase/firestore';

import { httpsCallable } from 'firebase/functions';

import { col } from '@/firebase/firestore';
import { USE_MOCK_DATA, getFirebase } from '@/firebase/config';
import { waitForAuthRestore } from '@/firebase/auth';
import { logError } from '@/services/errorLog';
import type { ChatMessage, ChatScope, ChatUnreadEntry, User, UserId } from '@/types';

/** Max characters per message — guards against pathological payloads. */
export const MAX_MESSAGE_LEN = 1000;
/** How many recent messages we keep live in the screen. */
const WINDOW = 100;

/** Stable per-chat key used across chatUnread / chatSettings docs. */
export function chatKeyFor(scope: ChatScope, parentId: string): string {
  return `${scope}__${parentId}`;
}

function messagesCol(scope: ChatScope, parentId: string) {
  if (scope === 'game') return col.gameMessages(parentId);
  if (scope === 'dm') return col.dmMessages(parentId);
  return col.groupMessages(parentId);
}

function readsCol(scope: ChatScope, parentId: string) {
  if (scope === 'game') return col.gameReads(parentId);
  if (scope === 'dm') return col.dmReads(parentId);
  return col.groupReads(parentId);
}

function typingCol(scope: ChatScope, parentId: string) {
  if (scope === 'game') return col.gameTyping(parentId);
  if (scope === 'dm') return col.dmTyping(parentId);
  return col.groupTyping(parentId);
}

/** Deterministic conversation id for a DM pair (order-independent). */
export function dmConvId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

/** A member currently typing in the chat. */
export interface ChatTyper {
  uid: string;
  name: string;
  at: number;
}

/** A member's chat read state — who's caught up to where. */
export interface ChatReader {
  uid: string;
  lastReadAt: number;
  name: string;
  avatarId?: string;
  photoUrl?: string;
}

export const chatService = {
  /**
   * Subscribe to the most recent messages, oldest→newest. Returns an
   * unsubscribe fn. `onError` fires if the listener is denied (e.g. the
   * user lost membership) so the screen can bail to a "no access" state.
   */
  subscribeMessages(
    scope: ChatScope,
    parentId: string,
    onMessages: (messages: ChatMessage[]) => void,
    onError?: (err: unknown) => void,
  ): () => void {
    // Window the MOST-RECENT messages: order newest→oldest at the query so
    // `limit` keeps the latest WINDOW (asc+limit would pin the oldest WINDOW
    // and a busy chat would never show recent messages), then reverse to
    // oldest→newest for rendering.
    const q = query(
      messagesCol(scope, parentId),
      orderBy('createdAt', 'desc'),
      limit(WINDOW),
    );
    // Don't open the listener until auth is RESTORED. Right after an app
    // update the persisted session is still loading, so a listener opened now
    // carries no `request.auth` → the rules deny it → the screen sticks on
    // "אין גישה לצ'אט" and never recovers (a denied listener doesn't re-auth).
    // Wait for restore, then subscribe. Returned fn cancels either phase.
    let real: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const user =
        getFirebase().auth.currentUser ?? (await waitForAuthRestore());
      if (cancelled) return;
      if (!user) {
        onError?.(new Error('chat: not signed in'));
        return;
      }
      real = onSnapshot(
        q,
        (snap) => onMessages(snap.docs.map((d) => d.data()).reverse()),
        (err) => onError?.(err),
      );
    })();
    return () => {
      cancelled = true;
      if (real) real();
    };
  },

  /**
   * Send a message. Denormalises the sender's name + avatar onto the doc
   * so it renders without an extra lookup. Returns the new message id.
   * Throws if the text is empty after trimming.
   */
  async sendMessage(
    scope: ChatScope,
    parentId: string,
    sender: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>,
    rawText: string,
  ): Promise<string> {
    const text = rawText.trim().slice(0, MAX_MESSAGE_LEN);
    if (!text) throw new Error('chat: empty message');
    const message: ChatMessage = {
      id: '', // assigned by Firestore
      text,
      senderId: sender.id,
      senderName: sender.name ?? '',
      senderAvatarId: sender.avatarId,
      senderPhotoUrl: sender.photoUrl,
      createdAt: Date.now(),
    };
    const ref = await addDoc(messagesCol(scope, parentId), message);
    return ref.id;
  },

  /**
   * Ensure the DM conversation metadata doc exists (idempotent). Required
   * before any message can be sent — the message rule reads `participants`
   * off this doc. The CREATE is gated by firestore.rules (the recipient's
   * `dmFriendsOnly`), so this throws permission-denied when a non-friend
   * tries to open a DM with someone who restricted it.
   */
  async ensureDmConversation(me: UserId, other: UserId): Promise<string> {
    // Guard against a self-DM: dmConvId(a,a) = "a__a" passes the rules'
    // `participants.size()==2` check ([a,a].sort() is still 2) and would
    // create a junk conversation doc that renders as a broken/locked chat.
    if (!other || me === other) {
      throw new Error('chat: cannot open a conversation with yourself');
    }
    const convId = dmConvId(me, other);
    if (USE_MOCK_DATA) return convId;
    await setDoc(
      col.dmConversation(convId),
      {
        participants: [me, other].sort(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      { merge: true },
    );
    return convId;
  },

  /**
   * Stamp MY own chats-list entry for a DM (count untouched) so the
   * conversation shows in my list with the other person's name — the server
   * only writes the OTHER side's unread entry.
   */
  async touchMyDmEntry(
    meId: UserId,
    convId: string,
    other: Pick<User, 'name' | 'avatarId' | 'photoUrl'>,
  ): Promise<void> {
    if (USE_MOCK_DATA) return;
    try {
      await setDoc(
        doc(col.userChatUnread(meId), chatKeyFor('dm', convId)),
        {
          scope: 'dm',
          parentId: convId,
          title: other.name ?? '',
          // Denormalise the other person's avatar so my chats list shows
          // their face even before they send me anything.
          ...(other.avatarId ? { avatarId: other.avatarId } : {}),
          ...(other.photoUrl ? { photoUrl: other.photoUrl } : {}),
          lastMessageAt: Date.now(),
        },
        { merge: true },
      );
    } catch (err) {
      logError('touchMyDmEntry', err, { convId });
    }
  },

  /**
   * Delete a message. Rules permit this only for the message's own sender
   * OR the chat's moderator (game creator / community creator).
   */
  async deleteMessage(
    scope: ChatScope,
    parentId: string,
    messageId: string,
  ): Promise<void> {
    await deleteDoc(doc(messagesCol(scope, parentId), messageId));
  },

  // ── Unread index (per-user) ────────────────────────────────────────────

  /** Subscribe to all of my unread entries (powers list sort + badges). */
  subscribeUnread(
    uid: UserId,
    cb: (entries: ChatUnreadEntry[]) => void,
  ): () => void {
    // Mock mode has no chat backend — emit an empty list once and no-op the
    // unsubscribe so the app-wide subscriber in MainTabs doesn't hit Firebase.
    if (USE_MOCK_DATA) {
      cb([]);
      return () => {};
    }
    return onSnapshot(col.userChatUnread(uid), (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Partial<ChatUnreadEntry>;
          return {
            id: d.id,
            count: typeof x.count === 'number' ? x.count : 0,
            lastMessageAt: typeof x.lastMessageAt === 'number' ? x.lastMessageAt : 0,
            lastText: typeof x.lastText === 'string' ? x.lastText : '',
            lastSenderName: typeof x.lastSenderName === 'string' ? x.lastSenderName : '',
            lastSenderId: typeof x.lastSenderId === 'string' ? x.lastSenderId : '',
            scope: (x.scope as ChatScope) ?? 'game',
            parentId: typeof x.parentId === 'string' ? x.parentId : '',
            title: typeof x.title === 'string' ? x.title : '',
            avatarId: typeof x.avatarId === 'string' ? x.avatarId : undefined,
            photoUrl: typeof x.photoUrl === 'string' ? x.photoUrl : undefined,
          };
        }),
      );
    });
  },

  /** Mark a chat read — resets my unread counter for it to 0. */
  async markChatRead(uid: UserId, scope: ChatScope, parentId: string): Promise<void> {
    await setDoc(
      doc(col.userChatUnread(uid), chatKeyFor(scope, parentId)),
      { count: 0, lastReadAt: Date.now() },
      { merge: true },
    );
  },

  // ── Read receipts ("who read") ─────────────────────────────────────────

  /** Stamp my read position in this chat (visible to the other members). */
  async writeReadReceipt(
    scope: ChatScope,
    parentId: string,
    user: Pick<User, 'id' | 'name' | 'avatarId' | 'photoUrl'>,
  ): Promise<void> {
    await setDoc(
      doc(readsCol(scope, parentId), user.id),
      {
        lastReadAt: Date.now(),
        name: user.name ?? '',
        ...(user.avatarId ? { avatarId: user.avatarId } : {}),
        ...(user.photoUrl ? { photoUrl: user.photoUrl } : {}),
      },
      { merge: true },
    );
  },

  // ── Typing indicators ("… מקליד") ──────────────────────────────────────

  /** Flag (or clear) that I'm typing. Callers should throttle the `true`
   *  writes (~every 2.5s) and clear on send / blur. */
  async setTyping(
    scope: ChatScope,
    parentId: string,
    user: Pick<User, 'id' | 'name'>,
    isTyping: boolean,
  ): Promise<void> {
    const ref = doc(typingCol(scope, parentId), user.id);
    if (isTyping) {
      const first = (user.name ?? '').trim().split(/\s+/)[0] || (user.name ?? '');
      await setDoc(ref, { name: first, at: Date.now() });
    } else {
      await deleteDoc(ref).catch(() => {});
    }
  },

  /** Subscribe to who's typing right now. */
  subscribeTyping(
    scope: ChatScope,
    parentId: string,
    cb: (typers: ChatTyper[]) => void,
  ): () => void {
    return onSnapshot(typingCol(scope, parentId), (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Partial<ChatTyper>;
          return {
            uid: d.id,
            name: typeof x.name === 'string' ? x.name : '',
            at: typeof x.at === 'number' ? x.at : 0,
          };
        }),
      );
    });
  },

  /** Subscribe to every member's read position in this chat. */
  subscribeReads(
    scope: ChatScope,
    parentId: string,
    cb: (readers: ChatReader[]) => void,
  ): () => void {
    return onSnapshot(readsCol(scope, parentId), (snap) => {
      cb(
        snap.docs.map((d) => {
          const x = d.data() as Partial<ChatReader>;
          return {
            uid: d.id,
            lastReadAt: typeof x.lastReadAt === 'number' ? x.lastReadAt : 0,
            name: typeof x.name === 'string' ? x.name : '',
            avatarId: typeof x.avatarId === 'string' ? x.avatarId : undefined,
            photoUrl: typeof x.photoUrl === 'string' ? x.photoUrl : undefined,
          };
        }),
      );
    });
  },

  // ── Per-chat mute ──────────────────────────────────────────────────────

  subscribeMuted(
    uid: UserId,
    scope: ChatScope,
    parentId: string,
    cb: (muted: boolean) => void,
  ): () => void {
    return onSnapshot(
      doc(col.userChatSettings(uid), chatKeyFor(scope, parentId)),
      (snap) => cb(snap.exists() && snap.data()?.muted === true),
    );
  },

  async setMuted(
    uid: UserId,
    scope: ChatScope,
    parentId: string,
    muted: boolean,
  ): Promise<void> {
    await setDoc(
      doc(col.userChatSettings(uid), chatKeyFor(scope, parentId)),
      { muted, scope, parentId },
      { merge: true },
    );
  },

  // ── Block list (store-safety) ──────────────────────────────────────────

  subscribeBlocked(uid: UserId, cb: (ids: Set<string>) => void): () => void {
    return onSnapshot(
      col.userBlocked(uid),
      (snap) => {
        cb(new Set(snap.docs.map((d) => d.id)));
      },
      (err) => {
        // Without an error handler a transient rules/permission failure
        // leaves the success callback unfired forever, hanging the
        // BlockedUsersScreen on its loader. Emit an empty set so the
        // screen resolves to its (correct) empty state instead.
        logError('subscribeBlocked', err, { uid });
        if (__DEV__) console.warn('[chatService] subscribeBlocked error', err);
        cb(new Set());
      },
    );
  },

  async blockUser(uid: UserId, blockedUid: string): Promise<void> {
    await setDoc(doc(col.userBlocked(uid), blockedUid), { at: Date.now() });
  },

  async unblockUser(uid: UserId, blockedUid: string): Promise<void> {
    await deleteDoc(doc(col.userBlocked(uid), blockedUid));
  },

  // ── Report (store-safety) ──────────────────────────────────────────────

  async reportMessage(
    _reporterId: UserId,
    scope: ChatScope,
    parentId: string,
    message: ChatMessage,
  ): Promise<void> {
    if (USE_MOCK_DATA) return;
    // IDs only — the server loads the real message and writes the report with
    // its authoritative text/author. Sending client-supplied messageText /
    // senderId would let a reporter frame an innocent user with fabricated
    // content, so those are no longer trusted (rules now deny direct writes).
    const { functions } = getFirebase();
    const fn = httpsCallable(functions, 'reportChatMessage');
    await fn({ scope, parentId, messageId: message.id });
  },
};
