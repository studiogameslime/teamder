// ============================================================
// FIREBASE CONFIG
// ============================================================
// Reads config from EXPO_PUBLIC_* env vars (see .env.example).
// If config is missing OR partially filled, the app automatically falls
// back to mock mode — every service in src/services/* checks USE_MOCK_DATA
// and chooses the in-memory branch instead of calling Firebase.
// ============================================================

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  Firestore,
} from 'firebase/firestore';
import {
  initializeAuth,
  getAuth,
  Auth,
  type Persistence,
} from 'firebase/auth';
// `getReactNativePersistence` was dropped from the umbrella `firebase/auth`
// bundle in v12 but still lives in the inner `@firebase/auth` package's
// React Native build (`dist/rn/index.js`), which Metro resolves via the
// package's `"react-native"` exports condition. TypeScript resolves the
// default condition (which doesn't expose the symbol), so we require the
// runtime module dynamically here — Metro picks the RN entry, types stay
// clean. AsyncStorage-backed persistence restores cross-launch sign-in.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getReactNativePersistence } = require('@firebase/auth') as {
  getReactNativePersistence: (storage: unknown) => Persistence;
};
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFunctions, Functions } from 'firebase/functions';

function val(v: string | undefined): string {
  return (v ?? '').trim();
}

const firebaseConfig = {
  apiKey: val(process.env.EXPO_PUBLIC_FIREBASE_API_KEY),
  authDomain: val(process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: val(process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: val(process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: val(process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: val(process.env.EXPO_PUBLIC_FIREBASE_APP_ID),
  measurementId: val(process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID),
};

export const googleOAuth = {
  webClientId: val(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID),
  iosClientId: val(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID),
  androidClientId: val(process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID),
};

const FORCE_MOCK = val(process.env.EXPO_PUBLIC_FOOTY_FORCE_MOCK) === '1';

/** True if all minimally-required Firebase fields are filled in. */
export const FIREBASE_CONFIGURED: boolean =
  !FORCE_MOCK &&
  !!firebaseConfig.apiKey &&
  !!firebaseConfig.projectId &&
  !!firebaseConfig.appId &&
  firebaseConfig.apiKey !== 'REPLACE_ME';

/**
 * The app is in mock mode when Firebase config is missing or the user has
 * forced it. All services check this flag and route reads/writes to the
 * in-memory mock data layer when true.
 */
export const USE_MOCK_DATA: boolean = !FIREBASE_CONFIGURED;

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;
let _auth: Auth | null = null;
let _storage: FirebaseStorage | null = null;
let _functions: Functions | null = null;

/**
 * Lazy initializer. Throws if called while USE_MOCK_DATA is true so we never
 * accidentally hit the network in mock mode.
 */
export function getFirebase(): {
  app: FirebaseApp;
  db: Firestore;
  auth: Auth;
  storage: FirebaseStorage;
  functions: Functions;
} {
  if (USE_MOCK_DATA) {
    throw new Error(
      'getFirebase() called while USE_MOCK_DATA is true. ' +
        'Fill in .env with your Firebase config to switch out of mock mode.'
    );
  }
  if (!_app) {
    _app = getApps()[0] ?? initializeApp(firebaseConfig);
    // Initialize Firestore with auto-detect long polling. The default
    // WebChannel transport stalls under some networks / Android
    // emulators, causing every read to time out after 10s with
    // "Could not reach Cloud Firestore backend" — even though the
    // device has working internet. Auto-detect falls back to HTTP
    // long-polling when WebChannel fails, fixing offline-loops on
    // restored sessions where the user is signed in via persisted
    // Auth but the /users/{uid} read silently fails.
    try {
      _db = initializeFirestore(_app, {
        experimentalAutoDetectLongPolling: true,
      });
    } catch {
      // Already initialised (HMR / fast refresh) — fall back to the
      // existing instance.
      _db = getFirestore(_app);
    }
    _storage = getStorage(_app);
    // The CF region must match `setGlobalOptions({ region })` in
    // functions/src/index.ts — otherwise the SDK calls the default
    // us-central1 endpoint and we'd get 404 / unauthenticated errors
    // for any callable that lives elsewhere.
    _functions = getFunctions(_app, 'us-central1');
    try {
      // AsyncStorage-backed persistence — the user stays signed in
      // across cold starts. `getReactNativePersistence` is sourced
      // from `@firebase/auth` directly (see import note above) because
      // the umbrella `firebase/auth` package stopped re-exporting it
      // in v12.
      _auth = initializeAuth(_app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      // initializeAuth throws if already called (HMR / fast refresh path)
      _auth = getAuth(_app);
    }
    // App Check must be initialised BEFORE any outbound Firestore /
    // Storage / Functions request so the very first call carries an
    // App Check token. Doing it here (right after the app instance
    // is created and before _db/_storage are returned to callers)
    // is the only synchronous-enough hook. The init itself is async
    // but the token fetch is lazy — the JS SDKs queue requests until
    // the first token resolves.
    //
    // Lazy-required so a missing native module doesn't break the
    // existing config import chain.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { initAppCheck } = require('./appCheck');
      void initAppCheck(_app);
    } catch {
      // appCheck.ts itself swallows missing-module errors; this catch
      // is just for any unexpected import-level explosion.
    }
  }
  if (!_storage) _storage = getStorage(_app);
  if (!_functions) _functions = getFunctions(_app, 'us-central1');
  return {
    app: _app!,
    db: _db!,
    auth: _auth!,
    storage: _storage!,
    functions: _functions!,
  };
}

