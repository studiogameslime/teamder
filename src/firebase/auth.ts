// Real Google Sign-In.
//
// Android + iOS: native Google account picker via
//   @react-native-google-signin/google-signin. Configured with the Web Client
//   ID (the audience Firebase Auth expects on the id_token); on iOS we also
//   pass iosClientId so the SDK can hand off to the system picker. Requires
//   a dev/production build — Expo Go can't load native modules.
//
// Web: not yet wired. expo-auth-session would be the path here when needed.

import { Platform } from 'react-native';
import {
  GoogleSignin,
  isSuccessResponse,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  reauthenticateWithCredential,
  deleteUser,
  User as FirebaseUser,
} from 'firebase/auth';
import { getFirebase, googleOAuth, USE_MOCK_DATA } from './config';
import { logError } from '@/services/errorLog';
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
    if (__DEV__) {
      console.warn(
        `[auth] webClientId does not start with project number ${EXPECTED_PROJECT_NUMBER} — ` +
          `Firebase will reject id_tokens with a different audience. Got: ${googleOAuth.webClientId}`
      );
    }
  }
  GoogleSignin.configure({
    webClientId: googleOAuth.webClientId,
    // iOS requires its own client ID — the Web ID alone isn't enough
    // for the GoogleSignIn SDK to drive the native picker. The value
    // comes from GoogleService-Info.plist (CLIENT_ID, NOT the
    // ANDROID_CLIENT_ID). When the env var is missing the SDK falls
    // back gracefully on Android.
    iosClientId: googleOAuth.iosClientId || undefined,
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
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error(
      `Google Sign-In not yet wired for platform=${Platform.OS}.`
    );
  }
  const { auth } = getFirebase();

  ensureGoogleConfigured();
  // hasPlayServices is an Android-only gate. The SDK no-ops on iOS but
  // the call still throws spurious warnings — skip it cleanly.
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }

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
    logError('signInGoogle', err, { provider: 'google', code: e?.code });
    if (__DEV__) {
      console.error('[auth] Firebase signInWithCredential FAILED', {
        name: e.name,
        code: e.code,
        message: e.message,
        customData: e.customData,
      });
    }
    const code = e.code ?? 'unknown';
    throw new Error(`ההתחברות ל-Firebase נכשלה (${code})`);
  }
}

/** Whether "Sign in with Apple" is usable on this device (iOS 13+). */
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Sign in with Apple → Firebase. Apple is REQUIRED by App Store
 * Guideline 4.8 as an equivalent option alongside Google. We bridge
 * Apple's identity token into Firebase via the `apple.com` OAuth
 * provider, using a hashed nonce to bind the token to this request
 * (replay protection — Firebase verifies the rawNonce matches the
 * SHA-256 carried inside the token).
 *
 * Apple returns the user's full name ONLY on the very first
 * authorization, so we surface it to the caller; later sign-ins carry
 * no name and we fall back to whatever's already on the Firebase user.
 */
export async function signInWithApple(): Promise<{
  user: FirebaseUser;
  fullName?: string;
}> {
  if (USE_MOCK_DATA) {
    throw new Error('signInWithApple: USE_MOCK_DATA is true');
  }
  if (Platform.OS !== 'ios') {
    throw new Error('Apple Sign-In is only available on iOS.');
  }
  const { auth } = getFirebase();

  const rawNonce = Array.from(Crypto.getRandomBytes(32))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce,
  );

  let appleCred: AppleAuthentication.AppleAuthenticationCredential;
  try {
    appleCred = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') {
      throw new Error('Sign-in cancelled');
    }
    throw err;
  }

  if (!appleCred.identityToken) {
    throw new Error('Apple Sign-In succeeded but no identityToken was returned');
  }

  const provider = new OAuthProvider('apple.com');
  const credential = provider.credential({
    idToken: appleCred.identityToken,
    rawNonce,
  });

  const fullName = appleCred.fullName
    ? [appleCred.fullName.givenName, appleCred.fullName.familyName]
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';

  try {
    const cred = await signInWithCredential(auth, credential);
    return { user: cred.user, fullName: fullName || undefined };
  } catch (err) {
    const e = err as { code?: string };
    logError('signInApple', err, { provider: 'apple', code: e?.code });
    if (__DEV__) {
      console.error('[auth] Firebase Apple signInWithCredential FAILED', e);
    }
    throw new Error(`ההתחברות ל-Firebase נכשלה (${e.code ?? 'unknown'})`);
  }
}

export async function signOutFirebase(): Promise<void> {
  if (USE_MOCK_DATA) return;
  // Sign out from native Google too so the next sign-in shows the picker
  // rather than silently re-using the cached account.
  if (Platform.OS === 'android' && _googleConfigured) {
    try {
      await GoogleSignin.signOut();
    } catch (e) {
      logError('signOut', e, {});
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

/**
 * Delete the currently signed-in Firebase Auth user. If Auth requires a
 * fresh login (the default after ~1h), we re-authenticate silently via
 * Google and retry once. Throws on cancellation or any other error so
 * the caller can surface a Hebrew message.
 */
export async function deleteCurrentFirebaseUser(): Promise<void> {
  if (USE_MOCK_DATA) return;
  const { auth } = getFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('deleteCurrentFirebaseUser: no current user');
  try {
    await deleteUser(user);
  } catch (e: any) {
    logError('deleteAccount', e, { code: e?.code });
    if (e?.code !== 'auth/requires-recent-login') throw e;
    if (Platform.OS !== 'android' && Platform.OS !== 'ios') throw e;
    ensureGoogleConfigured();
    await GoogleSignin.signOut().catch(() => {});
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) {
      throw new Error('reauth: cancelled');
    }
    const idToken = res.data?.idToken;
    if (!idToken) throw new Error('reauth: no idToken');
    const credential = GoogleAuthProvider.credential(idToken);
    const fresh = getFirebase().auth.currentUser ?? user;
    await reauthenticateWithCredential(fresh, credential);
    await deleteUser(getFirebase().auth.currentUser ?? fresh);
  }
}

// ─── Legacy helper kept so the old import path still resolves ──────────────
export function authUserToPlayer(u: AuthUser): Player {
  return { id: u.uid, displayName: u.displayName, avatarUrl: u.photoUrl };
}
