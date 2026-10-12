import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import admin from 'firebase-admin';
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-social-players';
process.env.FIREBASE_CONFIG = JSON.stringify({projectId:process.env.GCLOUD_PROJECT});
let api, db;
const call = (name,data={},uid='viewer') => api[name].run({auth:uid?{uid,token:{firebase:{sign_in_provider:'password'}}}:undefined,data});
const user = (id) => db.doc(`users/${id}`);
before(async()=>{api=await import('./lib/index.js');db=admin.firestore();});
after(async()=>{await Promise.all(admin.apps.map(a=>a.delete()));});
beforeEach(async()=>{
  await db.recursiveDelete(db.collection('users'));
  for(const name of ['groups','games','pairStats','gamePlayerStats','eveningStandings','friendRequests','notifications','serverRateLimits'])await db.recursiveDelete(db.collection(name));
  await user('viewer').set({name:'צופה',friends:[]});
  await user('target').set({name:'אִיתַי לוי',friends:[],email:'private@example.invalid',phone:'123',stats:{goals:4,assists:2},availability:{homeCity:'אור יהודה',homeLat:42,availabilitySlots:{3:['evening'],5:['morning']},preferredDays:[3,5],preferredTimes:['evening','morning']}});
});
test('search defaults, diacritics and allowlisted response never expose personal fields',async()=>{
  const result=await call('searchSocialPlayers',{text:'איתי'});
  assert.equal(result.players.length,1);assert.equal(result.players[0].city,'אור יהודה');
  const json=JSON.stringify(result);for(const secret of ['private@','phone','homeLat','stats','friends'])assert.ok(!json.includes(secret),secret);
  await user('target').update({socialPrivacy:{discoverable:false}});
  assert.deepEqual((await call('searchSocialPlayers')).players,[]);
});
test('availability respects actual day/time pairs and time without a day',async()=>{
  assert.equal((await call('searchSocialPlayers',{day:3,time:'morning'})).players.length,0);
  assert.equal((await call('searchSocialPlayers',{day:3,time:'evening'})).players.length,1);
  assert.equal((await call('searchSocialPlayers',{time:'morning'})).players.length,1);
  await user('target').update({'availability.isAvailableForInvites':false});
  assert.equal((await call('searchSocialPlayers',{time:'morning'})).players.length,0);
});
test('both directions of a block suppress search, profile, friendship and messages',async()=>{
  await db.doc('users/target/blocked/viewer').set({createdAt:1});
  assert.deepEqual((await call('searchSocialPlayers')).players,[]);
  for(const name of ['getSocialPlayerProfile','sendSocialFriendRequest','checkSocialMessaging'])await assert.rejects(call(name,{userId:'target'}));
});
test('statistics default to mutual friends; explicit onlyMe also hides from friends',async()=>{
  assert.equal((await call('getSocialPlayerProfile',{userId:'target'})).statistics,null);
  await user('viewer').update({friends:['target']});
  assert.equal((await call('getSocialPlayerProfile',{userId:'target'})).canSeeStatistics,false);
  await user('target').update({friends:['viewer']});
  assert.equal((await call('getSocialPlayerProfile',{userId:'target'})).statistics.stats.goals,4);
  await user('target').update({socialPrivacy:{statistics:'onlyMe'}});
  const result=await call('getSocialPlayerProfile',{userId:'target'});assert.equal(result.statistics,null);assert.equal(result.statisticsVisibility,'onlyMe');
  await user('target').update({socialPrivacy:{statistics:'everyone'}});
  await user('viewer').update({friends:[]});
  assert.equal((await call('getSocialPlayerProfile',{userId:'target'})).canSeeStatistics,true);
});
test('attendance excludes no-shows, counts confirmed historical rounds and keeps denominator',async()=>{
  await user('target').update({socialPrivacy:{statistics:'everyone'}});
  const game={players:['viewer','target'],participantIds:['viewer','target'],status:'finished',startsAt:100};
  await db.doc('games/played').set(game);await db.doc('games/no-show').set({...game,arrivals:{target:'no_show'}});
  await db.doc('games/not-played').set({...game,endedBy:'auto'});
  await db.doc('pairStats/target__viewer').set({a:'target',b:'viewer',sameTeam:5,winsTogether:3});
  const p=await call('getSocialPlayerProfile',{userId:'target'});
  assert.equal(p.statistics.stats.attendedGames,1);assert.equal(p.statistics.stats.totalRegistered,2);assert.equal(p.statistics.stats.attendanceRate,50);
  assert.equal(p.player.sharedRounds,1);assert.equal(p.together,null,'missing loss data must not become zero');
});
test('crossed requests create one mutual friendship; duplicate outgoing does not refresh its date',async()=>{
  await call('sendSocialFriendRequest',{userId:'target'});
  const ref=db.doc('friendRequests/viewer__target'),at=(await ref.get()).get('createdAt');
  await call('sendSocialFriendRequest',{userId:'target'});assert.equal((await ref.get()).get('createdAt'),at);
  await call('sendSocialFriendRequest',{userId:'viewer'},'target');
  assert.deepEqual((await user('viewer').get()).get('friends'),['target']);assert.deepEqual((await user('target').get()).get('friends'),['viewer']);
  await call('checkSocialMessaging',{userId:'target'});
  await user('viewer').update({friends:[]});await assert.rejects(call('checkSocialMessaging',{userId:'target'}));
});
test('club invitations are manager-only, consensual and idempotent for open and closed clubs',async()=>{
  for(const isOpen of [true,false]){
    const gid=isOpen?'open':'closed';await db.doc(`groups/${gid}`).set({name:gid,adminIds:['viewer'],playerIds:['viewer'],isOpen});
    assert.equal((await call('inviteSocialPlayerToClub',{groupId:gid,userId:'target'})).invited,true);
    assert.equal((await call('inviteSocialPlayerToClub',{groupId:gid,userId:'target'})).invited,false);
    const group=(await db.doc(`groups/${gid}`).get()).data();assert.deepEqual(group.playerIds,['viewer']);assert.equal(group.pendingPlayerIds,undefined);
    await assert.rejects(call('inviteSocialPlayerToClub',{groupId:gid,userId:'viewer'},'target'));
  }
  assert.equal((await db.collection('notifications').get()).size,2);
});
test('full account required and privacy updates cannot change server counters',async()=>{
  await assert.rejects(call('searchSocialPlayers',{},null));
  await assert.rejects(api.searchSocialPlayers.run({auth:{uid:'viewer',token:{firebase:{sign_in_provider:'anonymous'}}},data:{}}));
  await call('setSocialPrivacy',{discoverable:false,statistics:'everyone',stats:{goals:999}});
  assert.equal((await user('viewer').get()).get('stats'),undefined);assert.equal((await user('viewer').get()).get('dmFriendsOnly'),true);
});

test('legacy roster identities resolve even without mirrors and expose no private fields',async()=>{
  await user('target').update({socialPrivacy:{discoverable:false,statistics:'onlyMe'},createdAt:1234});
  const rows=await call('getPlayerIdentities',{userIds:['target','target','missing']});
  assert.equal(rows.length,1);assert.equal(rows[0].createdAt,1234);
  assert.deepEqual(Object.keys(rows[0]).sort(),['createdAt','id','name']);
  await assert.rejects(call('getPlayerIdentities',{userIds:['bad/path']}));
  await assert.rejects(call('getPlayerIdentities',{userIds:Array(101).fill('target')}));
  await assert.rejects(call('getPlayerIdentities',{userIds:['target']},null));
});

test('referral list and count are owner-scoped and paginated without downloading private docs',async()=>{
  const batch=db.batch();
  for(let i=0;i<101;i++)batch.set(user(`ref-${String(i).padStart(3,'0')}`),{name:'חדש',invitedBy:'viewer',invitedAt:i+1,invitedByType:'team',invitedByTargetId:'club',email:'secret',phone:'hidden'});
  await batch.commit();
  assert.equal((await call('getMyPlayerReferrals',{userId:'viewer',countOnly:true})).count,101);
  const first=await call('getMyPlayerReferrals',{userId:'viewer'});
  assert.equal(first.rows.length,100);assert.ok(first.cursor);
  const last=await call('getMyPlayerReferrals',{userId:'viewer',cursor:first.cursor});
  assert.equal(last.rows.length,1);assert.equal(last.cursor,null);
  assert.ok(!JSON.stringify(first).includes('secret'));assert.ok(!JSON.stringify(first).includes('phone'));
  await assert.rejects(call('getMyPlayerReferrals',{userId:'target'}));
});

test('available player matching derives location and exact time from a manager-owned round',async()=>{
  const startsAt=Date.parse('2026-10-14T17:00:00Z'); // Wednesday evening in Israel
  await db.doc('groups/club').set({name:'בדיקה',adminIds:['viewer'],playerIds:['viewer'],city:'אור יהודה',lat:32,lng:34});
  await db.doc('games/available').set({groupId:'club',createdBy:'viewer',startsAt,status:'open',players:['viewer']});
  await user('target').update({'availability.homeCityLat':32,'availability.homeCityLng':34,'availability.availabilityRadiusKm':5});
  let result=await call('findAvailableSocialPlayers',{gameId:'available',day:5,hour:'09:00',gameLat:0,gameLng:0});
  assert.equal(result.players.length,1);assert.equal(result.players[0].availability.preferredCity,'אור יהודה');
  const json=JSON.stringify(result);for(const secret of ['homeCityLat','homeCityLng','phone','stats','email'])assert.ok(!json.includes(secret));
  await assert.rejects(call('findAvailableSocialPlayers',{gameId:'available'},'target'));
  await user('target').update({'availability.availabilitySlots':{3:['morning'],5:['evening']}});
  assert.equal((await call('findAvailableSocialPlayers',{gameId:'available'})).players.length,0);
  await user('target').update({'availability.availabilitySlots':{3:['evening']},'availability.homeCityLat':33});
  assert.equal((await call('findAvailableSocialPlayers',{gameId:'available'})).players.length,0);
});
test('pagination advances through a whole hidden page and finds a later result',async()=>{
  const batch=db.batch();for(let i=0;i<250;i++)batch.set(user(`a${String(i).padStart(3,'0')}`),{name:'מוסתר',socialPrivacy:{discoverable:false}});await batch.commit();
  const first=await call('searchSocialPlayers',{text:'איתי'});assert.equal(first.players.length,0);assert.ok(first.cursor);
  let page=first,pages=1;const cursors=new Set([first.cursor]);
  while(page.cursor){page=await call('searchSocialPlayers',{text:'איתי',cursor:page.cursor});pages++;if(page.cursor){assert.ok(!cursors.has(page.cursor));cursors.add(page.cursor);}assert.ok(pages<=8);}
  assert.equal(pages,7);assert.equal(page.players[0].id,'target');assert.equal(page.cursor,null);
});
test('acceptance cannot revive a deleted request or create a deleted user',async()=>{
  await call('sendSocialFriendRequest',{userId:'target'});
  await user('viewer').delete();
  await assert.rejects(call('acceptFriendRequest',{fromUserId:'viewer'},'target'));
  assert.equal((await user('viewer').get()).exists,false);
  assert.deepEqual((await user('target').get()).get('friends'),[]);
});
