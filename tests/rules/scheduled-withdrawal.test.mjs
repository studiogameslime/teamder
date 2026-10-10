// Full rules contract, with the proposed one-clause change applied in memory.
// This does not edit/deploy firestore.rules. Remove the in-memory substitution
// after the owner approves and the exact same clause is applied to the source.
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

let env;
before(async()=>{
  const source=readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8');
  const old="(resource.data.status == 'open' || resource.data.status == 'locked') &&";
  const proposed="(resource.data.status == 'open' || resource.data.status == 'locked' || resource.data.status == 'scheduled') &&";
  if(!source.includes(old)&&!source.includes(proposed))throw Error('Withdrawal clause changed; review proposal');
  env=await initializeTestEnvironment({projectId:'demo-soccer',firestore:{host:'127.0.0.1',port:8080,rules:source.replace(old,proposed)}});
});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'groups','club'),{creatorId:'admin',adminIds:['admin'],playerIds:['admin','a','b','c','d','x'],isOpen:false});
    await setDoc(doc(ctx.firestore(),'games','round'),{createdBy:'admin',groupId:'club',status:'scheduled',visibility:'community',startsAt:Date.now()+86400000,registrationOpensAt:Date.now()+3600000,
      players:['a'],waitlist:['b','c'],pending:['d'],participantIds:['a','b','c','d'],maxPlayers:10,pendingPromotion:{uid:'b',offeredAt:Date.now()},cancellations:{},joinedAt:{a:100,b:100,c:100,d:100}});
  });
});
const ref=uid=>doc(env.authenticatedContext(uid).firestore(),'games','round');
test('scheduled: registered player withdraws without touching the queue or offer',async()=>{
  await assertSucceeds(updateDoc(ref('a'),{players:[],participantIds:['b','c','d'],cancellations:{a:200},joinedAt:{b:100,c:100,d:100},updatedAt:200}));
});
test('scheduled: waiting offer owner withdraws and clears only their own offer',async()=>{
  await assertSucceeds(updateDoc(ref('b'),{waitlist:['c'],participantIds:['a','c','d'],pendingPromotion:null,cancellations:{b:200},joinedAt:{a:100,c:100,d:100},updatedAt:200}));
});
test('scheduled: pending player withdraws',async()=>{
  await assertSucceeds(updateDoc(ref('d'),{pending:[],participantIds:['a','b','c'],cancellations:{d:200},joinedAt:{a:100,b:100,c:100},updatedAt:200}));
});
test('scheduled: new player cannot self-join or join the waitlist',async()=>{
  await assertFails(updateDoc(ref('x'),{players:['a','x'],participantIds:['a','b','c','d','x'],updatedAt:200}));
  await assertFails(updateDoc(ref('x'),{waitlist:['b','c','x'],participantIds:['a','b','c','d','x'],updatedAt:200}));
});
test('scheduled: withdrawing cannot remove another player or forge a promotion',async()=>{
  await assertFails(updateDoc(ref('a'),{players:[],waitlist:['c'],participantIds:['c','d'],updatedAt:200}));
  await assertFails(updateDoc(ref('b'),{players:['a','b'],waitlist:['c'],participantIds:['a','b','c','d'],pendingPromotion:null,updatedAt:200}));
  await assertFails(updateDoc(ref('a'),{players:[],participantIds:['b','c','d'],pendingPromotion:{uid:'c',offeredAt:200},updatedAt:200}));
});
test('scheduled: cannot reopen or alter timing while cancelling',async()=>{
  await assertFails(updateDoc(ref('a'),{players:[],participantIds:['b','c','d'],status:'open',updatedAt:200}));
  await assertFails(updateDoc(ref('a'),{players:[],participantIds:['b','c','d'],registrationOpensAt:0,updatedAt:200}));
});
