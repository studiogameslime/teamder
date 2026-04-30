// adsService — wraps react-native-google-mobile-ads with safe degradation.
//
// Key design choice: AdMob is OFF BY DEFAULT.
//
// To turn it on you must set `EXPO_PUBLIC_ADMOB_ENABLED=1` in .env *and*
// have the native module installed in a custom dev client. With the flag
// off, every entry point in this file is a fast no-op and the require call
// is never executed — so a missing/incompatible native module can't crash
// the app.
//
// With the flag on:
//   1. `npx expo install react-native-google-mobile-ads`
//   2. Add it to app.json plugins with your AdMob app IDs.
//   3. Build a custom dev client (`eas build --profile development`).
//      AdMob does NOT work in Expo Go.

import React from 'react';
import { View } from 'react-native';

// ─── Feature flag ─────────────────────────────────────────────────────────
// We deliberately gate the entire ads system behind an explicit env var so
// the require() call below is unreachable code unless the user opted in.
// Metro's static analysis can produce a "Requiring unknown module" runtime
// error if a literal string require() can't be resolved at bundle time, and
// that error escapes ordinary try/catch. The flag avoids the require entirely.
const ADS_ENABLED = (process.env.EXPO_PUBLIC_ADMOB_ENABLED ?? '').trim() === '1';
/**
 * Internal-testing escape hatch. When set to '1', the banner + app-open
 * ad unit IDs ALWAYS resolve to AdMob's test IDs even in release
 * builds. Lets us verify the ad slot renders on a real device while
 * the production AdMob unit is still warming up (fresh units often
 * start at 0% fill). Per AdMob TOS this is allowed for internal /
 * pre-launch testing builds only — flip it off before publishing.
 */
const FORCE_TEST_IDS =
  (process.env.EXPO_PUBLIC_ADMOB_USE_TEST_IDS ?? '').trim() === '1';

// ─── Module loading ───────────────────────────────────────────────────────

type AdsModule = {
  // v14.x exposes the SDK singleton via a factory function
  // (`MobileAds()`); the namespace default export is that same factory.
  default: () => { initialize: () => Promise<unknown> };
  MobileAds?: () => { initialize: () => Promise<unknown> };
  BannerAd: React.ComponentType<{
    unitId: string;
    size: string;
    requestOptions?: { requestNonPersonalizedAdsOnly?: boolean };
    onAdLoaded?: () => void;
    onAdFailedToLoad?: (err: unknown) => void;
  }>;
  BannerAdSize: Record<string, string>;
  TestIds: { BANNER: string; APP_OPEN: string };
  AppOpenAd: {
    createForAdRequest: (
      unitId: string,
      options?: { requestNonPersonalizedAdsOnly?: boolean }
    ) => {
      load: () => void;
      show: () => Promise<unknown>;
      addAdEventListener: (event: string, cb: () => void) => () => void;
      loaded: boolean;
    };
  };
  AdEventType: { LOADED: string; ERROR: string; CLOSED: string };
};

let adsMod: AdsModule | null = null;
let loadAttempted = false;

function loadAdsMod(): AdsModule | null {
  if (loadAttempted) return adsMod;
  loadAttempted = true;
  if (!ADS_ENABLED) return null; // never attempt the require unless opted in
  try {
    // Use a variable for the module name so Metro can't pre-resolve it at
    // bundle time. Without this indirection, an unresolvable literal
    // require() emits a runtime stub whose throw escapes ordinary
    // try/catch in some Metro configurations.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const moduleName: string = 'react-native-google-mobile-ads';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(moduleName);
    adsMod = mod && typeof mod === 'object' ? (mod as AdsModule) : null;
  } catch (err) {
    if (__DEV__) console.warn('[ads] native module not available — ads disabled', err);
    adsMod = null;
  }
  return adsMod;
}

// ─── Unit IDs ─────────────────────────────────────────────────────────────

function val(v: string | undefined): string {
  return (v ?? '').trim();
}

function bannerUnitId(): string {
  if (!adsMod) return '';
  if (__DEV__ || FORCE_TEST_IDS) return adsMod.TestIds.BANNER ?? '';
  return val(process.env.EXPO_PUBLIC_ADMOB_BANNER_UNIT_ID);
}

function appOpenUnitId(): string {
  if (!adsMod) return '';
  if (__DEV__ || FORCE_TEST_IDS) return adsMod.TestIds.APP_OPEN ?? '';
  return val(process.env.EXPO_PUBLIC_ADMOB_APP_OPEN_UNIT_ID);
}

// ─── Service ──────────────────────────────────────────────────────────────

let initialized = false;
// Resolves once `MobileAds().initialize()` has actually completed. The
// banner component awaits this before rendering — without it, the
// native banner can mount before the SDK is ready and silently no-op.
// (App-open works either way because `appOpenAdHandle.load()` is called
// AFTER `await sdk.initialize()` in `initializeAds` itself.)
let initResolve: (() => void) | null = null;
const initReady: Promise<void> = new Promise((res) => {
  initResolve = res;
});
let appOpenShownThisSession = false;
let appOpenAdHandle: ReturnType<AdsModule['AppOpenAd']['createForAdRequest']> | null =
  null;

export const adsService = {
  /** Idempotent. Safe to call from app boot. Always swallows errors. */
  async initializeAds(): Promise<void> {
    if (initialized) return;
    initialized = true;
    // Whichever branch we exit through, unblock any BannerAd that's
    // already mounted. `initResolve()` is one-shot (the Promise resolves
    // exactly once), so calling it on every path is safe.
    try {
      if (!ADS_ENABLED) return;
      let mod: AdsModule | null = null;
      try {
        mod = loadAdsMod();
      } catch (err) {
        if (__DEV__) console.warn('[ads] loadAdsMod threw', err);
        return;
      }
      if (!mod) return;
      try {
        // v14.x: default export is a factory; call it to get the singleton.
        const sdk =
          typeof mod.default === 'function'
            ? mod.default()
            : (mod.MobileAds?.() ?? null);
        if (!sdk) {
          if (__DEV__) console.warn('[ads] no MobileAds singleton in module');
          return;
        }
        await sdk.initialize();
        const id = appOpenUnitId();
        if (id) {
          appOpenAdHandle = mod.AppOpenAd.createForAdRequest(id, {
            requestNonPersonalizedAdsOnly: true,
          });
          appOpenAdHandle.load();
        }
      } catch (err) {
        if (__DEV__) console.warn('[ads] initializeAds failed', err);
      }
    } finally {
      initResolve?.();
    }
  },

  /** Show pre-warmed app-open ad, once per session. Always swallows errors. */
  async showAppOpenAdIfAvailable(opts?: { skip?: boolean }): Promise<void> {
    if (SCREENSHOT_MODE) return;
    if (opts?.skip) return;
    if (!ADS_ENABLED) return;
    if (appOpenShownThisSession) return;
    let mod: AdsModule | null = null;
    try {
      mod = loadAdsMod();
    } catch {
      return;
    }
    if (!mod || !appOpenAdHandle) return;
    if (!appOpenAdHandle.loaded) return;
    try {
      appOpenShownThisSession = true;
      await appOpenAdHandle.show();
    } catch (err) {
      if (__DEV__) console.warn('[ads] showAppOpenAdIfAvailable failed', err);
    }
  },
};

// ─── BannerAd component ───────────────────────────────────────────────────
// Renders nothing when the flag is off, the native module isn't available,
// no unit id is configured, or the underlying ad fails to load. Callers can
// render this unconditionally without worrying about feature detection.
// Built with React.createElement so this file can stay .ts (no JSX).

// ⚠️ SCREENSHOT MODE — flip SCREENSHOT_MODE back to false when
// finished capturing for the Play Store. Hides both BannerAd and
// the App Open ad.
const SCREENSHOT_MODE = false;

export function BannerAd(): React.ReactElement | null {
  const [failed, setFailed] = React.useState(false);
  // Gate the actual native render until MobileAds().initialize() has
  // resolved. Without this, the banner can mount before the SDK is
  // ready and the native side silently never sends a request — which
  // matches the "0 requests" symptom we saw in AdMob console.
  const [ready, setReady] = React.useState(initialized);
  React.useEffect(() => {
    if (ready) return;
    let alive = true;
    initReady.then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [ready]);

  if (SCREENSHOT_MODE) return null;
  if (!ADS_ENABLED || failed || !ready) return null;
  let mod: AdsModule | null = null;
  try {
    mod = loadAdsMod();
  } catch {
    return null;
  }
  if (!mod) return null;
  const unitId = bannerUnitId();
  if (!unitId) return null;
  const Banner = mod.BannerAd;
  // Use the fixed `BANNER` size (320×50). The adaptive variant requires
  // the parent View to have a measurable width before it can request an
  // ad, and our TabBar wrapper didn't always provide one — so the
  // request never left the device. A fixed size sidesteps the layout
  // chicken-and-egg.
  const size =
    (mod.BannerAdSize as Record<string, string> | undefined)?.BANNER ??
    'BANNER';
  return React.createElement(
    View,
    {
      style: {
        width: '100%',
        alignItems: 'center',
        backgroundColor: 'transparent',
      },
    },
    React.createElement(Banner, {
      unitId,
      size,
      requestOptions: { requestNonPersonalizedAdsOnly: true },
      onAdLoaded: () => {
        if (__DEV__) console.log('[ads] banner loaded', unitId);
      },
      onAdFailedToLoad: (err: unknown) => {
        if (__DEV__) console.warn('[ads] banner load failed', err);
        setFailed(true);
      },
    })
  );
}

// Test helper
export function __resetAdsForTests() {
  initialized = false;
  appOpenShownThisSession = false;
  appOpenAdHandle = null;
  loadAttempted = false;
  adsMod = null;
}
