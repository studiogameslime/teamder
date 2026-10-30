import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { retryRead } from '@/services/readRetry';
import { StaleSessionError } from '@/services/staleSession';

function userFixture() {
  const auth: { currentUser: { uid: string } | null } = { currentUser: { uid: 'owner' } };
  const getDoc = jest.fn();
  const cached = { id: 'owner', name: 'שם שמור' };
  const readCachedAuthUser = jest.fn(async () => cached), cacheAuthUser = jest.fn();
  const source = ts.createSourceFile('user.ts', fs.readFileSync('src/services/userService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const methods: string[] = [];
  function walk(node: ts.Node) {
    if (ts.isMethodDeclaration(node) && ['getCurrentUser','getUserById'].includes(node.name.getText(source))) methods.push(node.getText(source));
    ts.forEachChild(node, walk);
  }
  walk(source);
  const service = vm.runInNewContext(ts.transpileModule(`({${methods.join(',')}})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    USE_MOCK_DATA: false, getFirebase: () => ({ auth }), waitForAuthRestore: async () => ({ uid:'owner', isAnonymous:false }),
    docs: { user: (id: string) => id }, getDoc, retryRead, StaleSessionError,
    readCachedAuthUser, cacheAuthUser, touchPresence: jest.fn(), setTimeout, clearTimeout, __DEV__: false,
  });
  const snapshot = (id = 'owner') => ({ exists: () => true, data: () => ({ id, name: 'שם עדכני' }) });
  return { service, auth, getDoc, cached, readCachedAuthUser, cacheAuthUser, snapshot };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test.each(['getCurrentUser','getUserById'])('%s recovers a transient failure and returns confirmed data', async method => {
  const f=userFixture();
  f.getDoc.mockRejectedValueOnce(Object.assign(Error('temporary'),{code:'unavailable'})).mockResolvedValueOnce(f.snapshot());
  const pending=f.service[method]('owner');await jest.advanceTimersByTimeAsync(500);
  expect(await pending).toMatchObject({id:'owner',name:'שם עדכני'});
  expect(f.getDoc).toHaveBeenCalledTimes(2);expect(f.readCachedAuthUser).not.toHaveBeenCalled();
});
test.each(['getCurrentUser','getUserById'])('%s rejects an account switch during backoff without reading again', async method => {
  const f=userFixture();f.getDoc.mockRejectedValue(Object.assign(Error('offline'),{code:'unavailable'}));
  const assertion=expect(f.service[method]('owner')).rejects.toMatchObject({name:'StaleSessionError'});
  await jest.advanceTimersByTimeAsync(1);f.auth.currentUser={uid:'replacement'};
  await jest.advanceTimersByTimeAsync(500);await assertion;
  expect(f.getDoc).toHaveBeenCalledTimes(1);expect(f.readCachedAuthUser).not.toHaveBeenCalled();
});
test('an unresponsive boot read keeps the eight-second deadline and cached account', async()=>{
  const f=userFixture();let reject!: (e: unknown)=>void;
  f.getDoc.mockReturnValue(new Promise((_resolve,no)=>{reject=no;}));
  const pending=f.service.getCurrentUser();await jest.advanceTimersByTimeAsync(8000);
  expect(await pending).toEqual(f.cached);
  reject(Object.assign(Error('late offline'),{code:'unavailable'}));await jest.advanceTimersByTimeAsync(1000);
  expect(f.getDoc).toHaveBeenCalledTimes(1);expect(f.cacheAuthUser).not.toHaveBeenCalled();
});
test('persistent offline profile failure preserves the cached account after bounded retry',async()=>{
  const f=userFixture();f.getDoc.mockRejectedValue(Object.assign(Error('offline'),{code:'unavailable'}));
  const pending=f.service.getCurrentUser();await jest.advanceTimersByTimeAsync(500);
  expect(await pending).toEqual(f.cached);expect(f.getDoc).toHaveBeenCalledTimes(2);
});
