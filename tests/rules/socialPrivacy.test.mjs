// Always load the complete production rules; no isolated rule fragments.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, query, where, documentId, setDoc, updateDoc, getDoc, getDocs, arrayUnion, arrayRemove, serverTimestamp } from 'firebase/firestore';
let env;
const db=(uid,claims={})=>env.authenticatedContext(uid,claims).firestore();
const seed=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const user=(fs,id)=>doc(fs,'users',id);
const conv='alice__bob';
const send=(fs,id=conv)=>setDoc(doc(fs,'dmConversations',id,'messages','new'),{senderId:'alice',text:'שלום',createdAt:serverTimestamp()});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-soccer',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
after(async()=>env?.cleanup());
beforeEach(async()=>{
  await env.clearFirestore();
  await seed(async fs=>{
    await setDoc(user(fs,'alice'),{name:'אליס',friends:['bob'],stats:{goals:9}});
    await setDoc(user(fs,'bob'),{name:'בוב',friends:['alice'],stats:{goals:7},email:'secret'});
    await setDoc(doc(fs,'usersPublic','bob'),{id:'bob',name:'בוב'});
  });
});
test('private user records: owner only, even for a friend or club/system admin claim',async()=>{
  await assertSucceeds(getDoc(user(db('bob'),'bob')));
  for(const fs of [db('alice'),db('carol'),db('manager',{admin:true}),env.unauthenticatedContext().firestore()])await assertFails(getDoc(user(fs,'bob')));
  assert.equal((await assertSucceeds(getDoc(doc(db('alice'),'usersPublic','bob')))).data().name,'בוב');
  await assertFails(getDocs(collection(db('alice'),'users')));
  await assertFails(getDocs(query(collection(db('alice'),'users'),where(documentId(),'in',['bob']))));
  await assertFails(getDocs(query(collection(db('alice'),'users'),where('invitedBy','==','alice'))));
});
test('approved friendship cannot be fabricated on create or changed through any client write shape',async()=>{
  await assertFails(setDoc(user(db('carol'),'carol'),{name:'קרול',friends:['alice']}));
  await assertSucceeds(setDoc(user(db('carol'),'carol'),{name:'קרול',friends:[]}));
  const own=user(db('alice'),'alice');
  for(const friends of [['bob','carol'],[],arrayUnion('carol'),arrayRemove('bob')])await assertFails(updateDoc(own,{friends}));
  await assertFails(setDoc(own,{name:'אליס'})); // full overwrite would erase friendship
  await assertSucceeds(updateDoc(own,{name:'אליס החדשה'}));
  await assertSucceeds(setDoc(own,{friends:['bob']},{merge:true})); // unchanged server list remains compatible
});
test('old missing/false preference does not permit strangers or unilateral friendship',async()=>{
  await assertSucceeds(send(db('alice')));
  await seed(fs=>updateDoc(user(fs,'bob'),{friends:[],dmFriendsOnly:false}));
  await assertFails(send(db('alice')));
  await assertFails(setDoc(doc(db('alice'),'dmConversations',conv),{participants:['alice','bob'],createdAt:1,updatedAt:1}));
  await assertFails(send(db('alice'),'alice__missing'));
});
test('blocking in either direction prevents new messages even for mutual friends',async()=>{
  for(const [a,b] of [['alice','bob'],['bob','alice']]){
    await seed(fs=>setDoc(doc(fs,'users',a,'blocked',b),{at:1}));
    await assertFails(send(db('alice')));
    await env.withSecurityRulesDisabled(async ctx=>{const {deleteDoc}=await import('firebase/firestore');await deleteDoc(doc(ctx.firestore(),'users',a,'blocked',b));});
  }
});
test('official service replies work, impersonating the official sender does not',async()=>{
  await assertSucceeds(send(db('alice'),'alice__teamder'));
  await assertFails(setDoc(doc(db('alice'),'dmConversations','alice__teamder','messages','forged'),{senderId:'teamder',text:'forged'}));
});
test('anonymous sessions cannot send even if seeded with mutual friendship',async()=>{
  await assertFails(send(db('alice',{firebase:{sign_in_provider:'anonymous'}})));
});
test('existing history survives friendship removal; new messages remain blocked',async()=>{
  await seed(async fs=>{
    await setDoc(doc(fs,'dmConversations',conv,'messages','old'),{senderId:'bob',text:'ישן'});
    await updateDoc(user(fs,'alice'),{friends:[]});
  });
  await assertSucceeds(getDocs(collection(db('alice'),'dmConversations',conv,'messages')));
  await assertFails(send(db('alice')));
});
test('personal totals are owner-only, pair queries are limited to a participant',async()=>{
  await seed(async fs=>{
    await setDoc(doc(fs,'playerStats','bob'),{goals:7});
    await setDoc(doc(fs,'pairStats',conv),{a:'alice',b:'bob',sameTeam:4});
    await setDoc(doc(fs,'users','bob','seasonTitles','title'),{value:7});
  });
  await assertSucceeds(getDoc(doc(db('bob'),'playerStats','bob')));
  await assertFails(getDoc(doc(db('alice'),'playerStats','bob')));
  await assertFails(getDocs(collection(db('alice'),'users','bob','seasonTitles')));
  await assertSucceeds(getDocs(query(collection(db('alice'),'pairStats'),where('a','==','alice'))));
  await assertFails(getDocs(query(collection(db('carol'),'pairStats'),where('a','==','alice'))));
});
