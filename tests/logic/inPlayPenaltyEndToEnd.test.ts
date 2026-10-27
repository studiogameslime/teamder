import {liveTeamsEndToEndWorld} from '../helpers/liveTeamsEndToEndWorld';
import {roundCommitKey} from '@/services/rotationEngine';
import {inPlayPenaltyFingerprint} from '@/utils/inPlayPenalty';
import {verifiedInPlayPenalties,inPlayPenaltyFingerprint as serverFingerprint} from '../../functions/src/inPlayPenalties';
import {resetLiveForTeamChange} from '@/utils/liveTeamsEdit';
import type {InPlayPenalty} from '@/types';

type World=ReturnType<typeof liveTeamsEndToEndWorld>;
const event=(id:string,outcome:InPlayPenalty['outcome']='goal',team:'A'|'B'='A'):InPlayPenalty=>({id,team,
  kickerId:team==='A'?'t0-p0':'t1-p0',keeperId:team==='A'?'t1-p1':'t0-p1',outcome,minute:3,clockMs:142000,at:3000});
const save=(w:World,p:InPlayPenalty,previous?:InPlayPenalty)=>w.service.saveInPlayPenalty('audit',p,{id:p.id,roundId:roundCommitKey(w.read().rotation!),previous});
const commit=(w:World)=>w.service._commitRoundStatsAndClear('audit',w.read().liveMatch,w.read().rotation,w.read().draftTeams,'A');

test('overtime event time survives real persistence, conversion and round history',async()=>{
 const w=liveTeamsEndToEndWorld();w.state().matchDurationMinutes=8;
 const p={...event('overtime'),minute:11,clockMs:630000};
 await save(w,p);
 expect(w.read().liveMatch!.inPlayPenalties).toEqual([p]);
 expect(w.read().liveMatch!.goals!.find((g:{penaltyId?:string})=>g.penaltyId===p.id)).toMatchObject({minute:11});
 await commit(w);
 expect(w.history()[0].inPlayPenalties).toEqual([p]);
 expect(w.history()[0].goals.find((g:any)=>g.penaltyId===p.id)).toMatchObject({minute:11});
});

test('regulation goal and shootout goal share totals but only regulation credits a match goal, across real converters and callable',async()=>{
  const w=liveTeamsEndToEndWorld();const baseGoals=w.read().liveMatch!.goals!.length;
  const p=event('p1');await save(w,p);await save(w,p);
  expect(w.read().liveMatch!.inPlayPenalties).toEqual([p]);
  expect(w.read().liveMatch!.goals).toHaveLength(baseGoals+1);
  w.state().liveMatch.shootout={firstTeam:'A',kicks:[{id:'s1',team:'A',kickerId:p.kickerId,keeperId:p.keeperId,scored:true,outcome:'goal',at:4000}]};
  await commit(w);
  expect(w.documents.get('communityPlayerStats/club__t0-p0')).toMatchObject({goals:2,penTaken:2,penScored:2,penMissed:0,penInPlayTaken:1,penInPlayScored:1});
  expect(w.documents.get('users/t0-p0').stats).toMatchObject({penScored:2,penInPlayScored:1});
  expect(w.documents.get('gamePlayerStats/audit__t0-p0')).toMatchObject({penScored:2,penInPlayScored:1});
  expect(w.documents.get('communityStats/club')).toMatchObject({inPlayPenalties:1,shootoutRounds:1});
  expect(w.history()[0].inPlayPenalties).toEqual([p]);
  expect(w.history()[0].goals.filter((g:any)=>g.penaltyId==='p1')).toHaveLength(1);
  expect(w.read().liveMatch!.inPlayPenalties).toEqual([]);
  const saved=structuredClone(w.documents.get('communityStats/club'));await commit(w);expect(w.documents.get('communityStats/club')).toEqual(saved);
});

test.each(['save','miss'] as const)('%s feeds existing missed/saved counters without changing score',async outcome=>{
  const w=liveTeamsEndToEndWorld(),before=w.read().liveMatch!,p=event('miss',outcome);await save(w,p);
  expect(w.read().liveMatch).toMatchObject({scoreA:before.scoreA,scoreB:before.scoreB});await commit(w);
  expect(w.documents.get('communityPlayerStats/club__t0-p0')).toMatchObject({penTaken:1,penScored:0,penMissed:1,penInPlayTaken:1,penInPlayScored:0});
  expect(w.documents.get('communityPlayerStats/club__t1-p1')).toMatchObject({penFaced:1,penSaved:outcome==='save'?1:0,penConceded:0});
});

test('editing goal into save and deleting it corrects score, log and badges atomically',async()=>{
  const w=liveTeamsEndToEndWorld(),before=w.read().liveMatch!,p=event('edit');await save(w,p);
  const edited={...p,outcome:'save' as const};await save(w,edited,p);await save(w,edited,p);
  expect(w.read().liveMatch).toMatchObject({scoreA:before.scoreA,scoreB:before.scoreB,goals:before.goals,goalTally:before.goalTally});
  await expect(save(w,{...edited,outcome:'miss'},p)).rejects.toThrow('עודכן במכשיר אחר');
  await w.service.saveInPlayPenalty('audit',null,{id:p.id,roundId:'first',previous:edited});
  expect(w.read().liveMatch!.inPlayPenalties).toEqual([]);await commit(w);
  expect(w.documents.get('communityStats/club').inPlayPenalties).toBe(0);
});

test('goal undo also removes the linked attempt',async()=>{
  const w=liveTeamsEndToEndWorld(),p=event('undo');await save(w,p);await w.service.removeGoal('audit','goal_undo');
  expect(w.read().liveMatch!.inPlayPenalties).toEqual([]);
});

test('unknown keeper and guest kicker still count a club attempt without inventing a real scorer',async()=>{
  const w=liveTeamsEndToEndWorld(),game=w.state();game.guests=[{id:'visitor',name:'אורח'}];game.draftTeams.teams[0].playerIds.push('guest:visitor');
  const p={...event('guest'),kickerId:'guest:visitor',keeperId:null};await save(w,p);await commit(w);
  expect(w.documents.get('communityStats/club')).toMatchObject({inPlayPenalties:1,guestGoals:1});
  expect(w.documents.has('users/guest:visitor')).toBe(false);expect(w.history()[0].inPlayPenalties).toEqual([p]);
});

test('substituted kicker and keeper retain their attempt statistics',async()=>{
  const w=liveTeamsEndToEndWorld(),p=event('sub','save');await save(w,p);
  w.state().draftTeams.teams[0].playerIds=w.state().draftTeams.teams[0].playerIds.filter((id:string)=>id!==p.kickerId);
  w.state().draftTeams.teams[1].playerIds=w.state().draftTeams.teams[1].playerIds.filter((id:string)=>id!==p.keeperId);
  await commit(w);expect(w.documents.get('communityPlayerStats/club__t0-p0').penMissed).toBe(1);
  expect(w.documents.get('communityPlayerStats/club__t1-p1').penSaved).toBe(1);
});

test('failed commit preserves attempts and lost acknowledgement never duplicates counters',async()=>{
  const w=liveTeamsEndToEndWorld(),p=event('retry');await save(w,p);w.fail();await expect(commit(w)).rejects.toThrow();
  expect(w.read().liveMatch!.inPlayPenalties).toEqual([p]);expect(w.history()).toHaveLength(0);
  w.fail(false);const captured=w.read();w.loseAck();await expect(w.service._commitRoundStatsAndClear('audit',captured.liveMatch,captured.rotation,captured.draftTeams,'A')).rejects.toThrow();
  await w.service._commitRoundStatsAndClear('audit',captured.liveMatch,captured.rotation,captured.draftTeams,'A');
  expect(w.documents.get('communityStats/club').inPlayPenalties).toBe(1);
});

test('old clients and stale snapshots cannot erase a new missed penalty',async()=>{
  const w=liveTeamsEndToEndWorld();await save(w,event('late','miss'));const g=w.read();
  await expect(w.rawCall({gameId:'audit',roundId:'first',sideA:g.draftTeams!.teams[0].playerIds,sideB:g.draftTeams!.teams[1].playerIds,
    winnerSide:'A',liveGoalIds:g.liveMatch!.goals!.map((x:{id:string})=>x.id),penalties:[],rotationUpdatedAt:g.rotation!.updatedAt})).rejects.toThrow();
  expect(w.read().liveMatch!.inPlayPenalties).toHaveLength(1);expect(w.history()).toHaveLength(0);
});

test('team replacement clears attempts, and both fingerprint implementations agree',async()=>{
  const w=liveTeamsEndToEndWorld(),p=event('reset');await save(w,p);
  expect(inPlayPenaltyFingerprint([p])).toBe(serverFingerprint([p]));
  const cleared=resetLiveForTeamChange(w.read().liveMatch,'owner','מנהל',10000);expect(cleared.inPlayPenalties).toEqual([]);
  expect(()=>verifiedInPlayPenalties({inPlayPenalties:[p],goals:[]},serverFingerprint([p]))).toThrow('disagree');
});
