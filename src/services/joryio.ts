// joryio — Joryio integration for Teamder.
//
// Installed from npm: @joryio/react-native-sdk@1.3.0-beta.1.
// Native beta dependencies are wired by plugins/withJoryioSdk.js.
// Historical sources under vendor/joryio are no longer linked.
//
// The SDK degrades to a warning + no-ops when the native module is not linked,
// so a JS-only environment (jest, Expo Go) will not crash.

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Joryio from '@joryio/react-native-sdk';
import { USE_MOCK_DATA } from '@/firebase/config';
import { logUnexpected } from '@/services/errorLog';

// PRODUCTION since 24.09. `https://hippomation-backend.fly.dev/api`
// was Joryio's test environment and is what every build before this one
// reported to.
//
// The literal matters more than the env var and that is not a style choice:
// `.env` is gitignored and `eas build --local` copies the project BY GIT, so
// an env-only value resolves to undefined in a store build and this fallback
// is what ships. A change made only in `.env` would leave production silently
// reporting to the test backend — the same shape of failure as the first
// 1.0.94 AAB, which shipped with no SDK key at all.
//
// Verified against this host before switching: all three of our SDK keys
// authenticate, a fabricated key is refused with 401, one real event came back
// `processed: 1`, and the management API lists our three apps — same
// workspaceId and same app ids as the test host, which is why no history is
// left behind.
//
// ⚠️ It sits behind Cloudflare, which the test backend did not. A request with
// an unrecognised User-Agent is refused with `403` and `error code: 1010`
// BEFORE it reaches Joryio — Python's default `Python-urllib/3.x` is one of
// them. That is a bot rule and not an auth failure, and it will mislead anyone
// probing this host from a script. The SDK sets its own User-Agent and is
// unaffected; curl's default is fine too.
const API_HOST =
  process.env.EXPO_PUBLIC_JORYIO_API_HOST ?? 'https://api-eu1.joryio.com/api';

/** One app per platform — each carries its own key and, later, its own push
 *  credentials (APNs for iOS, FCM for Android).
 *
 *  Joryio calls the SDK key "configuration, not a secret", and it ships inside
 *  the binary either way — a release bundle cannot hide it.
 *
 *  The env var is kept as an OVERRIDE, but the literal has to be the fallback.
 *  `.env` is gitignored and `eas build --local` copies the project by git, so
 *  an env-only key resolves to '' in a store build: initJoryio() returns early,
 *  and the app ships with analytics silently switched off. That is exactly what
 *  the first 1.0.94 AAB did — the bundle contained the API host and the Firebase
 *  config, and no SDK key at all.
 *
 *  To rotate without a release, set the value in EAS environment variables. */
const SDK_KEYS = {
  ios:
    process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_IOS ??
    'jry_sdk_ios_d51ace7ab39f1672be01485b733b9c26b4d48c9741e4247f',
  android:
    process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_ANDROID ??
    'jry_sdk_android_1a5fba8fd7b8a96c1d14ce64aa9fa39c27a5b487a26f244e',
  web:
    process.env.EXPO_PUBLIC_JORYIO_SDK_KEY_WEB ??
    'jry_sdk_web_32fb87e179b49a5b6312788d557b247de189c0d416f33a9f',
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
    // Every log line in the SDK — including the one that says a track call
    // failed — is gated behind this flag. With it off the SDK is completely
    // silent in logcat, so a rejected impression looks exactly like one that
    // was never sent. That cost a full diagnostic build to discover.
    enableDebug: __DEV__,
    logLevel: 'debug',
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

/**
 * Update what Joryio knows about this person, without re-identifying them.
 *
 * `identify` binds an install to a person and is called once at sign-in; this
 * keeps the FACTS fresh afterwards. The distinction matters because journeys
 * here can only be built from events and attributes — we send no merge fields,
 * so a message that wants to say "you have 3 players" needs the 3 to already
 * be on the profile when the journey branches.
 *
 * Primitives only, same as identify: the native `setAttributes` takes a flat
 * map and silently drops anything else.
 */
export async function setAttributes(
  attributes: Record<string, unknown>,
): Promise<void> {
  if (USE_MOCK_DATA) return;
  if (!started) await initJoryio();
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(attributes)) {
    if (v === undefined) continue;
    if (
      v === null ||
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      clean[k] = v;
    }
  }
  if (Object.keys(clean).length === 0) return;
  Joryio.setAttributes(clean);
}

/** Forget the person, keep the install identity. */
export function resetUser(): void {
  if (USE_MOCK_DATA) return;
  Joryio.reset();
}

// Official identify() binds anonymous history itself. The removed alias(userId)
// API must not be replaced with addAlias(label, value), which has different semantics.

/** Who the SDK currently believes is using the app, per process. */
let identifiedUid: string | null = null;
/** True when anonymous activity has happened that nobody has claimed yet. */
let unclaimedAnonymousRun = false;

export interface IdentitySubject {
  uid: string;
  isAnonymous: boolean;
  email?: string;
  name?: string;
}

/**
 * Called on every auth emission. The official identify() links anonymous history.
 * 'aliased' is our upgrade event classification, not a separate SDK method.
 *
 * Returns what it did, for the caller to report. Never throws.
 */
export async function bindIdentity(
  subject: IdentitySubject | null,
): Promise<'none' | 'identified' | 'aliased'> {
  try {
    if (USE_MOCK_DATA || !subject?.uid) return 'none';

    if (subject.isAnonymous) {
      // Deliberately nothing. The SDK stays anonymous and keeps accumulating
      // events against its own anonymous id; identify later names that person.
      unclaimedAnonymousRun = true;
      return 'none';
    }

    // Already bound to this person in this process.
    if (identifiedUid === subject.uid) return 'none';

    const shouldAlias = unclaimedAnonymousRun;
    // The official SDK handles anonymous-to-person linking in identify().
    await identify(subject.uid, {
      email: subject.email,
      name: subject.name,
    });
    identifiedUid = subject.uid;
    unclaimedAnonymousRun = false;
    return shouldAlias ? 'aliased' : 'identified';
  } catch (err) {
    logUnexpected('joryioBindIdentity', {
      message: err instanceof Error ? err.message : String(err),
      isAnonymous: subject?.isAnonymous,
    });
    return 'none';
  }
}

/**
 * Sign-out. Forget the person AND start a new anonymous session.
 *
 * The new session is the point. Without it the next person to sign in on this
 * device would be aliased onto the previous person's anonymous id — two humans
 * collapsed into one profile, with the wrong one's behaviour driving the other's
 * lifecycle messaging. `resetUser` was already exported for this and had no call
 * site anywhere in the app.
 */
export function resetIdentity(): void {
  identifiedUid = null;
  unclaimedAnonymousRun = false;
  resetUser();
}

/** Test seam: the module-level identity state is per-process by design. */
export function __resetIdentityStateForTests(): void {
  identifiedUid = null;
  unclaimedAnonymousRun = false;
}

/** Teamder stores FCM for its own sender; Joryio requires APNs on iOS. */
export async function registerPushToken(token: string): Promise<boolean> {
  if (USE_MOCK_DATA || !token) return false;
  if (Platform.OS === 'ios') {
    try {
      const messaging = require('@react-native-firebase/messaging').default;
      token = await messaging().getAPNSToken();
    } catch {
      return false;
    }
    if (!token || !/^[0-9a-f]{64}$/i.test(token)) return false;
  }
  if (!started) await initJoryio();
  const result = await Joryio.registerPushToken(token);
  if (!result.success) {
    logUnexpected('joryioRegisterPushToken', {
      message: result.message ?? 'Push registration failed',
      isUnauthorized: result.isUnauthorized === true,
      isRetryable: result.isRetryable === true,
    });
    return false;
  }
  try {
    const status = await Joryio.getPushPermissionStatus();
    if (status) Joryio.setAttribute('push_permission', status);
  } catch {
    // Permission diagnostics must not turn a confirmed registration into failure.
  }
  return true;
}

/** Fired from the push handler so campaign attribution closes the loop. */
export function trackPushClick(trackingId: string): void {
  if (USE_MOCK_DATA || !trackingId) return;
  Joryio.trackPushClick(trackingId);
}

/** Report that a push actually ARRIVED on this device.
 *
 *  Joryio's own FirebaseMessagingService reports this for apps that let the SDK
 *  own push. We don't — Teamder has its own notification stack (expo-
 *  notifications) and registers its own service, so the SDK's never runs and
 *  this device reported no deliveries at all. The backend used to paper over
 *  that by emitting `delivered` alongside `sent` for everyone, which made every
 *  campaign read 100% delivered including sends to uninstalled devices. It now
 *  waits for the device to say so; `reportPushDelivered` is that half, added in
 *  the 2026-08-26 SDK for exactly our shape of app.
 *
 *  COVERAGE, so the number is read correctly: a Joryio push carries a
 *  `notification` block, so when the app is backgrounded or killed Android
 *  hands it straight to the tray and no JS of ours runs. We can therefore
 *  witness arrival in only two moments — a push that lands while the app is in
 *  the foreground, and a push the user taps. Both are TRUE arrivals, so nothing
 *  here inflates; a push delivered to the tray and never opened is simply not
 *  counted. Receipts dedupe by trackingId on the backend, so reporting the same
 *  push from both paths is free. */
export function reportPushDelivered(trackingId: string): void {
  if (USE_MOCK_DATA || !trackingId) return;
  Joryio.reportPushDelivered(trackingId);
}

/** In-app campaigns — the capability a hand-written HTTP client cannot provide.
 *  Subscribing is not enough on its own: something has to DRAW the message.
 *  See components/joryio/InAppMessageHost.
 *
 *  CAPABILITIES declare what OUR renderer can draw, and the server targets
 *  campaigns on them — an undeclared one is read as "cannot", not "unknown".
 *  Both are listed because InAppMessageHost now draws both: native with the
 *  app's own components, html in a WebView (HtmlMessageView).
 *
 *  This is the only lever we need, and `allowHtmlJsInAppMessages` is NOT one:
 *  that flag asks whether author HTML/JS may run in the web view the SDK
 *  itself owns, and setting a callback here is exactly what stops those views
 *  from running. We draw HTML in our own WebView (HtmlMessageView).
 *
 *  iOS used to disagree — its gate ran BEFORE the handoff, so declaring
 *  content.html got us HTML campaigns that were then silently dropped. Fixed
 *  upstream (sdk-ios 342d3834e, vendored 2026-08-31): the gate now applies
 *  only when no host renderer is set. We briefly turned the flag on as a
 *  workaround; carrying a permissive JS flag we never needed is worse than not
 *  carrying it, so it came back out with the pull. */
export function onInAppMessage(
  cb: (message: unknown) => void,
): () => void {
  if (USE_MOCK_DATA) return () => {};
  return Joryio.onInAppMessage(cb as never, {
    capabilities: ['content.native', 'content.html'],
  });
}

/** Ask for campaigns the user is eligible for right now. The SDK also pushes
 *  them as they qualify; this covers the ones already waiting at mount. */
export function syncInAppCampaigns(): void {
  if (USE_MOCK_DATA) return;
  Joryio.syncInAppCampaigns();
}

/** The only three actions the backend classifies. It matches by SUBSTRING —
 *  'click' → a click, 'dismiss' → a dismissal, anything else falls through to a
 *  DISPLAY. So a friendly label like 'impression' or 'button:cta' silently
 *  becomes another impression, which is exactly how a campaign reports displays
 *  it never had and zero clicks it did. The union makes that unspellable. */
export type InAppAction = 'displayed' | 'clicked' | 'dismissed';

/** Report what happened to a message — shown, clicked, dismissed.
 *  Without it a campaign has no idea whether it was ever seen. */
export function trackInAppImpression(campaignId: string, action: InAppAction): void {
  if (USE_MOCK_DATA || !campaignId) return;
  Joryio.trackInAppImpression(campaignId, action);
}

/* ── The two consents ───────────────────────────────────────────────────────
 *
 *  They are NOT the same thing and must never share a switch:
 *
 *    optOut / optIn   — may we OBSERVE this person (analytics, events).
 *    setSubscription  — may we MESSAGE this person on a channel.
 *
 *  Somebody can refuse tracking and still want the "your club has a game
 *  tomorrow" push, and the reverse. Both existed on the web SDK for a long
 *  time and neither reached React Native until 1.2.0, so until now the app
 *  simply had no way to honour either choice through the SDK. */

/** Stop collecting and sending analytics for this device.
 *
 *  Tracking only. This unsubscribes nobody from anything — a user who opts out
 *  here still gets every push they have asked for. The SDK reports
 *  `$tracking_opted_out` to the server as part of opting out; the wire shape is
 *  the SDK's business, not ours. */
export function optOutTracking(): void {
  if (USE_MOCK_DATA) return;
  Joryio.optOut();
}

/** Resume collecting after {@link optOutTracking}. */
export function optInTracking(): void {
  if (USE_MOCK_DATA) return;
  Joryio.optIn();
}

/** Whether this device has opted out of tracking. The SDK holds this natively
 *  and it survives reinstall-free restarts, so the settings screen asks the SDK
 *  rather than keeping its own copy that could drift. */
export async function isTrackingOptedOut(): Promise<boolean> {
  if (USE_MOCK_DATA) return false;
  try {
    return await Joryio.isUserOptedOut();
  } catch {
    return false;
  }
}

/** Marketing consent for one channel.
 *
 *  We only ever write 'push'. Teamder has no email or SMS channel — and per the
 *  owner's standing instruction there is no payments/marketing-email surface at
 *  all — so writing the other four would claim a consent we never act on.
 *
 *  Fire-and-forget on purpose: the switch has already been persisted to our own
 *  Firestore prefs by the time this runs, and the CFs that send OUR pushes read
 *  that, not Joryio. If this call fails the user is still unsubscribed
 *  everywhere it matters to them; only Joryio's copy lags until the next save. */
export function setMarketingPush(subscribed: boolean): void {
  if (USE_MOCK_DATA) return;
  Joryio.setSubscription('push', subscribed ? 'subscribed' : 'unsubscribed');
}

export function flush(): void {
  if (USE_MOCK_DATA) return;
  Joryio.flush();
}

export const joryio = {
  init: initJoryio,
  track,
  identify,
  bindIdentity,
  resetIdentity,
  setAttributes,
  resetUser,
  registerPushToken,
  trackPushClick,
  reportPushDelivered,
  onInAppMessage,
  syncInAppCampaigns,
  trackInAppImpression,
  optOutTracking,
  optInTracking,
  isTrackingOptedOut,
  setMarketingPush,
  flush,
};
