// Cold-start auth-race guard for Firestore reads.
//
// On a cold start (e.g. right after an app-update restart) the persisted
// session is restored — so `auth.currentUser` is already set — a few
// milliseconds BEFORE the ID token has attached to the Firestore channel. A
// query fired in that window reaches the rules with `request.auth == null` and
// fails `permission-denied`, even though the query itself is valid. It then
// self-recovers on the next read, so nothing is broken for long — but every
// occurrence is reported as a crash-grade error, and the user sees an empty
// screen until something re-reads.
//
// This wraps a read: on `permission-denied` WHILE a user session exists, it
// forces the token (which propagates it to the Firestore channel), waits a
// beat, and retries ONCE. A genuine "not signed in", or any non-permission
// error, rethrows immediately — so we never paper over a real rules bug.
//
// It lived inside gameService, which is why only that file's reads were
// protected: three reads on OTHER paths (hydrateUsers, hydratePlayers,
// getNearbyClubs) all failed within five seconds of the same cold start and
// landed in the production error log.
//
// CALLABLES hit the same race under a different name. A Cloud Function invoked
// in that window rejects with `functions/unauthenticated` rather than
// `permission-denied` — same cause, same cure, different string. That is what
// put `getAvailabilityCounts` in the production error log with "sign-in
// required" while a session plainly existed.
//
// TWO gaps this originally had, both found in the production error log after
// the first version shipped:
//
//   • It only retried when `auth.currentUser` was already set. But the race
//     has an earlier phase where the session is still being restored and
//     `currentUser` is null — exactly the worst moment — and there the guard
//     gave up instead of waiting. It now waits briefly for auth to settle.
//   • One retry after a fixed 300 ms was not always enough; a cold start on a
//     slow device can take longer. It now retries twice, backing off.
import { getFirebase } from './config';
import { onAuthStateChanged, type User } from 'firebase/auth';

/** The cold-start race, in both dialects: Firestore rules say permission-denied,
 *  a callable says unauthenticated. */
const RACE_CODES = new Set(['permission-denied', 'functions/unauthenticated']);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long each retry waits before trying again, backing off: long enough to
 *  cover a slow cold start, short enough that a genuine permission error still
 *  surfaces quickly.
 *
 *  Was [300, 900]. 1.1.6 took twelve `getTrustSummary` / permission-denied
 *  reports in its first twenty-two hours — a steady trickle across users
 *  rather than one broken account, which is the signature of a window that is
 *  simply too short. 1.2s does not cover a cold start on a mid-range Android
 *  where the session restores from disk before the ID token reaches the
 *  Firestore channel; 3.2s does, and a real denial still surfaces inside a
 *  few seconds. */
const RETRY_DELAYS_MS = [300, 900, 2000];

/**
 * The signed-in user, waiting up to `timeoutMs` for the session to restore.
 *
 * Resolves immediately when `currentUser` is already set. Otherwise it listens
 * for the restore — this is the phase the first version of this guard missed,
 * where the token has not arrived AND `currentUser` is still null, so a plain
 * null check concluded "not signed in" and rethrew a race as a real error.
 *
 * Resolves null when nobody signs in within the window, which is a genuine
 * signed-out state and must still rethrow.
 */
function awaitUser(timeoutMs: number): Promise<User | null> {
  const auth = getFirebase().auth;
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    let done = false;
    const finish = (u: User | null) => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      resolve(u);
    };
    const timer = setTimeout(() => finish(auth.currentUser), timeoutMs);
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) finish(u);
    });
  });
}

export async function withAuthRaceRetry<T>(run: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await run();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string })?.code;
      if (!code || !RACE_CODES.has(code)) throw err;
      if (attempt === RETRY_DELAYS_MS.length) break;

      // Wait for the session if it has not landed yet, then force the token —
      // which is what actually attaches it to the Firestore channel.
      const user = await awaitUser(RETRY_DELAYS_MS[attempt]);
      if (!user) throw err; // genuinely signed out
      try {
        await user.getIdToken();
      } catch {
        /* ignore — the next attempt surfaces any real failure */
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}
