import {liveTeamsEndToEndWorld} from '../helpers/liveTeamsEndToEndWorld';
import {recordTieSkeleton,roundCommitKey} from '@/services/rotationEngine';
import {drawRotationPreview} from '@/utils/drawRotationPreview';
import {roundDecisionContext} from '@/utils/roundDecision';

const actor={userId:'owner',userName:'מנהל'};
function fixture(count:number,score=0){
 const w=liveTeamsEndToEndWorld();const g=w.state();
 g.draftTeams.teams=g.draftTeams.teams.slice(0,count);g.rotation.baseTeams=g.rotation.baseTeams.slice(0,count);
 g.rotation.waiting=count===3?[2]:[];g.numberOfTeams=count;g.players=g.draftTeams.teams.flatMap((t:any)=>t.playerIds);
 Object.assign(g.liveMatch,{scoreA:score,scoreB:score,goals:score?[{id:'a',team:'A',scorerId:'t0-p0',at:1,minute:1},{id:'b',team:'B',scorerId:'t1-p0',at:2,minute:2}]:[],goalTally:score?{'t0-p0':1,'t1-p0':1}:{},timerAccumulatedMs:60000});
 return w;
}
test.each(['stayA','stayB','keepPlaying'] as const)('%s records one club draw and player draws, preserves events, and advances without a winner',async mode=>{
 const count=mode==='keepPlaying'?2:3,w=fixture(count,1);
 const result=await w.service.prepareRoundResult('audit','owner',undefined,mode,false,undefined,roundDecisionContext(w.read()));
 expect(result.outcome).toBe('tie');
 expect(w.history()).toHaveLength(1);expect(w.history()[0]).toMatchObject({scoreA:1,scoreB:1,winnerSide:'tie'});
 expect(w.history()[0].goals).toHaveLength(2);
 expect(w.documents.get('communityStats/club')).toMatchObject({rounds:1,tiedRounds:1,goals:2});
 for(const uid of ['t0-p0','t1-p0']){
  expect(w.documents.get(`communityPlayerStats/club__${uid}`)).toMatchObject({rounds:1,ties:1,goals:1});
  expect(w.documents.get(`gamePlayerStats/audit__${uid}`)).toMatchObject({rounds:1,ties:1});
  expect(w.documents.get(`users/${uid}`).stats).toMatchObject({ties:1,goals:1});
  expect(w.documents.get(`users/${uid}`).stats.wins??0).toBe(0);
  expect(w.documents.get(`communityPlayerStats/club__${uid}`).losses??0).toBe(0);
 }
 expect(w.documents.has('gamePlayerStats/audit__t2-p0')).toBe(false);
 for(const uid of w.state().players.filter((id:string)=>!id.startsWith('t2-'))){
  expect(w.documents.get(`communityPlayerStats/club__${uid}`)).toMatchObject({rounds:1,ties:1});
  expect(w.documents.get(`gamePlayerStats/audit__${uid}`)).toMatchObject({rounds:1,ties:1});
  expect(w.documents.get(`users/${uid}`).stats.ties).toBe(1);
 }
 const retry=await w.service.prepareRoundResult('audit','owner','A',undefined,true);
 expect(retry.outcome).toBe('tie');expect(retry.skeleton.playing).toEqual(result.skeleton.playing);
 expect(w.documents.get('communityStats/club').tiedRounds).toBe(1);
 await w.service.commitFilledRotation('audit',retry.draft,{rotation:retry.skeleton.rotation,teams:retry.skeleton.teams},undefined,actor,retry.skeleton.source);
 expect(w.read().rotation!.playing).toEqual(mode==='stayA'?[0,2]:mode==='stayB'?[2,1]:[0,1]);
 expect(w.read().rotation!.wins).toEqual({});
 expect(w.read().liveMatch).toMatchObject({scoreA:0,scoreB:0,timerAccumulatedMs:0,timerRunning:false});
 expect(w.read().rotation!.round).toBe(2);
 expect(await w.service.getRoundHistory('audit')).toHaveLength(1);
});
test('an acknowledgement lost after a saved draw recovers its original staying choice without another tally',async()=>{
 const w=fixture(3);w.loseAck();
 await expect(w.service.prepareRoundResult('audit','owner',undefined,'stayB')).rejects.toThrow('ACK_LOST');
 const retry=await w.service.prepareRoundResult('audit','owner',undefined,'stayA');
 expect(retry.skeleton.playing).toEqual([2,1]);expect(w.history()).toHaveLength(1);
 expect(w.documents.get('communityStats/club')).toMatchObject({rounds:1,tiedRounds:1});
});
test('a failed result write preserves the game, history and statistics for retry',async()=>{
 const w=fixture(3,1),before=structuredClone(w.read());w.fail();
 await expect(w.service.prepareRoundResult('audit','owner',undefined,'stayA')).rejects.toThrow();
 expect(w.read()).toEqual(before);expect(w.history()).toEqual([]);expect(w.documents.has('communityStats/club')).toBe(false);
 w.fail(false);expect((await w.service.prepareRoundResult('audit','owner',undefined,'stayA')).outcome).toBe('tie');
});
test('an unequal score or changed queue refuses the draw before statistics are written',async()=>{
 const w=fixture(3);w.state().liveMatch.scoreA=1;
 await expect(w.service.prepareRoundResult('audit','owner',undefined,'stayA')).rejects.toThrow();
 w.state().liveMatch.scoreA=0;w.state().rotation.waiting=[];
 await expect(w.service.prepareRoundResult('audit','owner',undefined,'stayA')).rejects.toThrow();
 expect(w.history()).toEqual([]);expect(w.documents.has('communityStats/club')).toBe(false);
});
test('preview and rotation preserve the staying side, returning incoming and outgoing loans',()=>{
 const rotation={playing:[1,0] as [number,number],waiting:[2],loans:[{playerId:'loan-in',homeTeam:2,filledTeam:1},{playerId:'loan-out',homeTeam:0,filledTeam:1},{playerId:'keep',homeTeam:1,filledTeam:0}],wins:{0:4},round:5,updatedAt:1};
 const teams=[0,1,2].map(index=>({index,playerIds:[`t${index}`]}));
 const next=recordTieSkeleton(teams,rotation,1,'temporary','stayB');
 expect(drawRotationPreview(rotation,null)).toBeNull();expect(next.playing).toEqual([2,0]);
 expect(next.playing).toEqual(drawRotationPreview(rotation,'B')!.playing);
 expect(next.rotation.waiting).toEqual([1]);expect(next.rotation.wins).toEqual({0:4});
 expect(next.rotation.loans.map(l=>l.playerId)).toEqual(['keep']);
 expect(next.rotation.lastRoundWinners).toEqual([]);expect(next.rotation.lastRoundLosers).toEqual([]);
 expect(roundCommitKey(rotation)).toBeTruthy();
});

test.each([{count:3,mode:'keepPlaying'},{count:2,mode:'stayA'}])('the server rejects $mode with $count teams before any statistics are written',async({count,mode})=>{
 const source=fixture(count),valid=count===2?'keepPlaying':'stayA';
 await source.service.prepareRoundResult('audit','owner',undefined,valid);
 const w=fixture(count);
 await expect(w.rawCall({...source.payloads[0],tieResolution:mode})).rejects.toThrow('סדר הקבוצות');
 expect(w.history()).toEqual([]);expect(w.documents.has('communityStats/club')).toBe(false);
});
