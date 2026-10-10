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
    profileRestoreFailed: false,
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
  it('stops the authenticated journey when the profile reads back empty', async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(useUserStore.getState().refreshFromSession()).rejects.toThrow();
    expect(useUserStore.getState().currentUser).toBeNull();
    expect(useUserStore.getState().profileRestoreFailed).toBe(true);
  });

  it('propagates profile failure and opens the root retry gate', async () => {
    getCurrentUser.mockRejectedValue(new Error('offline'));
    await expect(useUserStore.getState().refreshFromSession()).rejects.toThrow('offline');
    expect(useUserStore.getState().currentUser).toBeNull();
    expect(useUserStore.getState().profileRestoreFailed).toBe(true);
    expect(logError).toHaveBeenCalled();
  });
});

// ─── the email provider, which never reaches the sheet's handler ──────────

/**
 * "המשך עם מייל" is the one provider the sheet hands off rather than handling:
 * it calls `onCancel()` and navigates to EmailAuthScreen, so the sheet is
 * unmounted and `onAuthenticated` — the refresh AND the resume — never runs.
 *
 * `signInWithEmail` sets `currentUser` itself, so that path has no guest loop.
 * What it had instead was a dead end: nobody popped the screen and nobody
 * finished the parked club or game. A guest is already inside MainTabs, so
 * signing in does not make RootNavigator swap anything.
 */
describe('signing in through the email screen', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'src/screens/auth/EmailAuthScreen.tsx'),
    'utf8',
  ) as string;

  it('resumes the parked action', () => {
    expect(src).toContain("from '@/services/actionCoordinator'");
    expect(src).toContain('resumePendingAction()');
  });

  it('leaves the screen it was pushed onto', () => {
    expect(src).toContain('nav.canGoBack()');
    expect(src).toContain('nav.goBack()');
  });

  it('reports what the resume actually got them', () => {
    expect(src).toContain('reportResumeOutcome');
  });

  // A fresh account owes a profile: its document carries
  // `onboardingCompleted: false`, RootNavigator swaps to the profile screen,
  // and the coordinator's boot pass resumes after that screen saves. Resuming
  // here would race the swap.
  it('only does it for a sign-in, not a sign-up', () => {
    const at = src.indexOf('const submit = async');
    const body = src.slice(at, at + 2200);
    expect(body).toMatch(/if \(mode === 'signIn'\) \{\s*await finishParkedAction\(\);/);
  });
});

// ─── the wiring, so the fix cannot be removed from the one caller ──────────

describe('the contextual auth sheet handler', () => {
  const src = require('fs').readFileSync(
    require('path').resolve(__dirname, '..', 'src/hooks/useAuthenticatedAction.tsx'),
    'utf8',
  ) as string;

  it('refreshes the store when the sheet reports success', () => {
    expect(src).toContain('refreshFromSession(uid)');
  });

  // Before the new-account early return: that branch needs the refresh too,
  // or the navigator keeps reading the guest's `onboardingCompleted: true`.
  it('refreshes before the new-account branch returns', () => {
    const refresh = src.indexOf('refreshFromSession(uid)');
    const early = src.indexOf('if (isNewAccount) return;');
    expect(refresh).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(early);
  });

  // And before the resume, which asks the server as the newly signed-in user.
  it('refreshes before resuming the pending action', () => {
    const refresh = src.indexOf('refreshFromSession(uid)');
    const resume = src.indexOf('resumePendingAction()');
    expect(resume).toBeGreaterThan(-1);
    expect(refresh).toBeLessThan(resume);
  });
});

test('authenticated refresh refuses a guest or another account profile',async()=>{
 for(const value of [GUEST,REAL]){
  getCurrentUser.mockResolvedValue(value);
  await expect(useUserStore.getState().refreshFromSession('expected')).rejects.toThrow();
  expect(useUserStore.getState().currentUser).toBeNull();expect(useUserStore.getState().profileRestoreFailed).toBe(true);
 }
 getCurrentUser.mockResolvedValue(REAL);await useUserStore.getState().refreshFromSession('u-real');expect(useUserStore.getState().profileRestoreFailed).toBe(false);
});
