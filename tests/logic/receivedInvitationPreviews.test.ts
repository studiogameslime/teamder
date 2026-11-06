import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { receivedInvitations } from '../../src/utils/receivedInvitations';
import { StaleSessionError } from '../../src/services/staleSession';

function fixture(gameOverrides: Record<string, any> = {}) {
  const now=Date.now();
  const game={id:'round',title:'מחזור',groupId:'club',status:'open',startsAt:now+86400000,players:['a'],waitlist:[],maxPlayers:2,fieldType:'synthetic',city:'תל אביב',format:'5v5',...gameOverrides};
  const rows:Record<string,any>[]=[{id:'round-invite',type:'inviteToGame',recipientId:'me',payload:{gameId:'round',inviterId:'manager'},createdAt:now}];
  const getGameById=jest.fn(async()=>game);
  const hydratePublicUsers=jest.fn(async()=>[{id:'manager',photoUrl:'https://example.com/avatar.jpg'}]);
  const exports:any={},getPublic=jest.fn(async()=>({id:'club',name:'מועדון',coverPhotoUrl:'https://example.com/cover.jpg'}));
  const modules:Record<string,any>={
    'firebase/firestore':{},'firebase/functions':{},
    '@/firebase/config':{USE_MOCK_DATA:true},
    '@/store/userStore':{useUserStore:{getState:()=>({currentUser:{id:'me'}})}},
    '@/store/groupStore':{useGroupStore:{getState:()=>({groups:[]})}},
    './staleSession':{StaleSessionError},
    './notificationsService':{notificationsService:{__getMockDispatches:()=>rows}},
    '@/utils/receivedInvitations':{receivedInvitations},
    './groupService':{groupService:{getPublic,hydratePublicUsers}},
    './gameService':{gameService:{getGameById}},
    '@/types':{activeGuestCount:(guests:any[]=[])=>guests.filter(g=>!g.waitlisted).length},
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/receivedInvitationsService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(n:string)=>modules[n]});
  return {list:()=>exports.receivedInvitationsService.list('me'),listInbox:()=>exports.receivedInvitationsService.listInbox('me'),rows,getPublic,getGameById,hydratePublicUsers};
}

test('an unavailable invitation never fetches fresh player or target data, even for a pending player',async()=>{
  const f=fixture({pending:['me']});
  f.rows.push({id:'club-invite',type:'groupInvitation',recipientId:'me',payload:{groupId:'club',inviterId:'manager'},createdAt:1});
  f.rows.forEach(row=>row.invitationStatus='unavailable');
  expect((await f.list()).map((item:any)=>item.status)).toEqual(['unavailable','unavailable']);
  expect(f.getGameById).not.toHaveBeenCalled();
  expect(f.getPublic).not.toHaveBeenCalled();
  expect(f.hydratePublicUsers).not.toHaveBeenCalled();
});

test('pending membership never reopens the action on a server-confirmed expired invitation',async()=>{
  const f=fixture({pending:['me']});
  f.rows[0].invitationStatus='expired';
  expect((await f.list())[0].status).toBe('expired');
});

test('the badge and club decision can resolve while cover hydration is stalled',async()=>{
  const f=fixture();
  f.getPublic.mockImplementation(()=>new Promise(()=>{}));
  expect(await f.listInbox()).toMatchObject([{id:'round-invite',targetId:'round'}]);
  expect(f.getPublic).not.toHaveBeenCalled();
});
test.each([
  [{},false], [{players:['a','b']},true], [{guests:[{waitlisted:false}]},true],
  [{guests:[{waitlisted:true}]},false], [{pendingPromotion:{uid:'offer'}},true],
])('invitation fullness counts active guests and reserved offers, but not waiting guests: %j',async(overrides,full)=>{
  const result=await fixture(overrides as Record<string,any>).list();
  expect(result[0].preview).toMatchObject({isFull:full,coverPhotoUrl:'https://example.com/cover.jpg',inviterPhotoUrl:'https://example.com/avatar.jpg'});
});
test.each(['players','waitlist'])('an invitation disappears after a direct addition to %s, including legacy inboxes',async bucket=>{
  expect(await fixture({[bucket]:['me']}).list()).toEqual([]);
});
test('scheduled and finished rounds have explicit non-joinable states',async()=>{
  expect((await fixture({status:'scheduled'}).list())[0].status).toBe('scheduled');
  expect((await fixture({status:'finished'}).list())[0].status).toBe('unavailable');
});
test('a legacy notification does not turn an existing pending registration into a claimed direct join',async()=>{
  expect((await fixture({pending:['me']}).list())[0].status).toBe('pending');
});
test('club metadata is public and failure does not erase a valid invitation',async()=>{
  const f=fixture();f.getPublic.mockRejectedValue(new Error('offline'));
  expect((await f.list())[0]).toMatchObject({id:'round-invite',title:'מחזור'});
});
