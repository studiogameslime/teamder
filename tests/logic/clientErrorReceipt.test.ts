const mockRows = new Map<string, any>();
const mockDb = {doc: (path: string) => ({path}), runTransaction: async (fn: any) => fn({
  get: async (ref: any) => ({exists:mockRows.has(ref.path),data:()=>mockRows.get(ref.path)}),
  set: (ref: any, values: any) => {
    const old=mockRows.get(ref.path)??{};
    mockRows.set(ref.path,{...old,...values,...(values.count?.increment ? {count:(old.count??0)+values.count.increment} : {})});
  },
})};
jest.doMock(require.resolve('firebase-admin/firestore',{paths:[process.cwd()+'/functions']}),()=>({getFirestore:()=>mockDb,FieldValue:{increment:(n:number)=>({increment:n}),serverTimestamp:()=>123},Timestamp:{fromMillis:(n:number)=>n}}));
jest.doMock(require.resolve('firebase-functions/v2/https',{paths:[process.cwd()+'/functions']}),()=>({onCall:(_options:any,fn:any)=>fn,HttpsError:class extends Error {constructor(public code:string,message:string){super(message);}}}));
const {recordClientError}=require('../../functions/src/clientDiagnostics');
const send=recordClientError as unknown as (request:any)=>Promise<any>;
const request=(uid='one',deliveryId='delivery-123456')=>({auth:{uid},data:{operation:'load',lastMessage:'failed',count:2,deliveryId}});
beforeEach(()=>mockRows.clear());
test('response-loss retries do not increment occurrence count or quota twice',async()=>{
 await send(request());await send(request());
 const error=[...mockRows.entries()].find(([key])=>key.startsWith('errors/'))![1];
 expect(error.count).toBe(2);expect(mockRows.get('serverRateLimits/one_diagnostics').count).toBe(1);
});
test('new batches and different authenticated users remain separate occurrences',async()=>{
 await send(request());await send(request('one','delivery-second'));await send(request('two'));
 expect([...mockRows.entries()].find(([key])=>key.startsWith('errors/'))![1].count).toBe(6);
});
test('invalid receipt ids cannot escape the collection path',async()=>{
 await expect(send(request('one','../../other'))).rejects.toMatchObject({code:'invalid-argument'});expect(mockRows.size).toBe(0);
});
