import { createHash } from 'node:crypto';
import { getFirestore, type Transaction, type DocumentReference } from 'firebase-admin/firestore';
import { onCall, type CallableRequest } from './observedFunctions';
import { ExpectedCallableError as HttpsError } from './expectedCallableError';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { dmDay, dmStatus, validateDmText, type DmRequest } from './dmPolicy';

type Data = Record<string, any>;
const ids = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === 'string') : [];
function validId(v: unknown): string {
  if (typeof v !== 'string' || !v || v.length > 128 || /[\/\x00-\x1f]/.test(v) || v.includes('__')) throw new HttpsError('invalid-argument', 'Invalid player');
  return v;
}
const identity = (id: string, u: Data) => ({ id, name: String(u.name ?? '').slice(0, 60), ...(u.avatarId ? { avatarId: u.avatarId } : {}), ...(u.photoUrl ? { photoUrl: u.photoUrl } : {}) });

/** All state transitions use current users/blocks in the same transaction. */
export async function runDmAction(request: CallableRequest) {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Full account required');
  const other = validId(request.data?.userId);
  validId(uid);
  if (other === uid || other === 'teamder') throw new HttpsError('invalid-argument', 'Invalid player');
  const action = request.data?.action ?? 'status';
  if (!['status', 'send', 'accept', 'decline', 'cancel', 'seen'].includes(action)) throw new HttpsError('invalid-argument', 'Invalid action');
  const operation = request.data?.operationId;
  if (action !== 'status' && (typeof operation !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(operation))) throw new HttpsError('invalid-argument', 'Operation required');
  let text = '';
  if (action === 'send') {
    if (typeof request.data?.text !== 'string' || request.data.text.length > 1000 || !request.data.text.trim()) throw new HttpsError('invalid-argument', 'Message must contain 1 to 1000 characters');
    text = validateDmText(request.data.text);
  }
  const db = getFirestore(), convId = [uid, other].sort().join('__'), now = Date.now();
  const convRef = db.doc(`dmConversations/${convId}`), privateRef = db.doc(`dmRequestState/${convId}`);
  const opRef = db.doc(`dmOperations/${uid}_${operation ?? 'status'}`);
  const myRef = db.doc(`users/${uid}/dmRequests/${convId}`), peerRef = db.doc(`users/${other}/dmRequests/${convId}`);
  const quotaRef = db.doc(`dmRequestQuotas/${uid}`);
  // Bind retry ids to exact content/action, not merely a caller-provided token.
  const signature = createHash('sha256').update(JSON.stringify([other, action, text])).digest('hex');
  return db.runTransaction(async tx => {
    const [meSnap, otherSnap, a, b, convSnap, privateSnap, operationSnap, quotaSnap] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`users/${other}`)),
      tx.get(db.doc(`users/${uid}/blocked/${other}`)), tx.get(db.doc(`users/${other}/blocked/${uid}`)),
      tx.get(convRef), tx.get(privateRef), tx.get(opRef), tx.get(quotaRef),
    ]);
    if (!meSnap.exists || meSnap.data()?.isGuest) throw new HttpsError('unauthenticated', 'Full account required');
    if (!otherSnap.exists || otherSnap.data()?.isGuest) throw new HttpsError('not-found', 'Player unavailable');
    const me = meSnap.data()!, peer = otherSnap.data()!, conv = convSnap.data() ?? {};
    const r = privateSnap.data() as DmRequest | undefined;
    const blocked = a.exists || b.exists;
    const friends = ids(me.friends).includes(other) && ids(peer.friends).includes(uid);
    const status = dmStatus(uid, { blocked, friends, approved: conv.messagingApproved === true, accepts: peer.dmRequestPolicy === 'everyone', request: r });
    const result = { status, convId, other: identity(other, peer) };
    if (action === 'status') return result;
    if (operationSnap.exists) {
      if (operationSnap.data()?.signature !== signature) throw new HttpsError('invalid-argument', 'Operation changed');
      return result;
    }
    const complete = (next = status) => {
      tx.create(opRef, { signature, at: now, convId });
      return { ...result, status: next };
    };
    if (action === 'seen') {
      // Only the recipient owns this marker. It is never a shared read receipt.
      if (r?.to === uid) tx.set(myRef, { seenAt: now }, { merge: true });
      return complete();
    }
    if (blocked) throw new HttpsError('permission-denied', 'Contact unavailable');
    const metadata = { participants: [uid, other].sort(), createdAt: conv.createdAt ?? now, updatedAt: now };
    const index = (owner: string, user: Data) => ({ scope: 'dm', parentId: convId, title: String(user.name ?? ''), openedAt: now });
    const approve = () => {
      tx.set(convRef, { ...metadata, messagingApproved: true, approvedAt: conv.approvedAt ?? now }, { merge: true });
      tx.delete(myRef); tx.delete(peerRef);
      tx.set(db.doc(`users/${uid}/chatUnread/dm__${convId}`), index(uid, peer), { merge: true });
      tx.set(db.doc(`users/${other}/chatUnread/dm__${convId}`), index(other, me), { merge: true });
    };
    if (action === 'cancel') {
      if (r?.from !== uid || conv.messagingApproved === true || friends) throw new HttpsError('failed-precondition', 'Request unavailable');
      // A declined request behaves exactly like a pending one to the sender.
      if (r.status !== 'cancelled') {
        tx.set(privateRef, { status: 'cancelled' }, { merge: true });
        tx.delete(peerRef);
        tx.set(myRef, { status: 'cancelled' }, { merge: true });
      }
      return complete('cancelled');
    }
    if (action === 'decline') {
      if (!r || r.to !== uid || r.status === 'cancelled' || conv.messagingApproved === true || friends) throw new HttpsError('failed-precondition', 'Request unavailable');
      tx.set(privateRef, { status: 'declined' }, { merge: true });
      tx.set(myRef, { status: 'declined', seenAt: now }, { merge: true });
      // Do not touch the sender projection, timestamps, or shared conversation.
      return complete('declined');
    }
    if (action === 'accept') {
      if (status !== 'open' && status !== 'incoming' && status !== 'declined') throw new HttpsError('failed-precondition', 'Request unavailable');
      approve();
      return complete('open');
    }
    if (status === 'waiting' || status === 'cancelled' || status === 'unavailable') throw new HttpsError('permission-denied', 'Contact unavailable');
    const first = status === 'compose';
    if (first) {
      const quota = quotaSnap.data() ?? {}, day = dmDay(now);
      const count = quota.day === day ? Number(quota.count) || 0 : 0;
      if (count >= 5) throw new HttpsError('resource-exhausted', 'Daily request limit reached', { reason: 'dm-daily-limit' });
      tx.set(quotaRef, { day, count: count + 1 });
    }
    const messageId = `op_${uid}_${operation}`;
    const message = { senderId: uid, senderName: String(me.name ?? ''), ...(me.avatarId ? { senderAvatarId: me.avatarId } : {}), ...(me.photoUrl ? { senderPhotoUrl: me.photoUrl } : {}), text, createdAt: now, ...(first ? { messageRequest: true } : {}) };
    tx.set(convRef, metadata, { merge: true });
    tx.create(convRef.collection('messages').doc(messageId), message);
    if (first) {
      tx.set(privateRef, { from: uid, to: other, status: 'pending', text, messageId, createdAt: now });
      tx.set(myRef, { convId, userId: other, user: identity(other, peer), status: 'waiting', text, messageId, createdAt: now, seenAt: now });
      tx.set(peerRef, { convId, userId: uid, user: identity(uid, me), status: 'incoming', text, messageId, createdAt: now, seenAt: 0 });
    } else {
      // Explicit acceptance or a reply to a request grants durable permission.
      if (status === 'incoming' || status === 'declined') approve();
      else {
        if (friends) { tx.delete(myRef); tx.delete(peerRef); }
        tx.set(db.doc(`users/${uid}/chatUnread/dm__${convId}`), index(uid, peer), { merge: true });
        // Mutual friends become durable only once each has actually sent.
        const authors = new Set(ids(conv.friendMessageAuthors));
        if (friends) authors.add(uid);
        tx.set(convRef, { friendMessageAuthors: [...authors], ...(friends && authors.has(other) ? { messagingApproved: true, approvedAt: conv.approvedAt ?? now } : {}) }, { merge: true });
      }
    }
    return complete(first ? 'waiting' : 'open');
  });
}

export const dmRequestAction = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, runDmAction);

/** Persist historical continuity atomically BEFORE removing mutual friendship. */
export async function preserveDmOnRemoval(tx: Transaction, userRef: DocumentReference, otherRef: DocumentReference) {
  const db = getFirestore(), convRef = db.doc(`dmConversations/${[userRef.id, otherRef.id].sort().join('__')}`);
  const [a, b, mine, theirs] = await Promise.all([
    tx.get(userRef), tx.get(otherRef),
    tx.get(convRef.collection('messages').where('senderId', '==', userRef.id).limit(1)),
    tx.get(convRef.collection('messages').where('senderId', '==', otherRef.id).limit(1)),
  ]);
  if (ids(a.data()?.friends).includes(otherRef.id) && ids(b.data()?.friends).includes(userRef.id) && !mine.empty && !theirs.empty) {
    tx.set(convRef, { participants: [userRef.id, otherRef.id].sort(), messagingApproved: true, approvedAt: Date.now() }, { merge: true });
  }
}

export const setDmRequestPrivacy = onCall({ enforceAppCheck: ENFORCE_APP_CHECK }, async request => {
  const uid = request.auth?.uid;
  if (!uid || request.auth?.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Full account required');
  const policy = request.data?.policy;
  if (!['everyone', 'friends'].includes(policy)) throw new HttpsError('invalid-argument', 'Invalid privacy');
  await getFirestore().runTransaction(async tx => {
    const ref = getFirestore().doc(`users/${uid}`), snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.isGuest) throw new HttpsError('unauthenticated', 'Full account required');
    tx.update(ref, { dmRequestPolicy: policy, dmRequestPolicySource: 'explicit', dmRequestPolicyAt: Date.now(), dmFriendsOnly: policy === 'friends' });
  });
  return { policy };
});
