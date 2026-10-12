import { test, before, beforeEach, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, getDocs, deleteDoc, updateDoc, query, where, serverTimestamp } from 'firebase/firestore';

let env;
const uid='chat-player', admin='chat-admin', waiting='chat-waitlist', game='chat-round', club='chat-club';
const db=id=>env.authenticatedContext(id).firestore();
const seed=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));
const message=(fs,id='new',sender=uid)=>setDoc(doc(fs,'games',game,'messages',id),{senderId:sender,text:'כדורגל',createdAt:serverTimestamp()});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-soccer',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}});});
beforeEach(async()=>{
  await env.clearFirestore();
  await seed(async fs=>{
    await setDoc(doc(fs,'groups',club),{name:'בדיקה',adminIds:[admin],playerIds:[uid,admin,waiting],isOpen:false});
    await setDoc(doc(fs,'games',game),{title:'מחזור',groupId:club,players:[uid],waitlist:[waiting],participantIds:[uid,waiting],createdBy:admin,status:'active',startsAt:Date.now()});
    await message(fs,'history');
  });
});
after(async()=>env?.cleanup());

test('registered players and admins write; waitlist alone cannot read or write',async()=>{
  await assertSucceeds(message(db(uid)));
  await assertSucceeds(message(db(admin),'admin',admin));
  await assertFails(message(db(waiting),'waiting',waiting));
  await assertFails(getDocs(collection(db(waiting),'games',game,'messages')));
});
test('finished round accepts messages until 24h from actual end, then keeps history and receipts only',async()=>{
  await seed(fs=>updateDoc(doc(fs,'games',game),{status:'finished',endedAt:Date.now()-86400000+60000}));
  await assertSucceeds(message(db(uid)));
  await seed(fs=>updateDoc(doc(fs,'games',game),{endedAt:Date.now()-86400000}));
  await assertFails(message(db(uid),'after'));
  await assertFails(message(db(admin),'admin-after',admin));
  await assertSucceeds(getDocs(collection(db(uid),'games',game,'messages')));
  await assertSucceeds(setDoc(doc(db(uid),'games',game,'reads',uid),{lastReadAt:Date.now()}));
  await assertFails(setDoc(doc(db(uid),'games',game,'typing',uid),{at:Date.now()}));
  await assertSucceeds(deleteDoc(doc(db(uid),'games',game,'typing',uid)));
});
test('cancelled rounds close immediately, regardless of a future end timestamp',async()=>{
  await seed(fs=>updateDoc(doc(fs,'games',game),{status:'cancelled',endedAt:Date.now()+86400000}));
  await assertFails(message(db(uid)));
  await assertSucceeds(getDocs(collection(db(admin),'games',game,'messages')));
});
test('legacy finished rounds with missing or null end time stay readable but cannot reopen',async()=>{
  for(const value of [{status:'finished'},{status:'finished',endedAt:null},{status:'finished',endedAt:0}]){
    await seed(fs=>updateDoc(doc(fs,'games',game),value));
    await assertFails(message(db(uid)));
    await assertSucceeds(getDocs(collection(db(uid),'games',game,'messages')));
  }
});
test('cancelling signup removes chat access; rejoining restores it without deleting history',async()=>{
  await seed(fs=>updateDoc(doc(fs,'games',game),{players:[]}));
  await assertFails(message(db(uid)));await assertFails(getDocs(collection(db(uid),'games',game,'messages')));
  await seed(fs=>updateDoc(doc(fs,'games',game),{players:[uid]}));
  await assertSucceeds(getDocs(collection(db(uid),'games',game,'messages')));
  await assertSucceeds(message(db(uid)));
});
test('personal pin/mute/archive settings are private, including message identity anchors',async()=>{
  const own=doc(db(uid),'users',uid,'chatSettings',`game__${game}`);
  await assertSucceeds(setDoc(own,{scope:'game',parentId:game,pinned:true,muted:true,archivedAt:Date.now(),archivedMessageId:'history'}));
  await assertSucceeds(getDocs(collection(db(uid),'users',uid,'chatSettings')));
  await assertFails(getDocs(collection(db(admin),'users',uid,'chatSettings')));
});
test('inbox parent queries include finished metadata without relying on message permissions',async()=>{
  await seed(fs=>updateDoc(doc(fs,'games',game),{status:'finished',endedAt:Date.now()-86400000}));
  await assertSucceeds(getDocs(query(collection(db(uid),'games'),where('participantIds','array-contains',uid))));
  await assertSucceeds(getDocs(query(collection(db(admin),'games'),where('createdBy','==',admin))));
  await assertSucceeds(getDocs(query(collection(db(admin),'games'),where('groupId','in',[club]))));
});
