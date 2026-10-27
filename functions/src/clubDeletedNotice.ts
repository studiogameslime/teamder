import { onDocumentDeletedWithAuthContext } from './observedFunctions';
import { getFirestore } from 'firebase-admin/firestore';
import { cancelDeletedClubActivity } from './clubDeletion';

// A client cannot prove that a club was deleted. Only the deletion event can.
export const onClubDeletedNotice = onDocumentDeletedWithAuthContext({ document: 'groups/{groupId}', retry: true, timeoutSeconds: 540 }, async event => {
  if (!event.data) return;
  const club = event.data.data();
  const recipients = [...new Set<string>([...(club.playerIds ?? []), ...(club.adminIds ?? [])]
    .filter((id): id is string => typeof id === 'string' && id !== event.authId))];
  const db = getFirestore();
  await cancelDeletedClubActivity(db, event.params.groupId, Date.parse(event.time));
  for (let i = 0; i < recipients.length; i += 400) {
    const batch = db.batch();
    for (const uid of recipients.slice(i, i + 400)) {
      // Stable across event redelivery, without overwriting a read notification.
      const ref = db.collection('notifications').doc(`clubDeleted_${event.id}_${uid}`);
      batch.set(ref, {
        type: 'groupDeleted', recipientId: uid, srv: true,
        createdByUid: event.authId ?? '',
        payload: { groupId: event.params.groupId, groupName: String(club.name ?? '').slice(0, 120) },
        createdAt: Date.parse(event.time),
      }, { merge: true });
    }
    await batch.commit();
  }
});
