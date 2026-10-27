import { SPORTS_ACTIVITY_ENABLED, SportsActivityDisabledError } from '@/config/sportsActivity';
import { useEffect } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';
import { httpsCallable } from '@/services/diagnosticCallable';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { useUserStore } from '@/store/userStore';
import { StaleSessionError, isStaleSession } from '@/services/staleSession';
import { observeCaughtError } from '../utils/errorObservation';

export interface PersonalActivitySample {
  id: string; startAtMs: number; endAtMs: number;
  distanceM?: number; steps?: number; calories?: number; heartRateBpm?: number;
}
export interface PersonalActivityChunk {
  userId: string; gameId: string; sessionId: string; revision: number;
  source: 'wear-health-services'; offsetMs: number; clockUncertaintyMs: number;
  samples: PersonalActivitySample[];
}
export interface PersonalActivitySummary {
  version: 1; gameId: string; source: 'wear-health-services';
  eligibleMs: number; measuredMs: number; coverageRatio: number | null;
  coverageMs: { distanceM: number; steps: number; calories: number };
  distanceM: number | null; steps: number | null; calories: number | null;
  /** Arithmetic mean of accepted samples; not a time-weighted average. */
  avgHeartRateBpm: number | null; maxHeartRateBpm: number | null; heartRateSamples: number;
  acceptedSamples: number; excludedBoundarySamples: number; knownFrom: number | null; updatedAt: number;
}
export interface PersonalActivityResponse {
  status: 'available' | 'unavailable' | 'processing'; summary: PersonalActivitySummary | null; reason?: string;
}
export interface PersonalActivityFlush { uploaded: number; pending: number; processing: number }
interface ActivityBridge {
  getPendingActivity?: () => Promise<PersonalActivityChunk[]>;
  ackActivity?: (sessionId: string, revision: number) => Promise<boolean>;
}
type UploadResponse = { status: 'saved' | 'duplicate' | 'stale' | 'processing'; retryable: boolean; expectedRevision?: number; reason?: string };
const idValid = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const inFlight = new Map<string, Promise<PersonalActivityFlush>>();
const observedPrivateErrors = new WeakSet<object>();
function bridge(): ActivityBridge | undefined {
  return Platform.OS === 'android' ? NativeModules.WatchBridge as ActivityBridge | undefined : undefined;
}
function assertSession(uid: string): void {
  const current = useUserStore.getState().currentUser;
  const authenticated = getFirebase().auth.currentUser;
  if (!uid || current?.id !== uid || authenticated?.uid !== uid || current.isGuest || authenticated.isAnonymous) {
    throw new StaleSessionError(uid, authenticated?.uid ?? '');
  }
}
/** Never carry native/remote error text or sensor payloads into diagnostics. */
function privateError(error: unknown): Error {
  if (isStaleSession(error)) return error as Error;
  const code = (error as { code?: unknown })?.code;
  const safeCode = typeof code === 'string' && /^[A-Za-z][A-Za-z/_-]{0,59}$/.test(code) ? code : 'activity-sync-failed';
  return Object.assign(new Error('Personal activity synchronization failed'), { code: safeCode });
}
const emptyFlush = (): PersonalActivityFlush => ({ uploaded: 0, pending: 0, processing: 0 });
function validChunk(value: unknown): value is PersonalActivityChunk {
  const row = value as PersonalActivityChunk | undefined;
  return !!row && typeof row === 'object' && typeof row.userId === 'string' && idValid(row.gameId) &&
    idValid(row.sessionId) && Number.isSafeInteger(row.revision) && row.revision > 0 && row.source === 'wear-health-services' &&
    Number.isFinite(row.offsetMs) && Number.isFinite(row.clockUncertaintyMs) && row.clockUncertaintyMs >= 0 &&
    Array.isArray(row.samples) && row.samples.length > 0 && row.samples.length <= 300;
}

async function flush(uid: string): Promise<PersonalActivityFlush> {
  assertSession(uid);
  const native = bridge();
  if (!native?.getPendingActivity || !native.ackActivity) return emptyFlush();
  const pending = await native.getPendingActivity();
  assertSession(uid);
  if (!Array.isArray(pending)) throw privateError(undefined);
  const own = pending.filter(row => row?.userId === uid);
  const result = { uploaded: 0, pending: own.length, processing: 0 };
  const blocked = new Set<string>();
  // Native ordering is not a delivery guarantee. Sequence each session before ACK.
  const sorted = [...own].sort((a, b) => `${a.gameId}:${a.sessionId}`.localeCompare(`${b.gameId}:${b.sessionId}`) || a.revision - b.revision);
  for (const row of sorted) {
    assertSession(uid);
    if (!validChunk(row)) throw privateError(undefined);
    const key = `${row.gameId}:${row.sessionId}`;
    if (blocked.has(key)) continue;
    // Deliberately forward only the agreed protocol, excluding all other native metadata.
    const payload = { expectedUid: uid, gameId: row.gameId, sessionId: row.sessionId, revision: row.revision,
      source: row.source, offsetMs: row.offsetMs, clockUncertaintyMs: row.clockUncertaintyMs, samples: row.samples };
    const response = await httpsCallable<typeof payload, UploadResponse>(getFirebase().functions, 'savePersonalActivity', { timeout: 20000 })(payload);
    assertSession(uid);
    if (response.data.status !== 'saved' && response.data.status !== 'duplicate') {
      if (response.data.status !== 'processing' && response.data.status !== 'stale') throw privateError(undefined);
      blocked.add(key); result.processing++; continue;
    }
    // Native ACK also binds the pending key to its currently authenticated uid.
    // A session change while awaiting this operation cannot delete another user's data.
    const acknowledged = await native.ackActivity(row.sessionId, row.revision);
    assertSession(uid);
    if (acknowledged !== true) { blocked.add(key); result.processing++; continue; }
    result.uploaded++; result.pending--;
  }
  return result;
}

/** A concurrent hook/summary request joins the same flush for this uid. */
export function flushPersonalActivity(uid: string): Promise<PersonalActivityFlush> {
  if (!SPORTS_ACTIVITY_ENABLED) return Promise.reject(new SportsActivityDisabledError());
  if (USE_MOCK_DATA || Platform.OS !== 'android') return Promise.resolve(emptyFlush());
  const previous = inFlight.get(uid);
  if (previous) return previous;
  const task = flush(uid).catch(error => {
    assertSession(uid);
    if (isStaleSession(error)) throw error;
    const filtered = privateError(error);
    observedPrivateErrors.add(filtered);
    observeCaughtError(filtered, { source: 'src/services/personalActivityService.ts', handler: 'flushPersonalActivity', site: 'personalActivity:flush' });
    throw filtered;
  }).finally(() => {
    if (inFlight.get(uid) === task) inFlight.delete(uid);
  });
  inFlight.set(uid, task);
  return task;
}

function validSummary(value: unknown, gameId: string): value is PersonalActivitySummary {
  const s = value as PersonalActivitySummary | null;
  if (!s || s.version !== 1 || s.gameId !== gameId || s.source !== 'wear-health-services') return false;
  const nonnegative = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  const nullable = (v: unknown) => v === null || nonnegative(v);
  return ['eligibleMs', 'measuredMs', 'heartRateSamples', 'acceptedSamples', 'excludedBoundarySamples', 'updatedAt']
    .every(k => nonnegative((s as unknown as Record<string, unknown>)[k])) &&
    ['distanceM', 'steps', 'calories', 'avgHeartRateBpm', 'maxHeartRateBpm', 'knownFrom']
      .every(k => nullable((s as unknown as Record<string, unknown>)[k])) &&
    (s.coverageRatio === null || (nonnegative(s.coverageRatio) && s.coverageRatio <= 1)) &&
    !!s.coverageMs && ['distanceM', 'steps', 'calories'].every(k => nonnegative(s.coverageMs[k as keyof typeof s.coverageMs]));
}

export async function getMyPersonalActivity(gameId: string, uid: string): Promise<PersonalActivityResponse> {
  if (!SPORTS_ACTIVITY_ENABLED) return { status: 'unavailable', summary: null, reason: 'feature-disabled' };
  if (!idValid(gameId)) throw new Error('Invalid game identifier');
  if (USE_MOCK_DATA) return { status: 'unavailable', summary: null, reason: 'mock-mode' };
  try {
    assertSession(uid);
    const response = await httpsCallable<{ expectedUid: string; gameId: string }, PersonalActivityResponse>(
      getFirebase().functions, 'getMyPersonalActivity', { timeout: 20000 })({ expectedUid: uid, gameId });
    assertSession(uid);
    const data = response.data;
    if (!data || !['available', 'unavailable', 'processing'].includes(data.status) ||
      (data.status === 'available' ? !validSummary(data.summary, gameId) : data.summary !== null)) throw privateError(undefined);
    // A server with no accepted chunks cannot distinguish no recording from a
    // recording still in the local durable inbox. Preserve that distinction.
    if (data.status === 'unavailable' && bridge()?.getPendingActivity) {
      const pending = await bridge()!.getPendingActivity!();
      assertSession(uid);
      if (!Array.isArray(pending)) throw privateError(undefined);
      if (pending.some(row => row?.userId === uid && row.gameId === gameId)) {
        return { status: 'processing', summary: null, reason: 'native-queue-pending' };
      }
    }
    return { status: data.status, summary: data.summary, ...(typeof data.reason === 'string' ? { reason: data.reason } : {}) };
  } catch (error) {
    assertSession(uid);
    if (isStaleSession(error)) throw error;
    const filtered = privateError(error);
    observedPrivateErrors.add(filtered);
    observeCaughtError(filtered, { source: 'src/services/personalActivityService.ts', handler: 'getMyPersonalActivity', site: 'personalActivity:read' });
    throw filtered;
  }
}

export const personalActivityService = { syncPending: flushPersonalActivity, getSummary: getMyPersonalActivity };

/** The durable native queue remains intact through backgrounding or network errors. */
export function usePersonalActivitySync(uid: string | undefined | null): void {
  useEffect(() => {
    if (!SPORTS_ACTIVITY_ENABLED || !uid || USE_MOCK_DATA || Platform.OS !== 'android') return;
    let disposed = false;
    const run = () => {
      if (disposed || AppState.currentState !== 'active') return;
      void flushPersonalActivity(uid).catch(error => {
        if (disposed || isStaleSession(error) || observedPrivateErrors.has(error)) return;
        observeCaughtError(privateError(error), { source: 'src/services/personalActivityService.ts', handler: 'usePersonalActivitySync', site: 'personalActivity:sync' });
      });
    };
    run();
    const timer = setInterval(run, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') run(); });
    return () => { disposed = true; clearInterval(timer); subscription.remove(); };
  }, [uid]);
}
