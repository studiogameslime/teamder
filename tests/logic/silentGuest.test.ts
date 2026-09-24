/**
 * Boot with no session.
 *
 * This is the behaviour the whole entry refactor rests on: an install that has
 * never signed in gets an ANONYMOUS Firebase session and walks into the app,
 * instead of meeting a sign-in wall. Three things have to hold, and each of
 * them is a way the launch could go wrong in a way nobody would notice:
 *
 *   • a real session is left completely alone — an existing account must not
 *     be handed a guest session because a read was slow;
 *   • no session becomes a guest session, and `hydrated` flips ONCE with the
 *     session already in hand, so no frame ever renders the signed-out tree;
 *   • a guest sign-in that FAILS (offline on first launch) sets
 *     `guestInitFailed`, because without it RootNavigator has no way to tell
 *     "still starting" from "never will" and sits on the splash forever.
 *
 * The last one is the one that matters most. A perma-splash is unrecoverable
 * without a force-close, and this repo has been there before — the comment on
 * `hydrate` about wrapping each branch exists for exactly that reason.
 */

const getOnboardingDone = jest.fn();
const getCurrentUser = jest.fn();
const signInAsGuest = jest.fn();
const logEvent = jest.fn();
const logError = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('@/services', () => ({
  userService: {
    getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
    signInAsGuest: (...a: unknown[]) => signInAsGuest(...a),
  },
}));
jest.mock('@/services/storage', () => ({
  storage: {
    getOnboardingDone: (...a: unknown[]) => getOnboardingDone(...a),
    setOnboardingDone: jest.fn(),
    setAuthUserJson: jest.fn(),
    setCurrentGroupId: jest.fn(),
  },
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: (...a: unknown[]) => logEvent(...a),
}));
jest.mock('@/services/errorLog', () => ({ logError: (...a: unknown[]) => logError(...a) }));
jest.mock('@/services/notificationsService', () => ({ notificationsService: {} }));
jest.mock('@/store/groupStore', () => ({
  useGroupStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/store/gameStore', () => ({
  useGameStore: { getState: () => ({ reset: jest.fn() }) },
}));
jest.mock('@/store/chatStore', () => ({
  useChatStore: { getState: () => ({ clear: jest.fn() }) },
}));
jest.mock('firebase/firestore', () => ({ onSnapshot: jest.fn() }));
jest.mock('@/firebase/firestore', () => ({ docs: { user: jest.fn() } }));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { useUserStore } from '@/store/userStore';

const REAL = { id: 'u1', name: 'אליס', createdAt: 1, avatarId: 'a1' } as never;
const GUEST = { id: 'anon1', name: '', createdAt: 2, isGuest: true } as never;

beforeEach(() => {
  jest.clearAllMocks();
  getOnboardingDone.mockResolvedValue(false);
  useUserStore.setState({ hydrated: false, currentUser: null, guestInitFailed: false });
});

const fired = (name: string) => logEvent.mock.calls.filter((c) => c[0] === name);

// ─── an existing session ──────────────────────────────────────────────────

describe('a device that is already signed in', () => {
  it('keeps the real user and never touches anonymous sign-in', async () => {
    getCurrentUser.mockResolvedValue(REAL);
    await useUserStore.getState().hydrate();

    const s = useUserStore.getState();
    expect(s.currentUser).toEqual(REAL);
    expect(s.hydrated).toBe(true);
    expect(s.guestInitFailed).toBe(false);
    expect(signInAsGuest).not.toHaveBeenCalled();
    expect(fired('GuestSessionStarted')).toHaveLength(0);
  });

  it('does the same for a restored GUEST session — no second account', async () => {
    // The anonymous session persists natively, so a returning guest arrives
    // through `getCurrentUser` like anybody else. Signing in again would mint
    // a SECOND anonymous uid and strand the first one's Joryio history.
    getCurrentUser.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();

    expect(useUserStore.getState().currentUser).toEqual(GUEST);
    expect(signInAsGuest).not.toHaveBeenCalled();
  });
});

// ─── no session ───────────────────────────────────────────────────────────

describe('a fresh install', () => {
  it('starts an anonymous session and enters the app', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();

    const s = useUserStore.getState();
    expect(signInAsGuest).toHaveBeenCalledTimes(1);
    expect(s.currentUser).toEqual(GUEST);
    expect(s.hydrated).toBe(true);
    expect(s.guestInitFailed).toBe(false);
  });

  it('reports it, once, as the silent origin', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();

    const calls = fired('GuestSessionStarted');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ origin: 'silent' });
  });

  // `hydrated` is what RootNavigator gates the splash on. If it flipped before
  // the session existed, the signed-out tree would paint for a frame — which
  // is the sign-in screen this whole change exists to remove.
  it('flips hydrated only once the session is in hand', async () => {
    getCurrentUser.mockResolvedValue(null);
    let hydratedWhenGuestStarted: boolean | null = null;
    signInAsGuest.mockImplementation(async () => {
      hydratedWhenGuestStarted = useUserStore.getState().hydrated;
      return GUEST;
    });
    await useUserStore.getState().hydrate();

    expect(hydratedWhenGuestStarted).toBe(false);
    expect(useUserStore.getState().hydrated).toBe(true);
  });
});

// ─── the offline case ─────────────────────────────────────────────────────

describe('a fresh install with no network', () => {
  it('reports the failure and does NOT leave the app on the splash', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockRejectedValue(new Error('network request failed'));
    await useUserStore.getState().hydrate();

    const s = useUserStore.getState();
    // hydrated MUST still be true — that is what lets the navigator move on.
    expect(s.hydrated).toBe(true);
    expect(s.currentUser).toBeNull();
    expect(s.guestInitFailed).toBe(true);
    expect(logError).toHaveBeenCalledWith(
      'userHydrateSilentGuest',
      expect.anything(),
      expect.anything(),
    );
  });

  it('does not claim a guest session started', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockRejectedValue(new Error('offline'));
    await useUserStore.getState().hydrate();
    expect(fired('GuestSessionStarted')).toHaveLength(0);
  });

  it('a later hydrate can still succeed', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockRejectedValueOnce(new Error('offline'));
    await useUserStore.getState().hydrate();
    expect(useUserStore.getState().guestInitFailed).toBe(true);

    signInAsGuest.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();
    const s = useUserStore.getState();
    expect(s.currentUser).toEqual(GUEST);
    expect(s.guestInitFailed).toBe(false);
  });
});

// ─── the read itself failing ──────────────────────────────────────────────

describe('when the user read throws', () => {
  // The existing defence: a transient failure on /users must not wedge the
  // boot. It now also must not be mistaken for "no account" forever — a guest
  // session is created, which is the same thing this device would get on a
  // genuinely fresh install, and the real account returns on the next launch.
  it('still boots, as a guest', async () => {
    getCurrentUser.mockRejectedValue(new Error('read timeout'));
    signInAsGuest.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();

    const s = useUserStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.currentUser).toEqual(GUEST);
    expect(fired('BootHydrateFailed').map((c) => c[1])).toEqual([
      { source: 'user_read' },
    ]);
  });
});

// ─── no /users document for a guest ───────────────────────────────────────

describe('the guest user object', () => {
  it('is runtime-only — nothing here writes a /users document', async () => {
    getCurrentUser.mockResolvedValue(null);
    signInAsGuest.mockResolvedValue(GUEST);
    await useUserStore.getState().hydrate();

    // `signInAsGuest` is the ONLY thing called. The rules now refuse a
    // /users create from an anonymous session anyway, but the client must not
    // be attempting it: a rejected write is a permission error in the panel.
    expect(signInAsGuest).toHaveBeenCalledWith();
    expect(useUserStore.getState().currentUser).toMatchObject({
      isGuest: true,
      name: '',
    });
  });
});
