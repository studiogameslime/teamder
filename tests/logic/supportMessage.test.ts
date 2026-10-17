const mockDocs = new Map<string, any>();
const mockRef = (path: string): any => ({ path, collection: (key: string) => ({ doc: (id: string) => mockRef(`${path}/${key}/${id}`) }), get: async () => ({exists:mockDocs.has(path),data:()=>mockDocs.get(path)}) });
jest.mock('firebase-admin', () => ({firestore:()=>({doc:mockRef,runTransaction:async(work:any)=>work({getAll:async(...refs:any[])=>Promise.all(refs.map(ref=>ref.get())),set:(ref:any,data:any)=>mockDocs.set(ref.path,{...mockDocs.get(ref.path),...data}),create:(ref:any,data:any)=>{if(mockDocs.has(ref.path))throw Error('exists');mockDocs.set(ref.path,data);}})})}), {virtual:true});
jest.mock('firebase-functions/v2/https',()=>({onCall:(_opts:any,handler:any)=>handler,HttpsError:class extends Error {constructor(public code:string,message:string){super(message);}}}),{virtual:true});
import { sendSupportMessage } from '../../functions/src/supportMessage';
import { validateSupportMessage } from '../../functions/src/supportMessagePolicy';
const send=sendSupportMessage as unknown as (request:any)=>Promise<any>;
const payload={id:'support-1234567890-abcd',text:'לא מצליח ליצור מועדון',context:{screen:'CommunitiesCreate',screenLabel:'הקמת מועדון',step:2,appVersion:'1.1.35',password:'secret',email:'private@example.test'}};
const request=(data:any=payload,provider='google.com')=>({auth:{uid:'alice',token:{firebase:{sign_in_provider:provider}}},data:{...data,expectedUid:'alice'}});
beforeEach(()=>mockDocs.clear());
test('released callable client null image is an absent attachment and retry stays idempotent',async()=>{
  await expect(send(request({...payload,image:null}))).resolves.toMatchObject({id:payload.id});
  await expect(send(request({...payload,image:undefined}))).resolves.toMatchObject({id:payload.id});
  const row=mockDocs.get(`dmConversations/alice__teamder/messages/${payload.id}`);
  expect(row.text).toBe(payload.text);expect(row).not.toHaveProperty('supportImage');
  expect(mockDocs.get('supportMessageLimits/alice').count).toBe(1);
  await expect(send(request({...payload,id:'support-empty-1234567890',text:'',image:null}))).rejects.toMatchObject({code:'invalid-argument'});
});
test('registered caller starts their canonical thread and context excludes arbitrary private fields',async()=>{
  mockDocs.set('users/alice',{name:'אליס'});
  expect(await send(request())).toEqual({id:payload.id,convId:'alice__teamder'});
  const row=mockDocs.get(`dmConversations/alice__teamder/messages/${payload.id}`);
  expect(row.senderId).toBe('alice');expect(row.senderName).toBe('אליס');
  expect(row.supportContext).toEqual({screen:'CommunitiesCreate',screenLabel:'הקמת מועדון',step:2,appVersion:'1.1.35'});
  expect(mockDocs.get('dmConversations/alice__teamder').participants).toEqual(['alice','teamder']);
});
test('timeout retries acknowledge existing messages even when Firestore reordered context keys',async()=>{
  await send(request());const path=`dmConversations/alice__teamder/messages/${payload.id}`;
  const row=mockDocs.get(path);row.supportContext=Object.fromEntries(Object.entries(row.supportContext).reverse());
  await send(request());expect(mockDocs.get('supportMessageLimits/alice').count).toBe(1);
  await expect(send(request({...payload,text:'משהו אחר'}))).rejects.toMatchObject({code:'already-exists'});
});
test('guest, unauthenticated, changed identity and malformed conversations cannot write',async()=>{
  await expect(send(request(payload,'anonymous'))).rejects.toMatchObject({code:'failed-precondition'});
  await expect(send({data:payload})).rejects.toMatchObject({code:'unauthenticated'});
  const changed=request();changed.data.expectedUid='bob';await expect(send(changed)).rejects.toMatchObject({code:'failed-precondition'});
  mockDocs.set('dmConversations/alice__teamder',{participants:['alice','bob']});
  await expect(send(request())).rejects.toMatchObject({code:'failed-precondition'});
  expect(mockDocs.has('supportMessageLimits/alice')).toBe(false);
});
test('20-per-minute limit rejects new requests but allows an already accepted retry',async()=>{
  await send(request());mockDocs.set('supportMessageLimits/alice',{bucket:Math.floor(Date.now()/60000),count:20});
  await expect(send(request({...payload,id:'support-1234567890-next'}))).rejects.toMatchObject({code:'resource-exhausted'});
  await expect(send(request())).resolves.toBeDefined();
});
test('photo-only messages have readable fallback and malformed/oversized attachments are rejected',()=>{
  expect(validateSupportMessage({...payload,text:'',image:'/9j/AAAA'}).text).toBe('מצורף צילום מסך');
  for(const image of ['https://example.test/pic.jpg','data:image/jpeg;base64,/9j/AAAA','/9j/'+'A'.repeat(350000),42])expect(()=>validateSupportMessage({...payload,image})).toThrow();
  expect(()=>validateSupportMessage({...payload,text:'',image:undefined})).toThrow();
  expect(()=>validateSupportMessage({...payload,text:'x'.repeat(1001)})).toThrow();
});
