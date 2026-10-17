import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
function harness(profile:Record<string,unknown>|undefined={name:'גל Cohen',avatarId:'a03',photoUrl:'https://photo.invalid/one'}){
 const read=jest.fn(async()=>({data:()=>profile})),update=jest.fn(async()=>{});
 const doc=jest.fn(()=>({get:read})),collection=jest.fn(()=>({doc}));
 const module:any={exports:{}};
 const source=fs.readFileSync('functions/src/chatPush.ts','utf8')+'\nexports.__trusted = trustedChatMessage;';
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  module,exports:module.exports,console,
  require:(id:string)=>id==='firebase-admin'?{firestore:()=>({collection})}:id==='firebase-functions/v2/firestore'?{onDocumentCreated:(_path:string,callback:any)=>callback}:{}
 });
 const snapshot=(senderId='sender',senderName?:string)=>({id:'message-id',data:()=>({senderId,senderName,text:'הודעה'}),createTime:{toMillis:()=>1800000000123},ref:{update}});
 return {run:module.exports.__trusted,snapshot,read,update,doc,collection};
}

test.each([undefined,'','שחקן','שם מתחזה'])('missing or client supplied name %s is replaced with trusted profile before notification fanout',async name=>{
 const h=harness();const result=await h.run(h.snapshot('sender',name));
 expect(h.collection).toHaveBeenCalledWith('users');expect(h.doc).toHaveBeenCalledWith('sender');
 expect(h.update).toHaveBeenCalledWith({senderName:'גל Cohen',senderAvatarId:'a03',senderPhotoUrl:'https://photo.invalid/one',createdAt:1800000000123});
 expect(result).toMatchObject({senderName:'גל Cohen',senderId:'sender',messageId:'message-id',createdAt:1800000000123,text:'הודעה'});
});

test('official replies retain the server-controlled brand identity without reading a nonexistent account',async()=>{
 const h=harness();const result=await h.run(h.snapshot('teamder','שם מתחזה'));
 expect(h.read).not.toHaveBeenCalled();expect(result.senderName).toBe('Teamder');
});

test('failed trusted identity reads never proceed with a fabricated name',async()=>{
 const h=harness();h.read.mockRejectedValueOnce(Error('offline'));
 await expect(h.run(h.snapshot())).rejects.toThrow('offline');expect(h.update).not.toHaveBeenCalled();
});

test('a failed message hydration is propagated and a missing sender is rejected',async()=>{
 const h=harness();h.update.mockRejectedValueOnce(Error('write failed'));
 await expect(h.run(h.snapshot())).rejects.toThrow('write failed');
 await expect(h.run(h.snapshot(''))).rejects.toThrow('CHAT_SENDER_REQUIRED');
});
