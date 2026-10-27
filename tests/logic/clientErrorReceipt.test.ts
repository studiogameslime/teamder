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
test('retains first and latest distinct occurrences across users and versions without trusting client identity',async()=>{
 for(let i=0;i<6;i++)await send({auth:{uid:`viewer-${i}`},data:{operation:'load',lastMessage:'failed',count:1,deliveryId:`delivery-item-${i}`,
  occurrences:[{id:`occurrence-item-${i}`,capturedAt:100+i,lastMessage:'failed',appVersion:`version-${i}`,userId:'forged',status:'resolved',lastJournal:'{}'}]}});
 const row=[...mockRows.entries()].find(([key])=>key.startsWith('errors/'))![1];
 expect(row.count).toBe(6);expect(row.occurrences.map((x:any)=>x.appVersion)).toEqual(['version-0','version-4','version-5']);
 expect(row.occurrences.map((x:any)=>x.userId)).toEqual(['viewer-0','viewer-4','viewer-5']);
 expect(row.status).toBe('new');expect(row.occurrences.every((x:any)=>x.status===undefined)).toBe(true);
});
test('retried deliveries preserve occurrence samples and aggregated count exactly once',async()=>{
 const r={...request(),data:{...request().data,occurrences:[{id:'occurrence-original',capturedAt:123,lastMessage:'failed'}]}};
 await send(r);await send(r);
 const row=[...mockRows.entries()].find(([key])=>key.startsWith('errors/'))![1];expect(row.count).toBe(2);expect(row.occurrences).toHaveLength(1);
});
