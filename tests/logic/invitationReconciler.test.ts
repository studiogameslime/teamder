import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as policy from '../../functions/src/invitationPolicy';

const source=fs.readFileSync('functions/src/index.ts','utf8');
const tree=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
const reconcileFunction=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reconcileGameJoins');
if(!reconcileFunction)throw Error('Missing production reconcileGameJoins');
const code=ts.transpileModule(reconcileFunction.getText(tree)+'\nmodule.exports=reconcileGameJoins;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
async function reconcile(overrides:Record<string,any>, user:Record<string,any>|null={name:'שחקן'}) {
  const writes:any[]=[],now=Date.now();
  const game={status:'open',startsAt:now+3600000,visibility:'community',groupId:'club',createdBy:'manager',players:[],pending:[],waitlist:[],maxPlayers:2,...overrides};
  const queued={kind:'queued'},group={kind:'group'},person={kind:'user'},request={kind:'request'};
  const gameRef={kind:'game',collection:()=>({where:()=>queued})};
  const missing={kind:'missing'};Object.assign(person,{collection:()=>({doc:()=>missing})});
  const db={collection:(name:string)=>({doc:()=>name==='games'?gameRef:name==='users'?person:group}),runTransaction:(fn:any)=>fn({
    get:async(ref:any)=>{if(writes.length)throw new Error('read after write');return ref===missing?{exists:false}:ref===gameRef?{exists:true,data:()=>game}:ref===group?{exists:true,data:()=>({playerIds:['member'],adminIds:['manager'],cardsEnabled:false})}:ref===person?{exists:!!user,data:()=>user}:{empty:false,docs:[{id:'outsider',ref:request,data:()=>({uid:'outsider',tappedAt:now})}]};},
    update:(ref:any,data:any)=>writes.push({kind:ref.kind,...data}),
  })};
  const module={exports:null as any};
  vm.runInNewContext(code,{db,module,Date,Set,Array,...policy,TAP_BACKDATE_GRACE_MS:15000,admin:{firestore:{Timestamp:class Timestamp{}}}});
  await module.exports('round');return writes.find(x=>x.kind==='request');
}
const invited=()=>({approvedInvites:{outsider:{inviterId:'manager',expiresAt:Date.now()+100000}}});
test('the actual reconciler rejects an outsider even without approval requirements',async()=>{
  expect(await reconcile({requiresApproval:false})).toMatchObject({state:'rejected',reason:'GAME_JOIN_FORBIDDEN'});
});
test('manager invitation seats, or waitlists when capacity is exhausted',async()=>{
  expect(await reconcile({...invited(),requiresApproval:true})).toMatchObject({state:'assigned',bucket:'players'});
  expect(await reconcile({...invited(),requiresApproval:true,players:['a','b']})).toMatchObject({state:'assigned',bucket:'waitlist'});
});
test('a filler read grant always requests approval, including rounds with ordinary approval off',async()=>{
  expect(await reconcile({invitedUserIds:['outsider'],requiresApproval:false})).toMatchObject({state:'assigned',bucket:'pending'});
});
test('invitation cannot override rejection, lifecycle or missing/full-account identity',async()=>{
  expect(await reconcile({...invited(),rejectedPlayerIds:['outsider']})).toMatchObject({reason:'GAME_JOIN_REJECTED'});
  expect(await reconcile({...invited(),status:'scheduled'})).toMatchObject({reason:'GAME_NOT_OPEN'});
  expect(await reconcile({...invited(),liveMatch:{phase:'live'}})).toMatchObject({reason:'GAME_LIVE'});
  expect(await reconcile(invited(),{isGuest:true})).toMatchObject({reason:'GAME_JOIN_FORBIDDEN'});
  expect(await reconcile(invited(),null)).toMatchObject({reason:'GAME_JOIN_FORBIDDEN'});
});
