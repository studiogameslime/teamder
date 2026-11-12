import {createProxyReadRecovery} from '../../pulse/src/services/proxyReadRecovery';
import {profileReadDeadline} from '@/services/profileReadDeadline';
import {AppState} from 'react-native';

jest.mock('react-native', () => ({AppState: {currentState: 'active', addEventListener: jest.fn()}}));
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a suspended startup keeps its remaining foreground time budget and disposes its listener', async () => {
  const expire = jest.fn(), remove = jest.fn();
  const subscribe = AppState.addEventListener as jest.Mock;
  subscribe.mockReturnValue({remove});
  const cancel = profileReadDeadline(expire);
  const change = subscribe.mock.lastCall![1];
  await jest.advanceTimersByTimeAsync(2500);
  change('background'); await jest.advanceTimersByTimeAsync(14000);
  expect(expire).not.toHaveBeenCalled();
  change('active'); await jest.advanceTimersByTimeAsync(5499);
  expect(expire).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(expire).toHaveBeenCalledTimes(1); cancel(); expect(remove).toHaveBeenCalledTimes(1);
});

test('parallel DNS failures share a recovery probe and keep each response with its own caller', async () => {
  const read = createProxyReadRecovery(), dns = Error('java.net.UnknownHostException');
  const first = jest.fn().mockRejectedValueOnce(dns).mockResolvedValue('first');
  const second = jest.fn().mockRejectedValueOnce(dns).mockResolvedValue('second');
  const both = Promise.all([read(first), read(second)]);
  await jest.advanceTimersByTimeAsync(999);
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  await expect(both).resolves.toEqual(['first','second']);
});

test('sustained DNS failure rejects dependent reads, then a later read can recover', async () => {
  const read = createProxyReadRecovery(), dns = Error('Unable to resolve host');
  const source = jest.fn().mockRejectedValue(dns);
  const pending = read(source).catch(e => e);
  await jest.advanceTimersByTimeAsync(1000); expect(await pending).toBe(dns);
  await expect(read(source)).rejects.toBe(dns); expect(source).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(15000); source.mockResolvedValueOnce(9);
  await expect(read(source)).resolves.toBe(9);
});

test('a permission failure is immediately returned to its caller', async () => {
  const request = jest.fn().mockRejectedValue(Error('permission-denied'));
  await expect(createProxyReadRecovery()(request)).rejects.toThrow('permission-denied');
  expect(request).toHaveBeenCalledTimes(1);
});
