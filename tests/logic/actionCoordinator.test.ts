/**
 * The coordinator: who may run an action, and when it is safe to forget it.
 *
 * Two properties carry this whole layer, and both are easy to lose silently:
 *
 *   • EXACTLY ONCE. Three things legitimately try to resume the same action at
 *     the same moment — the auth callback, the `onAuthStateChanged` listener
 *     reacting to the same sign-in, and RootNavigator's effect when
 *     `currentUser` flips. All three are correct to try. Only one may join the
 *     game, or somebody is registered twice and a seat is taken from a real
 *     person.
 *
 *   • CLEARED ONLY ON TERMINAL SUCCESS. Not after auth, not after the profile
 *     screen, not when a request merely started. A retryable failure that
 *     cleared the stash is a person who filled in a club, signed up, lost
 *     signal for two seconds, and has nothing left.
 */

const mem = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (k: string) => Promise.resolve(mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => {
      mem.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k: string) => {
      mem.delete(k);
      return Promise.resolve();
    },
  },
}));
jest.mock(
  'expo-constants',
  () => ({ __esModule: true, default: { expoConfig: { version: '1.1.14' } } }),
  { virtual: true },
);
jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });

const logEvent = jest.fn();
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

let currentUser: { id: string; isGuest?: boolean } | null = null;
jest.mock('@/store/userStore', () => ({
  useUserStore: { getState: () => ({ currentUser }) },
}));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import {
  requestAction,
  resumePendingAction,
  registerResumer,
  __resetCoordinatorForTests,
  type ActionResult,
} from '@/services/actionCoordinator';
import { readPendingAction } from '@/services/pendingAction';
import { draftStore } from '@/services/draftStore';

const GUEST = { id: 'anon1', isGuest: true };
const REAL = { id: 'u1' };

const ok = (): ActionResult => ({ outcome: 'joined', terminal: true });
const retryable = (): ActionResult => ({
  outcome: 'joined',
  terminal: false,
  reason: 'network_unavailable',
});

beforeEach(() => {
  mem.clear();
  logEvent.mockClear();
  __resetCoordinatorForTests();
  currentUser = null;
});

const fired = (name: string) => logEvent.mock.calls.filter((c) => c[0] === name);

// ─── a full account ───────────────────────────────────────────────────────

describe('a real account', () => {
  it('runs the action immediately and never sees the wall', async () => {
    currentUser = REAL;
    const execute = jest.fn(async () => ok());
    const out = await requestAction({ kind: 'join_game', targetId: 'g1', execute });

    expect(out.status).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(fired('AuthPromptShown')).toHaveLength(0);
    expect(fired('PendingActionSaved')).toHaveLength(0);
  });

  it('leaves nothing on disk after a terminal success', async () => {
    currentUser = REAL;
    await requestAction({ kind: 'join_game', targetId: 'g1', execute: async () => ok() });
    expect(await readPendingAction()).toBeNull();
  });

  // A network failure on a direct action is still retryable — nothing was
  // stashed to begin with, but the result must say so rather than claim done.
  it('reports a retryable failure as non-terminal', async () => {
    currentUser = REAL;
    const out = await requestAction({
      kind: 'join_game',
      targetId: 'g1',
      execute: async () => retryable(),
    });
    expect(out.status === 'done' && out.result.terminal).toBe(false);
  });
});

// ─── the wall ─────────────────────────────────────────────────────────────

describe('a guest', () => {
  it('does not run the action, and persists the intent', async () => {
    currentUser = GUEST;
    const execute = jest.fn(async () => ok());
    const out = await requestAction({ kind: 'join_game', targetId: 'g1', execute });

    expect(out.status).toBe('needs_auth');
    expect(execute).not.toHaveBeenCalled();
    const stored = await readPendingAction();
    expect(stored).toMatchObject({ kind: 'join_game', targetId: 'g1' });
  });

  it('persists BEFORE the caller can show a sheet', async () => {
    // The ordering is the whole safety property: on the existing-account path
    // the session is replaced, which unmounts the calling screen. Anything
    // awaited after that races the teardown.
    currentUser = GUEST;
    const out = await requestAction({ kind: 'join_club', targetId: 'c1', execute: async () => ok() });
    expect(out.status).toBe('needs_auth');
    expect(await readPendingAction()).not.toBeNull();
  });

  it('writes the draft alongside, for a drafted kind', async () => {
    currentUser = GUEST;
    await requestAction({
      kind: 'create_club',
      draft: { kind: 'club', id: 'd1', values: { name: 'שכונה' } },
      execute: async () => ok(),
    });
    const d = await draftStore.read('club');
    expect(d?.values).toEqual({ name: 'שכונה' });
    expect(fired('DraftSaved')).toHaveLength(1);
    expect(fired('PendingActionSaved')[0][1]).toMatchObject({ has_draft: true });
  });

  it('reports the intent once, with its kind', async () => {
    currentUser = GUEST;
    await requestAction({ kind: 'join_game', targetId: 'g1', execute: async () => ok() });
    const calls = fired('PendingActionSaved');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ kind: 'join_game', origin: 'in_app' });
  });
});

// ─── exactly once ─────────────────────────────────────────────────────────

describe('two callers, one action', () => {
  it('a second request for the SAME action is refused while the first runs', async () => {
    currentUser = REAL;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const execute = jest.fn(async () => {
      await gate;
      return ok();
    });

    const first = requestAction({ kind: 'join_game', targetId: 'g1', execute });
    const second = await requestAction({ kind: 'join_game', targetId: 'g1', execute });

    expect(second.status).toBe('busy');
    release();
    await first;
    expect(execute).toHaveBeenCalledTimes(1);
  });

  // The lock is keyed by identity, not a global flag: joining game A must not
  // block joining game B.
  it('a DIFFERENT action is not blocked', async () => {
    currentUser = REAL;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = jest.fn(async () => {
      await gate;
      return ok();
    });
    const fast = jest.fn(async () => ok());

    const a = requestAction({ kind: 'join_game', targetId: 'g1', execute: slow });
    const b = await requestAction({ kind: 'join_game', targetId: 'g2', execute: fast });

    expect(b.status).toBe('done');
    release();
    await a;
  });

  it('the lock is released, so a retry after failure can run', async () => {
    currentUser = REAL;
    const execute = jest.fn(async () => retryable());
    await requestAction({ kind: 'join_game', targetId: 'g1', execute });
    await requestAction({ kind: 'join_game', targetId: 'g1', execute });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('three concurrent resumes run the action exactly once', async () => {
    // The real scenario: auth callback + auth listener + navigator effect.
    currentUser = GUEST;
    await requestAction({ kind: 'join_game', targetId: 'g1', execute: async () => ok() });
    currentUser = REAL;

    const resumer = jest.fn(async () => ok());
    registerResumer('join_game', resumer);

    const results = await Promise.all([
      resumePendingAction(),
      resumePendingAction(),
      resumePendingAction(),
    ]);
    expect(resumer).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r.status === 'ran')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy').length).toBeGreaterThanOrEqual(1);
  });
});

// ─── resume ───────────────────────────────────────────────────────────────

describe('resume', () => {
  it('does nothing when there is no stash', async () => {
    currentUser = REAL;
    expect(await resumePendingAction()).toEqual({ status: 'none' });
  });

  it('holds while the viewer is still a guest', async () => {
    currentUser = GUEST;
    await requestAction({ kind: 'join_game', targetId: 'g1', execute: async () => ok() });
    expect(await resumePendingAction()).toEqual({ status: 'held' });
    expect(await readPendingAction()).not.toBeNull();
  });

  // Navigate-only kinds belong to the deep-link consumer, not this one. Two
  // consumers racing on the same stash is how a link gets navigated twice.
  it('holds a navigate-only kind rather than claiming it', async () => {
    mem.set(
      'footy.pending.action',
      JSON.stringify({
        version: 2,
        createdAt: Date.now(),
        origin: 'deep_link',
        kind: 'open_game',
        targetId: 'g1',
      }),
    );
    currentUser = REAL;
    expect(await resumePendingAction()).toEqual({ status: 'held' });
    expect(await readPendingAction()).not.toBeNull();
  });

  // A resumer that has not registered yet is not a reason to throw the intent
  // away — the module that owns it may simply not have been imported.
  it('holds a kind nobody claimed', async () => {
    currentUser = GUEST;
    await requestAction({ kind: 'save_availability', draft: { kind: 'availability', id: 'd', values: {} }, execute: async () => ok() });
    currentUser = REAL;
    expect(await resumePendingAction()).toEqual({ status: 'held' });
    expect(await readPendingAction()).not.toBeNull();
  });

  it('reports the resume with the age of the intent', async () => {
    currentUser = GUEST;
    await requestAction({ kind: 'join_club', targetId: 'c1', execute: async () => ok() });
    currentUser = REAL;
    registerResumer('join_club', async () => ok());
    await resumePendingAction();

    const calls = fired('PendingActionResumed');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ kind: 'join_club', is_guest: false });
    expect(typeof calls[0][1].age_ms).toBe('number');
  });
});

// ─── cleanup ──────────────────────────────────────────────────────────────

describe('what survives, and what does not', () => {
  const park = async (kind: 'create_club' | 'join_game') => {
    currentUser = GUEST;
    await requestAction(
      kind === 'create_club'
        ? {
            kind,
            draft: { kind: 'club', id: 'd1', values: { name: 'x' } },
            execute: async () => ok(),
          }
        : { kind, targetId: 'g1', execute: async () => ok() },
    );
    currentUser = REAL;
  };

  it('a terminal success clears the stash AND the draft', async () => {
    await park('create_club');
    registerResumer('create_club', async () => ({ outcome: 'created', terminal: true }));
    await resumePendingAction();

    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('club')).toBeNull();
  });

  // The case that matters most. Losing signal for two seconds must not cost
  // somebody the club they just typed in.
  it('a RETRYABLE failure keeps both', async () => {
    await park('create_club');
    registerResumer('create_club', async () => ({
      outcome: 'created',
      terminal: false,
      reason: 'network_unavailable',
    }));
    await resumePendingAction();

    expect(await readPendingAction()).not.toBeNull();
    expect(await draftStore.read('club')).not.toBeNull();
    expect(fired('PendingActionFailed')[0][1]).toMatchObject({
      reason: 'network_unavailable',
    });
  });

  it('and the retry then succeeds and clears', async () => {
    await park('create_club');
    let attempt = 0;
    registerResumer('create_club', async () => {
      attempt += 1;
      return attempt === 1
        ? { outcome: 'created', terminal: false, reason: 'network_unavailable' }
        : { outcome: 'created', terminal: true };
    });
    await resumePendingAction();
    await resumePendingAction();

    expect(attempt).toBe(2);
    expect(await readPendingAction()).toBeNull();
    expect(await draftStore.read('club')).toBeNull();
  });

  // A waitlist place is a completed request, not a failure — clearing is right.
  it('waitlist and approval-pending both count as terminal', async () => {
    for (const outcome of ['waitlisted', 'approval_pending'] as const) {
      mem.clear();
      __resetCoordinatorForTests();
      await park('join_game');
      registerResumer('join_game', async () => ({ outcome, terminal: true }));
      await resumePendingAction();
      expect(await readPendingAction()).toBeNull();
    }
  });

  // The process died between authenticating and finishing. The next launch has
  // to be able to pick it up, which is only true if nothing cleared it early.
  it('survives a restart before the action ran', async () => {
    await park('join_game');
    // A "restart" is a fresh coordinator over the same disk.
    __resetCoordinatorForTests();
    expect(await readPendingAction()).toMatchObject({ kind: 'join_game' });

    registerResumer('join_game', async () => ok());
    const out = await resumePendingAction();
    expect(out.status).toBe('ran');
    expect(await readPendingAction()).toBeNull();
  });
});
