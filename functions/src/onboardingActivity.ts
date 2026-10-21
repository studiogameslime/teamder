import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { onCall, HttpsError } from './observedFunctions';
import { onDocumentCreated } from './observedFunctions';
import { ONBOARDING_ACTIONS, safeActivityParams } from './onboardingActivityCatalog';
import { onboardingPushMilestone } from './onboardingPushPolicy';
import { onboardingPushContent } from './onboardingPushContent';
import { onboardingGuestNumber } from './onboardingGuest';

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
  const anonymous = request.auth.token.firebase?.sign_in_provider === 'anonymous';
  // A queue may first reach the server after an in-place account upgrade.
  const guestNumber = await onboardingGuestNumber(uid, anonymous || rows.some(row =>
    row.action === 'guest_session_started' || row.params.is_guest === true));
  const journeyRefs = [...new Set(rows.map(row => row.sessionId))].map(id =>
    db.doc(`onboardingJourneyState/${createHash('sha256').update(`${uid}:${id}`).digest('hex')}`));
  await db.runTransaction(async tx => {
    const [limit, ...snapshots] = await tx.getAll(quota, ...refs, ...journeyRefs);
    const states = new Map<string, Record<string, any>>();
    [...new Set(rows.map(row => row.sessionId))].forEach((id, index) => {
      states.set(id, snapshots[refs.length + index].data() ?? {});
    });
    const fresh = rows.filter((_, i) => !snapshots[i].exists);
    const previous = limit.data();
    const sameHour = Number(previous?.window) === Math.floor(now / 3600000);
    const used = sameHour ? Number(previous?.count) || 0 : 0;
    if (used + fresh.length > 600) throw new HttpsError('resource-exhausted', 'Activity rate limit; retry later');
    tx.set(quota, { window: Math.floor(now / 3600000), count: used + fresh.length });
    rows.map((row, i) => ({ row, i })).sort((a, b) => a.row.sequence - b.row.sequence).forEach(({ row, i }) => {
      if (snapshots[i].exists) return;
      const state = states.get(row.sessionId)!;
      const choice = row.action === 'entry_intent_selected' && row.params.is_guest === true
        && ['create_club', 'find_game', 'one_off_game', 'invite'].includes(String(row.params.intent));
      const ordered = row.sequence > (state.intentSequence ?? 0);
      const previousIntent = choice && ordered ? state.intent : undefined;
      const repeatedIntent = choice && (!ordered || previousIntent === row.params.intent);
      if (choice && ordered) {
        state.intent = row.params.intent;
        state.intentSequence = row.sequence;
      }
      // Preserve launch attribution for older clients that omit it on later actions.
      if (row.action === 'entry_source_resolved') state.entryContext = row.params;
      const entryContext = Object.fromEntries(Object.entries(state.entryContext ?? {}).filter(([key]) =>
        ['entry_source', 'entry_channel', 'entry_campaign', 'entry_link_id', 'resolved_by', 'target_type', 'target_id', 'has_inviter', 'inviter_uid'].includes(key)));
      tx.create(refs[i], { ...row, params: { ...entryContext, ...row.params }, uid, actorName, anonymous,
        ...(guestNumber ? { guestNumber } : {}),
        ...(previousIntent && !repeatedIntent ? { previousIntent } : {}),
        ...(choice ? { intentTracked: true, repeatedIntent } : {}),
        createdAt: now, pushStatus: 'pending', label: ONBOARDING_ACTIONS[row.action] });
    });
    [...states.values()].forEach((state, index) => tx.set(journeyRefs[index], state));
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
  let milestone = onboardingPushMilestone(current.action, current.params);
  if (current.intentTracked && current.action === 'entry_intent_selected') {
    if (current.repeatedIntent) { await ref.update({ pushStatus: 'milestone_duplicate' }); return; }
    if (milestone) milestone = `intent-event:${event.params.eventId}`;
  }
  const guestNumber = current.guestNumber ?? await onboardingGuestNumber(current.uid, current.anonymous === true || current.params?.is_guest === true);
  if (milestone === 'registration_started' && !guestNumber) milestone = null;
  if (!milestone || (milestone === 'authenticated' && current.anonymous === true)) { await ref.update({ pushStatus: 'history_only' }); return; }
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
  // Use this visit's link identity only, never a historical referral from the
  // actor profile. Names supplied by a client are not display-name authority.
  const inviterUid = current.params?.inviter_uid;
  const inviter = typeof inviterUid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(inviterUid)
    ? (await db.doc(`users/${inviterUid}`).get()).data() : undefined;
  const inviterName = typeof inviter?.name === 'string' && inviter.name.trim() ? inviter.name : inviter?.displayName;
  const content = onboardingPushContent({ action: current.action, actorName: current.actorName, anonymous: current.anonymous, params: current.params,
    guestNumber, previousIntent: current.previousIntent, inviterName }, user);
  const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex');
  const delivered = new Set<string>(Array.isArray(current.deliveredTargets) ? current.deliveredTargets : []);
  const permanent = new Set<string>(Array.isArray(current.invalidTargets) ? current.invalidTargets : []);
  const pending = tokens.filter(token => !delivered.has(tokenKey(token)) && !permanent.has(tokenKey(token)));
  if (!pending.length) {
    await ref.update({ pushStatus: delivered.size ? 'sent' : 'no_devices', deliveredDevices: delivered.size, failedDevices: permanent.size });
    return;
  }
  const response = await admin.messaging().sendEachForMulticast({ tokens: pending,
    notification: content,
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
    pushTitle: content.title, pushBody: content.body,
    deliveredTargets: [...delivered], invalidTargets: [...permanent],
    deliveredDevices: delivered.size, failedDevices: permanent.size + transientCount, pushAttemptAt: Date.now() });
  if (transient) throw new Error('Transient onboarding push delivery failure');
});
