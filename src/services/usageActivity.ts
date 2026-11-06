import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { randomUUID } from 'expo-crypto';
import * as Application from 'expo-application';
import { onAuthStateChanged } from 'firebase/auth';
// Deliberately bypass diagnosticCallable: a delivery failure must never report itself.
import { httpsCallable } from 'firebase/functions';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { recordDiagnostic } from './diagnosticJournal';
import { UsageActivityQueue, USAGE_QUEUE_KEY } from './usageActivityQueue';
import { UsageContext, UsageEvent, usageContext } from '@/utils/usageActivity';
import { attachProductCollector } from './productActor';

/** Activation is a separate product/release decision. No collection while disabled. */
export const USAGE_ACTIVITY_ENABLED = process.env.EXPO_PUBLIC_USAGE_ACTIVITY_ENABLED === 'true';
let queue: UsageActivityQueue | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let route: { owner: string | null; key?: string; context: UsageContext } | undefined;
const sections = new Map<string, string>();
const sectionKey = (key: string, context: UsageContext) => JSON.stringify([key, context.groupId, context.gameId, context.playerId, context.seasonId]);
function diagnostic(reason: string) { try { recordDiagnostic('act', 'usage_collection', { reason }); } catch { /* Local reporter recursion boundary. */ } }
function guard<T>(work: () => T, fallback: T): T { try { return work(); } catch { diagnostic('collector_failure'); return fallback; } }
function replayRoute(owner: string | null) {
  if (!route) return;
  if (route.owner !== owner) { route = undefined; sections.clear(); return; }
  const section = route.key ? sections.get(sectionKey(route.key, route.context)) : undefined;
  queue?.screen(section && route.context.screen ? usageContext(route.context.screen,{ ...route.context, section }) : route.context);
}
function schedule() {
  if (!queue || timer || AppState.currentState !== 'active') return;
  timer = setTimeout(() => { timer = undefined; void queue?.flush().finally(schedule); }, 10_000);
}
function startUsageActivityUnsafe(): () => void {
  if (!USAGE_ACTIVITY_ENABLED || USE_MOCK_DATA || queue) return () => {};
  const { auth, functions } = getFirebase();
  queue = new UsageActivityQueue({ storage: AsyncStorage, now: Date.now, uuid: randomUUID,
    identity: () => auth.currentUser?.uid ?? null, platform: Platform.OS,
    appVersion: Application.nativeApplicationVersion ?? 'development', diagnostic,
    onBatchReady: () => { void queue?.flush(); },
    send: async (expectedUid, events) => (await httpsCallable<{ expectedUid: string; events: UsageEvent[] }, { acknowledged: string[]; rejected?: string[]; retryAfterMs?: number }>(functions, 'recordUsageActivity')({ expectedUid, events })).data,
  });
  guard(() => queue?.appState(AppState.currentState ?? 'inactive'), undefined); replayRoute(auth.currentUser?.uid ?? null); schedule();
  const detachProduct = attachProductCollector({
    actor: () => auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser.uid : null,
    record: key => queue?.record('product_action',{productKey:key}),
  });
  const stop = onAuthStateChanged(auth, () => guard(() => { queue?.syncIdentity(); replayRoute(auth.currentUser?.uid ?? null); schedule(); }, undefined));
  const listener = AppState.addEventListener('change', state => guard(() => {
    queue?.appState(state);
    if (state === 'active') { replayRoute(auth.currentUser?.uid ?? null); schedule(); }
    else if (state === 'background') { if (timer) clearTimeout(timer); timer = undefined; void queue?.flush(); }
  }, undefined));
  return () => { detachProduct(); stop(); listener.remove(); if (timer) clearTimeout(timer); timer = undefined; void queue?.persist(); queue = undefined; };
}
export function startUsageActivity(): () => void { return guard(startUsageActivityUnsafe, () => {}); }

export function recordUsageScreen(next: { name: string; key?: string; params?: unknown }): void {
  if (!USAGE_ACTIVITY_ENABLED || USE_MOCK_DATA) return;
  guard(() => {
    const owner = getFirebase().auth.currentUser?.uid ?? null;
    if (route && route.owner !== owner) sections.clear();
    route = {owner, key: next.key, context: usageContext(next.name,next.params)};
    replayRoute(owner);
  }, undefined);
}
export function setUsageSection(key: string, screen: string, context: UsageContext, section: string): void {
  if (!USAGE_ACTIVITY_ENABLED || USE_MOCK_DATA) return;
  sections.set(sectionKey(key, context), section);
  if (sections.size > 100) sections.delete(sections.keys().next().value!);
  if (route?.key === key && route.context.screen === screen && sectionKey(key, context) === sectionKey(key, route.context)) guard(() => replayRoute(getFirebase().auth.currentUser?.uid ?? null), undefined);
}
export function resetUsageVisit(): void { route=undefined; sections.clear(); guard(() => queue?.resetIdentity(), undefined); }
/** Successful account deletion removes this owner's local copy even when collection is off. */
export async function forgetUsageUser(uid: string): Promise<void> {
  if (queue) { await queue.forgetOwner(uid); return; }
  try {
    const raw = await AsyncStorage.getItem(USAGE_QUEUE_KEY);
    if (!raw) return;
    const rows = JSON.parse(raw);
    await AsyncStorage.setItem(USAGE_QUEUE_KEY, JSON.stringify(Array.isArray(rows) ? rows.filter(e => e?.ownerUid !== uid) : []));
  } catch { diagnostic('account_local_cleanup_failure'); }
}
/** Capture the owner now. An async outcome can never move to a later account/visit. */
export function beginUsageRegistration(gameId: string, operationId: string): (result: UsageEvent['result']) => void {
  return guard(() => {
    const finish = queue?.beginRegistration(gameId, operationId);
    return (result: UsageEvent['result']) => guard(() => finish?.(result), undefined);
  }, () => {});
}
