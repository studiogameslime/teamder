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
  EmailAuthProvider,
  signInAnonymously as fbSignInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword as fbSignInWithEmailAndPassword,
  createUserWithEmailAndPassword as fbCreateUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  fetchSignInMethodsForEmail,
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
    // Also establish a native session so the widget/watch can control the timer.
    mirrorToNativeAuth((rn) => rn.GoogleAuthProvider.credential(data.idToken));
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

// ─── Email + password ─────────────────────────────────────────────────────
//
// A third sign-in option alongside Google/Apple. Same downstream identity
// (a Firebase Auth user → a /users/{uid} doc), so everything past sign-in is
// provider-agnostic. We send a verification email but DON'T block usage on it
// (verification only proves inbox control, not that the address is "real").

/** Thrown by `signUpWithEmail` when the address is already registered via a
 *  social provider — the caller surfaces "use Google/Apple instead". */
export class EmailRegisteredWithProviderError extends Error {
  provider: 'google' | 'apple';
  constructor(provider: 'google' | 'apple') {
    super(`email already registered with ${provider}`);
    this.name = 'EmailRegisteredWithProviderError';
    this.provider = provider;
  }
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<FirebaseUser> {
  if (USE_MOCK_DATA) throw new Error('signInWithEmail: USE_MOCK_DATA is true');
  const { auth } = getFirebase();
  const cred = await fbSignInWithEmailAndPassword(auth, email.trim(), password);
  // Mirror into native auth so the home widget + Wear watch get an
  // authenticated session to write the timer with (same as Google/Apple).
  mirrorEmailToNativeAuth(email.trim(), password);
  return cred.user;
}

export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<FirebaseUser> {
  if (USE_MOCK_DATA) throw new Error('signUpWithEmail: USE_MOCK_DATA is true');
  const { auth } = getFirebase();
  const trimmed = email.trim();
  try {
    const cred = await fbCreateUserWithEmailAndPassword(auth, trimmed, password);
    // Best-effort verification email — never block the sign-up on it.
    sendEmailVerification(cred.user).catch((e) => {
      if (__DEV__) console.warn('[auth] sendEmailVerification failed', e);
    });
    mirrorEmailToNativeAuth(trimmed, password);
    return cred.user;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? '';
    // Collision: this address is already a Firebase account. If it belongs to
    // a social provider, the user has no password to sign in with — guide
    // them to the right button instead of a dead "email in use" error.
    if (code === 'auth/email-already-in-use') {
      try {
        const methods = await fetchSignInMethodsForEmail(auth, trimmed);
        if (methods.includes('google.com')) {
          throw new EmailRegisteredWithProviderError('google');
        }
        if (methods.includes('apple.com')) {
          throw new EmailRegisteredWithProviderError('apple');
        }
      } catch (inner) {
        if (inner instanceof EmailRegisteredWithProviderError) throw inner;
        // fetch failed — fall through to the generic error below.
      }
    }
    throw err;
  }
}

export async function sendPasswordReset(email: string): Promise<void> {
  if (USE_MOCK_DATA) return;
  const { auth } = getFirebase();
  await sendPasswordResetEmail(auth, email.trim());
}

/** The current user's primary sign-in provider — drives provider-specific
 *  flows (e.g. which credential to use when re-auth is required for account
 *  deletion). */
export function currentAuthProviderId():
  | 'google.com'
  | 'apple.com'
  | 'password'
  | null {
  if (USE_MOCK_DATA) return null;
  const user = getFirebase().auth.currentUser;
  const pid = user?.providerData?.[0]?.providerId;
  if (pid === 'google.com' || pid === 'apple.com' || pid === 'password') {
    return pid;
  }
  return null;
}

/** Mirror an email/password sign-in into the NATIVE Firebase Auth session so
 *  the home widget + Wear relay can control the timer. Best-effort. */
function mirrorEmailToNativeAuth(email: string, password: string): void {
  if (Platform.OS !== 'android') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rnAuth = require('@react-native-firebase/auth').default;
    rnAuth()
      .signInWithEmailAndPassword(email, password)
      .catch((e: unknown) => {
        if (__DEV__) console.warn('[auth] native email mirror failed', e);
      });
  } catch (e) {
    if (__DEV__) console.warn('[auth] native-auth module unavailable', e);
  }
}

/**
 * Mirror the just-completed JS-SDK sign-in into the NATIVE Firebase Auth
 * (@react-native-firebase/auth). The app authenticates with the Firebase JS
 * SDK, whose session lives only in the JS layer — but the home-screen widget
 * AND the paired watch relay both write the timer from native Kotlin
 * (TimerActionReceiver), which reads the NATIVE FirebaseAuth.getInstance().
 * Without a native session that's always signed-out, so widget/watch timer
 * taps just showed "התחברו לאפליקציה" after the 8s auth-restore timeout.
 * Establishing a parallel native session (same user) gives those surfaces an
 * authenticated user to write with; it persists natively across process
 * restarts, so the cold widget process restores it. Best-effort +
 * non-blocking — a failure only leaves the widget/watch unauthed, never
 * breaks the app's primary JS-SDK sign-in.
 */
function mirrorToNativeAuth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  makeCredential: (rnAuth: any) => any,
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rnAuth = require('@react-native-firebase/auth').default;
    rnAuth()
      .signInWithCredential(makeCredential(rnAuth))
      .catch((e: unknown) => {
        if (__DEV__) console.warn('[auth] native-auth mirror failed', e);
      });
  } catch (e) {
    // Native module not linked (e.g. pre-rebuild) — widget stays unauthed.
    if (__DEV__) console.warn('[auth] native-auth module unavailable', e);
  }
}

/**
 * Establish the native Firebase Auth session on app boot for users who are
 * ALREADY signed in via the JS SDK. An app update does NOT sign the user out
 * (the JS session persists), so the sign-in-time mirror above never fires for
 * existing users — their widget/watch would stay unauthed forever after
 * updating. Here we silently re-acquire a Google idToken (no UI) and mirror it
 * into native auth, but ONLY when native is currently signed-out (so we don't
 * thrash a session that's already good). Best-effort + non-blocking; runs once
 * per boot from waitForAuthRestore. Google-only: the home widget + Wear relay
 * are Android surfaces, and Apple users on iOS have no native widget to feed.
 */
function ensureNativeAuthMirror(): void {
  if (Platform.OS !== 'android') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rnAuth = require('@react-native-firebase/auth').default;
    // Already have a native session — nothing to do.
    if (rnAuth().currentUser) return;
    ensureGoogleConfigured();
    GoogleSignin.signInSilently()
      .then((res: unknown) => {
        const idToken = (res as { data?: { idToken?: string }; idToken?: string })
          ?.data?.idToken ?? (res as { idToken?: string })?.idToken;
        if (!idToken) return;
        return rnAuth().signInWithCredential(
          rnAuth.GoogleAuthProvider.credential(idToken),
        );
      })
      .catch((e: unknown) => {
        // No cached Google session / silent sign-in unavailable — the user
        // can still re-login to activate the widget. Stay quiet in prod.
        if (__DEV__) console.warn('[auth] boot native-auth mirror skipped', e);
      });
  } catch (e) {
    if (__DEV__) console.warn('[auth] native-auth module unavailable', e);
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
    mirrorToNativeAuth((rn) =>
      rn.AppleAuthProvider.credential(appleCred.identityToken, rawNonce),
    );
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

/**
 * Sign in anonymously — the "browse as guest" entry point. Gives the client a
 * real Firebase uid so it can READ public communities/games (the rules require
 * `isSignedIn()`), without collecting any personal info. The guest never gets a
 * /users doc; account actions later prompt a full Google/Apple/email sign-in.
 */
export async function signInAnonymously(): Promise<FirebaseUser> {
  if (USE_MOCK_DATA) throw new Error('signInAnonymously: USE_MOCK_DATA is true');
  const { auth } = getFirebase();
  const cred = await fbSignInAnonymously(auth);
  return cred.user;
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
  // Tear down the parallel native session too (kept in sync with the JS one).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    await require('@react-native-firebase/auth').default().signOut();
  } catch {
    // Not signed in natively / module unavailable — fine.
  }
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
      // Existing users won't re-login on an app update, so the sign-in-time
      // native mirror never fires for them — re-establish it here on boot so
      // the home widget / Wear relay can control the timer. Fire-and-forget.
      if (user) ensureNativeAuthMirror();
      resolve(user);
    });
  });
}

/** Thrown by `deleteCurrentFirebaseUser` when an email/password user needs to
 *  re-enter their password to confirm deletion (Firebase requires a fresh
 *  login). The caller prompts for the password and retries with it. */
export class NeedsPasswordReauthError extends Error {
  constructor() {
    super('needs password reauth');
    this.name = 'NeedsPasswordReauthError';
  }
}

/**
 * Delete the currently signed-in Firebase Auth user. If Auth requires a
 * fresh login (the default after ~1h), we re-authenticate and retry once —
 * via Google for Google users, or via the supplied `password` for
 * email/password users. Throws on cancellation or any other error so the
 * caller can surface a Hebrew message.
 *
 * @param password Re-auth password for email/password accounts. When the
 *   account needs re-auth and no password is given, throws
 *   `NeedsPasswordReauthError` so the UI can prompt and retry.
 */
export async function deleteCurrentFirebaseUser(
  password?: string,
): Promise<void> {
  if (USE_MOCK_DATA) return;
  const { auth } = getFirebase();
  const user = auth.currentUser;
  if (!user) throw new Error('deleteCurrentFirebaseUser: no current user');
  try {
    await deleteUser(user);
  } catch (e: any) {
    logError('deleteAccount', e, { code: e?.code });
    if (e?.code !== 'auth/requires-recent-login') throw e;

    // Email/password accounts re-auth with the password (re-prompted by the
    // UI), NOT with the Google picker.
    if (currentAuthProviderId() === 'password') {
      if (!password) throw new NeedsPasswordReauthError();
      const email = user.email;
      if (!email) throw new Error('reauth: account has no email');
      const credential = EmailAuthProvider.credential(email, password);
      const fresh = getFirebase().auth.currentUser ?? user;
      await reauthenticateWithCredential(fresh, credential);
      await deleteUser(getFirebase().auth.currentUser ?? fresh);
      return;
    }

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
