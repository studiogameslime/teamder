import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import { onCall, onDocumentWritten, onSchedule, HttpsError } from './observedFunctions';
import { UsageEvent, validUsageEvent, usageWire, usageScreenKey } from './usageActivityCatalog';
import { joinDiagnosticId } from './joinDiagnosticId';

const DAY = 86400000;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const enabled = (uid: string) => {
  if (process.env.USAGE_ACTIVITY_ENABLED !== 'true') return false;
  const scope = (process.env.USAGE_ACTIVITY_UIDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return scope.length === 0 || scope.includes(uid);
};
const eventRef = (db: FirebaseFirestore.Firestore, uid: string, id: string) => db.doc(`usageActivity/${hash(`${uid}:${id}`)}`);
const sessionRef = (db: FirebaseFirestore.Firestore, uid: string, visit: string) => db.doc(`usageSessions/${hash(`${uid}:${visit}`)}`);
const operationRef = (db: FirebaseFirestore.Firestore, uid: string, op: string) => db.doc(`usageOperations/${hash(`${uid}:${op}`)}`);
type StoredEvent = UsageEvent & { uid: string; receivedAt: number; sortAt: number; source: 'app' | 'server'; registrationState?: string; labelSnapshot: string; labelStatus: string; timeQuality: string; expiresAt: FirebaseFirestore.Timestamp };

/** Counts have explicit sets. Retries are filtered before these increments. */
export function addUsageSummary(previous: Record<string, any>, row: StoredEvent): Record<string, any> {
  const out: Record<string, any> = { ...previous, uid: row.uid, visitId: row.visitId, schemaVersion: 1 };
  const at = row.sortAt;
  out.startedAt = Math.min(previous.startedAt ?? at, at);
  out.lastActivityAt = Math.max(previous.lastActivityAt ?? at, at);
  out.updatedAt = row.receivedAt;
  out.eventCount = (previous.eventCount ?? 0) + 1;
  out.expiresAt = admin.firestore.Timestamp.fromMillis(row.receivedAt + 90 * DAY);
  out.platform = row.platform; out.appVersion = row.appVersion;
  out.partial = previous.partial === true || row.action === 'coverage_gap' || row.registrationState === 'unknown';
  for (const key of ['screens', 'games', 'groups', 'approved', 'waitlisted']) out[key] = [...(previous[key] ?? [])];
  const add = (key: string, value?: string) => {
    if (!value || out[key].includes(value)) return;
    if (out[key].length >= 1000) { out.partial = true; return; }
    out[key].push(value);
  };
  if (row.action === 'screen_view') {
    out.screenEntries = (previous.screenEntries ?? 0) + 1;
    add('screens', usageScreenKey(row)); add('games', row.gameId); add('groups', row.groupId);
  }
  if (row.action === 'registration_result' && row.source === 'server' && row.registrationState === 'created') {
    if (row.result === 'players') add('approved', row.operationId);
    if (row.result === 'waitlist') add('waitlisted', row.operationId);
  }
  out.distinctScreens = out.screens.length; out.distinctGames = out.games.length; out.distinctGroups = out.groups.length;
  out.confirmedRegistrations = out.approved.length; out.waitlistRegistrations = out.waitlisted.length;
  return out;
}

async function labels(db: FirebaseFirestore.Firestore, uid: string, e: UsageEvent): Promise<{ groupId?: string; labelSnapshot: string; labelStatus: string }> {
  let groupId = e.groupId, game: FirebaseFirestore.DocumentData | undefined;
  if (e.gameId) {
    const snapshot = await db.doc(`games/${e.gameId}`).get(); game = snapshot.data();
    if (!game) return { labelSnapshot: '', labelStatus: 'target_unavailable' };
    groupId = typeof game.groupId === 'string' ? game.groupId : undefined;
  }
  const group = groupId ? (await db.doc(`groups/${groupId}`).get()).data() : undefined;
  const member = group && (group.creatorId === uid || (group.playerIds ?? []).includes(uid) || (group.adminIds ?? []).includes(uid));
  const publicGroup = groupId && !member ? (await db.doc(`groupsPublic/${groupId}`).get()).data() : undefined;
  // Use only membership/participation or the public projection as name authority.
  // A client-provided screen event and a public visibility flag alone do not prove private read access.
  const gameTitleAllowed = !!game && (game.createdBy === uid || (game.participantIds ?? []).includes(uid) || member);
  if ((game && !gameTitleAllowed && !publicGroup) || (groupId && !member && !publicGroup && !game)) return { ...(groupId ? { groupId } : {}), labelSnapshot: '', labelStatus: 'access_unavailable' };
  const allowedGroup = member ? group : publicGroup;
  const name = typeof allowedGroup?.name === 'string' ? allowedGroup.name.trim().slice(0, 100) : '';
  const title = gameTitleAllowed && typeof game?.title === 'string' ? game.title.trim().slice(0, 100) : '';
  return { ...(groupId ? { groupId } : {}), labelSnapshot: [title, name].filter(Boolean).join(' / '), labelStatus: title || name ? 'resolved' : 'name_unavailable' };
}

async function storeEvents(uid: string, input: UsageEvent[], server = false, registrationCreated?: boolean): Promise<{ acknowledged: string[]; retryAfterMs?: number }> {
  const db = admin.firestore(), now = Date.now();
  const prepared: StoredEvent[] = await Promise.all(input.map(async e => ({ ...usageWire(e), uid, receivedAt: now,
    sortAt: e.occurredAt > now + 5 * 60_000 || e.occurredAt < now - 30 * DAY ? now : e.occurredAt,
    timeQuality: e.occurredAt > now + 5 * 60_000 || e.occurredAt < now - 30 * DAY ? 'unreliable' : 'device',
    source: server ? 'server' as const : 'app' as const, ...await labels(db, uid, e), expiresAt: admin.firestore.Timestamp.fromMillis(now + 30 * DAY),
    ...(server ? { registrationState: registrationCreated === true ? 'created' : registrationCreated === false ? 'existing' : 'unknown' } : {}),
  })));
  return db.runTransaction(async tx => {
    const refs = prepared.map(e => eventRef(db, uid, e.eventId));
    const sessions = [...new Set(prepared.map(e => e.visitId))];
    const sessionRefs = sessions.map(id => sessionRef(db, uid, id));
    const opIds = [...new Set(prepared.filter(e => e.operationId).map(e => e.operationId!))];
    const opRefs = opIds.map(id => operationRef(db, uid, id));
    const quota = db.doc(`usageActivityLimits/${hash(uid)}`);
    const snaps = await tx.getAll(...refs, ...sessionRefs, ...opRefs, quota, db.doc(`users/${uid}`));
    if (snaps[snaps.length - 1].data()?.deletedAt) {
      if (server) return { acknowledged: prepared.map(e => e.eventId) };
      throw new HttpsError('failed-precondition', 'Account deleted');
    }
    const state = new Map(sessions.map((id, i) => [id, snaps[refs.length + i].data() ?? {}]));
    const ops = new Map(opIds.map((id, i) => [id, snaps[refs.length + sessionRefs.length + i].data() ?? {}]));
    const limit = snaps[snaps.length - 2].data() ?? {};
    const fresh = prepared.filter((_, i) => !snaps[i].exists);
    const used = limit.window === Math.floor(now / 3600000) ? Number(limit.count) || 0 : 0;
    // Duplicates are always acknowledged even when the fresh quota has been consumed.
    if (!server && used + fresh.length > 600) return { acknowledged: prepared.filter((_, i) => snaps[i].exists).map(e => e.eventId), retryAfterMs: 3600000 - now % 3600000 };
    const accepted: string[] = [];
    prepared.forEach((row, i) => {
      if (snaps[i].exists) {
        const previous = snaps[i].data();
        if (server && previous?.source === 'app' && row.action === 'registration_result') {
          // A delayed business receipt can resolve an earlier client failure. The attempt remains.
          tx.set(refs[i], row);
          const summary = addUsageSummary(state.get(row.visitId)!, row);
          summary.eventCount = Math.max(1, summary.eventCount - 1);
          state.set(row.visitId, summary);
        }
        accepted.push(row.eventId); return;
      }
      const op = row.operationId ? ops.get(row.operationId)! : undefined;
      if (row.action === 'registration_result' && op?.attempt
        && row.eventId !== `${op.attempt.visitId}-${op.attempt.resultSequence}`) { accepted.push(row.eventId); return; }
      // Positive outcomes come only from the business receipt. A queued client outcome waits.
      if (row.action === 'registration_result' && !server && row.result !== 'failed') {
        if (op?.result) { /* materialized independently by the authoritative receipt */ }
        accepted.push(row.eventId); return;
      }
      // A result already linked to this operation cannot be counted again in another visit.
      if (row.action === 'registration_result' && op?.resultEventId && op.resultEventId !== row.eventId) { accepted.push(row.eventId); return; }
      if (row.action === 'registration_attempt' && op) {
        if (!op.attempt) op.attempt = usageWire(row);
        ops.set(row.operationId!, op);
      }
      if (row.action === 'registration_result' && op) { op.resultEventId = row.eventId; ops.set(row.operationId!, op); }
      tx.create(refs[i], row);
      state.set(row.visitId, addUsageSummary(state.get(row.visitId)!, row)); accepted.push(row.eventId);
    });
    for (const [id, summary] of state) if (summary.uid) tx.set(sessionRef(db, uid, id), summary);
    for (const [id, op] of ops) tx.set(operationRef(db, uid, id), { ...op, uid, expiresAt: admin.firestore.Timestamp.fromMillis(now + 30 * DAY) });
    if (!server) tx.set(quota, { uid, window: Math.floor(now / 3600000), count: used + fresh.length, expiresAt: admin.firestore.Timestamp.fromMillis(now + DAY) });
    return { acknowledged: accepted };
  });
}

/** Auth comes from the callable token; expectedUid is only a race guard. No push is sent. */
export const recordUsageActivity = onCall({ maxInstances: 5 }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required');
  if (request.data?.expectedUid !== request.auth.uid) throw new HttpsError('failed-precondition', 'Activity owner changed');
  if (!enabled(request.auth.uid)) return { acknowledged: [], retryAfterMs: 3600000, collectionEnabled: false };
  const values: unknown = request.data?.events;
  if (!Array.isArray(values) || values.length < 1 || values.length > 20) throw new HttpsError('invalid-argument', 'Expected 1-20 usage events');
  const events: UsageEvent[] = [], rejected: string[] = [];
  for (const value of values) {
    if (!validUsageEvent(value)) { if (value && typeof value.eventId === 'string' && value.eventId.length <= 100) rejected.push(value.eventId); continue; }
    if (value.action === 'product_action' && (!request.auth.token?.firebase?.sign_in_provider || request.auth.token.firebase.sign_in_provider === 'anonymous')) {
      rejected.push(value.eventId); continue;
    }
    if (!events.some(e => e.eventId === value.eventId)) events.push(usageWire(value));
  }
  const reply = events.length ? await storeEvents(request.auth.uid, events) : { acknowledged: [] };
  if (events.length) {
    const db = admin.firestore(), uid = request.auth.uid;
    await db.runTransaction(async tx => {
      if ((await tx.get(db.doc(`users/${uid}`))).data()?.deletedAt) return;
      tx.set(db.doc(`usageCoverage/${uid}`), { uid, enabled: true, lastReceivedAt: Date.now(), appVersion: events[0].appVersion, expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 90 * DAY) }, { merge: true });
    });
  }
  return { ...reply, rejected, collectionEnabled: true };
});

/** Receipt and attempt may arrive in either order. The operation id binds them explicitly. */
export const materializeUsageOperation = onDocumentWritten({ document: 'usageOperations/{operation}', retry: true, maxInstances: 3 }, async event => {
  const op = event.data?.after.data();
  if (!op?.uid || !enabled(op.uid)) return;
  if (!op?.attempt || !op.result || op.materialized === true) return;
  const attempt = op.attempt as UsageEvent;
  if (!validUsageEvent(attempt) || attempt.gameId !== op.gameId || !['players', 'waitlist', 'pending', 'failed'].includes(op.result)) return;
  const result: UsageEvent = { ...attempt, action: 'registration_result', sequence: attempt.resultSequence!, eventId: `${attempt.visitId}-${attempt.resultSequence}`, result: op.result, occurredAt: op.resultAt };
  delete result.resultSequence;
  await storeEvents(op.uid, [result], true, typeof op.registrationCreated === 'boolean' ? op.registrationCreated : undefined);
  const db = admin.firestore(), ref = event.data!.after.ref;
  await db.runTransaction(async tx => {
    const [current, actor] = await tx.getAll(ref, db.doc(`users/${op.uid}`));
    if (current.exists && !actor.data()?.deletedAt) tx.set(ref, { materialized: true }, { merge: true });
  });
});

/** Business snapshots, never a client claim. The original tap survives request cleanup. */
export const onUsageJoinReceipt = onDocumentWritten({ document: 'games/{gameId}/joinRequests/{uid}', retry: true, maxInstances: 3 }, async event => {
  if (!enabled(event.params.uid)) return;
  const row = event.data?.after.data();
  if (!row || !['assigned', 'rejected'].includes(row.state) || !Number.isFinite(row.tappedAt)) return;
  const uid = event.params.uid, operationId = joinDiagnosticId(event.params.gameId, uid, row.tappedAt);
  const result = row.state === 'rejected' ? 'failed' : row.bucket;
  if (!['players', 'waitlist', 'pending', 'failed'].includes(result)) return;
  const db = admin.firestore();
  await db.runTransaction(async tx => {
    if ((await tx.get(db.doc(`users/${uid}`))).data()?.deletedAt) return;
    tx.set(operationRef(db, uid, operationId), { uid, operationId, gameId: event.params.gameId, result, registrationCreated: typeof row.registrationCreated === 'boolean' ? row.registrationCreated : null, resultAt: Number(row.assignedAt) || Date.now(), expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * DAY) }, { merge: true });
  });
});

export async function deleteUsageForUser(db: FirebaseFirestore.Firestore, uid: string): Promise<void> {
  // Repeat bounded batches; a failed batch propagates and account deletion stays retryable.
  for (const collection of ['usageActivity', 'usageSessions', 'usageOperations', 'usageActivityLimits', 'usageCoverage']) {
    for (;;) {
      const page = await db.collection(collection).where('uid', '==', uid).limit(400).get();
      if (page.empty) break;
      const batch = db.batch(); page.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
    }
  }
}

/** Explicit cleanup, so retention does not depend on an unconfigured TTL policy. */
export const cleanupUsageActivity = onSchedule({ schedule: 'every 24 hours', timeZone: 'Asia/Jerusalem', maxInstances: 1 }, async () => {
  const db = admin.firestore();
  for (const collection of ['usageActivity', 'usageSessions', 'usageOperations', 'usageActivityLimits', 'usageCoverage']) {
    for (let page = 0; page < 25; page++) {
      const rows = await db.collection(collection).where('expiresAt', '<=', admin.firestore.Timestamp.now()).limit(400).get();
      if (rows.empty) break;
      const batch = db.batch(); rows.docs.forEach(d => batch.delete(d.ref)); await batch.commit();
    }
  }
});
