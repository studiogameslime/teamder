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
 */
const currentUser = { getIdToken: jest.fn() };
const auth: { currentUser: unknown } = { currentUser };

jest.mock('react-native', () => ({ Appearance: {} }), { virtual: true });
jest.mock('@/firebase/config', () => ({
  getFirebase: () => ({ auth }),
  USE_MOCK_DATA: false,
}));

import { withAuthRaceRetry } from '@/firebase/authRace';

const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });

beforeEach(() => {
  auth.currentUser = currentUser;
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

it('gives up after ONE retry — a real rules failure still surfaces', async () => {
  const run = jest.fn().mockRejectedValue(denied());
  await expect(withAuthRaceRetry(run)).rejects.toThrow('denied');
  expect(run).toHaveBeenCalledTimes(2);
});

it('does not retry when nobody is signed in', async () => {
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
