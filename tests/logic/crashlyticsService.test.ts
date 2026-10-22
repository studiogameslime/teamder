type CrashlyticsInput = {
  operation: string;
  message: string;
  code?: string;
  stack?: string;
  source?: string;
  handler?: string;
  site?: string;
  isFatal?: boolean;
};

type Options = {
  dev?: boolean;
  mock?: boolean;
  platform?: string;
  native?: boolean;
  nativeModules?: false;
  requireError?: boolean;
  initializationError?: boolean;
  recordingError?: boolean;
};

const previousDev = (globalThis as { __DEV__?: boolean }).__DEV__;

function load(options: Options = {}) {
  jest.resetModules();
  (globalThis as { __DEV__?: boolean }).__DEV__ = options.dev ?? false;
  const instance = { app: { name: '[DEFAULT]' } };
  const sdkLoads = jest.fn();
  const getCrashlytics = jest.fn(() => {
    if (options.initializationError) throw new Error('native initialization failed');
    return instance;
  });
  const recordError = jest.fn((_instance: unknown, _error: Error, _name?: string) => {
    if (options.recordingError) throw new Error('native recording failed');
  });
  const centralLog = jest.fn();
  jest.doMock('react-native', () => ({
    Platform: { OS: options.platform ?? 'android' },
    NativeModules: options.nativeModules === false ? undefined : options.native === false ? {} : { RNFBCrashlyticsModule: {} },
  }));
  jest.doMock('@/firebase/config', () => ({ USE_MOCK_DATA: options.mock ?? false }));
  jest.doMock('@/services/errorLog', () => ({ logError: centralLog }));
  jest.doMock('@react-native-firebase/crashlytics', () => {
    sdkLoads();
    if (options.requireError) throw new Error('native module is unavailable');
    return { getCrashlytics, recordError };
  });
  const caught = jest.fn();
  require('../../src/utils/errorObservation').installCaughtErrorSink(caught);
  const { reportCrashlyticsError } = require('../../src/services/crashlyticsService') as {
    reportCrashlyticsError: (input: CrashlyticsInput) => void;
  };
  return { report: reportCrashlyticsError, sdkLoads, getCrashlytics, recordError, instance, centralLog, caught };
}

function recordedText(recordError: jest.Mock): string {
  return recordError.mock.calls.map(([, error, name]) => JSON.stringify({
    name: error.name,
    message: error.message,
    stack: error.stack,
    jsErrorName: name,
  })).join('\n');
}

afterAll(() => {
  if (previousDev === undefined) delete (globalThis as { __DEV__?: boolean }).__DEV__;
  else (globalThis as { __DEV__?: boolean }).__DEV__ = previousDev;
});

test.each([
  ['development', { dev: true }],
  ['mock data', { mock: true }],
  ['web', { platform: 'web' }],
  ['an older native binary', { native: false }],
  ['a platform without NativeModules', { nativeModules: false }],
] as const)('does not load the SDK or send reports in %s', (_label, options) => {
  const { report, sdkLoads, getCrashlytics, recordError } = load(options);
  expect(() => report({ operation: 'groups.subscribe', message: 'permission denied' })).not.toThrow();
  expect(sdkLoads).not.toHaveBeenCalled();
  expect(getCrashlytics).not.toHaveBeenCalled();
  expect(recordError).not.toHaveBeenCalled();
});

test.each(['android', 'ios'])('loads the SDK lazily once and reports source information on %s', platform => {
  const { report, sdkLoads, getCrashlytics, recordError, instance } = load({ platform });
  expect(sdkLoads).not.toHaveBeenCalled();
  const input = {
    operation: 'groups.subscribe',
    message: 'subscription failed',
    code: 'firestore/permission-denied',
    stack: 'Error: subscription failed\n    at subscribe (src/services/groupService.ts:22:7)',
    source: 'src/hooks/useGroup.ts',
    handler: 'onSnapshot.error',
    site: 'group-subscription',
    isFatal: true,
  };
  report(input);
  report({ operation: 'games.load', message: 'offline' });
  expect(sdkLoads).toHaveBeenCalledTimes(1);
  expect(getCrashlytics).toHaveBeenCalledTimes(1);
  expect(recordError).toHaveBeenCalledTimes(2);
  expect(recordError.mock.calls[0][0]).toBe(instance);
  const error = recordError.mock.calls[0][1];
  expect(error).toBeInstanceOf(Error);
  const text = recordedText(recordError);
  for (const value of [input.operation, input.message, input.code, input.source, input.handler, input.site]) {
    expect(text).toContain(value);
  }
  expect(text).toContain('groupService.ts:22:7');
  expect(input.stack).toBe('Error: subscription failed\n    at subscribe (src/services/groupService.ts:22:7)');
});

test('redacts contact details, credentials and explicitly identified user ids in every report field', () => {
  const { report, recordError } = load();
  const input = {
    operation: 'subscribe uid=private-user-123',
    message: 'failed for private@example.invalid uid=account-456 userId:another-user-789 {"user_id":"private-json-user"} uid="private-quoted-user" token=secret-token Bearer secret-bearer',
    code: 'permission userId=private-code-owner',
    stack: 'Error: private@example.invalid\n at users/private-path-user/requests users/private.custom:owner/requests (src/request.ts:10:2)',
    source: 'source token=source-token',
    handler: 'handler uid=private-handler-owner',
    site: 'site private-site@example.invalid',
  };
  report(input);
  expect(recordError).toHaveBeenCalledTimes(1);
  const text = recordedText(recordError);
  expect(text).not.toMatch(/private@example|secret-token|secret-bearer|source-token|private-site@example/);
  expect(text).not.toMatch(/private-user-123|account-456|another-user-789|private-json-user|private-quoted-user|private-code-owner|private-path-user|\.custom:owner|private-handler-owner/);
  expect(input.message).toContain('private@example.invalid');
});

test('ignores identities, journals and arbitrary context outside the report allowlist', () => {
  const { report, recordError } = load();
  const input = {
    operation: 'groups.load',
    message: 'failed',
    userId: 'private-extra-user',
    trail: 'private-extra-trail',
    journal: { text: 'private-extra-journal' },
    context: { groupId: 'private-extra-group', email: 'context@example.invalid' },
    cause: new Error('private-extra-cause'),
  };
  report(input);
  expect(recordError).toHaveBeenCalledTimes(1);
  expect(recordedText(recordError)).not.toMatch(/private-extra|context@example/);
  const error = recordError.mock.calls[0][1];
  expect(Object.prototype.hasOwnProperty.call(error, 'cause')).toBe(false);
});

test.each([
  ['loading the SDK', { requireError: true }],
  ['initializing the native bridge', { initializationError: true }],
  ['recording a report', { recordingError: true }],
] as const)('swallows failures while %s without re-entering error reporting', (_label, options) => {
  const { report, centralLog, caught } = load(options);
  expect(() => {
    report({ operation: 'groups.load', message: 'failed' });
    report({ operation: 'games.load', message: 'failed again' });
  }).not.toThrow();
  expect(centralLog).not.toHaveBeenCalled();
  expect(caught).not.toHaveBeenCalled();
});

test('caps a repeated operation and code while preserving distinct failures', () => {
  const { report, recordError } = load();
  for (let i = 0; i < 1000; i++) {
    expect(() => report({ operation: 'groups.load', code: 'permission-denied', message: `failed ${i}` })).not.toThrow();
  }
  expect(recordError).toHaveBeenCalledTimes(8);
  report({ operation: 'groups.load', code: 'unavailable', message: 'offline' });
  report({ operation: 'games.load', code: 'permission-denied', message: 'denied' });
  expect(recordError).toHaveBeenCalledTimes(10);
});

test('bounds distinct signatures without allowing a hot signature to bypass its cap after overflow', () => {
  const { report, recordError } = load();
  for (let i = 0; i < 8; i++) report({ operation: 'hot-signature', code: 'denied', message: 'failed' });
  for (let i = 0; i < 1000; i++) {
    expect(() => report({ operation: `distinct-${i}`, code: 'denied', message: 'failed' })).not.toThrow();
  }
  const countAfterOverflow = recordError.mock.calls.length;
  expect(countAfterOverflow).toBeGreaterThan(8);
  expect(countAfterOverflow).toBeLessThan(1008);
  report({ operation: 'hot-signature', code: 'denied', message: 'failed again' });
  expect(recordError).toHaveBeenCalledTimes(countAfterOverflow);
});

test('keeps the report bounded when an error contains very large diagnostic fields', () => {
  const { report, recordError } = load();
  const huge = 'x'.repeat(100_000);
  expect(() => report({ operation: huge, message: huge, code: huge, stack: huge, source: huge, handler: huge, site: huge })).not.toThrow();
  expect(recordError).toHaveBeenCalledTimes(1);
  expect(recordedText(recordError).length).toBeLessThan(20_000);
});
