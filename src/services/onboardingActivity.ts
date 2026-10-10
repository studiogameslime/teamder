/** Separate, allowlisted remote onboarding stream. Diagnostic breadcrumbs stay local. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { onAuthStateChanged } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { getFirebase } from '@/firebase/config';
import { ONBOARDING_ACTIONS, safeActivityParams } from '@/utils/onboardingActivity';

const KEY = 'teamder:onboarding-activity:v1';
const QUARANTINE = 'teamder:onboarding-activity:quarantine';
type Event = { id: string; sessionId: string; sequence: number; occurredAt: number; action: string; params: Record<string, string | number | boolean>; ownerUid: string | null };
let chain: Promise<void> = Promise.resolve();
let sessionId = '';
let sequence = 0;
let ownerUid: string | null = null;
let started = false;
let awaitingPersistence: Event[] = [];
const claimedSessions = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let retryMs = 2000;
function retryLater() { retryMs = Math.min(60_000, retryMs * 2); schedule(); }

// Linking a guest to a credential keeps its Firebase UID and its journey.
// Logout or signing into another UID starts a separate journey immediately.
function syncIdentity() {
  const uid = getFirebase().auth.currentUser?.uid ?? null;
  if (!sessionId) sessionId = randomUUID();
  if (uid === ownerUid) return;
  if (ownerUid === null && uid) claimedSessions.set(sessionId, uid);
  else { sessionId = randomUUID(); sequence = 0; }
  ownerUid = uid;
}
/** Explicit successful logout boundary, even if auth callbacks are coalesced. */
export function resetOnboardingJourney(): void {
  sessionId = randomUUID(); sequence = 0;
  ownerUid = getFirebase().auth.currentUser?.uid ?? null;
}
function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = undefined;
    chain = chain.then(flush).catch(retryLater);
  }, retryMs);
}
function validEvent(value: unknown): value is Event {
  if (!value || typeof value !== 'object') return false;
  const e = value as Event;
  return typeof e.id === 'string' && /^[a-z0-9-]{10,160}$/.test(e.id)
    && typeof e.sessionId === 'string' && /^[a-z0-9-]{10,140}$/.test(e.sessionId)
    && e.id.startsWith(`${e.sessionId}-`) && Number.isSafeInteger(e.sequence) && e.sequence > 0
    && Number.isSafeInteger(e.occurredAt) && e.occurredAt > 0
    && e.occurredAt <= Date.now() + 86400000
    && typeof e.action === 'string' && Object.prototype.hasOwnProperty.call(ONBOARDING_ACTIONS, e.action)
    && !!e.params && typeof e.params === 'object' && !Array.isArray(e.params)
    && (e.ownerUid === null || (typeof e.ownerUid === 'string' && !!e.ownerUid));
}
async function quarantine(values: unknown[]) {
  if (!values.length) return;
  // Local diagnostics only; never upload malformed values or old unowned events.
  await AsyncStorage.setItem(QUARANTINE, JSON.stringify({ at: Date.now(), count: values.length }));
}
async function readQueue(): Promise<Event[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  let values: unknown;
  try { values = JSON.parse(raw); } catch { await quarantine([raw]); await AsyncStorage.setItem(KEY, '[]'); return []; }
  if (!Array.isArray(values)) { await quarantine([values]); await AsyncStorage.setItem(KEY, '[]'); return []; }
  const good = values.filter(validEvent).filter(event =>
    event.ownerUid !== null || event.sessionId === sessionId || claimedSessions.has(event.sessionId));
  if (good.length !== values.length) {
    const retained = new Set(good);
    await quarantine(values.filter(value => !retained.has(value)));
    await AsyncStorage.setItem(KEY, JSON.stringify(good));
  }
  return good.map(event => ({ ...event, ownerUid: event.ownerUid ?? claimedSessions.get(event.sessionId) ?? null, params: safeActivityParams(event.params) }));
}
async function flush() {
  syncIdentity();
  await persistPending();
  const { auth, functions } = getFirebase();
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const queue = await readQueue();
  const batch = queue.filter(event => event.ownerUid === uid).slice(0, 20);
  if (!batch.length) return;
  if (auth.currentUser?.uid !== uid) { schedule(); return; }
  // Server verifies this expectation against the token; it never trusts it as identity.
  const send = httpsCallable<{ events: Event[]; expectedUid: string }, { acknowledged: string[] }>(functions, 'recordOnboardingActivity');
  let acknowledged: string[];
  try { acknowledged = (await send({ events: batch, expectedUid: uid })).data.acknowledged; }
  catch (error) {
    if (String((error as { code?: string }).code).endsWith('invalid-argument')) {
      // A permanently rejected batch must not block later valid events forever.
      // Retry each independently to isolate the poison record.
      acknowledged = [];
      for (const event of batch) {
        if (auth.currentUser?.uid !== uid) { schedule(); break; }
        try { acknowledged.push(...(await send({ events: [event], expectedUid: uid })).data.acknowledged); }
        catch (single) {
          if (!String((single as { code?: string }).code).endsWith('invalid-argument')) throw single;
          await quarantine([event]); acknowledged.push(event.id);
        }
      }
    } else throw error;
  }
  const sent = new Set(batch.map(event => event.id));
  const accepted = new Set(acknowledged.filter(id => sent.has(id)));
  if (!accepted.size) throw new Error('Onboarding activity was not acknowledged');
  const remaining = queue.filter(event => !accepted.has(event.id));
  await AsyncStorage.setItem(KEY, JSON.stringify(remaining));
  retryMs = 2000;
  if (remaining.some(event => event.ownerUid === auth.currentUser?.uid)) schedule();
}
async function persistPending() {
  if (!awaitingPersistence.length) return;
  const queue = await readQueue();
  const saved = new Set(queue.map(event => event.id));
  const pending = awaitingPersistence.slice();
  for (const event of pending) if (!saved.has(event.id)) {
    queue.push({ ...event, ownerUid: event.ownerUid ?? claimedSessions.get(event.sessionId) ?? null }); saved.add(event.id);
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
  const written = new Set(pending.map(event => event.id));
  awaitingPersistence = awaitingPersistence.filter(event => !written.has(event.id));
  schedule();
}
export function recordOnboardingActivity(action: string, params: Record<string, string | number | boolean>): void {
  if (!Object.prototype.hasOwnProperty.call(ONBOARDING_ACTIONS, action)) return;
  if ((action === 'avatar_changed' || action.startsWith('photo_')) && params.source !== 'onboarding') return;
  syncIdentity();
  if (!started) {
    started = true;
    onAuthStateChanged(getFirebase().auth, () => { syncIdentity(); schedule(); });
    AppState.addEventListener('change', state => { if (state === 'active') { syncIdentity(); schedule(); } });
  }
  const event: Event = { id: `${sessionId}-${++sequence}`, sessionId, sequence, occurredAt: Date.now(), action, params: safeActivityParams(params), ownerUid };
  awaitingPersistence.push(event);
  chain = chain.then(persistPending).catch(retryLater);
}
