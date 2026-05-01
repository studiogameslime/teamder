import { Linking, Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import * as Application from 'expo-application';
import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';

export type UpdateKind = 'none' | 'optional' | 'force';

const ANDROID_PACKAGE = 'com.studiogameslime.soccerapp';
// TODO: replace with the real App Store numeric id once published.
// Empty string skips iOS deep-link entirely (no-op fallback).
const IOS_APP_STORE_ID = '';

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

export async function checkForUpdate(): Promise<UpdateKind> {
  if (USE_MOCK_DATA) return 'none';
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return 'none';

  const current = getCurrentVersion();

  try {
    const { db } = getFirebase();
    const snap = await getDoc(doc(db, 'appConfig', Platform.OS));
    if (!snap.exists()) {
      if (__DEV__) console.log('[update] no appConfig doc → none');
      return 'none';
    }
    const data = snap.data() as Record<string, unknown>;
    const latest = data.latestVersion;
    const minimum = data.minimumSupportedVersion;
    if (typeof latest !== 'string' || typeof minimum !== 'string') {
      if (__DEV__) console.log('[update] malformed appConfig → none');
      return 'none';
    }

    let result: UpdateKind = 'none';
    if (compareVersions(current, minimum) < 0) result = 'force';
    else if (compareVersions(current, latest) < 0) result = 'optional';

    if (__DEV__) {
      console.log(
        `[update] current=${current} latest=${latest} min=${minimum} → ${result}`,
      );
    }
    return result;
  } catch (err) {
    if (__DEV__) console.warn('[update] check failed', err);
    return 'none';
  }
}

export async function openStore(): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Linking.openURL(PLAY_STORE_URL);
      return;
    }
    if (Platform.OS === 'ios') {
      if (!IOS_APP_STORE_URL) return; // no App Store id wired yet
      const canOpen = await Linking.canOpenURL(IOS_APP_STORE_URL);
      await Linking.openURL(canOpen ? IOS_APP_STORE_URL : IOS_APP_STORE_WEB_FALLBACK);
      return;
    }
  } catch (err) {
    if (__DEV__) console.warn('[update] openStore failed', err);
  }
}
