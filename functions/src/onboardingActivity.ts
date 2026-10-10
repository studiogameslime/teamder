import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { ONBOARDING_ACTIONS, safeActivityParams, activityLabel } from './onboardingActivityCatalog';
import { onboardingPushMilestone } from './onboardingPushPolicy';

/** Authenticated anonymous sessions are valid; UID always comes from the token. */
export const recordOnboardingActivity = onCall({ maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (request.data?.expectedUid !== undefined && request.data.expectedUid !== request.auth.uid) {
    throw new HttpsError('failed-precondition', 'Activity identity changed; retry with its owner');
  }
  const events = request.data?.events;
  if (!Array.isArray(events) || !events.length || events.length > 20) throw new HttpsError('invalid-argument', 'Expected 1–20 events');
  const now = Date.now();
  const uid = request.auth.uid;
  const rows = events.map(event => {
    if (!event || typeof event.id !== 'string' || !/^[a-z0-9-]{10,160}$/.test(event.id)
      || typeof event.sessionId !== 'string' || !/^[a-z0-9-]{10,140}$/.test(event.sessionId)
      || !event.id.startsWith(`${event.sessionId}-`)
      || !Number.isSafeInteger(event.sequence) || event.sequence < 1
      || typeof event.action !== 'string' || !Object.prototype.hasOwnProperty.call(ONBOARDING_ACTIONS, event.action)
      || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 1 || event.occurredAt > now + 86400000
      || !event.params || typeof event.params !== 'object' || Array.isArray(event.params)) {
      throw new HttpsError('invalid-argument', 'Invalid activity event');
    }
    return { id: event.id as string, sessionId: event.sessionId as string, sequence: event.sequence as number,
      occurredAt: event.occurredAt as number, action: event.action as string, params: safeActivityParams(event.params) };
  });
  const db = admin.firestore();
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new HttpsError('invalid-argument', 'Duplicate event IDs in batch');
  const refs = rows.map(row => db.collection('onboardingActivity').doc(createHash('sha256').update(row.id).digest('hex')));
  const quota = db.collection('onboardingActivityLimits').doc(uid);
  const actor = (await db.doc(`users/${uid}`).get()).data();
  const actorName = typeof actor?.name === 'string' ? actor.name.trim().slice(0, 60) : '';
  await db.runTransaction(async tx => {
    const [limit, ...snapshots] = await tx.getAll(quota, ...refs);
    const fresh = rows.filter((_, i) => !snapshots[i].exists);
    const previous = limit.data();
    const sameHour = Number(previous?.window) === Math.floor(now / 3600000);
    const used = sameHour ? Number(previous?.count) || 0 : 0;
    if (used + fresh.length > 600) throw new HttpsError('resource-exhausted', 'Activity rate limit; retry later');
    tx.set(quota, { window: Math.floor(now / 3600000), count: used + fresh.length });
    rows.forEach((row, i) => {
      if (snapshots[i].exists) return;
      tx.create(refs[i], { ...row, uid, actorName, anonymous: request.auth!.token.firebase?.sign_in_provider === 'anonymous',
        createdAt: now, pushStatus: 'pending', label: ONBOARDING_ACTIONS[row.action] });
    });
  });
  return { acknowledged: rows.map(row => row.id) };
});

/** History is committed BEFORE delivery. Independent event IDs avoid the legacy global throttle. */
export const onOnboardingActivity = onDocumentCreated({ document: 'onboardingActivity/{eventId}', retry: true, maxInstances: 3 }, async event => {
  const ref = event.data?.ref;
  if (!ref) return;
  const db = admin.firestore();
  const current = (await ref.get()).data();
  if (!current || ['sent', 'muted', 'history_only', 'milestone_duplicate'].includes(current.pushStatus)) return;
  const milestone = onboardingPushMilestone(current.action, current.params);
  if (!milestone) { await ref.update({ pushStatus: 'history_only' }); return; }
  // A repeated tap/view is still in history, but only one push for this milestone per visit.
  const marker = db.collection('onboardingMilestonePushes').doc(createHash('sha256').update(`${current.sessionId}:${milestone}`).digest('hex'));
  const ownsMilestone = await db.runTransaction(async tx => {
    const [snapshot] = await tx.getAll(marker);
    if (snapshot.exists) return snapshot.data()?.eventId === event.params.eventId;
    tx.set(marker, { eventId: event.params.eventId, sessionId: current.sessionId, milestone, createdAt: Date.now() });
    return true;
  });
  if (!ownsMilestone) { await ref.update({ pushStatus: 'milestone_duplicate' }); return; }
  const prefs = (await db.doc('adminConfig/prefs').get()).data();
  if (prefs?.onboardingActivity === false) { await ref.update({ pushStatus: 'muted' }); return; }
  const config = (await db.doc('adminConfig/push').get()).data();
  const tokens = [...new Set<string>((config?.tokens ?? []).filter((v: unknown) => typeof v === 'string' && v.length))];
  if (!tokens.length) { await ref.update({ pushStatus: 'no_devices' }); return; }
  const user = (await db.doc(`users/${current.uid}`).get()).data();
  const who = typeof user?.name === 'string' && user.name.trim() ? user.name.trim().slice(0, 60) : 'אורח';
  const summary = milestone === 'entry'
    ? `נכנס לאפליקציה${current.params?.has_inviter ? ' דרך הזמנה' : ''}`
    : activityLabel(current.action, current.params);
  const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');
  const delivered = new Set<string>(Array.isArray(current.deliveredTargets) ? current.deliveredTargets : []);
  const permanent = new Set<string>(Array.isArray(current.invalidTargets) ? current.invalidTargets : []);
  const pending = tokens.filter(token => !delivered.has(tokenKey(token)) && !permanent.has(tokenKey(token)));
  if (!pending.length) {
    await ref.update({ pushStatus: delivered.size ? 'sent' : 'no_devices', deliveredDevices: delivered.size, failedDevices: permanent.size });
    return;
  }
  const response = await admin.messaging().sendEachForMulticast({ tokens: pending,
    notification: { title: 'תהליך ההצטרפות', body: `${who}: ${summary}` },
    data: { type: 'onboardingActivity', eventId: event.params.eventId, sessionId: current.sessionId, uid: current.uid },
    android: { priority: 'high', notification: { channelId: 'onboarding', sound: 'default', tag: event.params.eventId } },
    apns: { headers: { 'apns-collapse-id': createHash('sha256').update(event.params.eventId).digest('hex') }, payload: { aps: { sound: 'default' } } },
  });
  let transient = false;
  let transientCount = 0;
  response.responses.forEach((result, index) => {
    const hash = tokenKey(pending[index]);
    if (result.success || !result.error) delivered.add(hash);
    else if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(result.error.code)) permanent.add(hash);
    else { transient = true; transientCount++; }
  });
  await ref.update({ pushStatus: transient ? 'retrying' : delivered.size ? 'sent' : 'no_devices',
    deliveredTargets: [...delivered], invalidTargets: [...permanent],
    deliveredDevices: delivered.size, failedDevices: permanent.size + transientCount, pushAttemptAt: Date.now() });
  if (transient) throw new Error('Transient onboarding push delivery failure');
});
