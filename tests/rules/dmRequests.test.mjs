import {test,before,beforeEach,after} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,collection,setDoc,updateDoc,getDoc,getDocs,deleteDoc,serverTimestamp} from 'firebase/firestore';
let env;
const db=uid=>env.authenticatedContext(uid).firestore(),conv='alice__bob';
const path=(fs,...p)=>doc(fs,...p);
const send=uid=>setDoc(path(db(uid),'dmConversations',conv,'messages',`${uid}-${Date.now()}-${Math.random()}`),{senderId:uid,text:'שלום',createdAt:serverTimestamp()});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-soccer',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{
  await env.clearFirestore();await env.withSecurityRulesDisabled(async ctx=>{
    const fs=ctx.firestore();for(const uid of ['alice','bob'])await setDoc(path(fs,'users',uid),{name:uid,friends:[]});
    await setDoc(path(fs,'dmConversations',conv),{participants:['alice','bob'],createdAt:1,updatedAt:1});
    await setDoc(path(fs,'dmRequestState',conv),{from:'alice',to:'bob',status:'declined'});
    await setDoc(path(fs,'users','alice','dmRequests',conv),{status:'waiting',text:'שלום'});
    await setDoc(path(fs,'users','bob','dmRequests',conv),{status:'declined',text:'שלום'});
  });
});
after(async()=>env?.cleanup());
test('server private request state, quota and operations are unreadable and unwritable',async()=>{
  for(const name of ['dmRequestState','dmOperations','dmRequestQuotas']){
    await assertFails(getDoc(path(db('alice'),name,conv)));await assertFails(getDocs(collection(db('alice'),name)));
    await assertFails(setDoc(path(db('alice'),name,conv),{status:'accepted'}));
  }
});
test('recipient projection is private even though both can read conversation history',async()=>{
  await assertSucceeds(getDoc(path(db('alice'),'users','alice','dmRequests',conv)));
  await assertSucceeds(getDocs(collection(db('bob'),'users','bob','dmRequests')));
  await assertFails(getDoc(path(db('alice'),'users','bob','dmRequests',conv)));
  await assertFails(updateDoc(path(db('bob'),'users','bob','dmRequests',conv),{status:'open'}));
  await assertSucceeds(getDocs(collection(db('alice'),'dmConversations',conv,'messages')));
  await assertFails(getDocs(collection(db('carol'),'dmConversations',conv,'messages')));
});
test('pending requests cannot write messages, read receipts, or typing; cannot forge approval',async()=>{
  await assertFails(send('alice'));
  for(const name of ['reads','typing'])await assertFails(setDoc(path(db('bob'),'dmConversations',conv,name,'bob'),{at:1}));
  await assertFails(updateDoc(path(db('alice'),'dmConversations',conv),{messagingApproved:true}));
  await assertFails(setDoc(path(db('carol'),'dmConversations','carol__david'),{participants:['carol','david'],messagingApproved:true}));
});
test('server-approved strangers can write; blocks in either direction stop messages and preserve history',async()=>{
  await env.withSecurityRulesDisabled(ctx=>updateDoc(path(ctx.firestore(),'dmConversations',conv),{messagingApproved:true}));
  await assertSucceeds(send('alice'));await assertSucceeds(send('bob'));
  await assertSucceeds(setDoc(path(db('alice'),'dmConversations',conv,'reads','alice'),{at:1}));
  for(const [a,b] of [['alice','bob'],['bob','alice']]){
    await assertSucceeds(setDoc(path(db(a),'users',a,'blocked',b),{at:1}));
    await assertFails(send('alice'));await assertSucceeds(getDocs(collection(db('alice'),'dmConversations',conv,'messages')));
    await assertSucceeds(deleteDoc(path(db(a),'users',a,'blocked',b)));
  }
});
test('privacy is server-owned after signup and defaults can only be set on initial creation',async()=>{
  await assertFails(updateDoc(path(db('alice'),'users','alice'),{dmRequestPolicy:'everyone',dmRequestPolicySource:'explicit'}));
  await assertSucceeds(setDoc(path(db('carol'),'users','carol'),{name:'קרול',dmRequestPolicy:'everyone',dmRequestPolicySource:'default'}));
  await assertFails(setDoc(path(db('david'),'users','david'),{name:'דוד',dmRequestPolicy:'friends',dmRequestPolicySource:'explicit'}));
});
test('first request message remains reportable until approval; cancellation cannot erase evidence',async()=>{
  await env.withSecurityRulesDisabled(ctx=>setDoc(path(ctx.firestore(),'dmConversations',conv,'messages','first'),{senderId:'alice',text:'בקשה',messageRequest:true,createdAt:1}));
  await assertFails(deleteDoc(path(db('alice'),'dmConversations',conv,'messages','first')));
  await assertSucceeds(getDoc(path(db('bob'),'dmConversations',conv,'messages','first')));
  await env.withSecurityRulesDisabled(ctx=>updateDoc(path(ctx.firestore(),'dmConversations',conv),{messagingApproved:true}));
  await assertSucceeds(deleteDoc(path(db('alice'),'dmConversations',conv,'messages','first')));
});
