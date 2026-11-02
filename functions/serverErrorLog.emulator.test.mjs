import {test,before,beforeEach,after} from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8080','Never run against a live database');
process.env.GCLOUD_PROJECT='demo-server-errors';
let db,report;
before(async()=>{
  admin.initializeApp({projectId:process.env.GCLOUD_PROJECT});db=admin.firestore();
  report=(await import('./lib/serverErrorLog.js')).reportServerError;
});
beforeEach(async()=>db.recursiveDelete(db.collection('errors')));
after(async()=>Promise.all(admin.apps.map(app=>app.delete())));
test('real Firestore persists recurring server incidents without transforms inside occurrence arrays',async()=>{
  for(let index=0;index<4;index++){
    await report({operation:'emulatorOccurrence',err:new Error('database unavailable'),context:{groupId:'club',attempt:index}});
    if(index===0){
      const rows=await db.collection('errors').get();assert.equal(rows.size,1);
      await rows.docs[0].ref.update({status:'reviewed',claudeNote:'נבדק'});
    }
  }
  const rows=await db.collection('errors').get();assert.equal(rows.size,1);
  const incident=rows.docs[0].data();
  assert.equal(incident.count,4);assert.equal(incident.status,'reviewed');assert.equal(incident.claudeNote,'נבדק');
  assert.equal(typeof incident.lastSeen.toMillis(),'number');
  assert.equal(typeof incident.firstSeen.toMillis(),'number');
  assert.equal(incident.occurrences.length,3);
  for(const occurrence of incident.occurrences){
    assert.equal(typeof occurrence.capturedAt,'number');
    assert.equal(occurrence.lastSeen,occurrence.capturedAt);
  }
  assert.deepEqual(incident.occurrences.map(row=>row.lastContext.attempt),[0,2,3]);
});
