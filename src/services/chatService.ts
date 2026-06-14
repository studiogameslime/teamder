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
} from 'firebase/firestore';

import { col } from '@/firebase/firestore';
import type { ChatMessage, ChatScope, User } from '@/types';

/** Max characters per message — guards against pathological payloads. */
export const MAX_MESSAGE_LEN = 1000;
/** How many recent messages we keep live in the screen. */
const WINDOW = 100;

function messagesCol(scope: ChatScope, parentId: string) {
  return scope === 'game' ? col.gameMessages(parentId) : col.groupMessages(parentId);
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
    const q = query(
      messagesCol(scope, parentId),
      orderBy('createdAt', 'asc'),
      limit(WINDOW),
    );
    return onSnapshot(
      q,
      (snap) => onMessages(snap.docs.map((d) => d.data())),
      (err) => onError?.(err),
    );
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
};
