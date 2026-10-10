import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function load(mock: boolean, options: { auth?: any; restore?: () => Promise<any>; setupError?: Error; snapshotError?: Error } = {}) {
  const firebase = jest.fn(() => {
    if (mock) throw Error('getFirebase forbidden in demo');
    return { auth: options.auth ?? { currentUser: { uid: 'me' } } };
  });
  const collection = jest.fn(() => {
    if (mock) firebase();
    if (options.setupError) throw options.setupError;
    return {};
  });
  const stop = jest.fn();
  let next: ((snap: any) => void) | undefined, fail: ((err: unknown) => void) | undefined;
  const snapshot = jest.fn((_query, cb, err) => {
    if (options.snapshotError) throw options.snapshotError;
    next = cb; fail = err; return stop;
  });
  const write = jest.fn(() => { throw Error('write should not reach demo Firebase'); });
  const deps: Record<string, any> = {
    '@/firebase/config': { USE_MOCK_DATA: mock, getFirebase: firebase },
    '@/firebase/firestore': { col: new Proxy({}, { get: () => collection }) },
    '@/firebase/auth': { waitForAuthRestore: options.restore ?? (async () => ({ uid: 'me' })) },
    '@/services/errorLog': { logError: jest.fn() },
    'firebase/firestore': { query: (ref: any) => ref, orderBy() {}, limit() {}, onSnapshot: snapshot, setDoc: write, deleteDoc: write, addDoc: write, doc: collection },
    'firebase/functions': { httpsCallable: write },
  };
  const source = fs.readFileSync('src/services/chatService.ts', 'utf8');
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { module, exports: module.exports, require: (id: string) => deps[id] ?? {}, console, __DEV__: false });
  return { service: module.exports.chatService, firebase, collection, snapshot, stop, write, emit: (x: any) => next?.(x), fail: (x: any) => fail?.(x) };
}

test.each(['game', 'community', 'dm'])('demo %s chat reads, typing and receipts never access Firebase', async (scope) => {
  const x = load(true), seen = jest.fn(), failed = jest.fn();
  x.service.subscribeMessages(scope, 'g', seen, failed)();
  expect(seen.mock.calls[0][0]).toHaveLength(0);
  for (const name of ['subscribeTyping', 'subscribeReads']) {
    const cb = jest.fn(); x.service[name](scope, 'g', cb)(); expect(cb.mock.calls[0][0]).toHaveLength(0);
  }
  const muted = jest.fn(), blocked = jest.fn(), unread = jest.fn();
  x.service.subscribeMuted('me', scope, 'g', muted)();
  x.service.subscribeBlocked('me', blocked, failed)();
  x.service.subscribeUnread('me', unread)();
  expect(muted).toHaveBeenCalledWith(false); expect(blocked.mock.calls[0][0].size).toBe(0);
  await x.service.markChatRead('me', scope, 'g');
  await x.service.writeReadReceipt(scope, 'g', { id: 'me', name: 'דני' });
  await x.service.setTyping(scope, 'g', { id: 'me', name: 'דני' }, true);
  await x.service.setTyping(scope, 'g', { id: 'me', name: 'דני' }, false);
  expect(x.firebase).not.toHaveBeenCalled(); expect(x.collection).not.toHaveBeenCalled();
  expect(x.snapshot).not.toHaveBeenCalled(); expect(x.write).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});

test('unsupported demo actions reject explicitly without pretending to send or mutate', async () => {
  const x = load(true);
  const actions = [
    () => x.service.sendMessage('community', 'g', { id: 'me' }, 'hello'),
    () => x.service.deleteMessage('community', 'g', 'm'),
    () => x.service.setMuted('me', 'community', 'g', true),
    () => x.service.blockUser('me', 'other'), () => x.service.unblockUser('me', 'other'),
    () => x.service.reportMessage('me', 'community', 'g', { id: 'm' }),
  ];
  for (const action of actions) await expect(action()).rejects.toMatchObject({ code: 'chat/demo-read-only' });
  expect(x.firebase).not.toHaveBeenCalled(); expect(x.collection).not.toHaveBeenCalled(); expect(x.write).not.toHaveBeenCalled();
});

test.each(['query', 'snapshot'])('production synchronous %s failure is forwarded to the listener error callback', (kind) => {
  const error = Error(kind), x = load(false, kind === 'query' ? { setupError: error } : { snapshotError: error });
  const failed = jest.fn();
  expect(() => x.service.subscribeMessages('community', 'g', jest.fn(), failed)()).not.toThrow();
  expect(failed).toHaveBeenCalledWith(error);
});

test('rejected auth restoration is forwarded, while cancelled restoration cannot attach or report', async () => {
  let reject!: (err: Error) => void;
  const restore = () => new Promise((_resolve, fail) => { reject = fail; });
  const x = load(false, { auth: { currentUser: null }, restore });
  const failed = jest.fn(); x.service.subscribeMessages('game', 'g', jest.fn(), failed);
  reject(Error('offline')); await new Promise(setImmediate);
  expect(failed).toHaveBeenCalledTimes(1); expect(x.snapshot).not.toHaveBeenCalled();
  failed.mockClear(); const stop = x.service.subscribeMessages('game', 'g', jest.fn(), failed);
  stop(); reject(Error('offline after leave')); await new Promise(setImmediate);
  expect(failed).not.toHaveBeenCalled(); expect(x.snapshot).not.toHaveBeenCalled();
});

test('unsubscribing after attach closes the listener and suppresses late callbacks', () => {
  const x = load(false), seen = jest.fn(), failed = jest.fn();
  const stop = x.service.subscribeMessages('dm', 'g', seen, failed);
  x.emit({ docs: [{ data: () => ({ id: 'new' }) }, { data: () => ({ id: 'old' }) }] });
  expect(Array.from(seen.mock.calls[0][0], (m: any) => m.id)).toEqual(['old', 'new']);
  stop(); x.emit({ docs: [] }); x.fail(Error('late'));
  expect(x.stop).toHaveBeenCalledTimes(1); expect(seen).toHaveBeenCalledTimes(1); expect(failed).not.toHaveBeenCalled();
});

test('leaving before successful auth restore prevents attaching to the old chat', async () => {
  let resolve!: (user: any) => void;
  const x = load(false, { auth: { currentUser: null }, restore: () => new Promise(done => { resolve = done; }) });
  const failed = jest.fn(), stop = x.service.subscribeMessages('game', 'old', jest.fn(), failed);
  stop(); resolve({ uid: 'me' }); await new Promise(setImmediate);
  expect(x.snapshot).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
});
