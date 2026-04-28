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

/**
 * Lazy initializer. Throws if called while USE_MOCK_DATA is true so we never
 * accidentally hit the network in mock mode.
 */
export function getFirebase(): { app: FirebaseApp; db: Firestore; auth: Auth } {
  if (USE_MOCK_DATA) {
    throw new Error(
      'getFirebase() called while USE_MOCK_DATA is true. ' +
        'Fill in .env with your Firebase config to switch out of mock mode.'
    );
  }
  if (!_app) {
    _app = getApps()[0] ?? initializeApp(firebaseConfig);
    _db = getFirestore(_app);
    try {
      _auth = initializeAuth(_app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      // initializeAuth throws if already called (HMR / fast refresh path)
      _auth = getAuth(_app);
    }
  }
  return { app: _app!, db: _db!, auth: _auth! };
}

if (__DEV__) {
  // Surface mode at startup so dev confusion is one console line away.
  console.log(
    `[footy] mode: ${USE_MOCK_DATA ? 'MOCK' : 'FIREBASE'}` +
      (USE_MOCK_DATA && !FORCE_MOCK ? ' (config missing)' : '')
  );
}
