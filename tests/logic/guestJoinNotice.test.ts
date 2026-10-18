import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { guestJoinNotices, guestJoinMessage, joinNoticeRecipients } from '../../functions/src/guestJoinNotice';
import { dedupeIdFor, dedupeKeyFor, inferEntityFromPayload, cooldownMsFor } from '../../functions/src/notificationDedup';

const guest = {id:'guest-1',name:'אורח לדוגמה',addedBy:'member',createdAt:100};
test('guest additions and promotions are distinguished from edits, removals and waiting moves',()=>{
  expect(guestJoinNotices([], [guest])).toEqual([{id:guest.id,name:guest.name,addedBy:'member',waitlisted:false,action:'added'}]);
  expect(guestJoinNotices([], [{...guest,waitlisted:true}])[0].waitlisted).toBe(true);
  expect(guestJoinNotices([{...guest,waitlisted:true}],[guest])[0].action).toBe('promoted');
  expect(guestJoinNotices([guest],[{...guest,name:'שם חדש',estimatedRating:4}])).toEqual([]);
  expect(guestJoinNotices([guest],[])).toEqual([]);
  expect(guestJoinNotices([guest],[{...guest,waitlisted:true}])).toEqual([]);
  expect(guestJoinNotices([], [null,{},guest,guest])).toHaveLength(1);
});
test('creator and club admins receive notices once, excluding the actor only',()=>{
  expect(joinNoticeRecipients(['admin','admin','owner'],'owner',['member'])).toEqual(['admin','owner']);
  expect(joinNoticeRecipients(['admin','member'],'owner',['member'])).toEqual(['admin','owner']);
  expect(joinNoticeRecipients([], 'owner')).toEqual(['owner']);
});
test('copy names the adder and guest and never calls a waitlisted guest an active player',()=>{
  const payload={guestId:guest.id,guestName:'Alex',addedByName:'מתן'};
  expect(guestJoinMessage(payload,'מחזור')).toMatchObject({title:'⁨מתן⁩ צירף אורח: ⁨Alex⁩',body:'הצטרף להרכב · מחזור'});
  expect(guestJoinMessage({...payload,guestWaitlisted:true},'מחזור')?.body).toBe('נוסף לרשימת ההמתנה · מחזור');
  expect(guestJoinMessage({...payload,guestAction:'promoted'},'מחזור')?.title).toContain('עבר מרשימת ההמתנה להרכב');
  expect(guestJoinMessage({},'מחזור')).toBeNull();
});

const text=fs.readFileSync('functions/src/index.ts','utf8');
const ast=ts.createSourceFile('index.ts',text,ts.ScriptTarget.Latest,true);
const compile=(source:string,context:any)=>{
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  return context.module.exports;
};
function functionSource(name:string) {
  return ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!.getText(ast);
}
function triggerBlock() {
  let found='';
  const walk=(n:ts.Node)=>{
    if(ts.isIfStatement(n)&&n.expression.getText(ast).includes("after.status === 'open'")&&n.thenStatement.getText(ast).includes('for (const guest of guestJoinNotices')) found=n.getText(ast);
    ts.forEachChild(n,walk);
  };walk(ast);return found;
}
test.each([false,true])('actual trigger emits server notice for a regular member, waitlisted=%s',async(waitlisted)=>{
  const notify=jest.fn(async(_input:any)=>({wrote:true,id:'notice'}));
  const context={module:{exports:{}},guestJoinNotices,adminAlertUserName:async()=> 'מתן',createNotificationOnce:notify};
  const run=compile(`module.exports=async function(before,after,event){${triggerBlock()}}`,context);
  const event={id:'event-1',time:'2026-10-14T10:00:00Z',params:{gameId:'game'}};
  await run({guests:[]},{status:'open',groupId:'club',createdBy:'owner',guests:[{...guest,waitlisted}],title:'מחזור'},event);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(notify.mock.calls[0][0]).toMatchObject({type:'gamePlayersJoined',recipientId:'club',reason:'guest-added:event-1:guest-1',nowMs:Date.parse(event.time),payload:{addedBy:'member',addedByName:'מתן',guestWaitlisted:waitlisted}});
});
test('actual guest trigger does not send for closed rounds or unrelated edits and retries a failed write',async()=>{
  const notify=jest.fn(async()=>({wrote:false,id:'notice',skipped:'error'}));
  const run=compile(`module.exports=async function(before,after,event){${triggerBlock()}}`,{module:{exports:{}},guestJoinNotices,adminAlertUserName:async()=> 'מתן',createNotificationOnce:notify});
  const event={id:'event',time:'2026-10-14T10:00:00Z',params:{gameId:'game'}};
  await run({guests:[]},{status:'finished',groupId:'club',guests:[guest]},event);
  await run({guests:[guest]},{status:'open',groupId:'club',guests:[{...guest,name:'שם'}]},event);
  expect(notify).not.toHaveBeenCalled();
  await expect(run({guests:[]},{status:'open',createdBy:'owner',guests:[guest]},event)).rejects.toThrow('notification write failed');
});
test('actual notification writer deduplicates guest retries without aggregating the count',async()=>{
  const records=new Map<string,any>();const update=jest.fn();
  const db={collection:()=>({doc:(id:string)=>({create:async(data:any)=>{if(records.has(id))throw {code:6};records.set(id,data);},get:async()=>({data:()=>records.get(id)}),update})})};
  const create=compile(functionSource('createNotificationOnce')+'\nmodule.exports=createNotificationOnce;',{
    module:{exports:{}},db,console:{log:()=>{},warn:()=>{},error:()=>{}},
    inferEntityFromPayload,dedupeIdFor,dedupeKeyFor,cooldownMsFor,
    STRICT_UNREAD_DEDUP:{},AGGREGATE_ON_DUPLICATE:{gamePlayersJoined:true},STALE_UNREAD_TTL_MS:86400000,NOTIFICATION_SCHEMA_VERSION:1,
    admin:{firestore:{FieldValue:{serverTimestamp:()=>1}}},buildAggregateUpdate:()=>({}),
  });
  const input={type:'gamePlayersJoined',recipientId:'club',reason:'guest-added:event:g',nowMs:1000,payload:{gameId:'game',guestId:'g'}};
  await create(input);await create(input);
  expect(records.size).toBe(1);expect(update).not.toHaveBeenCalled();
  await create({...input,reason:'guest-added:other:h',payload:{gameId:'game',guestId:'h'}});
  expect(records.size).toBe(2);
});
test('actual fanout loads the organizer and club managers, deduplicating and excluding the adder',async()=>{
  const db={collection:(collection:string)=>({doc:()=>({get:async()=>({data:()=>collection==='groups'?{adminIds:['admin','member','owner']}:{createdBy:'owner'}})})})};
  const resolve=compile(functionSource('resolveRecipients')+'\nmodule.exports=resolveRecipients;',{
    module:{exports:{}},db,joinNoticeRecipients,FANOUT_NOTIF_TYPES:new Set(['gamePlayersJoined']),
    isFanoutSenderAuthorized:async()=>true,loadUsers:async(ids:string[])=>ids,
  });
  expect(await resolve({type:'gamePlayersJoined',srv:true,payload:{gameId:'game',groupId:'club',guestId:'g',addedBy:'member'}})).toEqual(['admin','owner']);
  expect(await resolve({type:'gamePlayersJoined',srv:true,payload:{gameId:'game',groupId:'club',joinerIds:'owner'}})).toEqual(['admin','member']);
  expect(await resolve({type:'gamePlayersJoined',srv:true,payload:{gameId:'game'}})).toEqual(['owner']);
});
