// joryio — Joryio integration for Teamder.
//
// Backed by the real SDK (@joryio/react-native-sdk), vendored under
// vendor/joryio because the package is not published to npm and its pods are
// not on CocoaPods. Native modules live in vendor/joryio/android and are wired
// into the Gradle build by plugins/withJoryioSdk.js.
//
// This file stays as the ONLY thing the rest of the app talks to. All 300+
// logEvent() call sites go through analyticsService, which calls track() here —
// so the SDK can be swapped for the published package (or back to a plain HTTP
// client) by editing this file alone.
//
// The SDK degrades to a warning + no-ops when the native module is not linked,
// so a JS-only environment (jest, Expo Go) will not crash.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Joryio from '@joryio/react-native-sdk';
import { USE_MOCK_DATA } from '@/firebase/config';

const API_HOST =
  process.env.EXPO_PUBLIC_JORYIO_API_HOST ?? 'https://hippomation-backend.fly.dev/api';

/** One app per platform — each carries its own key and, later, its own push
 *  credentials (APNs for iOS, FCM for Android).
 *
 *  Joryio calls the SDK key "configuration, not a secret", and it does ship
 *  inside the binary either way. It is still read from the environment rather
 *  than hardcoded, for two practical reasons: a leaked key can be rotated by
 *  changing one env var instead of shipping a new build, and the value never
 *  enters git history. Missing at build time → the SDK simply stays off. */
const SDK_KEYS = {
  ios: process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_IOS ?? '',
  android: process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_ANDROID ?? '',
  web: process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_WEB ?? '',
} as const;

const KEY = Platform.select({
  ios: SDK_KEYS.ios,
  android: SDK_KEYS.android,
  default: SDK_KEYS.web,
});

const APP_VERSION =
  (Constants.expoConfig?.version as string | undefined) ?? 'dev';

let started = false;

/**
 * snake_case → the Title Case names the workspace already holds, so events
 * arriving from the app land on the SAME event name as the 3,861 back-filled
 * from Firestore. Without this, `game_joined` would sit next to `Game Joined`
 * and split every funnel in two.
 *
 * Kept OUTSIDE the transport on purpose: it must keep applying no matter what
 * this file is implemented with.
 */
const NAME_OVERRIDES: Record<string, string> = {
  game_joined: 'Game Joined',
  game_created: 'Game Created',
  game_viewed: 'Game Viewed',
  game_cancelled: 'Game Registration Cancelled',
  guest_added: 'Guest Added',
  group_join_requested: 'Community Join Requested',
  group_join_approved: 'Community Join Approved',
  group_join_approved_by_admin: 'Community Join Approved',
  group_join_declined_by_admin: 'Community Join Rejected',
  group_viewed: 'Community Viewed',
  group_created: 'Community Created',
  friend_request_sent: 'Friend Requested',
  friend_request_accepted: 'Friend Accepted',
  onboarding_completed: 'Onboarding Completed',
  app_foregrounded: 'App Opened',
  screen_view: 'Screen Viewed',
  discipline_card_issued: 'Card Issued',
};

export function toJoryioName(raw: string): string {
  const mapped = NAME_OVERRIDES[raw];
  if (mapped) return mapped;
  return raw
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Start the SDK once, as early as possible so the anonymous id exists before
 *  the first event. Safe to call repeatedly. */
export async function initJoryio(): Promise<void> {
  if (started || USE_MOCK_DATA || !KEY) return;
  started = true;
  await Joryio.initialize(KEY, API_HOST, {
    // React Native's fetch sends `User-Agent: okhttp/...`, which the backend's
    // bot detector classifies as a bot; every analytics query then filters the
    // event out with `$is_bot != 'true'`. An app-shaped UA is not flagged.
    userAgent: `Teamder/${APP_VERSION} (${Platform.OS} ${String(Platform.Version)})`,
  } as Record<string, unknown>);
}

export async function track(
  name: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (USE_MOCK_DATA) return;
  if (!started) await initJoryio();
  Joryio.track(toJoryioName(name), properties ?? {});
}

/** Bind this install to a real person so pre-sign-in activity stitches on. */
export async function identify(
  userId: string,
  attributes?: Record<string, unknown>,
): Promise<void> {
  if (USE_MOCK_DATA || !userId) return;
  if (!started) await initJoryio();
  Joryio.identify(userId);
  if (attributes && Object.keys(attributes).length) {
    // setAttributes takes primitives only.
    const clean: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(attributes)) {
      if (v === undefined) continue;
      if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        clean[k] = v;
      }
    }
    clean.platform = Platform.OS;
    clean.appVersion = APP_VERSION;
    Joryio.setAttributes(clean);
  }
}

/** Forget the person, keep the install identity. */
export function resetUser(): void {
  if (USE_MOCK_DATA) return;
  Joryio.reset();
}

export async function registerPushToken(token: string): Promise<boolean> {
  if (USE_MOCK_DATA || !token) return false;
  if (!started) await initJoryio();
  Joryio.registerPushToken(token);
  return true;
}

/** Fired from the push handler so campaign attribution closes the loop. */
export function trackPushClick(trackingId: string): void {
  if (USE_MOCK_DATA || !trackingId) return;
  Joryio.trackPushClick(trackingId);
}

/** In-app campaigns — the capability a hand-written HTTP client cannot provide. */
export function onInAppMessage(
  cb: (message: unknown) => void,
): () => void {
  if (USE_MOCK_DATA) return () => {};
  return Joryio.onInAppMessage(cb as never);
}

export function flush(): void {
  if (USE_MOCK_DATA) return;
  Joryio.flush();
}

export const joryio = {
  init: initJoryio,
  track,
  identify,
  resetUser,
  registerPushToken,
  trackPushClick,
  onInAppMessage,
  flush,
};
