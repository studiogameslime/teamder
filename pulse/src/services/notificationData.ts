import { cached } from './cache';
import { queryCollectionRecent } from './firestoreRest';

export const NOTIFICATION_WINDOW = 1000;
/** Latest records, projected without message payloads; shared across all views. */
export function fetchNotificationData(force = false) {
  return cached('notificationData', () => queryCollectionRecent('notifications', NOTIFICATION_WINDOW,
    ['type', 'recipientId', 'createdAt', 'stats', 'read', 'delivered']), { force });
}
