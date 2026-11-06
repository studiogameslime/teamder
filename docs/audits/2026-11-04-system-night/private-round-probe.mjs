import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// Independent fixture, run only against the local Firestore emulator.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
const env=await initializeTestEnvironment({projectId:'demo-night-private-read',firestore:{host:'127.0.0.1',port:8080,
  rules:readFileSync(new URL('../../../firestore.rules',import.meta.url),'utf8')}});
try {
  await env.clearFirestore();
  const seed=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
  await seed(async db=>{
    await setDoc(doc(db,'groups','club'),{adminIds:['manager'],playerIds:['manager']});
    await setDoc(doc(db,'games','round'),{groupId:'club',createdBy:'manager',visibility:'community',players:[],participantIds:[],invitedUserIds:[],acceptsFillers:false,title:'synthetic'});
  });
  const result={};
  const read=async key=>{
    const db=env.authenticatedContext('outsider').firestore();
    try { result[key]=(await getDoc(doc(db,'games','round'))).get('title')==='synthetic'?'read':'missing'; }
    catch(e){result[key]=e.code;}
  };
  await read('beforeInvite');
  await seed(db=>updateDoc(doc(db,'games','round'),{invitedUserIds:['outsider']}));
  await read('invited');
  await seed(db=>setDoc(doc(db,'users','manager','blocked','outsider'),{at:1}));
  await read('afterBlock');
  await seed(db=>updateDoc(doc(db,'games','round'),{invitedUserIds:[]}));
  await read('afterInviteRemoved');
  const outsider=env.authenticatedContext('outsider').firestore();
  const collections=['usageActivity','usageSessions','usageOperations','usageActivityLimits','usageCoverage'];
  const checks=async work=>{try{await work();return 'allowed';}catch(e){return e.code;}};
  result.usage={};
  for(const name of collections){
    await seed(db=>setDoc(doc(db,name,'record'),{uid:'outsider',secret:'local-fixture'}));
    const ref=doc(outsider,name,'record');
    result.usage[name]=[await checks(()=>getDoc(ref)),await checks(()=>updateDoc(ref,{secret:'changed'}))];
  }
  await seed(db=>setDoc(doc(db,'users','outsider'),{name:'synthetic',friends:[]}));
  const own=doc(outsider,'users','outsider');
  const patch={invitedBy:'nonexistent-inviter',invitedByType:'app',invitedByTargetId:'app'};
  result.attribution={
    forgedFirstInviter:await checks(()=>updateDoc(own,patch)),
    replacementInviter:await checks(()=>updateDoc(own,{...patch,invitedBy:'second'})),
    inventedLink:await checks(()=>updateDoc(own,{acquisition:{linkId:'arbitrary-link',source:'fiction'}})),
    replacementLink:await checks(()=>updateDoc(own,{acquisition:{linkId:'replacement-link',source:'other'}})),
  };
  const current=(await getDoc(own)).data();
  result.attribution.stored={invitedBy:current.invitedBy,linkId:current.acquisition?.linkId};
  console.log(JSON.stringify(result));
} finally { await env.cleanup(); }
