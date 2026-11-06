import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080');
process.env.GCLOUD_PROJECT='demo-night-invite-commit';
process.env.FIREBASE_CONFIG=JSON.stringify({projectId:process.env.GCLOUD_PROJECT});
const req=createRequire(new URL('../../../functions/package.json',import.meta.url));
const api=req('./lib/index.js');
const admin=req('firebase-admin'),db=admin.firestore();
const call=(name,data)=>api[name].run({auth:{uid:'manager',token:{firebase:{sign_in_provider:'password'}}},data});
try{
  const results=[];
  for(const type of ['club','game']){
    for(const key of ['users','games','groups','notifications','serverRateLimits'])await db.recursiveDelete(db.collection(key));
    await db.doc('users/manager').set({name:'manager'});
    await db.doc('users/invitee').set({name:'invitee'});
    await db.doc('groups/club').set({adminIds:['manager'],playerIds:['manager'],name:'fixture',isOpen:false});
    await db.doc('games/game').set({createdBy:'manager',groupId:'club',status:'open',visibility:'community',startsAt:Date.now()+3600000,players:[],waitlist:[],pending:[]});
    const original=db.runTransaction;
    const beforeCommit=type==='club'?2:1; // Club first opens a rate-limit/session transaction.
    let count=0;
    db.runTransaction=async function(...args){
      if(++count===beforeCommit)await db.doc('users/invitee/blocked/manager').set({at:Date.now()});
      return original.apply(this,args);
    };
    try{
      const action=type==='club'?call('inviteSocialPlayerToClub',{groupId:'club',userId:'invitee'}):call('sendGameInvite',{gameId:'game',recipientId:'invitee'});
      const sent=await action.then(r=>r.invited).catch(e=>e.code);
      results.push({type,insertedBlock:count>=beforeCommit,sent,notices:(await db.collection('notifications').get()).size});
    }finally{db.runTransaction=original;}
  }
  console.log(JSON.stringify(results));
}finally{await Promise.all(admin.apps.map(a=>a.delete()));}
