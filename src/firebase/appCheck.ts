// App Check wiring.
//
// Two layers, because we have a hybrid SDK setup:
//   • `@react-native-firebase/app-check` — native module that talks to
//     Play Integrity (production) or the debug provider (development).
//   • `firebase/app-check` (JS) — the JS Firestore / Auth / Storage /
//     Functions SDKs read App Check tokens through this surface. We
//     wire a `CustomProvider` that delegates to the native module so
//     the same token the OS issues is attached to outbound JS-SDK
//     requests.
//
// Without the JS bridge, native App Check would only protect calls
// that go through @react-native-firebase/* (we mostly use the JS SDK
// for Firestore / Storage / Auth / Functions). The bridge ensures
// every Firestore read+write, every Storage upload, every callable
// invocation carries an App Check header.
//
// Production mode: Play Integrity. Requires:
//   • Firebase Console → App Check → Apps → Android → Register Play
//     Integrity (use the SHA-256 fingerprint from `google-services.json`
//     or `gradlew signingReport`).
//   • Play Console → Setup → App Integrity → API access linked to
//     this Firebase project.
//   • App Check enforcement turned ON in the console for Firestore +
//     Storage + Functions.
//
// Development mode: a "debug" provider — emits a token your project
// can recognise without a Play Integrity verdict. Boot the dev client,
// copy the debug token printed in logcat, and paste it into Firebase
// Console → App Check → Apps → Manage debug tokens. Tokens are
// per-device-install; rebuilding the dev client mints a new one.

import { Platform } from 'react-native';
import { CustomProvider, initializeAppCheck } from 'firebase/app-check';
import { FirebaseApp } from 'firebase/app';

let initialized = false;

const NATIVE_TOKEN_REFRESH_MS = 30 * 60 * 1000; // 30 min — Play Integrity TTL.

/**
 * Boot the JS-SDK App Check pipeline. Call once near app startup,
 * BEFORE any Firestore / Storage / Functions request. The boot is
 * lazy — if the native module isn't linked (Expo Go, fresh dev
 * client before rebuild), we silently skip and the JS SDK falls
 * back to no-token mode. With enforcement OFF in the console that's
 * harmless; with enforcement ON those calls will be rejected.
 */
export async function initAppCheck(app: FirebaseApp): Promise<void> {
  if (initialized) return;
  initialized = true;

  // Lazy require so missing native module → graceful no-op rather
  // than a top-level import crash on devices that don't have
  // @react-native-firebase/app-check linked yet.
  type NativeModule = {
    default?: () => {
      newReactNativeFirebaseAppCheckProvider: () => {
        configure: (cfg: unknown) => void;
      };
      initializeAppCheck: (opts: unknown) => Promise<void>;
      getToken: (forceRefresh?: boolean) => Promise<{ token: string }>;
    };
  };
  let appCheckMod: NativeModule['default'] | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require('@react-native-firebase/app-check') as NativeModule;
    appCheckMod = m?.default ?? null;
  } catch (err) {
    if (__DEV__) {
      console.warn(
        '[appCheck] native module not linked — skipping App Check init',
        err,
      );
    }
    return;
  }
  if (!appCheckMod) return;

  // 1) Configure + init native App Check.
  try {
    const native = appCheckMod();
    const provider = native.newReactNativeFirebaseAppCheckProvider();
    if (__DEV__) {
      // Debug provider — Firebase mints a stable token printed once
      // to logcat. Paste it into Firebase Console → App Check → Apps
      // → Manage debug tokens to whitelist the device.
      provider.configure({
        android: {
          provider: 'debug',
          debugToken:
            (process.env.EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN as string) ||
            undefined,
        },
        apple: { provider: 'debug' },
      });
    } else {
      provider.configure({
        android: { provider: 'playIntegrity' },
        apple: { provider: Platform.OS === 'ios' ? 'appAttest' : 'debug' },
      });
    }
    await native.initializeAppCheck({
      provider,
      isTokenAutoRefreshEnabled: true,
    });
  } catch (err) {
    if (__DEV__) {
      console.warn('[appCheck] native init failed', err);
    }
    return;
  }

  // 2) Bridge native → JS SDK via CustomProvider. Every getToken call
  //    on the JS side delegates to the native module so Firestore /
  //    Storage / Functions JS clients receive the same Play Integrity
  //    verdict the native side just produced.
  try {
    const native = appCheckMod();
    const customProvider = new CustomProvider({
      getToken: async () => {
        const result = await native.getToken();
        return {
          token: result.token,
          // Play Integrity tokens are valid for ~1h; refresh well
          // before that so an expired token never reaches a request.
          expireTimeMillis: Date.now() + NATIVE_TOKEN_REFRESH_MS,
        };
      },
    });
    initializeAppCheck(app, {
      provider: customProvider,
      isTokenAutoRefreshEnabled: true,
    });
    if (__DEV__) {
      console.log('[appCheck] initialized (debug mode)');
    }
  } catch (err) {
    if (__DEV__) {
      console.warn('[appCheck] JS SDK bridge failed', err);
    }
  }
}
