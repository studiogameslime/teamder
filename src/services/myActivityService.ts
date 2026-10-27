import { SPORTS_ACTIVITY_ENABLED, assertSportsActivityEnabled, SportsActivityDisabledError } from '@/config/sportsActivity';
import { NativeModules, Platform } from 'react-native';
import { httpsCallable } from '@/services/diagnosticCallable';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { StaleSessionError, isStaleSession } from './staleSession';
import { observeCaughtError } from '../utils/errorObservation';
import { activityMovement, type ActivityMovement } from '../utils/activityMovement';

export type MyActivityKind = 'wear-health-services' | 'health-connect';
export type MyActivityRecordType = 'distance' | 'steps' | 'active-calories' | 'total-calories' | 'heart-rate' | 'activity' | 'speed' | 'speed-max' | 'speed-avg' | 'stationary-ms' | 'walking-ms' | 'running-ms' | 'sprint-ms' | 'sprints' | 'sampled-ms';
export interface MyActivitySourceInput { kind: MyActivityKind; sourceId: string; readerInstallationId: string }
export interface MyActivityBinding extends MyActivitySourceInput { connectionId: string; generation: number }
export interface MyActivitySource extends MyActivityBinding { connectedAt: number }
export interface MyActivityRecord {
  id: string; recordType: MyActivityRecordType; modifiedAtMs: number;
  startAtMs?: number; endAtMs?: number; value?: number | null; activityType?: string; deleted?: boolean;
  clockUncertaintyMs?: number;
}
export interface MyActivityRange { from: number; to: number }
export interface MyActivitySummary {
  movement: ActivityMovement;
  distanceM: number | null; steps: number | null; activeCalories: number | null; totalCalories: number | null;
  avgHeartRateBpm: number | null; maxHeartRateBpm: number | null; heartRateSamples: number;
  activityMs: number | null; excludedBoundaryRecords: number; conflictingMetrics: MyActivityRecordType[];
  activityBoundaryUncertain: boolean;
  coverageMs: { distanceM: number; steps: number; activeCalories: number; totalCalories: number };
}
export interface MyActivityState {
  generation: number; source: MyActivitySource | null; dataRevision: number;
  records: MyActivityRecord[]; summary: MyActivitySummary | null;
}
export interface MyActivitySaveResponse { status: 'saved' | 'duplicate' | 'stale'; reason?: string; dataRevision?: number }
interface Cursor { generation: number; dataRevision: number; endAtMs: number; id: string }
interface Page { generation: number; source: MyActivitySource | null; dataRevision: number; records: MyActivityRecord[]; cursor: Cursor | null }
interface StandaloneChunk {
  mode: 'standalone'; userId: string; source: 'wear-health-services'; deviceId: string;
  connectionId: string; sourceGeneration: number; readerInstallationId: string;
  sessionId: string; revision: number; startedAtMs: number; endedAtMs?: number; offsetMs: number; clockUncertaintyMs: number;
  samples: Array<{ id: string; startAtMs: number; endAtMs: number; distanceM?: number; steps?: number; calories?: number; heartRateBpm?: number; speedMps?: number }>;
}
interface Bridge {
  getPendingStandaloneActivity?(): Promise<StandaloneChunk[]>;
  ackStandaloneActivity?(sessionId: string, revision: number): Promise<boolean>;
  publishActivitySource?(json: string): Promise<unknown>;
}
const native = (): Bridge | undefined => Platform.OS === 'android' ? NativeModules.WatchBridge : undefined;
const inFlight = new Map<string, Promise<{ uploaded: number; pending: number }>>();
function assertSession(uid: string): void {
  const user = useUserStore.getState().currentUser, auth = getFirebase().auth.currentUser;
  if (!uid || user?.id !== uid || auth?.uid !== uid || user.isGuest || auth.isAnonymous) throw new StaleSessionError(uid, auth?.uid ?? '');
}
/** Health payloads and remote/native exception text never enter diagnostics. */
async function privateOperation<T>(uid: string, operation: () => Promise<T>): Promise<T> {
  assertSportsActivityEnabled();
  assertSession(uid);
  try {
    const response = await operation();
    assertSession(uid);
    return response;
  } catch (error) {
    assertSession(uid);
    if (isStaleSession(error)) throw error;
    const code = (error as { code?: unknown })?.code;
    const safe = Object.assign(new Error('Activity request failed'), { code: typeof code === 'string' && /^[a-z/-]{1,60}$/.test(code) ? code : 'activity-request-failed' });
    observeCaughtError(safe, { source: 'src/services/myActivityService.ts', handler: 'privateOperation', site: 'myActivity:request' });
    throw safe;
  }
}
async function call<T>(uid: string, name: string, input: object): Promise<T> {
  return privateOperation(uid, async () => (await httpsCallable<object, T>(getFirebase().functions, name, { timeout: 20000 })({ ...input, expectedUid: uid })).data);
}
function rangeValid(range: MyActivityRange): boolean {
  return Number.isFinite(range.from) && Number.isFinite(range.to) && range.from >= 0 && range.to > range.from && range.to - range.from <= 31 * 86400000;
}
function unionMs(rows: Array<{ from: number; to: number }>): number {
  const sorted = [...rows].sort((a, b) => a.from - b.from); let end = -1, total = 0;
  for (const r of sorted) { total += Math.max(0, r.to - Math.max(end, r.from)); end = Math.max(end, r.to); }
  return total;
}
/** Whole intervals only. HC aggregates are authoritative snapshots, never prorated.
 * HR mean is an arithmetic sample mean. Overlapping scalar intervals fail closed. */
export function summarizeMyActivity(records: MyActivityRecord[], range: MyActivityRange): MyActivitySummary {
  const result: MyActivitySummary = { movement: activityMovement([]), distanceM: null, steps: null, activeCalories: null, totalCalories: null,
    avgHeartRateBpm: null, maxHeartRateBpm: null, heartRateSamples: 0, activityMs: null,
    excludedBoundaryRecords: 0, activityBoundaryUncertain: false, conflictingMetrics: [], coverageMs: { distanceM: 0, steps: 0, activeCalories: 0, totalCalories: 0 } };
  const accepted = records.filter(r => {
    const uncertainty = r.clockUncertaintyMs ?? 0;
    if (r.deleted || r.startAtMs === undefined || r.endAtMs === undefined || r.endAtMs + uncertainty < range.from || r.startAtMs - uncertainty >= range.to) return false;
    const boundary = r.startAtMs - uncertainty < range.from || r.endAtMs + uncertainty > range.to;
    if (r.recordType === 'activity' && uncertainty > 0 && boundary) {
      result.activityBoundaryUncertain = true; result.excludedBoundaryRecords++; return false;
    }
    if (r.recordType !== 'activity' && boundary) { result.excludedBoundaryRecords++; return false; }
    return true;
  });
  const fields = { distance: 'distanceM', steps: 'steps', 'active-calories': 'activeCalories', 'total-calories': 'totalCalories' } as const;
  for (const [type, field] of Object.entries(fields) as Array<[keyof typeof fields, typeof fields[keyof typeof fields]]>) {
    const rows = accepted.filter(r => r.recordType === type && r.value != null).sort((a, b) => a.startAtMs! - b.startAtMs!);
    let end = -1;
    if (rows.some(r => { const conflict = r.startAtMs! < end; end = Math.max(end, r.endAtMs!); return conflict; })) {
      result.conflictingMetrics.push(type); continue;
    }
    if (rows.length) result[field] = rows.reduce((sum, r) => sum + r.value!, 0);
    result.coverageMs[field] = unionMs(rows.map(r => ({ from: r.startAtMs!, to: r.endAtMs! })));
  }
  const hr = accepted.filter(r => r.recordType === 'heart-rate' && r.value != null);
  result.heartRateSamples = hr.length;
  if (hr.length) { result.avgHeartRateBpm = hr.reduce((s, r) => s + r.value!, 0) / hr.length; result.maxHeartRateBpm = hr.reduce((max, r) => Math.max(max, r.value!), 0); }
  const activity = accepted.filter(r => r.recordType === 'activity');
  if (activity.length && !result.activityBoundaryUncertain) result.activityMs = unionMs(activity.map(r => ({ from: Math.max(range.from, r.startAtMs!), to: Math.min(range.to, r.endAtMs!) })));
  result.movement = activityMovement(accepted.filter(r => r.recordType === 'speed' && r.value != null)
    .map(r => ({ at: r.endAtMs!, mps: r.value!, series: r.id.split(':')[0] })));
  const fieldsMovement = { 'speed-max': 'maxSpeedKmh', 'speed-avg': 'avgSpeedKmh', 'stationary-ms': 'stationaryMs',
    'walking-ms': 'walkingMs', 'running-ms': 'runningMs', 'sprint-ms': 'sprintMs', sprints: 'sprints', 'sampled-ms': 'sampledMs' } as const;
  for (const [type, field] of Object.entries(fieldsMovement) as Array<[keyof typeof fieldsMovement, typeof fieldsMovement[keyof typeof fieldsMovement]]>) {
    const rows = accepted.filter(r => r.recordType === type && r.value != null);
    // One authoritative daily snapshot. Multiple snapshots cannot be averaged or added blindly.
    if (rows.length === 1) result.movement[field] = rows[0].value!;
    else if (rows.length > 1) { result.movement[field] = null; result.conflictingMetrics.push(type); }
  }
  return result;
}
export async function getMyActivityState(uid: string, range?: MyActivityRange): Promise<MyActivityState> {
  assertSportsActivityEnabled();
  if (range && !rangeValid(range)) throw new Error('Invalid activity range');
  if (USE_MOCK_DATA) return { generation: 0, source: null, dataRevision: 0, records: [], summary: null };
  const all: MyActivityRecord[] = []; let cursor: Cursor | undefined, first: Page | undefined;
  for (let n = 0; n < 500; n++) {
    const page = await call<Page>(uid, 'getMyActivityState', { ...(range ? { range } : {}), ...(cursor ? { cursor } : {}) });
    if (!Number.isSafeInteger(page.generation) || !Number.isSafeInteger(page.dataRevision) || !Array.isArray(page.records) ||
      first && (first.generation !== page.generation || first.dataRevision !== page.dataRevision)) throw new Error('Activity page changed');
    first ??= page; all.push(...page.records);
    if (!page.cursor) return { generation: page.generation, source: page.source, dataRevision: page.dataRevision,
      records: all, summary: range && page.source ? summarizeMyActivity(all, range) : null };
    if (JSON.stringify(cursor) === JSON.stringify(page.cursor)) throw new Error('Activity pagination did not advance');
    cursor = page.cursor;
  }
  throw new Error('Activity range exceeds read limit');
}
export async function setMyActivitySource(uid: string, expectedGeneration: number, source: MyActivitySourceInput | null): Promise<MyActivityState> {
  assertSportsActivityEnabled();
  if (USE_MOCK_DATA) throw new Error('Activity source unavailable in mock mode');
  const response = await call<Page>(uid, 'setMyActivitySource', { expectedGeneration, source });
  const bridge = native();
  if (bridge?.publishActivitySource) await privateOperation(uid, () => bridge.publishActivitySource!(JSON.stringify({ expectedUid: uid, ...response })));
  return { ...response, records: [], summary: null };
}
export async function saveMyActivityRecords(uid: string, binding: MyActivityBinding, batchId: string, records: MyActivityRecord[]): Promise<MyActivitySaveResponse> {
  if (USE_MOCK_DATA) throw new Error('Activity upload unavailable in mock mode');
  const { connectionId, generation, kind, sourceId, readerInstallationId } = binding;
  return call(uid, 'saveMyActivityRecords', { binding: { connectionId, generation, kind, sourceId, readerInstallationId }, batchId, records });
}
function chunkRecords(chunk: StandaloneChunk): MyActivityRecord[] {
  const modified = Math.round((chunk.endedAtMs ?? Math.max(...chunk.samples.map(s => s.endAtMs))) + chunk.offsetMs);
  const fields = { distanceM: 'distance', steps: 'steps', calories: 'total-calories', heartRateBpm: 'heart-rate', speedMps: 'speed' } as const;
  const records: MyActivityRecord[] = chunk.samples.flatMap(sample => Object.entries(fields).flatMap(([key, recordType]) => {
    const value = sample[key as keyof typeof fields];
    if (value == null) return [];
    return [{ id: `${chunk.sessionId}:${sample.id}:${key}`, recordType, modifiedAtMs: modified,
      startAtMs: Math.round((recordType === 'heart-rate' || recordType === 'speed' ? sample.endAtMs : sample.startAtMs) + chunk.offsetMs),
      endAtMs: Math.round(sample.endAtMs + chunk.offsetMs), value, clockUncertaintyMs: chunk.clockUncertaintyMs }];
  }));
  if (modified > Math.round(chunk.startedAtMs + chunk.offsetMs)) records.push({ id: `${chunk.sessionId}:activity`, recordType: 'activity', modifiedAtMs: modified,
    startAtMs: Math.round(chunk.startedAtMs + chunk.offsetMs), endAtMs: modified, activityType: 'football', clockUncertaintyMs: chunk.clockUncertaintyMs });
  return records;
}
async function flush(uid: string): Promise<{ uploaded: number; pending: number }> {
  assertSession(uid);
  const bridge = native();
  if (USE_MOCK_DATA || !bridge?.getPendingStandaloneActivity || !bridge.ackStandaloneActivity) return { uploaded: 0, pending: 0 };
  const pending = await privateOperation(uid, () => bridge.getPendingStandaloneActivity!());
  if (!Array.isArray(pending)) throw new Error('Invalid activity queue');
  const own = pending.filter(c => c.userId === uid).sort((a, b) => a.sessionId.localeCompare(b.sessionId) || a.revision - b.revision), state = await getMyActivityState(uid);
  const result = { uploaded: 0, pending: own.length };
  for (const chunk of own) {
    const source = state.source;
    if (!source || chunk.mode !== 'standalone' || chunk.source !== source.kind || chunk.deviceId !== source.sourceId ||
      chunk.connectionId !== source.connectionId || chunk.sourceGeneration !== source.generation || chunk.readerInstallationId !== source.readerInstallationId) continue;
    if (!Array.isArray(chunk.samples) || chunk.samples.length < 1 || chunk.samples.length > 200 || !Number.isFinite(chunk.offsetMs) ||
      !Number.isFinite(chunk.clockUncertaintyMs) || chunk.clockUncertaintyMs < 0 || chunk.clockUncertaintyMs > 60000) continue;
    const records = chunkRecords(chunk); let accepted = records.length > 0;
    for (let i = 0; i < records.length; i += 300) {
      const response = await saveMyActivityRecords(uid, source, `${chunk.sessionId}:${chunk.revision}:${i / 300}`, records.slice(i, i + 300));
      if (response.status !== 'saved' && response.status !== 'duplicate') { accepted = false; break; }
    }
    assertSession(uid);
    if (accepted) { const ack = await privateOperation(uid, () => bridge.ackStandaloneActivity!(chunk.sessionId, chunk.revision));
      if (ack === true) { result.uploaded++; result.pending--; } }
  }
  return result;
}
export function flushMyActivity(uid: string): Promise<{ uploaded: number; pending: number }> {
  if (!SPORTS_ACTIVITY_ENABLED) return Promise.reject(new SportsActivityDisabledError());
  const running = inFlight.get(uid); if (running) return running;
  const promise = flush(uid).finally(() => { if (inFlight.get(uid) === promise) inFlight.delete(uid); });
  inFlight.set(uid, promise); return promise;
}
