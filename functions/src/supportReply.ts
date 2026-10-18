import { pushToAdmins } from './adminPush';
import * as admin from 'firebase-admin';

/** Validate the complete canonical pair, never a substring like teamder-fan. */
export function supportReplyUser(convId: string, senderId: string): string | null {
  const ids = convId.split('__');
  return ids.length === 2 && ids.includes('teamder') && senderId !== 'teamder' &&
    !!senderId && !/[\/\s]/.test(senderId) && ids.includes(senderId) && [...ids].sort().join('__') === convId ? senderId : null;
}

export async function notifySupportReply(convId: string, msgId: string, message: {
  senderId?: string; senderName?: string; text?: string;
}): Promise<void> {
  const userId = supportReplyUser(convId, message.senderId ?? '');
  if (!userId) return;
  const name = (message.senderName || '').replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 60) || 'משתמש';
  await pushToAdmins('teamderReply', `⁨${name}⁩ השיב לצוות טימדר`,
    (message.text || 'התקבלה הודעה חדשה').slice(0, 120),
    { parentId: convId, userId, messageId: msgId, eventId: `support:${convId}:${msgId}` });
}

export async function updateSupportSummary(convId: string, messageId: string, message: {
  senderId?: string; text?: string; createdAt?: number; supportOrigin?: string;
}): Promise<void> {
  const ids = convId.split('__');
  const userId = ids.find(id => id !== 'teamder') ?? '';
  if (!supportReplyUser(convId, userId) || !ids.includes(message.senderId ?? '')) return;
  const ref = admin.firestore().doc(`dmConversations/${convId}`);
  const jobRef = admin.firestore().doc(`supportOutreach/${userId}`);
  const at = message.createdAt ?? 0;
  await admin.firestore().runTransaction(async tx => {
    const [current, job] = await tx.getAll(ref, jobRef);
    if (!current.exists) return;
    const update: { supportLastMessageId?: string; supportLastMessageAt?: number; supportLastSenderId?: string; supportLastText?: string; supportLastHumanAt?: number } = {};
    if ((current.data()?.supportLastMessageAt ?? 0) <= at) Object.assign(update, {
      supportLastMessageId: messageId, supportLastMessageAt: at,
      supportLastSenderId: message.senderId, supportLastText: (message.text ?? '').slice(0, 120),
    });
    if (message.senderId === 'teamder' && message.supportOrigin !== 'club_onboarding' && at > (current.data()?.supportLastHumanAt ?? 0)) update.supportLastHumanAt = at;
    if (Object.keys(update).length) tx.update(ref, update);
    if (message.senderId === userId && job.data()?.status === 'sent' && at >= (job.data()?.sentAt ?? Infinity)) {
      tx.update(jobRef, { status: 'replied', repliedAt: at, updatedAt: at, replyMessageId: messageId });
    }
  });
}
