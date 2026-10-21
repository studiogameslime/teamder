import { observeCaughtError } from '../utils/errorObservation';
type Stop = () => void;
type SessionListener = { uid: string; start: () => void; stop: Stop };

const listeners = new Set<SessionListener>();
const suspensions = new Map<string, number>();

/** Own a realtime read for one identity. Old callbacks never become current
 * again, even if a failed sign-out resumes the same account's listener. */
export function subscribeUserSession(
  uid: string,
  isCurrentIdentity: () => boolean,
  attach: (isActive: () => boolean) => Stop,
  onError: (error: unknown) => void,
): Stop {
  let closed = false;
  let generation = 0;
  let unsubscribe: Stop | undefined;
  const allowed = () => !closed && !suspensions.has(uid) && isCurrentIdentity();
  const entry: SessionListener = {
    uid,
    stop: () => {
      ++generation;
      const stop = unsubscribe;
      unsubscribe = undefined;
      stop?.();
    },
    start: () => {
      if (!allowed() || unsubscribe) return;
      const ownGeneration = ++generation;
      const isActive = () => allowed() && generation === ownGeneration;
      try {
        const stop = attach(isActive);
        if (isActive()) unsubscribe = stop;
        else stop();
      } catch (error) {
    observeCaughtError(error, {"source":"src/services/userSessionListeners.ts","handler":"start","site":"userSessionListeners:507bf1bff9"});
        const report = isActive();
        ++generation;
        if (report) onError(error);
      }
    },
  };
  listeners.add(entry);
  entry.start();
  return () => {
    if (closed) return;
    closed = true;
    listeners.delete(entry);
    entry.stop();
  };
}

/** Stop account reads synchronously BEFORE auth is revoked. Release resumes
 * only listeners whose identity is still current (e.g. sign-out failed).
 * New listeners opened while teardown awaits are suspended too. */
export function suspendUserSessionListeners(uid: string): Stop {
  suspensions.set(uid, (suspensions.get(uid) ?? 0) + 1);
  for (const listener of listeners) if (listener.uid === uid) listener.stop();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (suspensions.get(uid) ?? 1) - 1;
    if (remaining) {
      suspensions.set(uid, remaining);
      return;
    }
    suspensions.delete(uid);
    for (const listener of listeners) if (listener.uid === uid) listener.start();
  };
}
