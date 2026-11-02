import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
function fixture(){
  const records=new Map<string,any>([
    ['dmRequestState/a__b',{from:'a',to:'b',status:'pending',messageId:'first'}],
    ['users/a',{name:'גל Cohen'}],['users/b/private/push',{fcmTokens:['token']}],
    ['dmConversations/a__b',{participants:['a','b']}],
  ]);
  const send=jest.fn(async(_payload:any)=>({responses:[{}]})),read=jest.fn();
  const ref=(path:string):any=>({path,collection:(name:string)=>ref(path+'/'+name),doc:(id:string)=>ref(path+'/'+id),get:async()=>{read(path);return snapshot(path);},update:async(patch:any)=>records.set(path,{...records.get(path),...patch})});
  const snapshot=(path:string)=>({exists:records.has(path),data:()=>records.get(path)});
  const db:any={doc:ref,collection:ref,runTransaction:async(fn:any)=>fn({get:async(r:any)=>snapshot(r.path),update:(r:any,data:any)=>records.set(r.path,{...records.get(r.path),...data})})};
  const module={exports:{} as any};const factory=(_path:string,callback:any)=>callback;
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('functions/src/chatPush.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module,exports:module.exports,console,Date,Set,
    require:(id:string)=>id==='firebase-admin'?{firestore:Object.assign(()=>db,{FieldValue:{arrayRemove:()=>null}}),messaging:()=>({sendEachForMulticast:send})}:id.startsWith('firebase-functions/')?{onDocumentCreated:factory,onDocumentWritten:factory}:{},
  });
  const event={params:{convId:'a__b'},data:{after:{exists:true,data:()=>({messageId:'first'})},before:{data:()=>undefined}}};
  return{api:module.exports,records,send,read,event};
}
test('request push contains only trusted sender name and is attempted once across duplicate events',async()=>{
  const f=fixture();await f.api.onDmRequestCreated(f.event);await f.api.onDmRequestCreated(f.event);
  expect(f.send).toHaveBeenCalledTimes(1);const push=f.send.mock.calls[0][0] as any;
  expect(push.notification.body).toBe('בקשת שיחה חדשה מאת ⁨גל Cohen⁩');expect(push.notification.body).not.toContain('שלום');
  expect(push.data.parentId).toBe('a__b');
});
test.each(['cancelled','declined','blocked','approved'])('late trigger suppresses %s request notifications',async kind=>{
  const f=fixture();if(kind==='blocked')f.records.set('users/b/blocked/a',{at:1});else if(kind==='approved')f.records.set('dmConversations/a__b',{messagingApproved:true});else f.records.set('dmRequestState/a__b',{...f.records.get('dmRequestState/a__b'),status:kind});
  await f.api.onDmRequestCreated(f.event);expect(f.send).not.toHaveBeenCalled();
});
test('first request message never enters ordinary message hydration or fanout',async()=>{
  const f=fixture();await f.api.onDmChatMessage({params:{convId:'a__b'},data:{data:()=>({messageRequest:true,text:'טקסט פרטי'})}});
  expect(f.read).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
});
