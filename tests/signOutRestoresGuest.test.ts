/**
 * Signing out of Teamder makes you a guest. It must never make you stuck.
 *
 * The bug this exists for shipped in 1.1.15 and was caught on the release
 * binary: after sign-out the app sat on the splash for as long as it was left
 * there — four and a half minutes in the measurement, unrecoverable without a
 * force-quit.
 *
 * It was not a crash and nothing was logged. `signOut` set
 *
 *     currentUser: null, guestInitFailed: false
 *
 * while `hydrated` stayed true, and the silent anonymous session was started
 * only inside `hydrate()`, which runs at launch. RootNavigator's guards then
 * read: hydrated, so don't splash for boot; no user; no failure flag, so don't
 * fall back to sign-in; …and return the splash. A terminal state, reachable by
 * a single tap on a menu item everybody uses.
 *
 * So the invariant under test is not "sign-out works". It is:
 *
 *     the store is NEVER left with no session and no way to get one.
 *
 * Every test below asserts that shape directly, because that shape is the bug.
 * Behaviour, not source text: the real store runs against a mocked service
 * layer, and the assertions are on the state it lands in.
 */

// The store logs through `__DEV__` guards, which Metro defines and Jest does
// not. Declaring it false keeps the dev-only console noise out of the run.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const signInAsGuest = jest.fn();
const serviceSignOut = jest.fn();
const deleteOwnAccount = jest.fn();
const getCurrentUser = jest.fn();
const unregisterThisDevice = jest.fn();
const clearPendingAction = jest.fn();
const discardDraft = jest.fn();
const groupReset = jest.fn();
const gameReset = jest.fn();
const chatClear = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('firebase/firestore', () => ({ onSnapshot: () => () => {} }));
jest.mock('@/firebase/firestore', () => ({ docs: { user: (id: string) => ({ id }) } }));
jest.mock('@/services', () => ({
  userService: {
    signInAsGuest: (...a: unknown[]) => signInAsGuest(...a),
    signOut: (...a: unknown[]) => serviceSignOut(...a),
    deleteOwnAccount: (...a: unknown[]) => deleteOwnAccount(...a),
    getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
  },
}));
jest.mock('@/services/notificationsService', () => ({
  notificationsService: { unregisterThisDevice: (...a: unknown[]) => unregisterThisDevice(...a) },
}));
jest.mock('@/services/storage', () => ({
  storage: { getOnboardingDone: async () => true, clearPendingInvite: async () => {} },
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: () => {},
}));
jest.mock('@/services/errorLog', () => ({ logError: () => {} }));
jest.mock('@/services/pendingAction', () => ({
  clearPendingAction: (...a: unknown[]) => clearPendingAction(...a),
}));
jest.mock('@/services/draftStore', () => ({
  draftStore: { discard: (...a: unknown[]) => discardDraft(...a) },
}));
jest.mock('@/store/groupStore', () => ({
  useGroupStore: { getState: () => ({ reset: groupReset }) },
}));
jest.mock('@/store/gameStore', () => ({
  useGameStore: { getState: () => ({ reset: gameReset }) },
}));
jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ clear: chatClear }) },
}));

import { useUserStore } from '@/store/userStore';

const REAL = { id: 'u-real', name: 'Real Person', onboardingCompleted: true };
const guest = (id: string) => ({ id, name: '', isGuest: true, onboardingCompleted: true });

/**
 * The shape the bug had. A helper rather than three inline assertions, because
 * this is the single thing every test here is really checking.
 */
function isStuckOnSplash(): boolean {
  const s = useUserStore.getState();
  return s.hydrated && s.currentUser === null && s.guestInitFailed === false;
}

beforeEach(() => {
  jest.clearAllMocks();
  signInAsGuest.mockImplementation(async () => guest('guest-1'));
  serviceSignOut.mockResolvedValue(undefined);
  deleteOwnAccount.mockResolvedValue(undefined);
  unregisterThisDevice.mockResolvedValue(undefined);
  clearPendingAction.mockResolvedValue(undefined);
  discardDraft.mockResolvedValue(undefined);
  useUserStore.setState({
    hydrated: true,
    onboardingDone: true,
    currentUser: REAL as never,
    guestInitFailed: false,
  });
});

// ─── the invariant ─────────────────────────────────────────────────────────

describe('after signing out', () => {
  it('is never left with no session and no way to get one', async () => {
    await useUserStore.getState().signOut();
    expect(isStuckOnSplash()).toBe(false);
  });

  it('hands back a fresh anonymous guest', async () => {
    await useUserStore.getState().signOut();
    expect(signInAsGuest).toHaveBeenCalledTimes(1);
    const s = useUserStore.getState();
    expect(s.currentUser).toMatchObject({ id: 'guest-1', isGuest: true });
    expect(s.guestInitFailed).toBe(false);
    expect(s.hydrated).toBe(true);
  });

  // The whole point of the product model: sign-out lands on Guest Home, not on
  // a sign-in wall. A guest user object IS what lets RootNavigator render the
  // tabs instead of AuthStack.
  it('leaves a user the navigator can render', () => {
    return useUserStore.getState().signOut().then(() => {
      expect(useUserStore.getState().currentUser).not.toBeNull();
    });
  });

  it('does not carry the previous identity into the guest session', async () => {
    await useUserStore.getState().signOut();
    expect(useUserStore.getState().currentUser).not.toMatchObject({ id: REAL.id });
    expect(groupReset).toHaveBeenCalled();
    expect(gameReset).toHaveBeenCalled();
    expect(chatClear).toHaveBeenCalled();
  });

  // `footy.pending.action` and the drafts are DEVICE-scoped, so they outlive
  // the account unless someone clears them. Left behind, the signed-out
  // person's half-finished club resumes under whoever signs in next.
  it('clears the pending action and every draft slot', async () => {
    await useUserStore.getState().signOut();
    expect(clearPendingAction).toHaveBeenCalledTimes(1);
    expect(discardDraft.mock.calls.map((c) => c[0]).sort()).toEqual([
      'availability',
      'club',
      'game',
    ]);
  });

  it('removes this device push token before auth is torn down', async () => {
    await useUserStore.getState().signOut();
    expect(unregisterThisDevice).toHaveBeenCalledWith(REAL.id);
    expect(unregisterThisDevice.mock.invocationCallOrder[0])
      .toBeLessThan(serviceSignOut.mock.invocationCallOrder[0]);
  });
});

// ─── the offline branch, which is the other way to get stuck ───────────────

describe('when the guest session cannot be started', () => {
  beforeEach(() => {
    signInAsGuest.mockRejectedValue(new Error('offline'));
  });

  it('raises the fallback flag instead of hanging', async () => {
    await useUserStore.getState().signOut();
    const s = useUserStore.getState();
    expect(s.currentUser).toBeNull();
    // This is what sends RootNavigator to the sign-in screen. Without it the
    // exact same splash lock-up returns by a different road.
    expect(s.guestInitFailed).toBe(true);
    expect(isStuckOnSplash()).toBe(false);
  });

  it('still signs the person out', async () => {
    await useUserStore.getState().signOut();
    expect(serviceSignOut).toHaveBeenCalled();
  });
});

// ─── deleting an account reaches the same state by another road ────────────

describe('after deleting the account', () => {
  it('is never left with no session and no way to get one', async () => {
    await useUserStore.getState().deleteOwnAccount('pw');
    expect(isStuckOnSplash()).toBe(false);
    expect(useUserStore.getState().currentUser).toMatchObject({ isGuest: true });
  });

  it('raises the fallback flag when the guest cannot start', async () => {
    signInAsGuest.mockRejectedValue(new Error('offline'));
    await useUserStore.getState().deleteOwnAccount('pw');
    expect(useUserStore.getState().guestInitFailed).toBe(true);
    expect(isStuckOnSplash()).toBe(false);
  });
});

// ─── repetition, because the reported repro was a cycle ────────────────────

describe('signing in and out repeatedly', () => {
  it('never lands in the stuck state on any cycle', async () => {
    for (let i = 0; i < 4; i += 1) {
      signInAsGuest.mockImplementation(async () => guest(`guest-${i}`));
      useUserStore.setState({
        hydrated: true,
        currentUser: { ...REAL, id: `u-${i}` } as never,
        guestInitFailed: false,
      });
      await useUserStore.getState().signOut();
      expect(isStuckOnSplash()).toBe(false);
      expect(useUserStore.getState().currentUser).toMatchObject({ id: `guest-${i}` });
    }
  });
});

// ─── boot must keep the same guarantee it always had ───────────────────────

describe('boot hydration', () => {
  it('starts a guest when there is no session', async () => {
    getCurrentUser.mockResolvedValue(null);
    useUserStore.setState({ hydrated: false, currentUser: null, guestInitFailed: false });
    await useUserStore.getState().hydrate();
    expect(useUserStore.getState().currentUser).toMatchObject({ isGuest: true });
    expect(isStuckOnSplash()).toBe(false);
  });

  it('keeps a real session and does not manufacture a guest', async () => {
    getCurrentUser.mockResolvedValue(REAL);
    useUserStore.setState({ hydrated: false, currentUser: null, guestInitFailed: false });
    await useUserStore.getState().hydrate();
    expect(useUserStore.getState().currentUser).toMatchObject({ id: REAL.id });
    expect(signInAsGuest).not.toHaveBeenCalled();
  });

  it('raises the fallback flag when the silent guest fails', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockRejectedValue(new Error('offline'));
    useUserStore.setState({ hydrated: false, currentUser: null, guestInitFailed: false });
    await useUserStore.getState().hydrate();
    expect(useUserStore.getState().guestInitFailed).toBe(true);
    expect(isStuckOnSplash()).toBe(false);
  });
});
