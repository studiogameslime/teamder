import fs from 'fs';
import ts from 'typescript';
const mockUser = { uid: 'owner', getIdToken: jest.fn().mockResolvedValue('token') };
const mockAuth: { currentUser: typeof mockUser | null } = { currentUser: mockUser };
jest.mock('@/firebase/config', () => ({ getFirebase: () => ({ auth: mockAuth }) }));
jest.mock('firebase/auth', () => ({ onAuthStateChanged: jest.fn() }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
import { withAuthRaceRetry } from '@/firebase/authRace';
import { observeCaughtError } from '@/utils/errorObservation';
beforeEach(() => { jest.useFakeTimers(); mockAuth.currentUser = mockUser; jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());
test.each(['internal', 'functions/internal', 'unavailable', 'functions/unavailable', 'deadline-exceeded', 'functions/deadline-exceeded'])('opted-in read recovers %s without a false failure report', async code => {
  const run = jest.fn().mockRejectedValueOnce({ code }).mockResolvedValue(['real data']);
  const pending = withAuthRaceRetry(run, { retryTransientReads: true });
  await jest.advanceTimersByTimeAsync(500);
  await expect(pending).resolves.toEqual(['real data']);
  expect(run).toHaveBeenCalledTimes(2); expect(observeCaughtError).not.toHaveBeenCalled();
});
test('persistent read failure remains an error and is reported once', async () => {
  const error = { code: 'unavailable' }, run = jest.fn().mockRejectedValue(error);
  const assertion = expect(withAuthRaceRetry(run, { retryTransientReads: true })).rejects.toBe(error);
  await jest.advanceTimersByTimeAsync(500); await assertion;
  expect(run).toHaveBeenCalledTimes(2); expect(observeCaughtError).toHaveBeenCalledTimes(1);
});
test.each(['internal', 'unavailable', 'deadline-exceeded'])('default mutation contract never retries %s', async code => {
  const error = { code }, run = jest.fn().mockRejectedValue(error);
  await expect(withAuthRaceRetry(run)).rejects.toBe(error); expect(run).toHaveBeenCalledTimes(1);
});
test.each(['replacement', 'signed out'])('account %s during backoff cancels the old read', async state => {
  const run = jest.fn().mockRejectedValue({ code: 'unavailable' });
  const assertion = expect(withAuthRaceRetry(run, { retryTransientReads: true })).rejects.toMatchObject({ name: 'StaleSessionError' });
  await jest.advanceTimersByTimeAsync(1);
  mockAuth.currentUser = state === 'signed out' ? null : { ...mockUser, uid: 'another' };
  await jest.advanceTimersByTimeAsync(499); await assertion; expect(run).toHaveBeenCalledTimes(1);
});
test('account replacement while a read completes rejects its data', async () => {
  const run = jest.fn(async () => { mockAuth.currentUser = { ...mockUser, uid: 'another' }; return ['old account']; });
  await expect(withAuthRaceRetry(run, { retryTransientReads: true })).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(run).toHaveBeenCalledTimes(1);
});
test('live/upcoming game queries opt in while season writes retain the default', () => {
  const source = ts.createSourceFile('game.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let reads = 0, writes = 0;
  function walk(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'withAuthRaceRetry') {
      if (n.arguments[0].getText(source).includes('startSeasonEvening')) { expect(n.arguments).toHaveLength(1); writes++; }
      else { expect(n.arguments[1].getText(source)).toContain('retryTransientReads: true'); reads++; }
    }
    ts.forEachChild(n, walk);
  }
  walk(source); expect(reads).toBe(8); expect(writes).toBe(1);
});
