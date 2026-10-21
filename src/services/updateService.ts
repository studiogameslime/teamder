import { observeCaughtError } from '../utils/errorObservation';
import { Linking, NativeModules, Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import * as Application from 'expo-application';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import { logError } from '@/services/errorLog';
import { getLocales } from 'expo-localization';

export type UpdateKind = 'none' | 'optional' | 'force';
export interface StoreUpdate {
  kind: 'optional' | 'force';
  fromVersion: string;
  fromBuild: string;
  targetVersion?: string;
  targetBuild?: number;
  source: 'google_play' | 'app_store';
}
export const updateTargetKey = (update: StoreUpdate): string =>
  `${update.source}:${update.targetBuild ?? update.targetVersion}`;
export const isReleaseVersion = (value: unknown): value is string =>
  typeof value === 'string' && /^\d+(\.\d+){1,3}$/.test(value);

function bounded<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Store check timed out')), timeoutMs);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => {
    observeCaughtError(error, {"source":"src/services/updateService.ts","handler":"bounded","site":"updateService:9a518dd28f"}); clearTimeout(timer); reject(error); });
  });
}

/**
 * Is a store-update gate on screen right now?
 *
 * Module state rather than context, because the only readers are screens that
 * must NOT stack a modal of their own on top of it, and they would otherwise
 * each need the whole app's update state threaded down to them.
 *
 * Set by App.tsx, which owns the gate. Read by anything that opens a modal
 * from a tab — today the achievement celebration, which landed ON TOP of a
 * FORCED update and left the user looking at trophies with no way to reach
 * the button that unblocks the app ("מקבלים קודם את ההישגים לפני שאפשר
 * ללחוץ על כפתור העדכן גרסה").
 */
let updateGateOpen = false;
export function setUpdateGateOpen(open: boolean): void {
  updateGateOpen = open;
}
export function isUpdateGateOpen(): boolean {
  return updateGateOpen;
}

const ANDROID_PACKAGE = 'com.studiogameslime.soccerapp';
// App Store Connect numeric app id (same value as `ascAppId` in eas.json).
// Drives the iOS update deep-link itms-apps://…/app/id<ID>.
const IOS_APP_STORE_ID = '6775178022';

const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
const IOS_APP_STORE_URL = IOS_APP_STORE_ID
  ? `itms-apps://itunes.apple.com/app/id${IOS_APP_STORE_ID}`
  : '';
const IOS_APP_STORE_WEB_FALLBACK = IOS_APP_STORE_ID
  ? `https://apps.apple.com/app/id${IOS_APP_STORE_ID}`
  : '';

export function getCurrentVersion(): string {
  return Application.nativeApplicationVersion ?? '0.0.0';
}

export function compareVersions(v1: string, v2: string): -1 | 0 | 1 {
  const parse = (s: string): number[] =>
    String(s)
      .split('-')[0]
      .split('.')
      .map((n) => Math.max(0, parseInt(n, 10) || 0));
  const a = parse(v1);
  const b = parse(v2);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    if (ai < bi) return -1;
    if (ai > bi) return 1;
  }
  return 0;
}

let checking: Promise<StoreUpdate | null> | null = null;
export function checkForUpdate(): Promise<StoreUpdate | null> {
  if (!checking) checking = resolveStoreUpdate().finally(() => { checking = null; });
  return checking;
}

async function resolveStoreUpdate(): Promise<StoreUpdate | null> {
  if (USE_MOCK_DATA) return null;
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  const current = getCurrentVersion();
  if (!isReleaseVersion(current) || current === '0.0.0') return null;
  try {
    const base = { fromVersion: current, fromBuild: Application.nativeBuildVersion ?? '' };
    let available: StoreUpdate;
    if (Platform.OS === 'android') {
      // Missing in older binaries/dev clients. Never infer availability from a
      // public listing or another release track's configured version.
      const bridge = NativeModules.TeamderStoreUpdate;
      if (typeof bridge?.check !== 'function') return null;
      const result = await bounded<{ available: boolean; versionCode: number }>(bridge.check());
      const installed = Number(base.fromBuild);
      if (result.available !== true || !Number.isSafeInteger(result.versionCode) ||
          !Number.isSafeInteger(installed) || installed <= 0 || result.versionCode <= installed) return null;
      available = { ...base, kind: 'optional', targetBuild: result.versionCode, source: 'google_play' };
    } else {
      const region = getLocales()[0]?.regionCode;
      const country = region && /^[A-Za-z]{2}$/.test(region) ? region.toLowerCase() : 'il';
      const controller = new AbortController();
      let json: { results?: Array<{ trackId?: number; bundleId?: string; version?: string }> };
      try {
        json = await bounded(fetch(`https://itunes.apple.com/lookup?id=${IOS_APP_STORE_ID}&country=${country}`, { signal: controller.signal })
          .then(response => { if (!response.ok) throw new Error('Store lookup failed'); return response.json(); }));
      } finally { controller.abort(); }
      const app = json.results?.find(item => item.trackId === Number(IOS_APP_STORE_ID) && item.bundleId === ANDROID_PACKAGE);
      if (!isReleaseVersion(app?.version) || compareVersions(current, app.version) >= 0) return null;
      available = { ...base, kind: 'optional', targetVersion: app.version, source: 'app_store' };
    }
    // Remote config only decides whether an AVAILABLE update is mandatory.
    // A failed/missing config cannot suppress the store-backed optional banner.
    try {
      const { db } = getFirebase();
      const snap = await bounded(getDoc(doc(db, 'appConfig', Platform.OS)), 3000);
      const minimum = snap.exists() ? snap.data().minimumSupportedVersion : null;
      if (isReleaseVersion(minimum) && compareVersions(current, minimum) < 0 &&
          (!available.targetVersion || compareVersions(available.targetVersion, minimum) >= 0)) available.kind = 'force';
    } catch (caughtError4f2a256c7f) {
    observeCaughtError(caughtError4f2a256c7f, {"source":"src/services/updateService.ts","handler":"resolveStoreUpdate","site":"updateService:4f2a256c7f"}); /* Available store update stays optional. */ }
    return available;
  } catch (err) {
    observeCaughtError(err, {"source":"src/services/updateService.ts","handler":"resolveStoreUpdate","site":"updateService:d6d7f5046d"});
    // Offline, missing Play ownership/store and unavailable country listings
    // are normal absence-of-evidence cases, not application crashes.
    if (__DEV__) console.warn('[update] check failed', err);
    return null;
  }
}

export async function openStore(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      try { await Linking.openURL(`market://details?id=${ANDROID_PACKAGE}`); }
      catch (caughtError447bc31acb) {
    observeCaughtError(caughtError447bc31acb, {"source":"src/services/updateService.ts","handler":"openStore","site":"updateService:447bc31acb"}); await Linking.openURL(PLAY_STORE_URL); }
      return true;
    }
    if (Platform.OS === 'ios') {
      // itms-apps:// opens the App Store APP directly, but iOS only allows it if
      // the scheme is in LSApplicationQueriesSchemes. Do NOT gate on
      // canOpenURL() — for a non-whitelisted scheme it REJECTS (not returns
      // false), which was caught below and skipped the fallback entirely, so the
      // store never opened (user report: "openStore failed · Add itms-apps to
      // LSApplicationQueriesSchemes"). Instead: try the scheme, and on ANY
      // failure fall back to the https App Store link — which ALSO opens the
      // App Store app (universal link) and never needs whitelisting.
      if (IOS_APP_STORE_URL) {
        try {
          await Linking.openURL(IOS_APP_STORE_URL);
          return true;
        } catch (caughtErrorb6612d5d9a) {
    observeCaughtError(caughtErrorb6612d5d9a, {"source":"src/services/updateService.ts","handler":"openStore","site":"updateService:b6612d5d9a"});
          /* scheme blocked / failed — fall through to the https link */
        }
      }
      if (IOS_APP_STORE_WEB_FALLBACK) {
        await Linking.openURL(IOS_APP_STORE_WEB_FALLBACK);
        return true;
      }
      return false;
    }
  } catch (err) {
    observeCaughtError(err, {"source":"src/services/updateService.ts","handler":"openStore","site":"updateService:5545d4b374"});
    logError('openStore', err, { platform: Platform.OS });
    if (__DEV__) console.warn('[update] openStore failed', err);
  }
  return false;
}
