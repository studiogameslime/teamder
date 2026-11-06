import { observeCaughtError } from './errorObservation';

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

export class AuthStorageUnavailableError extends Error {
  readonly code = 'AUTH_STORAGE_UNAVAILABLE';
  constructor(readonly operation: keyof AuthStorage) {
    super('Saved authentication could not be accessed');
    this.name = 'AuthStorageUnavailableError';
  }
}

/** Firebase swallows storage probe/read errors and can select memory-only
 * persistence. Retrying transient failures helps restore the real account;
 * remembering an exhausted failure prevents treating that fallback as a fresh
 * install. No credential, value or storage key is included in diagnostics. */
export function resilientAuthStorage(
  backing: AuthStorage,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
) {
  const pending = new Map<string, Promise<unknown>>();
  let failure: AuthStorageUnavailableError | undefined;

  function run<T>(key: string, operation: keyof AuthStorage, work: () => Promise<T>): Promise<T> {
    // Serialize the ENTIRE retry window. A delayed login write must never run
    // after a logout queued while that write was being retried.
    const next = (pending.get(key) ?? Promise.resolve()).catch(error => {
      observeCaughtError(error, { source: 'src/utils/resilientAuthStorage.ts', handler: 'run', site: 'resilientAuthStorage:previous' });
    }).then(async () => {
      for (let attempt = 0; ; attempt++) {
        try { return await work(); }
        catch {
          if (attempt < 2) { await wait(attempt === 0 ? 150 : 450); continue; }
          failure = new AuthStorageUnavailableError(operation);
          observeCaughtError(failure, { source: 'src/utils/resilientAuthStorage.ts', handler: operation, site: `resilientAuthStorage:${operation}` });
          throw failure;
        }
      }
    });
    pending.set(key, next);
    void next.then(() => cleanup(), error => {
      observeCaughtError(error, { source: 'src/utils/resilientAuthStorage.ts', handler: 'run', site: 'resilientAuthStorage:cleanup' });
      cleanup();
    });
    function cleanup() { if (pending.get(key) === next) pending.delete(key); }
    return next;
  }

  const storage: AuthStorage = {
    getItem: key => run(key, 'getItem', () => backing.getItem(key)),
    setItem: (key, value) => run(key, 'setItem', () => backing.setItem(key, value)),
    removeItem: key => run(key, 'removeItem', () => backing.removeItem(key)),
  };
  return {
    storage,
    assertRestored(hasUser: boolean): void {
      // A restored user means Firebase selected the durable store despite a
      // failed probe. If it selected memory and returned null, do not create a
      // guest or overwrite anything. A cold restart retries SDK initialization.
      if (!hasUser && failure) throw failure;
    },
  };
}
