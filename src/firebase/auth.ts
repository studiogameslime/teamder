// Real Google Sign-In.
//
// Android: native Google account picker via
//   @react-native-google-signin/google-signin. Configured with the Web Client
//   ID (the audience Firebase Auth expects on the id_token). Requires a dev
//   build — Expo Go can't load native modules.
//
// iOS / web: not yet wired. expo-auth-session would be the path here when
//   needed.

import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFirebase, googleOAuth, USE_MOCK_DATA } from './config';
import { Player } from '@/types';

const EXPECTED_PROJECT_NUMBER = '559368532219';

let _googleConfigured = false;
function ensureGoogleConfigured() {
  if (_googleConfigured) return;
  if (!googleOAuth.webClientId) {
    throw new Error(
      'Google OAuth Web Client ID not configured. ' +
        'Set EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID in .env.'
    );
  }
  if (!googleOAuth.webClientId.startsWith(EXPECTED_PROJECT_NUMBER)) {
    console.warn(
      `[auth] webClientId does not start with project number ${EXPECTED_PROJECT_NUMBER} — ` +
        `Firebase will reject id_tokens with a different audience. Got: ${googleOAuth.webClientId}`
    );
  }
  GoogleSignin.configure({
    webClientId: googleOAuth.webClientId,
    offlineAccess: false,
  });
  _googleConfigured = true;
}

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
}

export async function signInWithGoogle(): Promise<FirebaseUser> {
  if (USE_MOCK_DATA) {
    throw new Error('signInWithGoogle: USE_MOCK_DATA is true');
  }
  if (Platform.OS !== 'android') {
    throw new Error(
      `Google Sign-In not yet wired for platform=${Platform.OS}.`
    );
  }
  const { auth } = getFirebase();

  ensureGoogleConfigured();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const result = await GoogleSignin.signIn();
  if (!isSuccessResponse(result)) {
    throw new Error('Sign-in cancelled');
  }

  const data = result.data;

  if (!data.idToken) {
    throw new Error('Google Sign-In succeeded but no idToken was returned');
  }

  const credential = GoogleAuthProvider.credential(data.idToken);
  try {
    const cred = await signInWithCredential(auth, credential);
    return cred.user;
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string; customData?: unknown };
    console.error('[auth] Firebase signInWithCredential FAILED', {
      name: e.name,
      code: e.code,
      message: e.message,
      customData: e.customData,
    });
    const code = e.code ?? 'unknown';
    throw new Error(`ההתחברות ל-Firebase נכשלה (${code})`);
  }
}

export async function signOutFirebase(): Promise<void> {
  if (USE_MOCK_DATA) return;
  // Sign out from native Google too so the next sign-in shows the picker
  // rather than silently re-using the cached account.
  if (Platform.OS === 'android' && _googleConfigured) {
    try {
      await GoogleSignin.signOut();
    } catch {
      // best-effort
    }
  }
  const { auth } = getFirebase();
  await firebaseSignOut(auth);
}

/**
 * Resolves once Firebase has restored the persisted auth session (or
 * confirmed there is none). Used at app boot before reading auth.currentUser
 * since it'll be null on cold start.
 */
export function waitForAuthRestore(): Promise<FirebaseUser | null> {
  if (USE_MOCK_DATA) return Promise.resolve(null);
  const { auth } = getFirebase();
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

// ─── Legacy helper kept so the old import path still resolves ──────────────
export function authUserToPlayer(u: AuthUser): Player {
  return { id: u.uid, displayName: u.displayName, avatarUrl: u.photoUrl };
}
