import {liveTeamsEndToEndWorld} from '../helpers/liveTeamsEndToEndWorld';
import {liveTeamsEditContext} from '@/utils/liveTeamsEdit';
import {roundCommitKey,applyChosenFill,rosterOf} from '@/services/rotationEngine';
import {didEveningHappen} from '@/utils/eveningPlayed';

type World=ReturnType<typeof liveTeamsEndToEndWorld>;
const actor={userId:'owner',userName:'מנהל'};
async function next(w:World){const result=await w.service.prepareRoundResult('audit','owner');expect(result?.outcome).toBe('A');
 const s=result.skeleton;await w.service.commitFilledRotation('audit',result.draft,{rotation:s.rotation,teams:s.teams},undefined,actor,s.source);}
async function replace(w:World,playing:[number,number]=[2,3],waiting=[1,0]){
 await w.service.saveLiveTeamsEdit('audit',{playing,waiting},liveTeamsEditContext(w.read()),actor);
}
async function goal(w:World,team:'A'|'B',scorerId:string|null,assisterId?:string,ownGoal=false){
 await w.service.recordGoal('audit',{team,scorerId,assisterId,ownGoal,minute:2,expectedRoundId:roundCommitKey(w.read().rotation!)});
}
async function finish(w:World){await w.service.endEvening('audit');await w.finishStages();}
const rows=(w:World,prefix:string)=>[...w.documents.entries()].filter(([p])=>p.startsWith(prefix)).map(([,v])=>v);

test.each([3,4,5,6,7,8,9,10,11])('%s-a-side: saved first game, discarded second, replacement and full evening summaries agree',async size=>{
 const w=liveTeamsEndToEndWorld(size);await next(w);const first=structuredClone(w.history()[0]);
 const discarded=roundCommitKey(w.read().rotation!);
 await goal(w,'A','t0-p0','t0-p1');
 Object.assign(w.state().liveMatch,{timerAccumulatedMs:60000,shootout:{firstTeam:'A',kicks:[{id:'discarded-penalty',team:'A',kickerId:'t0-p0',keeperId:'t2-p0',outcome:'save',scored:false,at:1}]}});
 await replace(w);expect(roundCommitKey(w.read().rotation!)).not.toBe(discarded);
 expect(w.read().rotation!.round).toBe(2);expect(w.read().liveMatch!.goalTally).toEqual({'t0-p0':1});
 await goal(w,'B','t3-p0','t3-p1');await finish(w);
 const history=await w.service.getRoundHistory('audit');expect(history).toHaveLength(2);expect(history[0]).toMatchObject(first);
 expect(history[1]).toMatchObject({teamAIndex:2,teamBIndex:3,scoreA:0,scoreB:1,winnerSide:'B'});
 expect(history[1].teamA).toContain('t2-p0');expect(history[1].teamB).toContain('t3-p0');expect(history[1].penalties??[]).toEqual([]);
 expect(w.documents.has(`games/audit/roundHistory/${discarded}`)).toBe(false);
 const club=w.documents.get('communityStats/club');expect(club).toMatchObject({rounds:2,goals:2});expect(club.shootoutRounds??0).toBe(0);
 const gps=rows(w,'gamePlayerStats/');expect(gps.reduce((sum,p)=>sum+p.rounds,0)).toBe(4*size);
 expect(gps.reduce((sum,p)=>sum+(p.goals??0),0)).toBe(2);expect(gps.reduce((sum,p)=>sum+(p.assists??0),0)).toBe(2);
 expect(w.documents.get('users/t0-p0').stats.goals).toBe(1);expect(w.documents.get('users/t3-p0').stats.goals).toBe(1);
 expect(w.documents.get('users/t2-p0')?.stats?.penSaved??0).toBe(0);
 for(let t=0;t<4;t++)for(let p=0;p<size;p++){
  const uid=`t${t}-p${p}`,gps=w.documents.get(`gamePlayerStats/audit__${uid}`),cps=w.documents.get(`communityPlayerStats/club__${uid}`);
  expect(cps).toMatchObject({rounds:1,games:1,csRounds:1,asRounds:1});expect(gps).toMatchObject({rounds:1,teamScoreRounds:1});
  const summary=await w.summaryService.getEveningSummary('audit',uid);
  expect(summary).toMatchObject({rounds:1,totalRounds:2,totalKnown:true,teamGoalsKnown:true,wins:t===0||t===3?1:0,losses:t===1||t===2?1:0,winRate:t===0||t===3?100:0});
  expect(summary.outcomes).toEqual([t===0||t===3?'win':'loss']);expect(summary.teamGoalsFor).toBe(t===0||t===3?1:0);
 }
 expect((await w.roundSummaryService.get('audit','club')).stats).toEqual({rounds:2,goals:2,assists:2,shootouts:0,ties:0});
 expect(w.documents.get('clubRecords/club').eveningsSealed).toBe(1);
 expect(w.documents.get('communityPairStats/club__t0-p0__t0-p1')).toMatchObject({sameTeam:1,winsTogether:1,assistsAToB:0,assistsBToA:1});
 expect(w.documents.has('communityPairStats/club__t0-p0__t2-p0')).toBe(false);
 const stable=()=>[...w.documents].filter(([path])=>path!=='games/audit/finishStages/complete');
 const saved=structuredClone(stable());await finish(w);await w.finishStages();expect(stable()).toEqual(saved);
});

test.each([false,true])('ending immediately after reset creates no fictitious 0:0 (prior saved game=%s)',async prior=>{
 const w=liveTeamsEndToEndWorld();if(prior)await next(w);
 await replace(w);await finish(w);
 expect(w.history()).toHaveLength(prior?1:0);expect(w.documents.get('roundSummaries/audit').stats.rounds).toBe(prior?1:0);
 expect(w.documents.get('communityStats/club')?.rounds??0).toBe(prior?1:0);
 expect(didEveningHappen(w.read())).toBe(true);
 expect(w.documents.get('communityPlayerStats/club__t3-p0')).toMatchObject({games:1});
 expect(w.documents.get('communityPlayerStats/club__t3-p0').rounds??0).toBe(0);
});

test('queue-only edit preserves the result and original players through direct evening finish',async()=>{
 const w=liveTeamsEndToEndWorld();const key=roundCommitKey(w.read().rotation!);
 await w.service.saveLiveTeamsEdit('audit',{playing:[0,1],waiting:[3,2]},liveTeamsEditContext(w.read()),actor);
 expect(roundCommitKey(w.read().rotation!)).toBe(key);await finish(w);
 expect(w.history()).toHaveLength(1);expect(w.history()[0]).toMatchObject({roundId:key,teamAIndex:0,teamBIndex:1,scoreA:1,scoreB:0});
 expect(w.documents.get('roundSummaries/audit').stats).toMatchObject({rounds:1,goals:1,assists:1});
});

test('swapping A/B of the same two teams resets their old events and reverses the saved attribution',async()=>{
 const w=liveTeamsEndToEndWorld();await replace(w,[1,0],[2,3]);await goal(w,'A','t1-p0');await finish(w);
 expect(w.history()[0]).toMatchObject({teamAIndex:1,teamBIndex:0,scoreA:1,scoreB:0});
 expect(w.documents.get('users/t0-p0')?.stats?.goals??0).toBe(0);expect(w.documents.get('users/t1-p0').stats.goals).toBe(1);
});

test.each(['clock','goalless-shootout','own-goal','unknown-goal'] as const)('post-reset %s is retained with the correct statistical meaning',async scenario=>{
 const w=liveTeamsEndToEndWorld();await replace(w);
 if(scenario==='clock')w.state().liveMatch.timerAccumulatedMs=10000;
 if(scenario==='goalless-shootout')w.state().liveMatch.shootout={firstTeam:'A',kicks:[{id:'p',team:'A',kickerId:'t2-p0',keeperId:'t3-p0',outcome:'save',scored:false,at:5}]};
 if(scenario==='own-goal')await goal(w,'A','t3-p0',undefined,true);
 if(scenario==='unknown-goal')await goal(w,'A',null);
 await finish(w);expect(w.history()).toHaveLength(1);
 const history=w.history()[0],stats=w.documents.get('roundSummaries/audit').stats;
 expect(history).toMatchObject({teamAIndex:2,teamBIndex:3,scoreA:scenario==='own-goal'||scenario==='unknown-goal'?1:0,scoreB:0});
 expect(stats.rounds).toBe(1);expect(stats.goals).toBe(scenario==='own-goal'||scenario==='unknown-goal'?1:0);
 if(scenario==='goalless-shootout'){expect(w.documents.get('gamePlayerStats/audit__t3-p0')).toMatchObject({penSaved:1});expect(stats.shootouts).toBe(1);}
 if(scenario==='own-goal')expect(w.documents.get('gamePlayerStats/audit__t3-p0')).toMatchObject({ownGoals:1});
 expect(rows(w,'gamePlayerStats/').reduce((s,p)=>s+(p.goals??0),0)).toBe(0);
});

test.each(['temporary','permanent','balanced'] as const)('%s filler receives only the replacement appearance and his actual goal',async mode=>{
 const w=liveTeamsEndToEndWorld();w.state().draftTeams.teams[2].playerIds.pop();w.state().draftTeams.fillMode=mode==='permanent'?'permanent':'temporary';
 if(mode==='balanced')w.state().draftTeams.completionMode='balanced';
 const plan={playing:[2,3],waiting:[0,1]},context=liveTeamsEditContext(w.read());const prepared=await w.service.prepareLiveTeamsEdit('audit',plan,context);
 const filled=applyChosenFill(prepared.skeleton.teams,prepared.skeleton.rotation.loans,2,['t1-p0'],prepared.skeleton.fillMode);
 await w.service.saveLiveTeamsEdit('audit',plan,context,actor,filled);
 expect(rosterOf(2,w.read().draftTeams!.teams,w.read().rotation!.loans)).toContain('t1-p0');
 await goal(w,'A','t1-p0','t2-p0');await finish(w);
 expect(w.history()[0].teamA).toContain('t1-p0');expect(w.documents.get('gamePlayerStats/audit__t1-p0')).toMatchObject({rounds:1,goals:1,wins:1});
 expect(w.documents.get('communityPlayerStats/club__t1-p0')).toMatchObject({rounds:1,goals:1,games:1});
 expect((await w.summaryService.getEveningSummary('audit','t1-p0')).outcomes).toEqual(['win']);
});

test('a guest in the new team is counted in this evening but creates no lifetime account or club-ranked row',async()=>{
 const w=liveTeamsEndToEndWorld();w.state().guests=[{id:'visitor',name:'אורח',addedBy:'owner',createdAt:1}];
 w.state().players=w.state().players.filter((id:string)=>id!=='t2-p0');w.state().draftTeams.teams[2].playerIds[0]='guest:visitor';
 await replace(w);await goal(w,'A','guest:visitor','t2-p1');await finish(w);
 expect(w.history()[0].teamA).toContain('guest:visitor');expect(w.documents.get('gamePlayerStats/audit__guest:visitor')).toMatchObject({rounds:1,wins:1,goals:1,isGuest:true});
 expect(w.documents.has('users/guest:visitor')).toBe(false);expect(w.documents.has('communityPlayerStats/club__guest:visitor')).toBe(false);
 expect(w.documents.get('roundSummaries/audit').stats).toMatchObject({rounds:1,goals:1,assists:1});
});

test.each(['failure','lost-ack'] as const)('final result %s can be retried without double-crediting the replacement',async failure=>{
 const w=liveTeamsEndToEndWorld();await replace(w);await goal(w,'A','t2-p0');
 if(failure==='failure')w.fail();else w.loseAck();await expect(w.service.endEvening('audit')).rejects.toThrow();expect(w.state().status).toBe('active');
 w.fail(false);await finish(w);await finish(w);
 expect(w.history()).toHaveLength(1);expect(w.documents.get('communityStats/club')).toMatchObject({rounds:1,goals:1});
 expect(w.documents.get('communityPlayerStats/club__t2-p0')).toMatchObject({rounds:1,goals:1,games:1,eveningScoreCount:1});
});

test.each(['games/audit/finishCredited/once','games/audit/finishStages/standings','roundSummaries/audit','communityPairRollups/club__audit/chunks/0'])('finish recovery at %s preserves statistics and resumes its missing summaries',async path=>{
 const w=liveTeamsEndToEndWorld();await replace(w);await goal(w,'A','t2-p0','t2-p1');await w.service.endEvening('audit');
 w.failAt(path);await expect(w.finishStages()).rejects.toThrow('UNAVAILABLE');w.failAt();await w.finishStages();await w.finishStages();
 expect(w.documents.get('communityPlayerStats/club__t2-p0')).toMatchObject({goals:1,rounds:1,games:1,eveningScoreCount:1});
 expect(w.documents.get('clubRecords/club').eveningsSealed).toBe(1);
 expect(w.documents.get('communityPairStats/club__t2-p0__t2-p1')).toMatchObject({sameTeam:1,winsTogether:1});
 expect((await w.roundSummaryService.get('audit','club')).stats).toMatchObject({rounds:1,goals:1,assists:1});
});

test('several replacements discard all intermediate events, then one saved game advances once',async()=>{
 const w=liveTeamsEndToEndWorld();await replace(w,[0,2],[3,1]);await goal(w,'B','t2-p0');
 await replace(w,[3,2],[1,0]);await goal(w,'A','t3-p0');await replace(w,[1,0],[2,3]);await goal(w,'A','t1-p0');
 await next(w);await finish(w);expect(w.history()).toHaveLength(1);
 expect(w.documents.get('communityStats/club')).toMatchObject({rounds:1,goals:1});
 expect(w.documents.get('gamePlayerStats/audit__t2-p0')).toBeUndefined();expect(w.documents.get('gamePlayerStats/audit__t3-p0')).toBeUndefined();
 expect(w.documents.get('roundSummaries/audit').stats).toMatchObject({rounds:1,goals:1});
});

test('a drawn replacement saved with both-out is one draw in history, summaries, and every player denominator',async()=>{
 const w=liveTeamsEndToEndWorld();await replace(w);w.state().liveMatch.timerAccumulatedMs=10000;
 const result=await w.service.prepareRoundResult('audit','owner',undefined,'bothOut');const s=result.skeleton;
 await w.service.commitFilledRotation('audit',result.draft,{rotation:s.rotation,teams:s.teams},undefined,actor,s.source);await finish(w);
 expect(w.history()).toHaveLength(1);expect(w.history()[0].winnerSide).toBe('tie');
 expect(w.documents.get('communityStats/club')).toMatchObject({rounds:1,tiedRounds:1});
 expect((await w.summaryService.getEveningSummary('audit','t2-p0'))).toMatchObject({rounds:1,wins:0,losses:0,winRate:0,outcomes:['draw']});
 expect(w.documents.get('roundSummaries/audit').stats).toMatchObject({rounds:1,ties:1,goals:0});
});

test('sealed old season data remains unchanged while current evening credit reaches the running club table',async()=>{
 const w=liveTeamsEndToEndWorld();const archive={groupId:'club',seasonId:'s1',totals:{goals:20,rounds:10,assists:8},players:{'t2-p0':{goals:12,rounds:10,games:3}}};
 w.documents.set('seasonSummary/club__s1',structuredClone(archive));
 await replace(w);await goal(w,'A','t2-p0');await finish(w);
 expect(w.documents.get('seasonSummary/club__s1')).toEqual(archive);
 expect(w.documents.get('communityPlayerStats/club__t2-p0')).toMatchObject({goals:1,rounds:1,games:1});
 expect(w.documents.get('roundSummaries/audit').correctionBasis.career.find((p:any)=>p.userId==='t2-p0')).toMatchObject({goals:13,rounds:11,games:4});
});

test('an unchanged evening remains the baseline for the same callable, finish stages and readers',async()=>{
 const w=liveTeamsEndToEndWorld();
 await w.service.endEvening('audit');
 await w.finishStages();
 expect(w.history()).toHaveLength(1);
 expect(w.documents.get('communityPlayerStats/club__t0-p0')).toMatchObject({goals:1,rounds:1,games:1});
 const summary=await w.summaryService.getEveningSummary('audit','t0-p0');
 expect(summary).toMatchObject({goals:1,rounds:1,totalRounds:1});
 expect(await w.service.getRoundHistory('audit')).toHaveLength(1);
});

test('a late server request from the discarded game cannot pollute the replacement statistics or history',async()=>{
 const w=liveTeamsEndToEndWorld();w.fail();await expect(w.service.endEvening('audit')).rejects.toThrow();const oldPayload=w.payloads[0];w.fail(false);
 await replace(w);await expect(w.rawCall(oldPayload)).rejects.toMatchObject({code:'failed-precondition'});
 expect(w.history()).toHaveLength(0);expect(rows(w,'gamePlayerStats/')).toHaveLength(0);
 await goal(w,'B','t3-p0');await finish(w);expect(w.history()).toHaveLength(1);expect(w.documents.get('communityStats/club')).toMatchObject({goals:1,rounds:1});
});

test('previous personal and club counters receive only the new result delta, and no-show attendance stays excluded',async()=>{
 const w=liveTeamsEndToEndWorld();
 w.documents.set('users/t2-p0',{stats:{goals:20,assists:7,wins:8,cleanSheets:5}});
 w.documents.set('communityPlayerStats/club__t2-p0',{userId:'t2-p0',groupId:'club',goals:10,rounds:8,games:4,wins:3,cleanSheets:2,csRounds:8,asRounds:8});
 w.documents.set('communityStats/club',{groupId:'club',rounds:25,goals:60});
 w.state().arrivals={'t1-p0':'no_show'};
 await replace(w);await goal(w,'A','t2-p0');await finish(w);
 expect(w.documents.get('users/t2-p0').stats).toMatchObject({goals:21,assists:7,wins:9,cleanSheets:6});
 expect(w.documents.get('communityPlayerStats/club__t2-p0')).toMatchObject({goals:11,rounds:9,games:5,wins:4,cleanSheets:3,csRounds:9,asRounds:9});
 expect(w.documents.get('communityStats/club')).toMatchObject({rounds:26,goals:61});
 expect(w.documents.has('communityPlayerStats/club__t1-p0')).toBe(false);
 expect((await w.summaryService.getEveningSummary('audit','t2-p0'))).toMatchObject({rounds:1,totalRounds:1,goals:1,wins:1});
});
