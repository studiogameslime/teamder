import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { isStaleSession, StaleSessionError } from '@/services/staleSession';
import { isTransientReadError } from '@/services/readRetry';

function load(file: string, dependencies: Record<string, any>) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => dependencies[name] ?? {},
    Date, console, __DEV__: false, setTimeout, clearTimeout });
  return module.exports;
}
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const a = { id: 'first', name: 'ראשון' }, b = { id: 'second', name: 'שני' };
const flush = () => new Promise<void>(done => setImmediate(done));
function world() {
  const auth = { currentUser: { uid: a.id } };
  let cached: any = a, stored: any = { ...a };
  const storage = { setAuthUserJson: jest.fn(async (json: string) => { cached = JSON.parse(json); }), getAuthUserJson: async () => JSON.stringify(cached) };
  const write = jest.fn(async (_ref: any, updates: any) => { stored = { ...stored, ...updates }; });
  const readBack = jest.fn(async () => ({ exists: () => true, data: () => stored }));
  const statistics: any[] = [];
  const deps = {
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ auth }) },
    '@/firebase/firestore': { docs: { user: (id:string) => id } },
    './publicPlayerService': { invalidatePlayerIdentityReads() {} },
    './readRetry': { isTransientReadError, retryRead: async (read: () => unknown, check: () => void) => { check(); const result = await read(); check(); return result; } },
    './staleSession': { StaleSessionError, isStaleSession }, '@/services/staleSession': { StaleSessionError, isStaleSession },
    '@/firebase/auth': { waitForAuthRestore: async () => auth.currentUser },
    './storage': { storage }, '@/services/storage': { storage },
    '@/services/errorLog': { logError() {} }, './errorLog': { logError() {} }, '../utils/errorObservation': { observeCaughtError() {} },
    '@/utils/validate': { sanitizeDisplayString: (s:string) => s.trim() },
    '@/utils/officialAccount': { isReservedName: () => false, isEmailLikeName: () => false },
    'firebase/firestore': { updateDoc: write, getDoc: async () => { throw new Error('offline'); }, getDocFromServer: readBack, deleteField: () => 'delete' },
    '@/services/analyticsService': { logEvent: (...args:any[]) => statistics.push(args), AnalyticsEvent: {} },
  };
  const service = load('src/services/userService.ts', deps).userService;
  const getCurrentUser = service.getCurrentUser.bind(service);
  service.getCurrentUser = jest.fn(async () => ({ ...stored }));
  let state: any;
  const set = (patch: any) => Object.assign(state, patch);
  load('src/store/userStore.ts', { ...deps, '@/services': { userService: service },
    zustand: { create: (init:any) => { state = init(set, () => state); return () => state; } } });
  state.currentUser = a;
  const switchToB = () => { auth.currentUser = { uid: b.id }; state.currentUser = b; cached = b; };
  return { service, getCurrentUser, state, write, readBack, switchToB, storage, auth, statistics, cached: () => cached, stored: () => stored };
}
test('a save awaiting the profile read cannot write its draft to the next identity', async () => {
  const w = world(), gate = defer<any>();
  w.service.getCurrentUser.mockReturnValueOnce(gate.promise);
  const pending = w.state.updateProfile({ name: 'פרטי' });
  w.switchToB(); gate.resolve(b);
  await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(w.write).not.toHaveBeenCalled();
  expect(w.state.currentUser).toEqual(b);
  expect(w.cached()).toEqual(b);
});
test('an acknowledgement delivered after account replacement cannot replace its store or offline profile', async () => {
  const w = world(), gate = defer<void>();
  w.write.mockImplementationOnce(async () => { await gate.promise; });
  const pending = w.state.updateProfile({ position: 'GK' });
  await flush();
  expect(w.write).toHaveBeenCalledTimes(1);
  w.switchToB(); gate.resolve();
  await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(w.state.currentUser).toEqual(b);
  expect(w.cached()).toEqual(b);
  expect(w.statistics).toHaveLength(0);
});
test('a lost reply is acknowledged only when a server read verifies the intended fields', async () => {
  const w = world();
  const write = w.write.getMockImplementation()!;
  w.write.mockImplementationOnce(async (...args) => { await write(...args); throw Object.assign(new Error('lost reply'), { code: 'unavailable' }); });
  await w.state.updateProfile({ name: 'שמור' });
  expect(w.readBack).toHaveBeenCalledTimes(1);
  expect(w.write).toHaveBeenCalledTimes(1);
  expect(w.state.currentUser.name).toBe('שמור');
  expect(w.cached().name).toBe('שמור');
});
test('when neither the write nor a confirming read succeeds, keep the profile and accept a later retry', async () => {
  const w = world();
  const offline = Object.assign(new Error('offline'), { code: 'unavailable' });
  w.write.mockRejectedValueOnce(offline);
  w.readBack.mockRejectedValueOnce(offline);
  await expect(w.state.updateProfile({ name: 'טיוטה' })).rejects.toThrow('offline');
  expect(w.state.currentUser).toEqual(a);
  expect(w.cached()).toEqual(a);
  await w.state.updateProfile({ name: 'טיוטה' });
  expect(w.stored().name).toBe('טיוטה');
  expect(w.write).toHaveBeenCalledTimes(2);
});

test('a failed refresh keeps a known profile for its current owner and exposes that the read failed', async () => {
  const w = world();
  w.service.getCurrentUser.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await expect(w.state.refreshFromSession(a.id)).rejects.toThrow('offline');
  expect(w.state.currentUser).toEqual(a);
  expect(w.state.profileRestoreFailed).toBe(true);
});
test('a failed or successful old refresh cannot clear or overwrite the new session', async () => {
  for (const failed of [true, false]) {
    const w = world(), gate = defer<void>();
    w.service.getCurrentUser.mockImplementationOnce(async () => { await gate.promise; if (failed) throw new Error('offline'); return a; });
    const pending = w.state.refreshFromSession(a.id);
    w.switchToB(); gate.resolve();
    await expect(pending).rejects.toMatchObject({ name: 'StaleSessionError' });
    expect(w.state.currentUser).toEqual(b);
    expect(w.state.profileRestoreFailed).toBe(false);
  }
});

test('queued cache writes check their owner at execution and the latest account wins even after delayed native storage', async () => {
  const gate = defer<void>(), writes: string[] = [];
  let owner = a.id, cache = '';
  const native = {
    setItem: async (_key:string, value:string) => { writes.push(value); if (value === 'first') await gate.promise; cache = value; },
    getItem: async () => cache,
  };
  const storage = load('src/services/storage.ts', { '@react-native-async-storage/async-storage': { default: native } }).storage;
  const active = storage.setAuthUserJson('first', () => owner === a.id);
  await flush();
  const stale = storage.setAuthUserJson('late-first', () => owner === a.id);
  owner = b.id;
  const current = storage.setAuthUserJson('second', () => owner === b.id);
  gate.resolve();
  await Promise.all([active, stale, current]);
  expect(writes).toEqual(['first', 'second']);
  expect(await storage.getAuthUserJson()).toBe('second');
});

test('a server reply that disagrees about the intended value cannot claim a save succeeded', async () => {
  const w = world(), offline = Object.assign(new Error('offline'), { code: 'unavailable' });
  w.write.mockRejectedValueOnce(offline);
  await expect(w.state.updateProfile({ name: 'העריכה שלי' })).rejects.toThrow('offline');
  expect(w.readBack).toHaveBeenCalledTimes(1);
  expect(w.statistics).toHaveLength(0);
  expect(w.state.currentUser).toEqual(a);
});

test('startup can restore a matching offline profile but an explicit refresh cannot mislabel it as a server read', async () => {
  const w = world();
  await expect(w.getCurrentUser()).resolves.toEqual(a);
  w.readBack.mockRejectedValueOnce(new Error('offline'));
  await expect(w.getCurrentUser({ requireServer: true })).rejects.toThrow('offline');
  expect(w.readBack).toHaveBeenCalledTimes(1);
});
test('a callback from the previous account cannot start a write on the account now on screen', async () => {
  const w = world();
  w.switchToB();
  await expect(w.state.updateProfile({ name: 'טיוטה מהמסך הקודם' }, a.id)).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(w.service.getCurrentUser).not.toHaveBeenCalled();
  expect(w.write).not.toHaveBeenCalled();
});
