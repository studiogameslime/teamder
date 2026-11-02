import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080', 'Never run against a live database');
process.env.GCLOUD_PROJECT = 'demo-dm-requests';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: process.env.GCLOUD_PROJECT });
let api, db, serial=0;
const auth=uid=>({uid,token:{firebase:{sign_in_provider:'password'}}});
const call=(uid,userId,action='status',extra={})=>api.runDmAction({auth:auth(uid),data:{userId,action,operationId:`test_operation_${++serial}`,...extra}});
const conv='alice__bob';
const send=(uid='alice',to='bob',extra={})=>call(uid,to,'send',{text:'שלום',...extra});
const data=async path=>(await db.doc(path).get()).data();
const mutual=async()=>{await db.doc('users/alice').update({friends:['bob']});await db.doc('users/bob').update({friends:['alice']});};
before(async()=>{admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});db=admin.firestore();api=await import('./lib/dmRequests.js');});
after(async()=>{await Promise.all(admin.apps.map(a=>a.delete()));});
beforeEach(async()=>{
  for(const path of ['users','dmConversations','dmRequestState','dmOperations','dmRequestQuotas'])await db.recursiveDelete(db.collection(path));
  for(const uid of ['alice','bob','carol','david','eve','frank','grace'])await db.doc(`users/${uid}`).set({name:uid,friends:[],dmRequestPolicy:'everyone'});
});
test('status is read only; request and sender/recipient projections are created atomically',async()=>{
  assert.equal((await call('alice','bob')).status,'compose');
  assert.equal(await data(`dmConversations/${conv}`),undefined);
  assert.equal((await send()).status,'waiting');
  assert.equal((await call('bob','alice')).status,'incoming');
  assert.equal((await data('dmRequestQuotas/alice')).count,1);
  assert.equal((await db.collection(`dmConversations/${conv}/messages`).get()).size,1);
  assert.equal((await data(`users/alice/dmRequests/${conv}`)).status,'waiting');
  assert.equal((await data(`users/bob/dmRequests/${conv}`)).status,'incoming');
  assert.equal(await data(`users/bob/chatUnread/dm__${conv}`),undefined);
  await assert.rejects(send(),/Contact unavailable/);
});
test('idempotent retry and concurrent double click consume exactly one request',async()=>{
  await Promise.all([send('alice','bob',{operationId:'same_operation_1'}),send('alice','bob',{operationId:'same_operation_1'})]);
  assert.equal((await data('dmRequestQuotas/alice')).count,1);
  assert.equal((await db.collection(`dmConversations/${conv}/messages`).get()).size,1);
  await assert.rejects(send('alice','bob',{operationId:'same_operation_1',text:'different'}),/Operation changed/);
});
test('reply atomically approves without adding friendship or charging the recipient quota',async()=>{
  await send();
  assert.equal((await send('bob','alice')).status,'open');
  assert.equal((await call('alice','bob')).status,'open');
  assert.deepEqual((await data('users/alice')).friends,[]);
  assert.equal(await data('dmRequestQuotas/bob'),undefined);
  assert.equal(await data(`users/bob/dmRequests/${conv}`),undefined);
  assert.equal((await data(`dmConversations/${conv}`)).messagingApproved,true);
});
test('explicit acceptance allows writing without any reply; sender cannot accept their own request',async()=>{
  await send();
  await assert.rejects(call('alice','bob','accept'),/Request unavailable/);
  await call('bob','alice','accept');
  assert.equal((await send()).status,'open');
});
test('decline and recipient seen marker do not change any sender-visible request fields',async()=>{
  await send();
  const before=await data(`users/alice/dmRequests/${conv}`),shared=await data(`dmConversations/${conv}`);
  await call('bob','alice','seen');await call('bob','alice','decline');
  assert.deepEqual(await data(`users/alice/dmRequests/${conv}`),before);
  assert.deepEqual(await data(`dmConversations/${conv}`),shared);
  assert.equal((await call('alice','bob')).status,'waiting');
  assert.equal((await call('bob','alice')).status,'declined');
  await assert.rejects(send(),/Contact unavailable/);
  await send('bob','alice');assert.equal((await call('alice','bob')).status,'open');
});
test('cancellation works identically after pending or declined and never refunds quota',async()=>{
  await send();await call('bob','alice','decline');await call('alice','bob','cancel');
  assert.equal((await call('alice','bob')).status,'cancelled');
  assert.equal(await data(`users/bob/dmRequests/${conv}`),undefined);
  assert.equal((await data('dmRequestQuotas/alice')).count,1);
  await assert.rejects(send(),/Contact unavailable/);
  // Original recipient can initiate a fresh request; only that person pays.
  await send('bob','alice');
  assert.equal((await call('alice','bob')).status,'incoming');
});
test('five concurrent requests succeed; sixth is rejected with no partial message',async()=>{
  const peers=['bob','carol','david','eve','frank','grace'];
  const results=await Promise.allSettled(peers.map(to=>send('alice',to)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,5);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.equal((await data('dmRequestQuotas/alice')).count,5);
  assert.equal((await db.collection('dmRequestState').get()).size,5);
  const rejected=peers[results.findIndex(r=>r.status==='rejected')];
  assert.equal(await data(`dmConversations/alice__${rejected}`),undefined);
});
test('prior calendar-day quota expires; cancelled requests remain charged today',async()=>{
  await db.doc('dmRequestQuotas/alice').set({day:'1900-01-01',count:5});await send();
  assert.equal((await data('dmRequestQuotas/alice')).count,1);
  await call('alice','bob','cancel');assert.equal((await data('dmRequestQuotas/alice')).count,1);
});
test('missing legacy privacy fails closed; friends-only keeps pending requests usable',async()=>{
  await db.doc('users/bob').update({dmRequestPolicy:admin.firestore.FieldValue.delete(),dmFriendsOnly:false});
  assert.equal((await call('alice','bob')).status,'unavailable');await assert.rejects(send());
  await db.doc('users/bob').update({dmRequestPolicy:'everyone'});await send();
  await db.doc('users/bob').update({dmRequestPolicy:'friends'});
  await assert.rejects(send('carol','bob'));
  await call('bob','alice','accept');assert.equal((await send()).status,'open');
});
test('mutual friends bypass decline and quota but unilateral friendship cannot',async()=>{
  await send();await call('bob','alice','decline');await mutual();
  await db.doc('dmRequestQuotas/alice').set({day:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),count:5});
  assert.equal((await send()).status,'open');
  await db.doc('users/bob').update({friends:[]});
  await assert.rejects(send());
});
test('blocking either way stops new sends; unblocking restores approval but not declined requests',async()=>{
  await send();await call('bob','alice','accept');
  for(const [a,b] of [['alice','bob'],['bob','alice']]){
    const block=db.doc(`users/${a}/blocked/${b}`);await block.set({at:1});
    assert.equal((await call('alice','bob')).status,'unavailable');await assert.rejects(send());
    await block.delete();assert.equal((await call('alice','bob')).status,'open');
  }
  assert.equal((await db.collection(`dmConversations/${conv}/messages`).get()).size,1);
  await send('carol','bob');await call('bob','carol','decline');
  await db.doc('users/bob/blocked/carol').set({at:1});await db.doc('users/bob/blocked/carol').delete();
  assert.equal((await call('carol','bob')).status,'waiting');assert.equal((await call('bob','carol')).status,'declined');
});
test('friend continuity requires an actual message from each side before removal',async()=>{
  await mutual();await send();
  await db.runTransaction(tx=>api.preserveDmOnRemoval(tx,db.doc('users/alice'),db.doc('users/bob')));
  assert.notEqual((await data(`dmConversations/${conv}`)).messagingApproved,true);
  await send('bob','alice');
  await db.runTransaction(async tx=>{await api.preserveDmOnRemoval(tx,db.doc('users/alice'),db.doc('users/bob'));tx.update(db.doc('users/alice'),{friends:[]});tx.update(db.doc('users/bob'),{friends:[]});});
  assert.equal((await call('alice','bob')).status,'open');
});
test('privacy setter records an explicit choice, preserves unrelated privacy and rejects guests',async()=>{
  await db.doc('users/alice').update({socialPrivacy:{discoverable:false,statistics:'onlyMe'}});
  await api.setDmRequestPrivacy.run({auth:auth('alice'),data:{policy:'friends'}});
  const u=await data('users/alice');assert.equal(u.dmRequestPolicy,'friends');assert.equal(u.dmRequestPolicySource,'explicit');assert.equal(u.socialPrivacy.discoverable,false);
  await assert.rejects(api.setDmRequestPrivacy.run({auth:auth('alice'),data:{policy:'invalid'}}));
  await db.doc('users/alice').update({isGuest:true});await assert.rejects(send());
});
test('validates text lengths, self, missing account, anonymous callers and operation identity',async()=>{
  for(const text of ['', '   ', 'א'.repeat(1001), null])await assert.rejects(send('alice','bob',{text}));
  assert.equal(await data('dmRequestQuotas/alice'),undefined);
  await send('alice','bob',{text:'א'.repeat(1000)});
  await assert.rejects(call('alice','alice'));await assert.rejects(call('alice','missing'));
  await assert.rejects(api.runDmAction({auth:{uid:'alice',token:{firebase:{sign_in_provider:'anonymous'}}},data:{userId:'bob'}}));
  await assert.rejects(send('carol','bob',{operationId:'bad'}));
});
