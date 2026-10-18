import { receivedInvitations, hasClubInvitation } from '../../src/utils/receivedInvitations';

const invite=(id:string,type:string,recipientId:string,payload:object,createdAt:number,read=false)=>({id,data:{type,recipientId,payload,createdAt,read}});
test('inbox contains only owned invitations with navigable targets; newest target wins',()=>{
  const rows=[invite('old','groupInvitation','me',{groupId:'club',groupName:'ישן'},10),
    invite('other','groupInvitation','other',{groupId:'club'},50),
    invite('new','groupInvitation','me',{groupId:'club',groupName:'חדש'},20,true),
    invite('round','inviteToGame','me',{gameId:'round',startsAt:200},30),
    invite('friend','friendRequest','me',{groupId:'club'},40),
    invite('invalid','inviteToGame','me',{},40)];
  const result=receivedInvitations(rows,'me');
  expect(result.map(x=>x.id)).toEqual(['round','new']);
  expect(result[1]).toMatchObject({title:'חדש',read:true});
  expect(result[0].startsAt).toBe(200);
});
test('legacy timestamps, missing names, and read invitations remain accessible',()=>{
  const row=invite('legacy','groupInvitation','me',{groupId:'g'},0,true);
  (row.data as any).createdAt={toMillis:()=>100};
  expect(receivedInvitations([row],'me')[0]).toMatchObject({createdAt:100,read:true,inviterName:'מנהל'});
  expect(receivedInvitations([],'me')).toEqual([]);
});

test.each(['groupInvitation','inviteToGame'])('accepted %s disappears without resurrecting older invitations',type=>{
  const payload=type==='groupInvitation'?{groupId:'target'}:{gameId:'target'};
  const old=invite('old',type,'me',payload,10);
  const joined={...invite('accepted',type,'me',payload,20),data:{...invite('accepted',type,'me',payload,20).data,invitationStatus:'joined'}};
  expect(receivedInvitations([old,joined],'me')).toEqual([]);
});

test('club invitation is independent of navigation, but limited to its target, status and expiry',()=>{
  const rows=receivedInvitations([invite('club','groupInvitation','me',{groupId:'club',expiresAt:200},10)],'me');
  expect(hasClubInvitation(rows,'club',100)).toBe(true);
  expect(hasClubInvitation(rows,'other',100)).toBe(false);
  expect(hasClubInvitation(rows,'club',200)).toBe(false);
  for(const status of ['joined','expired','unavailable'] as const)
    expect(hasClubInvitation([{...rows[0],status}],'club',100)).toBe(false);
  expect(hasClubInvitation([{...rows[0],payload:{managerApproved:false}}],'club',100)).toBe(false);
  expect(hasClubInvitation([{...rows[0],status:'pending'}],'club',100)).toBe(true);
});
