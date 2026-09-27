// authUpgrade — turning an anonymous session into a real account.
//
// ONE normalisation of every provider's result and every way it can fail, so
// the contextual auth flow branches once here instead of at every call site.
// `src/firebase/auth.ts` keeps owning the provider mechanics; this owns the
// question "what happened, and what should the caller do about it".
//
// ─── Why hybrid ──────────────────────────────────────────────────────────
//
// Case A — the credential belongs to nobody yet. `linkWithCredential` promotes
// the anonymous user in place: SAME uid, session never drops, the navigator is
// never swapped and the screen the person was on is never unmounted. Whatever
// they had typed is still on screen.
//
// Case B — the credential is already somebody's account. Link throws
// `auth/credential-already-in-use`, and Firebase hands the credential back on
// the error. We sign in with it, which abandons the anonymous uid. The session
// DOES change here, which is exactly what PendingAction and draftStore exist
// to survive.
//
// What makes both safe is that a guest owns nothing: every write path is behind
// `ensureNotGuest`, and `buildGuestUser` never creates a /users document. There
// is no data to merge, so the usual reason to fear linking does not apply.
//
// The orphaned anonymous uid in Case B is left alone, deliberately. Deleting it
// would add a failure point to the most sensitive moment in the flow, and
// without a /users document it is not a business entity — see the decision in
// the design report.

import { Platform } from 'react-native';
import {
  GoogleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  signInWithCredential,
  type AuthCredential,
  type UserCredential,
} from 'firebase/auth';

import { getFirebase, USE_MOCK_DATA } from '@/firebase/config';
import {
  acquireGoogleCredential,
  acquireAppleCredential,
  mirrorCredentialToNativeAuth,
  currentAuthProviderId,
} from '@/firebase/auth';
import { logError } from '@/services/errorLog';
import { joryio } from '@/services/joryio';
import { AnalyticsEvent, logEvent } from '@/services/analyticsService';

/** The providers the contextual sheet can offer. No new ones — these are what
 *  the product already ships, and `email` deliberately routes to the existing
 *  EmailAuth screen rather than collecting a password inside a sheet. */
export type AuthMethod = 'google' | 'apple' | 'email';

export type UpgradeOutcome =
  /** Case A — same uid, session intact, nothing was torn down. */
  | { status: 'linked'; uid: string; isNewAccount: true }
  /** Case B — signed into an account that already existed. */
  | { status: 'switched'; uid: string; isNewAccount: false }
  /** The person backed out. NOT an error: nothing is lost and nothing is said. */
  | { status: 'cancelled' }
  /** A real failure. `code` is the Firebase code where there was one. */
  | { status: 'failed'; code: string; message?: string };

/**
 * Every way a provider says "the user backed out".
 *
 * Normalised because they do not agree: the Google SDK returns a
 * non-success response that `signInWithGoogle` turns into the message
 * 'Sign-in cancelled', Apple throws `ERR_REQUEST_CANCELED`, and the Firebase
 * layer has its own `auth/popup-closed-by-user` family. Treating any of them
 * as a failure would show somebody a red error for pressing Back.
 */
function isCancellation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  const code = String(e?.code ?? '');
  const msg = e?.message ?? '';
  return (
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'ERR_CANCELED' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/user-cancelled' ||
    code === '-5' || // Google Sign-In iOS: SIGN_IN_CANCELLED
    code === '12501' || // Google Sign-In Android: SIGN_IN_CANCELLED
    /cancel/i.test(msg)
  );
}

/**
 * The provider failed in a way that is the ENVIRONMENT's problem, not ours.
 *
 * These reach the error inbox as "פעולה נכשלה · upgradeAcquire" and there is
 * nothing in the app to fix for any of them:
 *
 *   8   Play Services INTERNAL_ERROR — a Google-side hiccup, or Play Services
 *       needing an update on that device
 *   -1  the iOS Google sheet failed to present or was dismissed without a
 *       result; indistinguishable from a cancel from our side
 *   7 / NETWORK_ERROR   no connection at the moment of the tap
 *   ERR_REQUEST_UNKNOWN Apple returned a request it would not explain, which
 *       in practice is a dismissed sheet
 *
 * The person sees the auth sheet stay put and taps again, which is the right
 * outcome. Logging them buried the denials that DO need looking at: three of
 * these in one day, on one user each, next to a real permission bug nobody
 * noticed for a week.
 *
 * They are still reported to analytics as `auth_failed` with the code, so the
 * rate stays visible — this only keeps them out of the error inbox.
 */
function isProviderEnvironmentFailure(err: unknown): boolean {
  const code = String((err as { code?: unknown } | null)?.code ?? '');
  return (
    code === '8' ||
    code === '-1' ||
    code === '7' ||
    code === 'ERR_REQUEST_UNKNOWN' ||
    code === 'NETWORK_ERROR'
  );
}

/**
 * The credential is already attached to another account.
 *
 * Three codes, not one. `credential-already-in-use` is the documented answer
 * from `linkWithCredential`; `email-already-in-use` comes back when the
 * provider's email collides; `account-exists-with-different-credential` is what
 * Firebase says when the address is registered under a DIFFERENT provider, and
 * that one cannot be resolved by retrying the same credential — see the note in
 * `upgradeAnonymous` below.
 */
function isAlreadyInUse(code: string): boolean {
  return (
    code === 'auth/credential-already-in-use' ||
    code === 'auth/email-already-in-use' ||
    code === 'auth/provider-already-linked'
  );
}

/** Firebase returns the credential ON the error for the already-in-use case,
 *  which is what makes the fallback possible without asking the person to
 *  authenticate a second time. */
function credentialFromError(err: unknown): AuthCredential | null {
  const e = err as { customData?: { _tokenResponse?: unknown }; credential?: unknown };
  // The modular SDK exposes it through the provider's own extractor.
  for (const extract of [
    () => GoogleAuthProvider.credentialFromError(err as never),
    () => OAuthProvider.credentialFromError(err as never),
  ]) {
    try {
      const c = extract();
      if (c) return c;
    } catch {
      /* not this provider */
    }
  }
  return (e?.credential as AuthCredential) ?? null;
}

interface Acquired {
  credential: AuthCredential;
  /** Re-establishes the native session the widget and watch read. */
  mirror: () => void;
  /** Apple hands the full name back ONLY on the first authorisation ever, so
   *  it has to be carried out of here or it is gone for good. */
  fullName?: string;
}

/** Ask the provider for a credential. Throws; the caller normalises. */
async function acquire(method: AuthMethod, email?: string, password?: string): Promise<Acquired> {
  if (method === 'google') {
    const { idToken } = await acquireGoogleCredential();
    return {
      credential: GoogleAuthProvider.credential(idToken),
      mirror: () => mirrorCredentialToNativeAuth((rn) => rn.GoogleAuthProvider.credential(idToken)),
    };
  }
  if (method === 'apple') {
    if (Platform.OS !== 'ios') throw new Error('Apple Sign-In is only available on iOS.');
    const { identityToken, rawNonce, fullName } = await acquireAppleCredential();
    const provider = new OAuthProvider('apple.com');
    return {
      credential: provider.credential({ idToken: identityToken, rawNonce }),
      mirror: () =>
        mirrorCredentialToNativeAuth((rn) =>
          rn.AppleAuthProvider.credential(identityToken, rawNonce),
        ),
      fullName,
    };
  }
  if (!email || !password) throw new Error('upgradeAnonymous: email and password required');
  return {
    credential: EmailAuthProvider.credential(email.trim(), password),
    mirror: () => {},
  };
}

export interface UpgradeResult extends Object {}

/**
 * Promote the current anonymous session to a real account, or sign into the
 * existing account the credential belongs to.
 *
 * Never throws. Every outcome is a value, because the caller's job is to decide
 * what to keep — and a thrown error at this point in the flow is how a pending
 * action gets lost.
 */
export async function upgradeAnonymous(
  method: AuthMethod,
  opts?: { email?: string; password?: string },
): Promise<UpgradeOutcome> {
  if (USE_MOCK_DATA) return { status: 'failed', code: 'mock-mode' };
  const { auth } = getFirebase();

  let acquired: Acquired;
  try {
    acquired = await acquire(method, opts?.email, opts?.password);
  } catch (err) {
    if (isCancellation(err)) return { status: 'cancelled' };
    const code = String((err as { code?: unknown })?.code ?? 'provider-failed');
    // Environment failures are reported to analytics by the caller, not to the
    // error inbox — see `isProviderEnvironmentFailure`.
    if (!isProviderEnvironmentFailure(err)) {
      logError('upgradeAcquire', err, { method, code });
    }
    return { status: 'failed', code, message: (err as Error)?.message };
  }

  const anonUser = auth.currentUser;
  const wasAnonymous = anonUser?.isAnonymous === true;

  // ── Case A ────────────────────────────────────────────────────────────
  if (wasAnonymous && anonUser) {
    try {
      const cred: UserCredential = await linkWithCredential(anonUser, acquired.credential);
      acquired.mirror();
      await bindUpgradedIdentity(cred.user.uid, method, true);
      return { status: 'linked', uid: cred.user.uid, isNewAccount: true };
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (isCancellation(err)) return { status: 'cancelled' };

      if (!isAlreadyInUse(code)) {
        // `account-exists-with-different-credential` lands here on purpose.
        // Retrying the same credential cannot resolve it — the address belongs
        // to a DIFFERENT provider, and the person has to use that provider's
        // button. `signUpWithEmail` already surfaces exactly that guidance via
        // EmailRegisteredWithProviderError; the sheet shows the message and
        // keeps the pending action, which is the correct outcome.
        logError('upgradeLink', err, { method, code });
        return { status: 'failed', code: code || 'link-failed', message: (err as Error)?.message };
      }

      // ── Case B ────────────────────────────────────────────────────────
      // Prefer the credential Firebase handed back on the error so the person
      // is not asked to authenticate twice.
      const recovered = credentialFromError(err) ?? acquired.credential;
      try {
        const cred = await signInWithCredential(auth, recovered);
        acquired.mirror();
        await bindUpgradedIdentity(cred.user.uid, method, false);
        return { status: 'switched', uid: cred.user.uid, isNewAccount: false };
      } catch (inner) {
        if (isCancellation(inner)) return { status: 'cancelled' };
        const icode = (inner as { code?: string })?.code ?? 'signin-failed';
        logError('upgradeFallbackSignIn', inner, { method, code: icode });
        return { status: 'failed', code: icode, message: (inner as Error)?.message };
      }
    }
  }

  // Not anonymous (or no session at all) — a plain sign-in. Keeps this the one
  // entry point the sheet needs, whatever state it is called from.
  try {
    const cred = await signInWithCredential(auth, acquired.credential);
    acquired.mirror();
    await bindUpgradedIdentity(cred.user.uid, method, false);
    return { status: 'switched', uid: cred.user.uid, isNewAccount: false };
  } catch (err) {
    if (isCancellation(err)) return { status: 'cancelled' };
    const code = (err as { code?: string })?.code ?? 'signin-failed';
    logError('upgradeSignIn', err, { method, code });
    return { status: 'failed', code, message: (err as Error)?.message };
  }
}

/**
 * Hand the anonymous run to the person who just appeared — alias, THEN identify.
 *
 * Called ONLY after a successful upgrade, which is what keeps the ordering
 * guarantees the design asked for: a cancellation reaches neither call, and a
 * failure never aliases early. `bindIdentity` itself is idempotent, so the
 * auth listener firing for the same uid a moment later is a no-op rather than
 * a second alias.
 */
async function bindUpgradedIdentity(
  uid: string,
  method: AuthMethod,
  isNew: boolean,
): Promise<void> {
  try {
    const what = await joryio.bindIdentity({ uid, isAnonymous: false });
    if (what === 'aliased') {
      logEvent(AnalyticsEvent.IdentityAliased, {
        provider: currentAuthProviderId() ?? method,
      });
    }
  } catch (err) {
    // Analytics identity must never be able to fail an authentication.
    logError('upgradeBindIdentity', err, { uid, method, isNew });
  }
}
