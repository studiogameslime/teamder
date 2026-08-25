/**
 * A push registration that fails must say so.
 *
 * This is the mechanism, not the bug: `registerPushToken` is fire-and-forget on
 * both platforms, and the SDK's only reaction to a rejected registration is
 * `logger.error` — behind `enableDebug`, which is `__DEV__`. So in a store build
 * a device could fail to register on every launch in total silence, and one
 * did: a real phone sat in Joryio with full device details and no push token,
 * and finding it took comparing their device rows against our own token store
 * by hand.
 *
 * `getDiagnostics().lastError` is the only signal reachable from React Native,
 * and it is GLOBAL — the last error from anything, not from our call. Hence the
 * timestamp comparison, and hence these cases: an older error must stay quiet,
 * or the report becomes noise nobody reads.
 *
 * These go away with the workaround: native 1.2.0 has a real `onResult`
 * callback, it just isn't bridged to React Native yet.
 */
jest.mock(
  'react-native',
  () => ({
    Platform: {
      OS: 'android',
      select: (o: Record<string, unknown>) => o.android ?? o.default,
    },
  }),
  { virtual: true },
);
jest.mock('expo-constants', () => ({ default: { deviceName: 'Pixel' } }), { virtual: true });
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));

const logUnexpected = jest.fn();
jest.mock('@/services/errorLog', () => ({ logUnexpected: (...a: unknown[]) => logUnexpected(...a) }));

// The module reads `__DEV__` when it lazily initialises the SDK.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const sdk = {
  initialize: jest.fn().mockResolvedValue(undefined),
  registerPushToken: jest.fn(),
  getPushPermissionStatus: jest.fn().mockResolvedValue('granted'),
  setAttribute: jest.fn(),
  getDiagnostics: jest.fn(),
};
jest.mock('@joryio/react-native-sdk', () => ({ __esModule: true, default: sdk }), {
  virtual: true,
});

import { registerPushToken } from '@/services/joryio';

const TOKEN = 'dg9ry4mMT7G_yUV-yP3-Sm:APA91bExample';

beforeEach(() => {
  jest.useFakeTimers();
  logUnexpected.mockReset();
  sdk.registerPushToken.mockReset();
  sdk.getDiagnostics.mockReset().mockResolvedValue({ apiEndpoint: 'https://x/api' });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Run the detached verification without waiting four real seconds. */
async function settle() {
  await Promise.resolve();
  jest.runOnlyPendingTimers();
  // The verifier awaits the timer, then getDiagnostics, then reports.
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

it('hands the token to the SDK', async () => {
  await registerPushToken(TOKEN);
  expect(sdk.registerPushToken).toHaveBeenCalledWith(TOKEN);
});

it('stays quiet when nothing failed', async () => {
  await registerPushToken(TOKEN);
  await settle();
  expect(logUnexpected).not.toHaveBeenCalled();
});

it('reports an error stamped AFTER the registration', async () => {
  sdk.getDiagnostics.mockResolvedValue({
    apiEndpoint: 'https://x/api',
    lastError: { message: 'device registration failed', isUnauthorized: false, at: Date.now() + 10 },
  });
  await registerPushToken(TOKEN);
  await settle();
  expect(logUnexpected).toHaveBeenCalledWith(
    'joryioRegisterPushToken',
    expect.objectContaining({ message: 'device registration failed' }),
  );
});

it('ignores an error that predates the registration', async () => {
  sdk.getDiagnostics.mockResolvedValue({
    apiEndpoint: 'https://x/api',
    lastError: { message: 'something older', isUnauthorized: false, at: Date.now() - 60_000 },
  });
  await registerPushToken(TOKEN);
  await settle();
  expect(logUnexpected).not.toHaveBeenCalled();
});

it('never reports the token itself — only a prefix, so a log is not a credential', async () => {
  sdk.getDiagnostics.mockResolvedValue({
    apiEndpoint: 'https://x/api',
    lastError: { message: 'nope', isUnauthorized: true, at: Date.now() + 10 },
  });
  await registerPushToken(TOKEN);
  await settle();
  const ctx = logUnexpected.mock.calls[0][1] as { tokenPrefix: string };
  expect(TOKEN.startsWith(ctx.tokenPrefix)).toBe(true);
  expect(ctx.tokenPrefix.length).toBeLessThan(TOKEN.length);
});

it('says nothing when the diagnostic call itself fails', async () => {
  sdk.getDiagnostics.mockRejectedValue(new Error('bridge down'));
  await registerPushToken(TOKEN);
  await settle();
  expect(logUnexpected).not.toHaveBeenCalled();
});

it('does nothing at all without a token', async () => {
  await expect(registerPushToken('')).resolves.toBe(false);
  expect(sdk.registerPushToken).not.toHaveBeenCalled();
});
