import { cached } from './cache';
import { getDoc, queryEquals, type FsDoc } from './firestoreRest';

/** Preserve stored business fields, without passing credentials or image payloads to the inspector. */
export function userRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(userRecord);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (/token|password|secret|credential|authorization|apiKey/i.test(key)) return [[key, 'מוסתר']];
    if (/^(image|claudeImages|photoBase64)$/i.test(key)) return [[key, 'צילום זמין בפרטי הדיווח']];
    // Device dictionaries are keyed by the actual FCM token.
    if (key === 'devices' && entry && typeof entry === 'object') return [[key, Object.values(entry).map(userRecord)]];
    return [[key, userRecord(entry)]];
  }));
}

export const USER_RECORD_LIMIT = 100;
export const USER_SOURCES = {
  notifications: { label: 'התראות שנוצרו למשתמש', collection: 'notifications', field: 'recipientId' },
  onboarding: { label: 'מסלול ההצטרפות', collection: 'onboardingActivity', field: 'uid' },
  friendsSent: { label: 'בקשות חברות שנשלחו', collection: 'friendRequests', field: 'fromUserId' },
  friendsReceived: { label: 'בקשות חברות שהתקבלו', collection: 'friendRequests', field: 'toUserId' },
  joinRequests: { label: 'בקשות הצטרפות למועדונים', collection: 'groupJoinRequests', field: 'userId' },
  tasks: { label: 'משימות המשויכות למדווח', collection: 'tasks', field: 'reporterId' },
  pairsA: { label: 'נתוני משחק משותף — צד ראשון', collection: 'pairStats', field: 'a' },
  pairsB: { label: 'נתוני משחק משותף — צד שני', collection: 'pairStats', field: 'b' },
} as const;
export type UserSource = keyof typeof USER_SOURCES;
export function fetchUserRecords(uid: string, source: UserSource, force = false): Promise<FsDoc[]> {
  const spec = USER_SOURCES[source];
  return cached(`user-records:${uid}:${source}`, async () => {
    const docs = await queryEquals(spec.collection, spec.field, uid, USER_RECORD_LIMIT);
    return docs.map(doc => userRecord(doc) as FsDoc).sort((a,b) => Number(b.createdAt ?? b.updatedAt ?? 0) - Number(a.createdAt ?? a.updatedAt ?? 0));
  }, { ttl: 180_000, force });
}
export function fetchPublicUserRecord(uid: string, force = false) {
  return cached(`user-public:${uid}`, async () => userRecord(await getDoc(`usersPublic/${uid}`)) as Record<string, unknown> | null, {ttl:180_000,force});
}

export function fetchPlayerStatsRecord(uid: string, force = false) {
  return cached(`user-stats:${uid}`, async () => userRecord(await getDoc(`playerStats/${uid}`)) as Record<string,unknown>|null, {ttl:180_000,force});
}
