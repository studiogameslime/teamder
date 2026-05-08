// ============================================================
// FIREBASE CONFIG
// ============================================================
// Reads config from EXPO_PUBLIC_* env vars (see .env.example).
// If config is missing OR partially filled, the app automatically falls
// back to mock mode — every service in src/services/* checks USE_MOCK_DATA
// and chooses the in-memory branch instead of calling Firebase.
// ============================================================

import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import {
  initializeAuth,
  getAuth,
  // @ts-ignore — getReactNativePersistence is exported but missing from
  // firebase's TypeScript bundle in some versions; safe to ignore.
  getReactNativePersistence,
  Auth,
} from 'firebase/auth';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { getFunctions, Functions } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    _db = getFirestore(_app);
    _storage = getStorage(_app);
    // The CF region must match `setGlobalOptions({ region })` in
    // functions/src/index.ts — otherwise the SDK calls the default
    // us-central1 endpoint and we'd get 404 / unauthenticated errors
    // for any callable that lives elsewhere.
    _functions = getFunctions(_app, 'us-central1');
    try {
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

