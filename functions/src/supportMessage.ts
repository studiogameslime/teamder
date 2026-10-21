import { observeCaughtError } from './serverErrorLog';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from './observedFunctions';
import { validateSupportMessage } from './supportMessagePolicy';

const stableContext = (value: Record<string, unknown> = {}) => JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));

/** Writes only to the caller's canonical official support conversation. */
export const sendSupportMessage = onCall({ region: 'us-central1', maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required');
  if (request.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('failed-precondition', 'Registered account required');
  const uid = request.auth.uid;
  if (uid === 'teamder' || uid.includes('__') || /[\/\s]/.test(uid) || request.data?.expectedUid !== uid) throw new HttpsError('failed-precondition', 'Identity changed');
  let message: ReturnType<typeof validateSupportMessage>;
  try { message = validateSupportMessage(request.data); } catch (caughtErrore588fb13df) {
    observeCaughtError(caughtErrore588fb13df, {"source":"functions/src/supportMessage.ts","handler":"module","site":"supportMessage:e588fb13df"}); throw new HttpsError('invalid-argument', 'Invalid support message'); }
  const db = admin.firestore();
  const convId = [uid, 'teamder'].sort().join('__');
  const conversation = db.doc(`dmConversations/${convId}`);
  const ref = conversation.collection('messages').doc(message.id);
  const quota = db.doc(`supportMessageLimits/${uid}`);
  const profile = (await db.doc(`users/${uid}`).get()).data();
  const now = Date.now();
  await db.runTransaction(async tx => {
    const [existing, limit, parent] = await tx.getAll(ref, quota, conversation);
    if (existing.exists) {
      const previous = existing.data()!;
      if (previous.senderId !== uid || previous.text !== message.text || (previous.supportImage ?? '') !== (message.image ?? '') || stableContext(previous.supportContext) !== stableContext(message.context)) throw new HttpsError('already-exists', 'Message identity reused');
      return;
    }
    if (parent.exists && JSON.stringify(parent.data()?.participants) !== JSON.stringify([uid, 'teamder'].sort())) throw new HttpsError('failed-precondition', 'Invalid conversation');
    const bucket = Math.floor(now / 60_000);
    const used = limit.data()?.bucket === bucket ? Number(limit.data()?.count) || 0 : 0;
    if (used >= 20) throw new HttpsError('resource-exhausted', 'Try again later');
    tx.set(quota, { bucket, count: used + 1 });
    tx.set(conversation, { participants: [uid, 'teamder'].sort(), ...(parent.exists ? {} : { createdAt: now }), updatedAt: now }, { merge: true });
    tx.create(ref, { text: message.text, senderId: uid, senderName: typeof profile?.name === 'string' ? profile.name.slice(0, 60) : 'משתמש', createdAt: now,
      supportContext: message.context, ...(message.image ? { supportImage: message.image } : {}) });
  });
  return { id: message.id, convId };
});
