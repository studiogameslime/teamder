import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the canonical deployed-path handler; never connect to Firestore.
async function join(overrides:Record<string,any>={},blocked=false) {
  const writes:any[]=[],now=Date.now();
  const club={isOpen:false,playerIds:[],adminIds:['manager'],pendingPlayerIds:['me'],maxMembers:10,approvedInvites:{me:{inviterId:'manager',expiresAt:now+10000}},...overrides};
  const ref={kind:'club'},requests={kind:'requests'},notices={kind:'notices'};
  const db={collection:(name:string)=>({doc:()=>ref,where:()=>name==='joinRequests'?{where:()=>requests}:notices}),doc:()=>({kind:'block'}),runTransaction:(fn:any)=>fn({
    get:async(r:any)=>{if(writes.length)throw Error('read after write');return r===ref?{data:()=>club}:r===requests||r===notices?{docs:[]}:{exists:blocked};},
    update:(r:any,data:any)=>writes.push(data),create:(r:any,data:any)=>writes.push(data),
  })};
  const source=ts.createSourceFile('server.ts',fs.readFileSync('functions/src/socialPlayers.ts','utf8'),ts.ScriptTarget.Latest,true);
  let code='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(source)==='joinSocialClub')code=n.initializer!.getText(source);ts.forEachChild(n,visit);};visit(source);
  const exports:any={};
  vm.runInNewContext(ts.transpileModule('exports.run='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,onCall:(_:any,fn:any)=>fn,ENFORCE_APP_CHECK:false,session:async()=>({uid:'me',db}),validId:(id:string)=>id,
    strings:(value:any)=>Array.isArray(value)?value:[],number:(value:any)=>typeof value==='number'?value:0,milliseconds:(value:any)=>typeof value==='number'?value:0,
    HttpsError:class extends Error{constructor(_:string,message:string){super(message);}},FieldValue:{arrayUnion:(id:string)=>({add:id}),arrayRemove:(id:string)=>({remove:id})},Date,
  });
  return {result:await exports.run({data:{groupId:'club'}}),writes};
}
test('a valid manager invitation immediately joins a closed club and removes the pending membership',async()=>{
  const {result,writes}=await join();expect(result).toEqual({status:'joined'});
  expect(writes[0]).toMatchObject({playerIds:{add:'me'},pendingPlayerIds:{remove:'me'}});
});
test.each([40,500,1001])('joins a club with %i members despite a legacy cap',async count=>{
  const {result,writes}=await join({playerIds:Array.from({length:count},(_,i)=>`member${i}`),maxMembers:40});
  expect(result).toEqual({status:'joined'});
  expect(writes[0]).toMatchObject({playerIds:{add:'me'}});
});
test('blocks and previous membership remain authoritative',async()=>{
  await expect(join({},true)).rejects.toThrow('Invitation unavailable');
  expect((await join({playerIds:['me']})).result).toEqual({status:'joined'});
});
test('a large closed club without a manager grant still requires approval',async()=>{
  const {result,writes}=await join({playerIds:Array.from({length:501},(_,i)=>`member${i}`),maxMembers:40,approvedInvites:{},pendingPlayerIds:[]});
  expect(result).toEqual({status:'pending'});
  expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({status:'pending',userId:'me'})]));
  expect(writes.some(write=>'playerIds' in write)).toBe(false);
});
