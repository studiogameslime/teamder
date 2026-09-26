/**
 * Signing in from the contextual auth sheet must make the app believe it.
 *
 * Reported from production on 1.1.15, and it made the release's own headline
 * journey impossible: "creating a club or a game pops the sign-in sheet; after
 * signing in it returns to the create screen, and pressing create opens the
 * sheet again, and again, and you cannot get past it."
 *
 * `upgradeAnonymous` links or switches the Firebase session directly and
 * returns an outcome. It never touched `useUserStore`. So after a SUCCESSFUL
 * upgrade the store still held the guest object:
 *
 *     currentUser.isGuest === true      → useIsGuest() stays true
 *     currentUser.onboardingCompleted   → true, because buildGuestUser sets it
 *
 * — so the gate that had just been satisfied re-opened the sheet on the next
 * press, and the navigator could not route a brand-new account to the profile
 * screen it owes either. Both halves come from the same missing line.
 *
 * The invariant: after `onAuthenticated`, the store reflects the session.
 */

const getCurrentUser = jest.fn();
const resumePendingAction = jest.fn();
const logError = jest.fn();

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('firebase/firestore', () => ({ onSnapshot: () => () => {} }));
jest.mock('@/firebase/firestore', () => ({ docs: { user: (id: string) => ({ id }) } }));
jest.mock('@/services', () => ({
  userService: {
    getCurrentUser: (...a: unknown[]) => getCurrentUser(...a),
    signInAsGuest: async () => ({ id: 'guest-1', isGuest: true }),
    signOut: async () => {},
    deleteOwnAccount: async () => {},
  },
}));
jest.mock('@/services/notificationsService', () => ({
  notificationsService: { unregisterThisDevice: async () => {} },
}));
jest.mock('@/services/storage', () => ({
  storage: { getOnboardingDone: async () => true, clearPendingInvite: async () => {} },
}));
jest.mock('@/services/analyticsService', () => ({
  AnalyticsEvent: new Proxy({}, { get: (_t, k) => String(k) }),
  logEvent: () => {},
}));
jest.mock('@/services/errorLog', () => ({ logError: (...a: unknown[]) => logError(...a) }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: { getState: () => ({ reset: () => {} }) } }));
jest.mock('@/store/gameStore', () => ({ useGameStore: { getState: () => ({ reset: () => {} }) } }));
jest.mock('@/store/chatStore', () => ({ useChatStore: { getState: () => ({ clear: () => {} }) } }));

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import { useUserStore } from '@/store/userStore';

const GUEST = { id: 'guest-1', name: '', isGuest: true, onboardingCompleted: true };
const REAL = { id: 'u-real', name: 'Real Person', onboardingCompleted: true };
const FRESH = { id: 'u-new', name: '', onboardingCompleted: false };

beforeEach(() => {
  jest.clearAllMocks();
  useUserStore.setState({
    hydrated: true,
    onboardingDone: true,
    currentUser: GUEST as never,
    guestInitFailed: false,
  });
});

describe('refreshing the store from the session', () => {
  it('replaces the guest with the account that is now signed in', async () => {
    getCurrentUser.mockResolvedValue(REAL);
    await useUserStore.getState().refreshFromSession();
    const s = useUserStore.getState();
    expect(s.currentUser).toMatchObject({ id: 'u-real' });
    // The whole bug: this is what the create gate reads.
    expect(s.isProfileComplete()).toBe(true);
    expect((s.currentUser as { isGuest?: boolean }).isGuest).toBeUndefined();
  });

  // A guest object carries `onboardingCompleted: true`, so without the refresh
  // the navigator cannot tell a brand-new account it owes a profile.
  it('lets a brand-new account be recognised as owing a profile', async () => {
    getCurrentUser.mockResolvedValue(FRESH);
    expect(useUserStore.getState().hasCompletedOnboarding()).toBe(true); // the guest lie
    await useUserStore.getState().refreshFromSession();
    expect(useUserStore.getState().hasCompletedOnboarding()).toBe(false);
  });

  // Blanking the tree under a live screen is worse than being briefly stale.
  it('keeps what it has when the session reads back empty', async () => {
    getCurrentUser.mockResolvedValue(null);
    await useUserStore.getState().refreshFromSession();
    expect(useUserStore.getState().currentUser).toMatchObject({ id: 'guest-1' });
  });

  it('never throws into the caller', async () => {
    getCurrentUser.mockRejectedValue(new Error('offline'));
    await expect(useUserStore.getState().refreshFromSession()).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});

// ─── the wiring, so the fix cannot be removed from the one caller ──────────

describe('the contextual auth sheet handler', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'src/hooks/useAuthenticatedAction.tsx'),
    'utf8',
  ) as string;

  it('refreshes the store when the sheet reports success', () => {
    expect(src).toContain('refreshFromSession()');
  });

  // Before the new-account early return: that branch needs the refresh too,
  // or the navigator keeps reading the guest's `onboardingCompleted: true`.
  it('refreshes before the new-account branch returns', () => {
    const refresh = src.indexOf('refreshFromSession()');
    const early = src.indexOf('if (isNewAccount) return;');
    expect(refresh).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(early);
  });

  // And before the resume, which asks the server as the newly signed-in user.
  it('refreshes before resuming the pending action', () => {
    const refresh = src.indexOf('refreshFromSession()');
    const resume = src.indexOf('resumePendingAction()');
    expect(resume).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(resume);
  });
});
