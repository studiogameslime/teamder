jest.mock('firebase/storage', () => ({
  ref: jest.fn((_storage: unknown, path: string) => ({ fullPath: path })),
  deleteObject: jest.fn(),
}));
jest.mock('@/firebase/config', () => ({ getFirebase: jest.fn(() => ({ storage: {} })), USE_MOCK_DATA: false }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));

import { deleteObject, ref } from 'firebase/storage';
import { deleteUserPhoto } from '@/services/photoService';
import { logError } from '@/services/errorLog';
import { clearCaughtErrorOrigins, installCaughtErrorSink } from '@/utils/errorObservation';

const sink = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  clearCaughtErrorOrigins();
  installCaughtErrorSink(sink);
});
afterEach(() => installCaughtErrorSink(() => {}));

test('the real photo service deletes the expected object and treats repeated deletion as success', async () => {
  jest.mocked(deleteObject).mockResolvedValueOnce(undefined).mockRejectedValueOnce({ code: 'storage/object-not-found' });
  await expect(deleteUserPhoto('player')).resolves.toBeUndefined();
  await expect(deleteUserPhoto('player')).resolves.toBeUndefined();
  expect(ref).toHaveBeenNthCalledWith(1, {}, 'users/player/avatar.jpg');
  expect(ref).toHaveBeenNthCalledWith(2, {}, 'users/player/avatar.jpg');
  expect(deleteObject).toHaveBeenCalledTimes(2);
  expect(logError).not.toHaveBeenCalled();
  expect(sink).not.toHaveBeenCalled();
});

test.each(['storage/unauthorized', 'storage/retry-limit-exceeded', 'storage/unknown'])(
  '%s stays observable without rejecting the saved profile', async code => {
    const error = Object.assign(new Error('storage failure'), { code });
    jest.mocked(deleteObject).mockRejectedValueOnce(error);
    await expect(deleteUserPhoto('player')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('deleteUserPhoto', error, { uid: 'player' });
    expect(sink).toHaveBeenCalledWith(error, expect.objectContaining({ handler: 'deleteUserPhoto' }));
  },
);

test('no account means no storage operation or diagnostic', async () => {
  await deleteUserPhoto('');
  expect(deleteObject).not.toHaveBeenCalled();
  expect(logError).not.toHaveBeenCalled();
  expect(sink).not.toHaveBeenCalled();
});
