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
const { ExpectedCallableError } = require('../../functions/src/expectedCallableError');
const { HttpsError } = require(require.resolve('firebase-functions/v2/https', {paths: [process.cwd() + '/functions']}));
beforeEach(() => {mockRows.clear();mockWrite.mockClear();});
test('strict-schema join writes correlate from existing fields without changing the document',async()=>{
 const {joinDiagnosticId}=require('@/utils/joinDiagnosticId'),server=require('../../functions/src/joinDiagnosticId');
 expect(server.joinDiagnosticId('round','viewer',123)).toBe(joinDiagnosticId('round','viewer',123));
 const data={uid:'viewer',tappedAt:123,requestedAt:123,state:'queued'};
 const info=jest.spyOn(console,'info').mockImplementation(()=>{});
 await expect(withServerErrorReporting('onDocumentCreated:join',async(_request:unknown)=>{throw new Error('reconcile failed');})({params:{gameId:'round',uid:'viewer'},data:{data:()=>data}})).rejects.toThrow('reconcile failed');
 expect([...mockRows.values()][0].lastContext).toMatchObject({requestId:joinDiagnosticId('round','viewer',123),joinTappedAt:123});
 expect(data).toEqual({uid:'viewer',tappedAt:123,requestedAt:123,state:'queued'});info.mockRestore();
});
test('server correlation is isolated, stripped from business payload and retained with exact failure',async()=>{
 const info=jest.spyOn(console,'info').mockImplementation(()=>{});
 const handler=withServerErrorReporting('onCall:join',async(request:any)=>{
  expect(request.data).toEqual({gameId:'round'});throw new Error('database failed');
 });
 await expect(handler({auth:{uid:'owner'},data:{gameId:'round',_diagnostic:{requestId:'request-valid-id'}}})).rejects.toThrow('database failed');
 expect([...mockRows.values()][0].lastContext).toMatchObject({requestId:'request-valid-id',userId:'owner',durationMs:expect.any(Number),serverRevision:expect.any(String)});
 expect(info).toHaveBeenCalledWith('[diagnostic-call]',expect.objectContaining({requestId:'request-valid-id',outcome:'failure'}));info.mockRestore();
});

test.each(['invalid-argument','unauthenticated','permission-denied','failed-precondition','resource-exhausted'])('explicit expected %s rejection preserves the response without reporting a server incident',async code=>{
 const error=new ExpectedCallableError(code,'Rejected',{kept:true});
 expect(error.toJSON()).toEqual(new HttpsError(code,'Rejected',{kept:true}).toJSON());
 const call=withServerErrorReporting('comparison',async()=>{
  observeCaughtError(error,origin);
  await reportServerError({operation:'comparison',err:error});
  throw error;
 });
 await expect(call()).rejects.toBe(error);expect(mockWrite).not.toHaveBeenCalled();
});

test('an ordinary HttpsError is still reported even when its code matches a rejected request',async()=>{
 const error=new HttpsError('permission-denied','Unexpected database access failure');
 await expect(withServerErrorReporting('comparison',async()=>{throw error;})()).rejects.toBe(error);
 expect(mockWrite).toHaveBeenCalledTimes(1);
});
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
