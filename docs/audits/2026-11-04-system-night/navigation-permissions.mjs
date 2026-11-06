// A separate synthetic project on the existing loopback emulator.
// Load the complete rules unchanged and never touch a production endpoint.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createRequire } from 'node:module';
const projectId='demo-navigation-night-'+Date.now().toString(36);
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8195';
process.env.GCLOUD_PROJECT=projectId;
const backendRequire=createRequire(new URL('../../../functions/package.json',import.meta.url));
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8195,
  rules:readFileSync(new URL('../../../firestore.rules',import.meta.url),'utf8')}});
const seed=fn=>env.withSecurityRulesDisabled(ctx=>fn(ctx.firestore()));
const db=uid=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'password'}}).firestore();
const results={projectId,fullRules:true,endpoint:'127.0.0.1:8195',checks:[]};
try {
  await seed(async fs=>{
    await setDoc(doc(fs,'groups','club'),{name:'club',creatorId:'creator',adminIds:['creator','admin'],playerIds:['creator','admin','player'],pendingPlayerIds:[]});
    await setDoc(doc(fs,'games','round'),{title:'round',groupId:'club',createdBy:'creator',status:'open',visibility:'community',
      startsAt:Date.now()+86400000,maxPlayers:15,players:['player'],waitlist:[],pending:[],participantIds:['player'],
      requiresApproval:true,newServerContract:{revision:7,private:true}});
    await setDoc(doc(fs,'users','player'),{name:'player',statsVisibility:'private',newClientPrivacy:{revision:3,enabled:true}});
    await setDoc(doc(fs,'users','admin'),{name:'admin',isGuest:false});
  });
  await assertSucceeds(updateDoc(doc(db('admin'),'games','round'),{title:'admin first edit',updatedAt:Date.now()}));
  await seed(fs=>updateDoc(doc(fs,'groups','club'),{adminIds:['creator']}));
  await assertFails(updateDoc(doc(db('admin'),'games','round'),{title:'revoked edit',updatedAt:Date.now()}));
  results.checks.push({scenario:'admin revoked before next save',before:'allowed',after:'permission-denied'});
  await assertSucceeds(updateDoc(doc(db('player'),'users','player'),{name:'updated',updatedAt:Date.now()}));
  const self=(await getDoc(doc(db('player'),'users','player'))).data();
  assert.equal(self.statsVisibility,'private');assert.equal(self.newClientPrivacy.revision,3);
  await assertSucceeds(updateDoc(doc(db('creator'),'games','round'),{title:'old partial update',updatedAt:Date.now()}));
  const round=(await getDoc(doc(db('creator'),'games','round'))).data();
  assert.equal(round.requiresApproval,true);assert.equal(round.newServerContract.revision,7);
  results.checks.push({scenario:'old client partial update',userPrivacyPreserved:true,unknownGameFieldPreserved:true});
  // A full replacement from an old reader can lose fields unknown to it.
  await assertSucceeds(setDoc(doc(db('player'),'users','player'),{name:'old replacement'}));
  const replaced=(await getDoc(doc(db('player'),'users','player'))).data();
  results.checks.push({scenario:'old client full replacement',privacyFieldRemains:'statsVisibility' in replaced,newFieldRemains:'newClientPrivacy' in replaced});
  await seed(async fs=>{
    await updateDoc(doc(fs,'groups','club'),{playerIds:['creator']});
    await updateDoc(doc(fs,'games','round'),{players:[],waitlist:['player'],participantIds:['player'],
      pendingPromotion:{uid:'player',offeredAt:Date.now()}});
  });
  const api=backendRequire('./lib/index.js');
  await assert.rejects(api.sendGameInvite.run({auth:{uid:'admin',token:{firebase:{sign_in_provider:'password'}}},
    data:{gameId:'round',recipientId:'player'}}), error=>error.code==='permission-denied');
  results.checks.push({scenario:'revoked admin sends stale invitation action',result:'permission-denied',checkedInsideTransaction:true});
  const reply=await api.resolveSpotOffer.run({auth:{uid:'player'},data:{gameId:'round',decision:'confirm'}});
  let assigned;
  await seed(async fs=>{assigned=(await getDoc(doc(fs,'games','round'))).data();});
  assert.equal(reply.changed,true);assert.equal(assigned.players.includes('player'),true);
  results.checks.push({scenario:'departed club member retains own waitlist offer',accepted:true,
    interpretation:'current backend preserves independent waitlist rights; policy decision required'});
  await backendRequire('firebase-admin').app().delete();
  console.log(JSON.stringify(results));
} finally {
  await env.cleanup();
  writeFileSync(new URL('navigation-permissions.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
}
