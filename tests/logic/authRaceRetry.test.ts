/**
 * The cold-start auth race.
 *
 * Right after an app restart the persisted session is already on
 * `auth.currentUser`, but the ID token has not yet reached the Firestore
 * channel. Any read fired in that window is denied by the rules even though it
 * is perfectly valid. It self-heals on the next read, so the user sees a blank
 * list for a moment — and the production error log gets a crash-grade entry.
 *
 * The retry must be narrow. Retrying a REAL rules violation would turn a bug we
 * need to see into a bug that costs one extra read and stays invisible, so
 * these pin both directions: retry only for permission-denied WITH a session.
 *
 * The guard was widened after two of these still reached production on 1.1.5:
 * it now retries TWICE with a backoff, and it WAITS for a session that has not
 * restored yet instead of treating a null currentUser as "signed out". That
 * second gap was the important one — the earliest phase of the race is exactly
 * when currentUser is still null, so the original guard gave up at the worst
 * possible moment.
 */
const currentUser = { getIdToken: jest.fn() };
const auth: { currentUser: unknown } = { currentUser };
/** Handlers registered via onAuthStateChanged, so a test can restore a session
 *  mid-flight the way Firebase does on a cold start. */
let authListeners: Array<(u: unknown) => void> = [];

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({
  getFirebase: () => ({ auth }),
  USE_MOCK_DATA: false,
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (_a: unknown, cb: (u: unknown) => void) => {
    authListeners.push(cb);
    return () => {
      authListeners = authListeners.filter((f) => f !== cb);
    };
  },
}));

import { withAuthRaceRetry } from '@/firebase/authRace';

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

beforeEach(() => {
  auth.currentUser = currentUser;
  authListeners = [];
  currentUser.getIdToken.mockReset().mockResolvedValue('token');
});

it('passes a successful read straight through, with no token refresh', async () => {
  const run = jest.fn().mockResolvedValue('ok');
  await expect(withAuthRaceRetry(run)).resolves.toBe('ok');
  expect(run).toHaveBeenCalledTimes(1);
  expect(currentUser.getIdToken).not.toHaveBeenCalled();
});

it('refreshes the token and retries once when denied WITH a session', async () => {
  const run = jest.fn().mockRejectedValueOnce(denied()).mockResolvedValue('ok');
  await expect(withAuthRaceRetry(run)).resolves.toBe('ok');
  expect(run).toHaveBeenCalledTimes(2);
  expect(currentUser.getIdToken).toHaveBeenCalledTimes(1);
});

it('gives up after a BOUNDED number of retries — a real rules failure still surfaces', async () => {
  // Two retries, not one: a single 300 ms wait was not always enough on a slow
  // cold start, and two of these still reached production. Bounded either way,
  // so a genuine rules violation is never retried into invisibility.
  const run = jest.fn().mockRejectedValue(denied());
  await expect(withAuthRaceRetry(run)).rejects.toThrow('denied');
  expect(run).toHaveBeenCalledTimes(3);
});

it('waits for a session that has not restored yet, then retries', async () => {
  // The phase the original guard missed: denied AND currentUser still null.
  auth.currentUser = null;
  const run = jest.fn().mockRejectedValueOnce(denied()).mockResolvedValue('ok');
  const p = withAuthRaceRetry(run);
  // Firebase restores the session a moment later.
  await Promise.resolve();
  auth.currentUser = currentUser;
  authListeners.forEach((cb) => cb(currentUser));
  await expect(p).resolves.toBe('ok');
  expect(run).toHaveBeenCalledTimes(2);
});

it('still refuses to retry when nobody signs in at all', async () => {
  // Genuinely signed out — the read must fail once and surface.
  auth.currentUser = null;
  const run = jest.fn().mockRejectedValue(denied());
  await expect(withAuthRaceRetry(run)).rejects.toThrow('denied');
  expect(run).toHaveBeenCalledTimes(1);
});

it('does not retry a non-permission error', async () => {
  const run = jest
    .fn()
    .mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await expect(withAuthRaceRetry(run)).rejects.toThrow('offline');
  expect(run).toHaveBeenCalledTimes(1);
  expect(currentUser.getIdToken).not.toHaveBeenCalled();
});

it('retries even when the token refresh itself fails — the read is what matters', async () => {
  currentUser.getIdToken.mockRejectedValue(new Error('network'));
  const run = jest.fn().mockRejectedValueOnce(denied()).mockResolvedValue('ok');
  await expect(withAuthRaceRetry(run)).resolves.toBe('ok');
  expect(run).toHaveBeenCalledTimes(2);
});
