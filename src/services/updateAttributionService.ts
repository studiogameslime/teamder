import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';
import { compareVersions, getCurrentVersion, isReleaseVersion, openStore, updateTargetKey, type StoreUpdate } from '@/services/updateService';

const KEY = 'storeUpdateAttribution:v1';
const WINDOW = 14 * 24 * 60 * 60 * 1000;
interface Receipt {
  id: string;
  userId: string | null;
  clickedAt: number;
  update: StoreUpdate;
  surface: 'home_banner' | 'force_modal';
  opened: boolean;
  reported?: boolean;
}
let opening = false;
let reconciling = false;

/** Persist BEFORE leaving the app. Every accepted tap has its own correlation id. */
export async function openTrackedUpdate(update: StoreUpdate, userId: string | null, surface: Receipt['surface']): Promise<boolean> {
  if (opening) return false;
  opening = true;
  const receipt: Receipt = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, userId, clickedAt: Date.now(), update, surface, opened: false };
  const params = { attempt_id: receipt.id, actor_id: userId, source: surface, from_version: update.fromVersion, from_build: update.fromBuild, target: updateTargetKey(update), kind: update.kind };
  logEvent(AnalyticsEvent.UpdatePromptTapped, params);
  let previousReceipt: string | null | undefined;
  try {
    try { previousReceipt = await AsyncStorage.getItem(KEY); } catch { /* Best effort. */ }
    try { await AsyncStorage.setItem(KEY, JSON.stringify(receipt)); } catch { /* Opening the store remains available. */ }
    const opened = await openStore().catch(() => false);
    if (!opened) {
      // Do not erase a previous successful attempt when this tap cannot open the store.
      try {
        if (previousReceipt) await AsyncStorage.setItem(KEY, previousReceipt);
        else await AsyncStorage.removeItem(KEY);
      } catch { /* The failed receipt has opened=false and cannot complete. */ }
      logEvent(AnalyticsEvent.UpdateStoreOpenFailed, params);
      return false;
    }
    receipt.opened = true;
    try { await AsyncStorage.setItem(KEY, JSON.stringify(receipt)); } catch { /* Click remains measured; completion may be unobservable. */ }
    logEvent(AnalyticsEvent.UpdateStoreOpened, params);
    return true;
  } finally { opening = false; }
}

/** A store visit alone is never a completion. Observe a newer native binary on launch. */
export async function reconcileStoreUpdate(userId: string | null): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    let receipt: Receipt;
    try { receipt = JSON.parse(raw); } catch { await AsyncStorage.removeItem(KEY); return; }
    if (!receipt?.update || !Number.isFinite(receipt.clickedAt) || Date.now() - receipt.clickedAt > WINDOW || receipt.clickedAt > Date.now() || receipt.reported) {
      await AsyncStorage.removeItem(KEY); return;
    }
    if (!receipt.opened || receipt.userId !== userId) return;
    const current = getCurrentVersion();
    const build = Application.nativeBuildVersion ?? '';
    const previous = receipt.update;
    let completed = false;
    if (previous.source === 'google_play') {
      const now = Number(build), before = Number(previous.fromBuild);
      completed = Number.isSafeInteger(now) && Number.isSafeInteger(before) && before > 0 && now > before &&
        Number.isSafeInteger(previous.targetBuild) && now >= previous.targetBuild!;
    } else if (previous.source === 'app_store' && isReleaseVersion(current) && isReleaseVersion(previous.fromVersion) && isReleaseVersion(previous.targetVersion)) {
      completed = compareVersions(current, previous.fromVersion) > 0 && compareVersions(current, previous.targetVersion) >= 0;
    }
    if (!completed) return;
    // Mark before dispatch: at most one completion per local receipt, even if
    // the effect runs twice or removal fails. Analytics delivery is best effort.
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...receipt, reported: true }));
    logEvent(AnalyticsEvent.UpdatePromptCompleted, {
      attempt_id: receipt.id, actor_id: receipt.userId, source: receipt.surface, from_version: previous.fromVersion,
      from_build: previous.fromBuild, installed_version: current, installed_build: build,
      target: updateTargetKey(previous), elapsed_seconds: Math.floor((Date.now() - receipt.clickedAt) / 1000),
      attribution: 'new_binary_after_store_open',
    });
    await AsyncStorage.removeItem(KEY);
  } catch { /* Retry after a storage failure. Telemetry cannot block launch. */ }
  finally { reconciling = false; }
}
