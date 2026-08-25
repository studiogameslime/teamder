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
import { getFirebase } from './config';

export async function withAuthRaceRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const user = getFirebase().auth.currentUser;
    if (code === 'permission-denied' && user) {
      try {
        await user.getIdToken();
      } catch {
        /* ignore — the retry below surfaces any real failure */
      }
      await new Promise((r) => setTimeout(r, 300));
      return await run();
    }
    throw err;
  }
}
