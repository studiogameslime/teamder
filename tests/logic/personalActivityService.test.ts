import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError, isStaleSession } from '../../src/services/staleSession';
import { clearCaughtErrorOrigins, installCaughtErrorSink } from '../../src/utils/errorObservation';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(options: { mock?: boolean; os?: string } = {}): any {
  let uid = 'u', storeUid = 'u';
  const effects: Array<() => (() => void) | void> = [], ticks: Array<() => void> = [];
  let stateChange: (value: string) => void = () => {};
  const remove = jest.fn(), clear = jest.fn(), observe = jest.fn();
  clearCaughtErrorOrigins(); installCaughtErrorSink(observe);
  const chunk = (extra = {}) => ({ userId: 'u', gameId: 'g', sessionId: 'session', revision: 1,
    source: 'wear-health-services', offsetMs: 0, clockUncertaintyMs: 10,
    samples: [{ id: 'd:2000:3000', startAtMs: 2000, endAtMs: 3000, distanceM: 4 }], ...extra });
  const native = { getPendingActivity: jest.fn(async () => [chunk()]), ackActivity: jest.fn(async () => true) };
  const upload = jest.fn(async (_data: any) => ({ data: { status: 'saved', retryable: false } }));
  const summary = { version: 1, gameId: 'g', source: 'wear-health-services', eligibleMs: 9000, measuredMs: 1000,
    coverageRatio: 1 / 9, coverageMs: { distanceM: 1000, steps: 0, calories: 0 }, distanceM: 4, steps: null, calories: null,
    avgHeartRateBpm: null, maxHeartRateBpm: null, heartRateSamples: 0, acceptedSamples: 1, excludedBoundarySamples: 0,
    knownFrom: 1000, updatedAt: 10000 };
  const read = jest.fn(async (_data: any) => ({ data: { status: 'available', summary } }));
  const callable = jest.fn((_functions: any, name: string) => name === 'savePersonalActivity' ? upload : read);
  const appState = { currentState: 'active', addEventListener: jest.fn((_event: string, cb: typeof stateChange) => { stateChange = cb; return { remove }; }) };
  const nativeModules: any = { WatchBridge: native };
  const imports: Record<string, any> = {
    '@/config/sportsActivity': { SPORTS_ACTIVITY_ENABLED: true, assertSportsActivityEnabled: () => {} },
    react: { useEffect: (cb: typeof effects[number]) => effects.push(cb) },
    'react-native': { AppState: appState, NativeModules: nativeModules, Platform: { OS: options.os ?? 'android' } },
    'firebase/functions': { httpsCallable: callable },
    '@/firebase/config': { USE_MOCK_DATA: !!options.mock, getFirebase: () => ({ functions: {}, auth: { currentUser: uid ? { uid, isAnonymous: false } : null } }) },
    '@/store/userStore': { useUserStore: { getState: () => ({ currentUser: storeUid ? { id: storeUid, isGuest: false } : null }) } },
    '@/services/staleSession': { StaleSessionError, isStaleSession },
    '../utils/errorObservation': { observeCaughtError: observe },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/personalActivityService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions'; if (!(id in imports)) throw new Error(id); return imports[id]; },
    setInterval: (cb: () => void) => { ticks.push(cb); return ticks.length; }, clearInterval: clear, Map, Set, Promise });
  return { ...exports, native, nativeModules, upload, read, callable, summary, chunk, effects, ticks, appState, remove, clear, observe,
    switchUser: (id: string, store = id) => { uid = id; storeUid = store; },
    emitState: (state: string) => { appState.currentState = state; stateChange(state); } };
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('saved chunk is sent with bound identity and acknowledged exactly once', async () => {
  const f = fixture();
  expect(await f.flushPersonalActivity('u')).toEqual({ uploaded: 1, pending: 0, processing: 0 });
  expect(f.upload).toHaveBeenCalledWith(expect.objectContaining({ expectedUid: 'u', gameId: 'g', source: 'wear-health-services' }));
  expect(f.native.ackActivity).toHaveBeenCalledWith('session', 1);
  expect(f.callable).toHaveBeenCalledWith(expect.anything(), 'savePersonalActivity', { timeout: 20000 });
});
test('duplicate is acknowledged, processing and stale retain their durable chunks', async () => {
  const f = fixture();
  f.upload.mockResolvedValue({ data: { status: 'duplicate', retryable: false } });
  await f.flushPersonalActivity('u'); expect(f.native.ackActivity).toHaveBeenCalledTimes(1);
  for (const status of ['processing', 'stale']) {
    f.native.ackActivity.mockClear(); f.upload.mockResolvedValue({ data: { status, retryable: status === 'processing' } });
    expect(await f.flushPersonalActivity('u')).toMatchObject({ uploaded: 0, pending: 1, processing: 1 });
    expect(f.native.ackActivity).not.toHaveBeenCalled();
  }
});
test('session chunks are sorted and later revisions wait when a previous revision is pending', async () => {
  const f = fixture();
  f.native.getPendingActivity.mockResolvedValue([f.chunk({ revision: 2 }), f.chunk(), f.chunk({ sessionId: 'z-other' })]);
  f.upload.mockImplementation(async (data: any) => ({ data: { status: data.sessionId === 'session' ? 'processing' : 'saved', retryable: true } }));
  expect(await f.flushPersonalActivity('u')).toEqual({ uploaded: 1, pending: 2, processing: 1 });
  expect(f.upload.mock.calls.map((args: any[]) => [args[0].sessionId, args[0].revision])).toEqual([['session', 1], ['z-other', 1]]);
});
test('concurrent callers share one native read and one upload', async () => {
  const f = fixture(), gate = deferred<any>();
  f.upload.mockReturnValue(gate.promise);
  const first = f.flushPersonalActivity('u'), second = f.flushPersonalActivity('u');
  expect(first).toBe(second); await settle();
  expect(f.native.getPendingActivity).toHaveBeenCalledTimes(1);
  gate.resolve({ data: { status: 'saved', retryable: false } }); await first;
  expect(f.upload).toHaveBeenCalledTimes(1);
});
test('wrong auth or store identity is rejected before touching the queue', async () => {
  const f = fixture(); f.switchUser('u', 'old');
  await expect(f.flushPersonalActivity('u')).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(f.native.getPendingActivity).not.toHaveBeenCalled();
});
test('switch while reading the native queue stops before upload', async () => {
  const f = fixture(), gate = deferred<any>(); f.native.getPendingActivity.mockReturnValue(gate.promise);
  const task = f.flushPersonalActivity('u'); f.switchUser('new'); gate.resolve([f.chunk()]);
  await expect(task).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(f.upload).not.toHaveBeenCalled();
});
test('switch during an in-flight upload never acknowledges old-account data', async () => {
  const f = fixture(), gate = deferred<any>(); f.upload.mockReturnValue(gate.promise);
  const task = f.flushPersonalActivity('u'); await settle(); f.switchUser('new');
  gate.resolve({ data: { status: 'saved', retryable: false } });
  await expect(task).rejects.toMatchObject({ name: 'StaleSessionError' }); expect(f.native.ackActivity).not.toHaveBeenCalled();
  expect(f.observe).not.toHaveBeenCalled();
});
test('a failed request from a replaced account is still a stale session, not a current-user error', async () => {
  const f = fixture(), gate = deferred<any>(); f.upload.mockReturnValue(gate.promise);
  const task = f.flushPersonalActivity('u'); await settle(); f.switchUser('new'); gate.reject(new Error('network old request'));
  await expect(task).rejects.toMatchObject({ name: 'StaleSessionError' }); expect(f.native.ackActivity).not.toHaveBeenCalled();
  expect(f.observe).not.toHaveBeenCalled();
});
test('queue records belonging to another user are neither uploaded nor acknowledged', async () => {
  const f = fixture(); f.native.getPendingActivity.mockResolvedValue([f.chunk({ userId: 'another' })]);
  expect(await f.flushPersonalActivity('u')).toEqual({ uploaded: 0, pending: 0, processing: 0 });
  expect(f.upload).not.toHaveBeenCalled(); expect(f.native.ackActivity).not.toHaveBeenCalled();
});
test('failed native acknowledgment retains the revision and blocks its successor', async () => {
  const f = fixture(); f.native.ackActivity.mockResolvedValue(false);
  f.native.getPendingActivity.mockResolvedValue([f.chunk(), f.chunk({ revision: 2 })]);
  expect(await f.flushPersonalActivity('u')).toMatchObject({ uploaded: 0, pending: 2, processing: 1 });
  expect(f.upload).toHaveBeenCalledTimes(1);
});
test('remote error never exposes measurement values and never acknowledges data', async () => {
  const f = fixture(); f.upload.mockRejectedValue(Object.assign(new Error('secret heartRate=177 distance=412'), { code: 'functions/unavailable' }));
  await expect(f.flushPersonalActivity('u')).rejects.toMatchObject({ message: 'Personal activity synchronization failed', code: 'functions/unavailable' });
  expect(f.native.ackActivity).not.toHaveBeenCalled(); expect(f.observe).toHaveBeenCalledTimes(1);
  const [reported, origin] = f.observe.mock.calls[0];
  expect(reported).toMatchObject({ message: 'Personal activity synchronization failed', code: 'functions/unavailable' });
  expect(`${String(reported)} ${JSON.stringify(reported)} ${JSON.stringify(origin)}`).not.toMatch(/177|412|heartRate|distance/);
});

test('native error code remains diagnosable without forwarding private native text',async()=>{
 const f=fixture();f.native.getPendingActivity.mockRejectedValue(Object.assign(Error('private sensor payload 177'),{code:'ACTIVITY_READ_FAILED'}));
 await expect(f.flushPersonalActivity('u')).rejects.toMatchObject({code:'ACTIVITY_READ_FAILED',message:'Personal activity synchronization failed'});
 expect(f.upload).not.toHaveBeenCalled();expect(f.native.ackActivity).not.toHaveBeenCalled();
 expect(f.observe.mock.calls[0][0].code).toBe('ACTIVITY_READ_FAILED');
});
test.each([{ mock: true }, { os: 'ios' }])('disabled platform and mock do not touch native or Firebase %j', async options => {
  const f = fixture(options); await f.flushPersonalActivity('u');
  expect(f.native.getPendingActivity).not.toHaveBeenCalled(); expect(f.callable).not.toHaveBeenCalled();
});
test('missing native binding is a supported no-op', async () => {
  const f = fixture(); delete f.nativeModules.WatchBridge;
  expect(await f.flushPersonalActivity('u')).toEqual({ uploaded: 0, pending: 0, processing: 0 });
});
test('summary read preserves null values and binds uid and game', async () => {
  const f = fixture();
  const result = await f.getMyPersonalActivity('g', 'u');
  expect(result.summary.steps).toBeNull(); expect(f.read).toHaveBeenCalledWith({ expectedUid: 'u', gameId: 'g' });
});
test('switch during summary read discards the previous account response', async () => {
  const f = fixture(), gate = deferred<any>(); f.read.mockReturnValue(gate.promise);
  const task = f.getMyPersonalActivity('g', 'u'); f.switchUser('new');
  gate.resolve({ data: { status: 'available', summary: f.summary } });
  await expect(task).rejects.toMatchObject({ name: 'StaleSessionError' });
});
test('summary game mismatch or invalid coverage cannot become an empty successful result', async () => {
  const f = fixture();
  f.read.mockResolvedValue({ data: { status: 'available', summary: { ...f.summary, gameId: 'wrong' } } });
  await expect(f.getMyPersonalActivity('g', 'u')).rejects.toThrow('synchronization failed');
  f.read.mockResolvedValue({ data: { status: 'available', summary: { ...f.summary, coverageRatio: 2 } } });
  await expect(f.getMyPersonalActivity('g', 'u')).rejects.toThrow('synchronization failed');
});
test('pending summary remains null with its reason instead of fabricated zeros', async () => {
  const f = fixture(); f.read.mockResolvedValue({ data: { status: 'processing', summary: null, reason: 'journal-pending' } });
  expect(await f.getMyPersonalActivity('g', 'u')).toEqual({ status: 'processing', summary: null, reason: 'journal-pending' });
});
test('an unavailable server summary with a local recording is pending instead of absent', async () => {
  const f = fixture(); f.read.mockResolvedValue({ data: { status: 'unavailable', summary: null, reason: 'no-watch-data' } });
  expect(await f.getMyPersonalActivity('g', 'u')).toEqual({ status: 'processing', summary: null, reason: 'native-queue-pending' });
  f.native.getPendingActivity.mockResolvedValue([f.chunk({ userId: 'other' }), f.chunk({ gameId: 'another' })]);
  expect(await f.getMyPersonalActivity('g', 'u')).toMatchObject({ status: 'unavailable', summary: null });
});
test('summary invalid path and mock do not call the backend', async () => {
  const f = fixture(); await expect(f.getMyPersonalActivity('../other', 'u')).rejects.toThrow('identifier'); expect(f.read).not.toHaveBeenCalled();
  const mock = fixture({ mock: true }); expect(await mock.getMyPersonalActivity('g', 'u')).toMatchObject({ status: 'unavailable', summary: null });
});
test('hook starts immediately, resumes on foreground, skips background and cleans up', async () => {
  const f = fixture(); f.usePersonalActivitySync('u'); const cleanup = f.effects[0](); await settle();
  expect(f.native.getPendingActivity).toHaveBeenCalledTimes(1);
  f.emitState('background'); f.ticks[0](); await settle(); expect(f.native.getPendingActivity).toHaveBeenCalledTimes(1);
  f.emitState('active'); await settle(); expect(f.native.getPendingActivity).toHaveBeenCalledTimes(2);
  cleanup(); f.ticks[0](); await settle(); expect(f.native.getPendingActivity).toHaveBeenCalledTimes(2);
  expect(f.remove).toHaveBeenCalledTimes(1); expect(f.clear).toHaveBeenCalledTimes(1);
});
test('hook does not report the sanitized service error a second time', async () => {
  const f = fixture(); f.upload.mockRejectedValue(new Error('heartRate=177'));
  f.usePersonalActivitySync('u'); const cleanup = f.effects[0](); await settle(); cleanup();
  expect(f.observe).toHaveBeenCalledTimes(1);
  expect(String(f.observe.mock.calls[0][0])).not.toContain('177');
});
test('summary failures are observed only as sanitized errors', async () => {
  const f = fixture(); f.read.mockRejectedValue(new Error('calories=1234'));
  await expect(f.getMyPersonalActivity('g', 'u')).rejects.toThrow('synchronization failed');
  expect(f.observe).toHaveBeenCalledTimes(1);
  expect(`${String(f.observe.mock.calls[0][0])} ${JSON.stringify(f.observe.mock.calls[0][1])}`).not.toMatch(/1234|calories/);
});
