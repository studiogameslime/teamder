const mockRows = new Map<string, any>();
const mockWrite = jest.fn((ref: any, values: any) => {
  const old = mockRows.get(ref.path) ?? {};
  mockRows.set(ref.path, {...old, ...values, count: (old.count ?? 0) + (values.count?.increment ?? 0)});
});
jest.doMock(require.resolve('firebase-admin/firestore', {paths: [process.cwd() + '/functions']}), () => ({
  getFirestore: () => ({doc: (path: string) => ({path}), runTransaction: async (fn: any) => fn({
    get: async (ref: any) => ({exists: mockRows.has(ref.path)}), set: mockWrite,
  })}),
  FieldValue: {increment: (n: number) => ({increment: n}), serverTimestamp: () => 123},
}), {virtual: true});
const { observeCaughtError, reportServerError, withServerErrorReporting }: typeof import('../../functions/src/serverErrorLog') = require('../../functions/src/serverErrorLog');
const origin = {source:'functions/src/example.ts',handler:'work',site:'example:one'};
beforeEach(() => {mockRows.clear();mockWrite.mockClear();});
test('caught, explicitly reported and rethrown server error is one report and preserves identity', async () => {
  const failure = Object.assign(new Error('database failed'),{code: 9});
  const work = withServerErrorReporting('request', async () => {
    observeCaughtError(failure, origin);
    await reportServerError({operation:'finishRound',err:failure,context:{gameId:'round'}});
    throw failure;
  });
  await expect(work()).rejects.toBe(failure);
  expect(mockWrite).toHaveBeenCalledTimes(1);
  expect([...mockRows.values()][0]).toMatchObject({operation:'finishRound',count:1,lastCode:'9',lastContext:{source:origin.source,gameId:'round'}});
});
test('successful fallback waits for reporting and returns the original value', async () => {
  const result = await withServerErrorReporting('load', async () => {observeCaughtError(new Error('failed'),origin);return 42;})();
  expect(result).toBe(42);expect(mockWrite).toHaveBeenCalledTimes(1);
});
test('distinct recurring failures in one invocation share a write but retain the occurrence count', async () => {
  await withServerErrorReporting('load',async()=>{
    observeCaughtError(new Error('failed'),origin);observeCaughtError(new Error('failed'),origin);
  })();
  expect(mockWrite).toHaveBeenCalledTimes(1);expect([...mockRows.values()][0].count).toBe(2);
});
test('legacy season reporters keep their existing document id and moderation state',async()=>{
  mockRows.set('errors/srv_seasonRollover_club',{status:'reviewed',count:4});
  await withServerErrorReporting('sweep',async()=>{
    await reportServerError({operation:'seasonRollover',err:new Error('failed'),context:{groupId:'club'}});
  })();
  expect(mockRows.get('errors/srv_seasonRollover_club')).toMatchObject({status:'reviewed',count:5});
  expect(mockRows.size).toBe(1);
});
test('concurrent invocations keep unrelated errors and context isolated', async () => {
  await Promise.all(['first','second'].map(handler => withServerErrorReporting(handler, async () => {
    await Promise.resolve();observeCaughtError(new Error(handler),{...origin,handler});
  })()));
  expect(mockWrite).toHaveBeenCalledTimes(2);
  expect([...mockRows.values()].map(row => row.lastContext.handler).sort()).toEqual(['first','second']);
});
test('diagnostic write failure does not mask the operation outcome or recurse', async () => {
  const warning=jest.spyOn(console,'error').mockImplementation(()=>{});
  mockWrite.mockImplementationOnce(()=>{throw new Error('reporter offline');});
  await expect(withServerErrorReporting('work', async () => {observeCaughtError(new Error('private@example.invalid'),origin);return 'kept';})()).resolves.toBe('kept');
  expect(mockWrite).toHaveBeenCalledTimes(1);expect(warning).toHaveBeenCalledTimes(1);warning.mockRestore();
});
test('explicit cause wrappers share an incident while separate errors remain occurrences',async()=>{
 const root=new Error('failed');
 await withServerErrorReporting('load',async()=>{
  observeCaughtError(root,origin);
  observeCaughtError(Object.assign(new Error('wrapped'),{cause:root}),origin);
  observeCaughtError(new Error('failed'),origin);
 })();
 expect([...mockRows.values()].reduce((sum,row)=>sum+row.count,0)).toBe(2);
});
