import { createHash, randomUUID } from 'node:crypto';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { onCall, onDocumentUpdated, type CallableRequest } from './observedFunctions';
import { ENFORCE_APP_CHECK } from './appCheckPolicy';
import { ExpectedCallableError as HttpsError } from './expectedCallableError';

export type MyActivityKind = 'wear-health-services' | 'health-connect';
export type MyActivityRecordType = 'distance' | 'steps' | 'active-calories' | 'total-calories' | 'heart-rate' | 'activity' | 'speed' | 'speed-max' | 'speed-avg' | 'stationary-ms' | 'walking-ms' | 'running-ms' | 'sprint-ms' | 'sprints' | 'sampled-ms';
export interface MyActivitySourceInput { kind: MyActivityKind; sourceId: string; readerInstallationId: string }
export interface MyActivitySource extends MyActivitySourceInput { connectionId: string; generation: number; connectedAt: number }
export interface MyActivityRecord {
  id: string; recordType: MyActivityRecordType; modifiedAtMs: number;
  startAtMs?: number; endAtMs?: number; value?: number | null; activityType?: string; deleted?: boolean;
  clockUncertaintyMs?: number;
}
type Data = Record<string, any>;
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const invalid = (): never => { throw new HttpsError('invalid-argument', 'Invalid activity request'); };
function text(v: unknown, max = 160): string {
  return typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f]/.test(v) ? v : invalid();
}
function integer(v: unknown): number { return Number.isSafeInteger(v) && (v as number) >= 0 ? v as number : invalid(); }
function owner(r: CallableRequest): string {
  if (!r.auth?.uid || r.auth.token.firebase?.sign_in_provider === 'anonymous') throw new HttpsError('unauthenticated', 'Full account required');
  if (r.data?.expectedUid !== r.auth.uid) throw new HttpsError('failed-precondition', 'Account changed');
  return r.auth.uid;
}
function active(profile: { exists: boolean; data(): Data | undefined }): void {
  if (!profile.exists || !profile.data() || profile.data()?.deletedAt != null) throw new HttpsError('failed-precondition', 'Account unavailable');
  if (profile.data()?.isGuest === true) throw new HttpsError('permission-denied', 'Full account required');
}
function sourceInput(v: any): MyActivitySourceInput {
  if (v?.kind !== 'wear-health-services' && v?.kind !== 'health-connect') return invalid();
  return { kind: v.kind, sourceId: text(v.sourceId), readerInstallationId: text(v.readerInstallationId) };
}
function recordInput(v: any, now: number): MyActivityRecord {
  const types: MyActivityRecordType[] = ['distance', 'steps', 'active-calories', 'total-calories', 'heart-rate', 'activity', 'speed', 'speed-max', 'speed-avg', 'stationary-ms', 'walking-ms', 'running-ms', 'sprint-ms', 'sprints', 'sampled-ms'];
  if (!v || !types.includes(v.recordType)) return invalid();
  const result: MyActivityRecord = { id: text(v.id, 300), recordType: v.recordType, modifiedAtMs: integer(v.modifiedAtMs) };
  if (result.modifiedAtMs > now + 300000) return invalid();
  if (v.clockUncertaintyMs !== undefined) {
    if (!finite(v.clockUncertaintyMs) || v.clockUncertaintyMs < 0 || v.clockUncertaintyMs > 60000) return invalid();
    result.clockUncertaintyMs = v.clockUncertaintyMs;
  }
  if (v.deleted === true) return { ...result, deleted: true };
  result.startAtMs = integer(v.startAtMs); result.endAtMs = integer(v.endAtMs);
  if (result.endAtMs < result.startAtMs || result.endAtMs > now + 300000 || result.endAtMs - result.startAtMs > 32 * 86400000) return invalid();
  if (v.recordType === 'heart-rate' || v.recordType === 'speed' ? result.startAtMs !== result.endAtMs : result.startAtMs === result.endAtMs) return invalid();
  if (v.recordType === 'activity') {
    result.activityType = text(v.activityType ?? 'unknown', 80);
  } else {
    if (v.value !== null && (!finite(v.value) || v.value < 0 || v.value > 100000000 || v.recordType === 'heart-rate' && (v.value < 25 || v.value > 240) || v.recordType === 'steps' && !Number.isSafeInteger(v.value))) return invalid();
    result.value = v.value;
    if (v.value !== null && (v.recordType === 'speed' && v.value > 12 ||
      ['speed-max', 'speed-avg'].includes(v.recordType) && v.value > 43.2 ||
      ['stationary-ms', 'walking-ms', 'running-ms', 'sprint-ms', 'sampled-ms'].includes(v.recordType) && (!Number.isSafeInteger(v.value) || v.value > result.endAtMs - result.startAtMs) ||
      v.recordType === 'sprints' && !Number.isSafeInteger(v.value))) return invalid();
  }
  return result;
}
const options = { enforceAppCheck: ENFORCE_APP_CHECK };
const rootFor = (uid: string) => getFirestore().collection('myActivityPrivate').doc(hash(uid));
const bindingMatches = (a: MyActivitySource | null, b: any) => !!a && !!b &&
  ['connectionId', 'generation', 'kind', 'sourceId', 'readerInstallationId'].every(k => (a as any)[k] === b[k]);

/** Independent of games and eligibility. Exporting locally does not deploy these functions. */
export const setMyActivitySource = onCall(options, async request => {
  const uid = owner(request), expected = integer(request.data?.expectedGeneration);
  const input = request.data?.source === null ? null : sourceInput(request.data?.source);
  const db = getFirestore(), ref = rootFor(uid), connectionId = randomUUID();
  return db.runTransaction(async tx => {
    active(await tx.get(db.doc(`users/${uid}`)));
    const old = (await tx.get(ref)).data() ?? {}, generation = old.generation ?? 0;
    if (generation !== expected) throw new HttpsError('failed-precondition', 'Source changed');
    const previous: MyActivitySource | null = old.source ?? null;
    if (input === null && previous === null || input && previous &&
      ['kind', 'sourceId', 'readerInstallationId'].every(k => (input as any)[k] === (previous as any)[k])) {
      return { generation, source: previous, dataRevision: old.dataRevision ?? 0 };
    }
    if (generation >= 1000000) throw new HttpsError('resource-exhausted', 'Source limit reached');
    const now = Date.now(), source: MyActivitySource | null = input ? { ...input, connectionId, generation: generation + 1, connectedAt: now } : null;
    tx.set(ref, { userId: uid, generation: generation + 1, source, dataRevision: 0, updatedAt: now });
    if (previous) tx.set(ref.collection('connections').doc(previous.connectionId), { ...previous, closedAt: now }, { merge: true });
    if (source) tx.set(ref.collection('connections').doc(connectionId), { ...source, batchCount: 0 });
    return { generation: generation + 1, source, dataRevision: 0 };
  });
});

export const saveMyActivityRecords = onCall(options, async request => {
  const uid = owner(request), binding = request.data?.binding, batchId = text(request.data?.batchId, 200);
  sourceInput(binding); text(binding.connectionId); integer(binding.generation);
  if (!Array.isArray(request.data?.records) || request.data.records.length < 1 || request.data.records.length > 300) return invalid();
  const rows: MyActivityRecord[] = request.data.records.map((v: any) => recordInput(v, Date.now()));
  const keys = rows.map(r => hash(`${r.recordType}:${r.id}`));
  if (new Set(keys).size !== keys.length) return invalid();
  const digest = hash(JSON.stringify(rows)), db = getFirestore(), ref = rootFor(uid);
  return db.runTransaction(async tx => {
    active(await tx.get(db.doc(`users/${uid}`)));
    const state = (await tx.get(ref)).data();
    if (!bindingMatches(state?.source ?? null, binding)) return { status: 'stale', reason: 'source-changed' };
    const connection = ref.collection('connections').doc(binding.connectionId);
    const receipt = connection.collection('batches').doc(hash(batchId));
    const prior = await tx.get(receipt);
    if (prior.exists) {
      if (prior.data()?.digest !== digest) throw new HttpsError('already-exists', 'Batch content changed');
      return { status: 'duplicate', dataRevision: state!.dataRevision };
    }
    const connectionData = (await tx.get(connection)).data();
    if ((connectionData?.batchCount ?? 0) >= 50000) throw new HttpsError('resource-exhausted', 'Connection batch limit reached');
    const refs = keys.map(k => connection.collection('records').doc(k));
    const previous = await Promise.all(refs.map(r => tx.get(r)));
    for (let i = 0; i < rows.length; i++) {
      const old = previous[i].data(), row = rows[i];
      if (old && row.modifiedAtMs < old.modifiedAtMs) continue;
      if (old && row.modifiedAtMs === old.modifiedAtMs) {
        if (JSON.stringify(old.record) !== JSON.stringify(row)) throw new HttpsError('already-exists', 'Record version content changed');
        continue;
      }
      tx.set(refs[i], { record: row, modifiedAtMs: row.modifiedAtMs,
        // Tombstones retain their previous position for exact replacement/deletion.
        endAtMs: row.endAtMs ?? old?.endAtMs ?? 0 });
    }
    const dataRevision = (state!.dataRevision ?? 0) + 1;
    tx.set(receipt, { digest, createdAt: Date.now() });
    tx.set(connection, { ...connectionData, batchCount: (connectionData?.batchCount ?? 0) + 1 });
    tx.set(ref, { ...state, dataRevision, updatedAt: Date.now() });
    return { status: 'saved', dataRevision };
  });
});

export const getMyActivityState = onCall(options, async request => {
  const uid = owner(request), range = request.data?.range, cursor = request.data?.cursor;
  if (range && (!finite(range.from) || !finite(range.to) || range.from < 0 || range.to <= range.from || range.to - range.from > 31 * 86400000)) return invalid();
  if (cursor && (!range || !finite(cursor.endAtMs) || typeof cursor.id !== 'string' || !/^[a-f0-9]{64}$/.test(cursor.id) || !Number.isSafeInteger(cursor.dataRevision) || !Number.isSafeInteger(cursor.generation))) return invalid();
  const db = getFirestore(), ref = rootFor(uid);
  return db.runTransaction(async tx => {
    active(await tx.get(db.doc(`users/${uid}`)));
    const state = (await tx.get(ref)).data() ?? { generation: 0, source: null, dataRevision: 0 };
    const header = { generation: state.generation, source: state.source, dataRevision: state.dataRevision };
    if (cursor && (cursor.generation !== state.generation || cursor.dataRevision !== state.dataRevision)) throw new HttpsError('failed-precondition', 'Activity changed during read');
    if (!range || !state.source) return { ...header, records: [], cursor: null };
    let query = ref.collection('connections').doc(state.source.connectionId).collection('records')
      .where('endAtMs', '>=', Math.max(0, range.from - 60000)).where('endAtMs', '<=', range.to + 32 * 86400000)
      .orderBy('endAtMs').orderBy(FieldPath.documentId()).limit(501);
    if (cursor) query = query.startAfter(cursor.endAtMs, cursor.id);
    const page = await tx.get(query), docs = page.docs.slice(0, 500), last = docs[docs.length - 1];
    return { ...header, records: docs.map(d => d.data().record), cursor: page.size > 500 ? {
      generation: state.generation, dataRevision: state.dataRevision, endAtMs: last.data().endAtMs, id: last.id } : null };
  });
});

export const onMyActivityOwnerDeleted = onDocumentUpdated({ document: 'users/{uid}', retry: true }, async event => {
  if (event.data?.after.data()?.deletedAt == null) return;
  const db = getFirestore(), roots = await db.collection('myActivityPrivate').where('userId', '==', event.params.uid).get();
  for (const root of roots.docs) {
    await db.recursiveDelete(root.ref.collection('connections'));
    await root.ref.delete();
  }
});
