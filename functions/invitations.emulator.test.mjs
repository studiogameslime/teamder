import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import admin from 'firebase-admin';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
process.env.GCLOUD_PROJECT='demo-invitations';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:process.env.GCLOUD_PROJECT});
let api,db;
const call=(name,data={},uid='manager')=>api[name].run({auth:{uid,token:{firebase:{sign_in_provider:'password'}}},data});
before(async()=>{api=await import('./lib/index.js');db=admin.firestore();});
after(async()=>{await Promise.all(admin.apps.map(a=>a.delete()));});
beforeEach(async()=>{
  for(const name of ['users','groups','games','joinRequests','notifications','serverRateLimits','inviteLinks'])await db.recursiveDelete(db.collection(name));
  for(const uid of ['manager','member','target','other'])await db.doc(`users/${uid}`).set({name:uid,friends:['manager','member','target','other']});
  await db.doc('groups/club').set({name:'מועדון בדיקה',adminIds:['manager'],playerIds:['manager','member'],pendingPlayerIds:[],isOpen:false,maxMembers:4});
  await db.doc('games/round').set({groupId:'club',createdBy:'manager',status:'open',visibility:'community',startsAt:Date.now()+3600000,players:[],waitlist:[],pending:[],requiresApproval:true,maxPlayers:2});
});
test('manager invitation admits a consenting player to a closed club exactly once',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  assert.ok(!(await db.doc('groups/club').get()).get('playerIds').includes('target'));
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'joined');
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'joined');
  assert.equal((await db.doc('groups/club').get()).get('playerIds').filter(x=>x==='target').length,1);
});
test('ordinary closed-club requests stay pending and manager rejection cannot be bypassed',async()=>{
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'pending');
  assert.equal((await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'})).reason,'pending');
  await db.doc('joinRequests/rejection').set({groupId:'club',userId:'other',status:'rejected'});
  assert.equal((await call('inviteSocialPlayerToClub',{groupId:'club',userId:'other'})).reason,'rejected');
  await assert.rejects(call('joinSocialClub',{groupId:'club'},'other'),/GROUP_JOIN_REJECTED/);
});
test('expired or revoked manager grants do not auto-approve',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  await db.doc('groups/club').update({adminIds:['other']});
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'pending');
});
test('expired manager grant requests approval; blocks prevent accepting a live grant',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  await db.doc('groups/club').update({'approvedInvites.target.expiresAt':Date.now()-1});
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'pending');
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'other'});
  await db.doc('users/other/blocked/manager').set({createdAt:Date.now()});
  await assert.rejects(call('joinSocialClub',{groupId:'club'},'other'));
});
test('concurrent invitation acceptance ignores the legacy club cap without losing members',async()=>{
  await db.doc('groups/club').update({maxMembers:3});
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'other'});
  const result=await Promise.allSettled(['target','other'].map(uid=>call('joinSocialClub',{groupId:'club'},uid)));
  assert.equal(result.filter(r=>r.status==='fulfilled').length,2);
  assert.deepEqual(new Set((await db.doc('groups/club').get()).get('playerIds')),new Set(['manager','member','target','other']));
});
test('clubs beyond 500 members can invite, show available invitations and join',async()=>{
  const players=Array.from({length:501},(_,i)=>`existing${i}`);
  await db.doc('groups/club').update({playerIds:players,maxMembers:40});
  assert.equal((await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'})).invited,true);
  assert.equal((await call('getReceivedInvitations',{},'target'))[0].data.invitationStatus,'available');
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'joined');
  assert.equal((await db.doc('groups/club').get()).get('playerIds').length,502);
});
test('member friend invitation never enrolls the recipient or grants manager approval',async()=>{
  assert.equal((await call('inviteFriendsToGroup',{groupId:'club',friendIds:['target']},'member')).invited,1);
  const club=(await db.doc('groups/club').get()).data();
  assert.deepEqual(club.playerIds,['manager','member']);assert.deepEqual(club.pendingPlayerIds,[]);
  assert.equal((await call('joinSocialClub',{groupId:'club'},'target')).status,'pending');
});
test('round invitation is manager-only, atomic and duplicate-safe',async()=>{
  await assert.rejects(call('sendGameInvite',{gameId:'round',recipientId:'target'},'member'));
  await call('sendGameInvite',{gameId:'round',recipientId:'target'});
  assert.equal((await call('sendGameInvite',{gameId:'round',recipientId:'target'})).reason,'already_invited');
  const round=(await db.doc('games/round').get()).data();
  assert.ok(round.invitedUserIds.includes('target'));assert.equal(round.approvedInvites.target.inviterId,'manager');
  assert.equal((await db.collection('notifications').where('recipientId','==','target').get()).size,1);
});
test('live rounds and rejected recipients do not receive invitations',async()=>{
  await db.doc('games/round').update({liveMatch:{phase:'live'}});
  await assert.rejects(call('sendGameInvite',{gameId:'round',recipientId:'target'}));
  await db.doc('games/round').update({liveMatch:null,rejectedPlayerIds:['target']});
  await assert.rejects(call('sendGameInvite',{gameId:'round',recipientId:'target'}));
  assert.equal((await db.collection('notifications').get()).size,0);
});
test('inbox resolves joined, deleted and expired targets for its recipient only',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  assert.equal((await call('getReceivedInvitations',{},'other')).length,0);
  assert.equal((await call('getReceivedInvitations',{},'target'))[0].data.invitationStatus,'available');
  await call('joinSocialClub',{groupId:'club'},'target');
  assert.equal((await call('getReceivedInvitations',{},'target'))[0].data.invitationStatus,'joined');
  await db.doc('groups/club').delete();
  assert.equal((await call('getReceivedInvitations',{},'target'))[0].data.invitationStatus,'unavailable');
});

test('reopening old invitations after either side blocks reflects the current contact state',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  await call('sendGameInvite',{gameId:'round',recipientId:'target'});
  const states=async()=>Object.fromEntries((await call('getReceivedInvitations',{},'target')).map(n=>[n.data.type,n.data.invitationStatus]));
  const expected=status=>({groupInvitation:status,inviteToGame:status});
  assert.deepEqual(await states(),expected('available'));
  for(const path of ['users/target/blocked/manager','users/manager/blocked/target']){
    await db.doc(path).set({at:1});
    assert.deepEqual(await states(),expected('unavailable'));
    await assert.rejects(call('joinSocialClub',{groupId:'club'},'target'),/Invitation unavailable/);
    await db.doc(path).delete();
    assert.deepEqual(await states(),expected('available'));
  }
  assert.equal((await db.collection('notifications').where('recipientId','==','target').get()).size,2);
});

test('an expired invitation stays expired when a separate request for the same target is pending',async()=>{
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  await call('sendGameInvite',{gameId:'round',recipientId:'target'});
  const notices=await db.collection('notifications').where('recipientId','==','target').get();
  const batch=db.batch();
  for(const n of notices.docs)batch.update(n.ref,{'payload.expiresAt':Date.now()-1000});
  batch.update(db.doc('groups/club'),{'approvedInvites.target.expiresAt':Date.now()-1000,pendingPlayerIds:['target']});
  batch.update(db.doc('games/round'),{'approvedInvites.target.expiresAt':Date.now()-1000,pending:['target']});
  await batch.commit();
  const rows=await call('getReceivedInvitations',{},'target');
  assert.deepEqual(rows.map(n=>n.data.invitationStatus),['expired','expired']);
});

for(const type of ['club','game'])test('a block committed immediately before the '+type+' invitation transaction prevents both notice and grant',async()=>{
  const original=db.runTransaction;
  let transactions=0;
  db.runTransaction=async function(...args){
    if(++transactions===(type==='club'?2:1))await db.doc('users/target/blocked/manager').set({at:Date.now()});
    return original.apply(this,args);
  };
  try {
    const result=type==='club'?call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'}):call('sendGameInvite',{gameId:'round',recipientId:'target'});
    await assert.rejects(result,type==='club'?/Player unavailable/:/Contact blocked/);
    assert.equal((await db.collection('notifications').get()).size,0);
    assert.equal((await db.doc(type==='club'?'groups/club':'games/round').get()).get('approvedInvites.target'),undefined);
  }finally{db.runTransaction=original;}
});

test('a signed-out short-link read followed by authenticated repeated club acceptance preserves inviter and counts once',async()=>{
  await db.doc('inviteLinks/night').set({type:'team',targetId:'club',invitedBy:'manager',clicks:0});
  await call('inviteSocialPlayerToClub',{groupId:'club',userId:'target'});
  const http=createServer(express().use(api.serveInviteCode));
  try {
    await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
    const url='http://127.0.0.1:'+http.address().port+'/i/night?resolve=1&invitedBy=forged';
    const response=await fetch(url,{signal:AbortSignal.timeout(5000)});
    assert.equal(response.status,200);
    const link=await response.json();
    assert.deepEqual(link,{type:'team',id:'club',invitedBy:'manager'});
    assert.equal((await db.doc('inviteLinks/night').get()).get('clicks'),0);
    for(let i=0;i<2;i++)assert.equal((await call('joinSocialClub',{groupId:link.id},'target')).status,'joined');
    assert.equal((await db.doc('groups/club').get()).get('playerIds').filter(id=>id==='target').length,1);
    assert.equal((await call('getReceivedInvitations',{},'target'))[0].data.invitationStatus,'joined');
  } finally {await new Promise(resolve=>http.close(resolve));}
});
