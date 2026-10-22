type RejectionOptions = {
  allRejections: boolean;
  onUnhandled: (id: number, reason: unknown) => void;
  onHandled: (id: number, reason?: unknown) => void;
};

type HermesHooks = {
  hasPromise?: () => boolean;
  enablePromiseRejectionTracker?: (options: RejectionOptions) => void;
};

const globalNames = ['HermesInternal', 'ErrorUtils', '__errorLogInstalled', '__DEV__'] as const;
const originalGlobals = globalNames.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let clearPending: (() => void) | undefined;

function load(hermes?: HermesHooks, polyfillThrows = false) {
  jest.resetModules();
  Object.assign(globalThis, { HermesInternal: hermes, ErrorUtils: undefined });
  delete (globalThis as { __errorLogInstalled?: boolean }).__errorLogInstalled;
  const report = jest.fn();
  const polyfillLoads = jest.fn();
  const polyfillEnable = jest.fn((_options: RejectionOptions) => {
    if (polyfillThrows) throw new Error('polyfill tracking unavailable');
  });
  jest.doMock('react-native', () => ({ Platform: { OS: 'android', Version: 35 } }));
  jest.doMock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: 'test' } } }));
  jest.doMock('@/firebase/config', () => ({
    getFirebase: () => ({ auth: { currentUser: { uid: 'test-owner' } }, functions: {} }),
  }));
  jest.doMock('firebase/functions', () => ({ httpsCallable: () => jest.fn().mockResolvedValue({}) }));
  jest.doMock('@/services/breadcrumbs', () => ({ crumbErr: jest.fn(), formatTrail: () => '' }));
  jest.doMock('@/services/diagnosticJournal', () => ({
    diagnosticAttachment: () => '', diagnosticOwner: () => undefined, diagnosticReportScreen: () => 'test-screen',
  }));
  jest.doMock('@/services/diagnosticStorage', () => ({
    readPendingDiagnosticErrors: () => Promise.resolve([]),
    savePendingDiagnosticErrors: jest.fn().mockResolvedValue(undefined),
    persistDiagnosticJournal: jest.fn().mockResolvedValue(undefined),
  }));
  jest.doMock('@/services/crashlyticsService', () => ({ reportCrashlyticsError: report }));
  jest.doMock('promise/setimmediate/rejection-tracking', () => {
    polyfillLoads();
    return { enable: polyfillEnable };
  });
  const errors = require('../../src/services/errorLog') as typeof import('../../src/services/errorLog');
  clearPending = errors.clearPendingErrors;
  return { errors, report, polyfillLoads, polyfillEnable };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  clearPending?.();
  clearPending = undefined;
  jest.useRealTimers();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('registers native Hermes promise tracking without loading the unrelated promise polyfill tracker', () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const hasPromise = jest.fn(() => true);
  const { errors, polyfillLoads, polyfillEnable } = load({ hasPromise, enablePromiseRejectionTracker: enable });
  const originalPromise = globalThis.Promise;
  expect(() => errors.installGlobalErrorHandlers()).not.toThrow();
  expect(globalThis.Promise).toBe(originalPromise);
  expect(hasPromise).toHaveBeenCalled();
  expect(enable).toHaveBeenCalledTimes(1);
  expect(enable.mock.calls[0][0]).toEqual({
    allRejections: true,
    onUnhandled: expect.any(Function),
    onHandled: expect.any(Function),
  });
  expect(polyfillLoads).not.toHaveBeenCalled();
  expect(polyfillEnable).not.toHaveBeenCalled();
});

test('preserves React Native promise tracking and LogBox in Hermes development builds', () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const { errors, polyfillLoads, polyfillEnable } = load({ hasPromise: (): boolean => true, enablePromiseRejectionTracker: enable });
  Object.assign(globalThis, { __DEV__: true });
  expect(() => errors.installGlobalErrorHandlers()).not.toThrow();
  expect(enable).not.toHaveBeenCalled();
  expect(polyfillLoads).not.toHaveBeenCalled();
  expect(polyfillEnable).not.toHaveBeenCalled();
});

test('sends an unhandled Hermes rejection through the existing sanitized error channel', () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const { errors, report } = load({ hasPromise: (): boolean => true, enablePromiseRejectionTracker: enable });
  errors.installGlobalErrorHandlers();
  const options = enable.mock.calls[0][0];
  const rejection = Object.assign(new Error('private@example.invalid token=private-token'), { code: 'unavailable' });
  expect(() => options.onUnhandled(4, rejection)).not.toThrow();
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({
    operation: 'unhandledRejection', code: 'unavailable', message: expect.stringContaining('[redacted]'),
  }));
  expect(JSON.stringify(report.mock.calls)).not.toMatch(/private@example|private-token/);
  options.onHandled(4, rejection);
  expect(report).toHaveBeenCalledTimes(1);
});

test('deduplicates a Hermes rejection already reported by a service or caught-error observer', async () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const { errors, report } = load({ hasPromise: (): boolean => true, enablePromiseRejectionTracker: enable });
  const observations = require('../../src/utils/errorObservation') as typeof import('../../src/utils/errorObservation');
  errors.installGlobalErrorHandlers();
  const failure = new Error('same failure');
  observations.observeCaughtError(failure, { source: 'src/service.ts', handler: 'load', site: 'service-load' });
  errors.logError('loadGroup', failure);
  enable.mock.calls[0][0].onUnhandled(7, failure);
  await Promise.resolve();
  expect(report).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'loadGroup', source: 'src/service.ts' }));
});

test('retains an undefined Hermes rejection reason as an error occurrence', () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const { errors, report } = load({ hasPromise: (): boolean => true, enablePromiseRejectionTracker: enable });
  errors.installGlobalErrorHandlers();
  enable.mock.calls[0][0].onUnhandled(1, undefined);
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'unhandledRejection', message: 'undefined' }));
});

test.each([
  ['Hermes is absent', undefined],
  ['Hermes uses the promise polyfill', { hasPromise: (): boolean => false, enablePromiseRejectionTracker: jest.fn() }],
  ['the native tracking API is absent', { hasPromise: (): boolean => true }],
] as const)('uses the promise-polyfill tracker when %s', (_label, hermes) => {
  const { errors, report, polyfillLoads, polyfillEnable } = load(hermes);
  errors.installGlobalErrorHandlers();
  expect(polyfillLoads).toHaveBeenCalledTimes(1);
  expect(polyfillEnable).toHaveBeenCalledTimes(1);
  const options = polyfillEnable.mock.calls[0][0];
  expect(options.allRejections).toBe(true);
  options.onUnhandled(2, new Error('polyfill rejection'));
  expect(report).toHaveBeenCalledWith(expect.objectContaining({ operation: 'unhandledRejection', message: 'polyfill rejection' }));
});

test.each([
  ['checking Hermes promise support', { hasPromise: (): boolean => { throw new Error('Hermes probe failed'); } }],
  ['enabling Hermes tracking', { hasPromise: (): boolean => true, enablePromiseRejectionTracker: () => { throw new Error('Hermes tracking failed'); } }],
] as const)('keeps startup usable if %s throws', (_label, hermes) => {
  const { errors, report } = load(hermes);
  expect(() => errors.installGlobalErrorHandlers()).not.toThrow();
  expect(report).not.toHaveBeenCalled();
});

test('keeps startup usable if the fallback tracker throws', () => {
  const { errors, report } = load(undefined, true);
  expect(() => errors.installGlobalErrorHandlers()).not.toThrow();
  expect(report).not.toHaveBeenCalled();
});

test('still installs Hermes tracking when an unrelated ErrorUtils hook fails', () => {
  const enable = jest.fn<void, [RejectionOptions]>();
  const { errors } = load({ hasPromise: (): boolean => true, enablePromiseRejectionTracker: enable });
  Object.assign(globalThis, { ErrorUtils: { setGlobalHandler: () => { throw new Error('ErrorUtils unavailable'); } } });
  expect(() => errors.installGlobalErrorHandlers()).not.toThrow();
  expect(enable).toHaveBeenCalledTimes(1);
});
