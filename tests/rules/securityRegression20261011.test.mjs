// Security regression: authenticated legitimate paths plus denial of the audited attacks.
// Never run against production. Complete rules file, isolated demo project.
import {before,after,beforeEach,test} from 'node:test';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertSucceeds,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,updateDoc,getDoc,getDocs,collection,arrayUnion} from 'firebase/firestore';
let env;
const db=(uid,anonymous=false)=>env.authenticatedContext(uid,{firebase:{sign_in_provider:anonymous?'anonymous':'password'}}).firestore();
const seed=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-soccer',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(new URL('../../firestore.rules',import.meta.url),'utf8')}})});
after(async()=>env?.cleanup());
beforeEach(async()=>{await env.clearFirestore();await seed(async fs=>{
  await setDoc(doc(fs,'users','alice'),{name:'Alice',friends:[],email:'private@example.invalid'});
  await setDoc(doc(fs,'users','bob'),{name:'Bob',friends:[]});
  await setDoc(doc(fs,'groups','club'),{creatorId:'alice',adminIds:['alice'],playerIds:['alice','bob'],pendingPlayerIds:[],isOpen:true,name:'Audit club'});
  await setDoc(doc(fs,'games','round'),{createdBy:'alice',groupId:'club',players:['alice','bob'],participantIds:['alice','bob'],waitlist:[],status:'finished'});
})});
test('S02: unauthenticated error writer cannot forge identity, status and extra fields',async()=>{
 const fs=env.unauthenticatedContext().firestore();
 await assertFails(setDoc(doc(fs,'errors','audit'),{operation:'audit',lastUserId:'alice',status:'resolved',claudeNote:'forged',arbitrary:'x'.repeat(100000)}));
 await assertFails(updateDoc(doc(fs,'errors','audit'),{status:'open'}));
 await assertFails(getDoc(doc(fs,'errors','audit')));
});
test('S03: a participant reads another participant heart rate and heatmap',async()=>{
 await seed(fs=>setDoc(doc(fs,'games','round','physical','alice'),{avgHr:140,maxHr:190,hrZones:{peak:20},heatGrid:[0,1]}));
 await assertFails(getDoc(doc(db('bob'),'games','round','physical','alice')));
 await assertSucceeds(getDoc(doc(db('alice'),'games','round','physical','alice')));
 await assertFails(getDoc(doc(db('outsider'),'games','round','physical','alice')));
});
test('S04: anonymous account creates a club directly, bypassing callable daily quota',async()=>{
 await assertFails(setDoc(doc(db('anon',true),'groups','anonymousClub'),{creatorId:'anon',adminIds:['anon'],playerIds:['anon'],pendingPlayerIds:[],name:'Audit'}));
});
test('S05: initial user creation accepts forged server-derived statistics',async()=>{
 await assertFails(setDoc(doc(db('newuser'),'users','newuser'),{name:'Audit',friends:[],stats:{goals:999999,wins:999999}}));
 await assertFails(updateDoc(doc(db('newuser'),'users','newuser'),{stats:{goals:1}}));
});
test('S06: rejected club applicant cannot bypass canonical server rejection by direct open-club update',async()=>{
 await seed(fs=>setDoc(doc(fs,'joinRequests','rejected'),{groupId:'club',userId:'rejected',status:'rejected'}));
 await assertFails(updateDoc(doc(db('rejected'),'groups','club'),{playerIds:arrayUnion('rejected')}));
});
test('S07: legacy report writer can fabricate text and author without reading the message',async()=>{
 await assertFails(setDoc(doc(db('bob'),'chatReports','forged'),{reporterId:'bob',senderId:'alice',messageText:'fabricated',scope:'dm',parentId:'unknown',status:'open'}));
});
test('S08: feedback creator controls moderation status and arbitrary extra fields',async()=>{
 await assertFails(setDoc(doc(db('bob'),'feedback','hidden'),{type:'bug',message:'audit',userId:'bob',status:'done',claudeNote:'fake',extra:'x'.repeat(100000)}));
});
test('S09: private manager ratings respect visibility and retain legitimate admin/member access', async()=>{
 await seed(async fs=>{
   await updateDoc(doc(fs,'groups','club'),{internalRating:true,hideInternalRating:true});
   await setDoc(doc(fs,'groups','club','private','adminRatings'),{ratings:{alice:1,bob:5}});
 });
 await assertSucceeds(getDoc(doc(db('alice'),'groups','club','private','adminRatings')));
 await assertFails(getDoc(doc(db('bob'),'groups','club','private','adminRatings')));
 await assertFails(getDoc(doc(db('outsider'),'groups','club','private','adminRatings')));
 await assertFails(updateDoc(doc(db('alice'),'groups','club'),{adminRatings:{bob:5}}));
 await seed(fs=>updateDoc(doc(fs,'groups','club'),{hideInternalRating:false}));
 await assertSucceeds(getDoc(doc(db('bob'),'groups','club','private','adminRatings')));
 await assertFails(updateDoc(doc(db('alice'),'groups','club','private','adminRatings'),{ratings:{bob:5}}));
});
test('S10: full-account directory query includes identity of opted-out player',async()=>{
 await seed(async fs=>{await updateDoc(doc(fs,'users','alice'),{socialPrivacy:{discoverable:false}});await setDoc(doc(fs,'usersPublic','alice'),{id:'alice',name:'Alice'});});
 await assertFails(getDocs(collection(db('outsider'),'usersPublic')));
});
test('S11: unrelated full account reads a private club round record',async()=>{
 await seed(fs=>setDoc(doc(fs,'rounds','privateRound'),{gameId:'round',teams:[{name:'Red',players:['alice','bob']}],goals:[{scorerId:'alice'}]}));
 await assertFails(getDoc(doc(db('outsider'),'rounds','privateRound')));
 await assertFails(getDoc(doc(db('outsider'),'games','round')));
});
test('S12: direct friendship request bypasses block, full-account check and callable rate limit',async()=>{
 await seed(fs=>setDoc(doc(fs,'users','alice','blocked','anon'),{at:1}));
 await assertFails(setDoc(doc(db('anon',true),'friendRequests','any-id'),{fromUserId:'anon',toUserId:'alice',status:'pending'}));
});
test('S13: unrelated sender creates a club-deleted notification for any recipient',async()=>{
 await assertFails(setDoc(doc(db('outsider'),'notifications','fakeDeleted'),{recipientId:'alice',type:'groupDeleted',payload:{groupId:'nonexistent',groupName:'fabricated'},createdByUid:'outsider',delivered:false}));
});
test('S14: authenticated chat sender cannot forge displayed name, avatar and timestamp',async()=>{
 await assertFails(setDoc(doc(db('bob'),'groups','club','messages','spoof'),{senderId:'bob',senderName:'Teamder',senderPhotoUrl:'https://example.invalid/logo.png',createdAt:9999999999999,text:'audit'}));
});
test('Controls: private identity, another club and server rate limits remain protected',async()=>{
 await assertFails(getDoc(doc(db('bob'),'users','alice')));
 await assertFails(getDoc(doc(db('outsider'),'groups','club')));
 await assertFails(setDoc(doc(db('bob'),'serverRateLimits','bob_search'),{uid:'bob',count:0}));
 await assertFails(setDoc(doc(db('bob'),'groups','club'),{adminIds:['bob']},{merge:true}));
});

test('legitimate feedback and first user creation remain supported',async()=>{
 const {serverTimestamp}=await import('firebase/firestore');
 await assertSucceeds(setDoc(doc(db('newuser'),'users','newuser'),{name:'שחקן',friends:[],stats:null}));
 await assertSucceeds(setDoc(doc(db('bob'),'feedback','actual'),{type:'bug',message:'תקלה',userId:'bob',status:'new',createdAt:serverTimestamp()}));
});
test('authoritative chat identity is server-only while valid member messages remain accepted',async()=>{
 const {serverTimestamp}=await import('firebase/firestore');
 await assertSucceeds(setDoc(doc(db('bob'),'groups','club','messages','actual'),{senderId:'bob',text:'שלום',createdAt:serverTimestamp()}));
});
test('declined friendship history cannot be deleted to bypass rejection',async()=>{
 const {deleteDoc}=await import('firebase/firestore');
 await seed(fs=>setDoc(doc(fs,'friendRequests','declined'),{fromUserId:'bob',toUserId:'alice',status:'declined'}));
 await assertFails(deleteDoc(doc(db('bob'),'friendRequests','declined')));
 await assertFails(deleteDoc(doc(db('alice'),'friendRequests','declined')));
});
