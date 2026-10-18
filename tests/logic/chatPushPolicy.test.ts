import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function harness(initialCount:number, muted=false) {
  const send=jest.fn(async()=>({responses:[{}]}));
  let count=initialCount;
  const ref=(path:string):any=>({
    collection:(name:string)=>ref(`${path}/${name}`),doc:(id:string)=>ref(`${path}/${id}`),
    get:async()=>({data:()=>path.endsWith('/private/push')?{fcmTokens:['token']}:path.includes('/chatSettings/')?{muted}:{count},exists:true}),
    update:jest.fn(async()=>{}),
  });
  const db={collection:(name:string)=>ref(name),runTransaction:async(fn:any)=>fn({
    get:async()=>({data:()=>({count}),exists:true}),set:(_ref:any,data:any)=>{count+=data.count.increment;},
  })};
  const firestore=Object.assign(()=>db,{FieldValue:{increment:(n:number)=>({increment:n}),arrayRemove:jest.fn()}});
  const module={exports:{} as any};
  const source=fs.readFileSync('functions/src/chatPush.ts','utf8')+'\nexports.__recipient = handleRecipient;';
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    module,exports:module.exports,console,
    require:(id:string)=>id==='firebase-admin'?{firestore,messaging:()=>({sendEachForMulticast:send})}:{onDocumentCreated:()=>{}},
  });
  const receive=(scope:string,blocked=false)=>module.exports.__recipient('recipient',scope,'chat','כדורגל',{senderId:'sender',senderName:'דניאל',text:'היי',createdAt:1800000000000},blocked);
  return {receive,send,getCount:()=>count};
}
test.each(['game','community'])('%s sends only the first unread group notification',async(scope)=>{
  const h=harness(0);await h.receive(scope);await h.receive(scope);await h.receive(scope);
  expect(h.getCount()).toBe(3);expect(h.send).toHaveBeenCalledTimes(1);
});
test('personal conversations send a push per message even while earlier messages are unread',async()=>{
  const h=harness(4);await h.receive('dm');await h.receive('dm');
  expect(h.getCount()).toBe(6);expect(h.send).toHaveBeenCalledTimes(2);
});
test.each(['game','community','dm'])('muted %s keeps unread counts without sending pushes',async(scope)=>{
  const h=harness(0,true);await h.receive(scope);await h.receive(scope);
  expect(h.getCount()).toBe(2);expect(h.send).not.toHaveBeenCalled();
});
test('blocked senders consume neither the unread counter nor the first-unread push',async()=>{
  const h=harness(0);await h.receive('community',true);expect(h.getCount()).toBe(0);
  await h.receive('community');expect(h.send).toHaveBeenCalledTimes(1);
});
