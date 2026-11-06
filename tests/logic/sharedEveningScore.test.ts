import * as client from '@/utils/sharedEveningScore';
import * as server from '../../functions/src/sharedEveningScore';
import { verifiedSharedRecords, prepareSharedScoreCalibration } from '../../functions/src/sharedScoreCalibration';
import { planRetroScores, scoreWithCalibration } from '../../functions/src/retroScorePlan';
import { liveTeamsEndToEndWorld } from '../helpers/liveTeamsEndToEndWorld';

const basis:server.SharedScoreCalibration={version:'shared-v1',threshold:1.3915,frozenAt:server.SHARED_SCORE_ACTIVATION_AT+1,
  previousThreshold:1.4,target:1.3915,sourceGameIds:[],selected:[]};
const stats=(n:number,w:number,g=0,a=0,c=0)=>({rounds:n,wins:w,goals:g,assists:a,cleanSheets:c});

test.each([
  ['אלירן',stats(9,7,6,0,7),9.4],['אדיר',stats(10,7,3,3,7),9],
  ['שלומי',{...stats(8,3,0,2,2),penScored:1},7.6],
  ['איציק',{...stats(9,7,1,0,7),penMissed:1},8.6],
  ['עומרי',{...stats(9,4,1,1,2),penScored:1},7.7],
] as const)('%s reproduces the accepted real-evening simulation',(_name,row,expected)=>{
  const input=client.sharedInputFromStats(row);
  expect(client.sharedEveningScore(input,basis.threshold)).toBe(expected);
  expect(server.sharedEveningScore(input,basis.threshold)).toBe(expected);
});

test('perfect scores require no penalty and never exceed ten; no play is not six',()=>{
  expect(client.sharedEveningScore(client.sharedInputFromStats(stats(10,10,6,0,10)),1.4)).toBe(10);
  expect(client.sharedEveningScore(client.sharedInputFromStats({...stats(1,1,99,0,1),penScored:99}),1.4)).toBe(10);
  expect(client.sharedEveningScore(client.sharedInputFromStats(stats(0,0)),1.4)).toBeNull();
  expect(client.sharedEveningScore(client.sharedInputFromStats({...stats(2,3),goals:null}),1.4)).toBeNull();
  expect(client.sharedEveningScore(client.sharedInputFromStats(stats(8,6,2,0,4)),1.4)).toBe(8.6);
});

test('regulation goals are not also shootout bonuses, saves and scored penalties have equal weight',()=>{
  const s={...stats(8,4,1),penScored:1,penInPlayScored:1};
  expect(scoreWithCalibration(s,basis)).toBe(scoreWithCalibration(stats(8,4,1),basis));
  expect(scoreWithCalibration({...stats(8,4),penSaved:1},basis)).toBe(scoreWithCalibration({...stats(8,4),penScored:1},basis));
  expect(scoreWithCalibration({...stats(8,4),penConceded:8},basis)).toBe(scoreWithCalibration(stats(8,4),basis));
});

test('calibration uses ten performances, at most two per evening, median and bounded updates',()=>{
  const records=Array.from({length:5},(_,i)=>[3,1.22,1.20].map((index,j)=>({gameId:String(i),userId:String(j),index}))).flat();
  const r=client.calibrateSharedScore(records,1.4);
  expect(r.selected).toHaveLength(10);
  for(const id of ['0','1','2','3','4'])expect(r.selected.filter(p=>p.gameId===id)).toHaveLength(2);
  expect(r.threshold).toBeCloseTo(1.442);
  expect(client.calibrateSharedScore(records.filter(p=>p.gameId!=='4'),1.4).threshold).toBe(1.4);
  const ordered=Array.from({length:10},(_,i)=>({gameId:String(Math.floor(i/2)),userId:String(i),index:[2,1.6,1.5,1.4,1.22,1.20,1.1,1,.9,.8][i]}));
  expect(client.calibrateSharedScore(ordered,1.4).threshold).toBeCloseTo(1.3915);
  const extreme=[...ordered];extreme[0]={...extreme[0],index:1000};
  expect(client.calibrateSharedScore(extreme,1.4).threshold).toBe(client.calibrateSharedScore(ordered,1.4).threshold);
});

test('verified history admits a one-game performance and rejects partial or mismatched counters',()=>{
  const h=[{teamA:['u'],teamB:['v'],scoreA:1,scoreB:0,winnerSide:'A',goals:[{scorerId:'u',team:'A'}]}];
  expect(verifiedSharedRecords('g',[{userId:'u',...stats(1,1,1,0,1)}],h,[])).toEqual([{gameId:'g',userId:'u',index:1.6}]);
  expect(verifiedSharedRecords('g',[{userId:'u',...stats(2,1,1,0,1)}],h,[])).toEqual([]);
  expect(verifiedSharedRecords('g',[{userId:'u',...stats(1,1,1,1,1)}],h,[])).toEqual([]);
  expect(verifiedSharedRecords('g',[{userId:'u',...stats(1,1,2,0,1)}],h,[{scorerId:'u'}])).toHaveLength(1);
});

test('old or already frozen games never query or rebase against today',async()=>{
  const tx={get:jest.fn()};
  expect(await prepareSharedScoreCalibration(tx as any,{} as any,{status:'finished',startsAt:1},'old',Date.now())).toBeNull();
  expect(await prepareSharedScoreCalibration(tx as any,{} as any,{status:'active',liveMatch:{startedAt:1}},'old',Date.now(),{starting:true})).toBeNull();
  expect(await prepareSharedScoreCalibration(tx as any,{} as any,{scoreCalibration:basis},'new',Date.now())).toEqual(basis);
  expect(tx.get).not.toHaveBeenCalled();
});

test('new standings, stored reader and replay agree; historical score stays byte-for-byte unchanged',async()=>{
  const w=liveTeamsEndToEndWorld();
  w.state().scoreCalibration=basis;
  expect(w.read().scoreCalibration).toEqual(basis);
  w.documents.set('communityStats/club',{kingGoalsSum:12,kingGoalsCount:3,kingAssistsSum:6,kingAssistsCount:3});
  const old={gameId:'old',userId:'t0-p0',groupId:'club',score:7.2,at:1};
  w.documents.set('eveningStandings/old__t0-p0',structuredClone(old));
  await w.service.endEvening('audit');await w.finishStages();
  const standing=w.documents.get('eveningStandings/audit__t0-p0');
  expect(standing.scoreBasis.version).toBe('shared-v1');
  expect(standing.score).toBe(10);
  expect((await w.summaryService.getEveningSummary('audit','t0-p0')).score).toBe(10);
  expect(w.documents.get('eveningStandings/audit__t2-p0').score).toBeNull();
  expect(w.documents.get('roundSummaries/audit').correctionBasis.standings.every((r:any)=>typeof r.score==='number')).toBe(true);
  const sum=w.documents.get('communityPlayerStats/club__t0-p0').eveningScoreSum;
  await w.finishStages();
  expect(w.documents.get('communityPlayerStats/club__t0-p0').eveningScoreSum).toBe(sum);
  expect(w.documents.get('eveningStandings/old__t0-p0')).toEqual(old);
  expect(w.documents.get('communityStats/club')).toMatchObject({kingGoalsSum:12,kingGoalsCount:3,kingAssistsSum:6,kingAssistsCount:3});
});

test('retro correction uses the frozen shared model and preserves equal ranks',()=>{
  const rows=['u','v'].map(userId=>({userId,stats:stats(8,6,2,0,4),standing:{score:8.6,scoreBasis:{previousScore:8,counted:true}},cumulative:{eveningScoreCount:1,eveningScoreSum:8.6}}));
  const result=planRetroScores(rows,{...basis,threshold:1.4},1,2);
  expect(result.map(r=>r.standing.scoreRank)).toEqual([1,1]);
  rows[0].stats.goals++;
  expect(planRetroScores(rows,{...basis,threshold:1.4},1,2)[0].score).toBe(8.8);
});

test('both formula bundles match over varied counts and thresholds',()=>{
  for(let n=1;n<=20;n++)for(let w=0;w<=n;w++)for(const t of [0.7,1.349755,1.4,2.8]){
    const input=client.sharedInputFromStats({...stats(n,w,w%7,w%5,w),ties:n-w,penScored:w%3,penSaved:w%4,penMissed:w%6});
    expect(client.sharedEveningScore(input,t)).toBe(server.sharedEveningScore(input,t));
  }
});

test('start freezes only prior completed evenings, then retries return the exact stored basis',async()=>{
  const now=server.SHARED_SCORE_ACTIVATION_AT+10000;
  const game={status:'active',groupId:'club',startsAt:now,liveMatch:{startedAt:now}};
  const prior=Array.from({length:5},(_,i)=>({id:'g'+i,data:()=>({startsAt:now-1000-i,endedAt:now-500,status:'finished'})}));
  const rejected=[{id:'current',data:()=>game},{id:'late',data:()=>({startsAt:now-1,endedAt:now+1,status:'finished'})},
    {id:'cancelled',data:()=>({startsAt:now-2,status:'cancelled'})}];
  const ref=(path:string,filter?:unknown):any=>({path,filter,where:(_key:string,_op:string,value:unknown)=>ref(path,value),orderBy:()=>ref(path,filter),limit:()=>ref(path,filter)});
  const db={collection:ref};
  const docs=(rows:unknown[])=>({size:rows.length,docs:rows.map(data=>({data:()=>data}))});
  const tx={get:jest.fn(async(q:any)=>q.path==='games'?{size:8,docs:[...rejected,...prior]}:q.path==='gamePlayerStats'?docs([
    {userId:'u',...stats(1,1,1,0,1)},{userId:'a',...stats(1,1,0,0,1)}]):q.path.endsWith('roundHistory')?docs([
    {teamA:['u','a'],teamB:['v'],scoreA:1,scoreB:0,winnerSide:'A',goals:[{scorerId:'u',team:'A'}]}]):docs([]))};
  const frozen=await prepareSharedScoreCalibration(tx as any,db as any,game,'current',now,{starting:true});
  expect(frozen?.sourceGameIds).toEqual(prior.map(g=>g.id));
  expect(frozen?.selected).toHaveLength(10);expect(frozen?.threshold).toBeCloseTo(1.442);
  tx.get.mockClear();
  expect(await prepareSharedScoreCalibration(tx as any,db as any,{...game,scoreCalibration:frozen},'current',now+999,{starting:true})).toEqual(frozen);
  expect(tx.get).not.toHaveBeenCalled();
});

test('guest gets the same grade and place without entering account averages',async()=>{
 const w=liveTeamsEndToEndWorld();w.state().scoreCalibration=basis;
 w.state().guests=[{id:'g',name:'אורח'}];
 w.documents.set('gamePlayerStats/audit__guest:g',{gameId:'audit',userId:'guest:g',isGuest:true,...stats(1,1,1,1,1)});
 await w.service.endEvening('audit');await w.finishStages();
 expect(w.documents.get('eveningStandings/audit__guest:g')).toMatchObject({score:10,scoreRank:1,scoreBasis:{counted:false}});
 expect(w.documents.has('communityPlayerStats/club__guest:g')).toBe(false);
 expect(w.documents.has('users/guest:g')).toBe(false);
});

test('award eligibility is separate from grade and zero-game rows do not block a correction',()=>{
 const make=(userId:string,s:ReturnType<typeof stats>)=>({userId,stats:s,standing:{score:scoreWithCalibration(s,basis),scoreBasis:{counted:true}},cumulative:{eveningScoreCount:1,eveningScoreSum:scoreWithCalibration(s,basis)}});
 const short=make('short',stats(1,1,3)),full=make('full',stats(8,6,2,0,4));
 const none={...full,userId:'none',stats:stats(0,0),standing:{score:null,scoreBasis:{counted:false}}};
 const rows=planRetroScores([short,full,none] as any,basis,1,2);
 expect(rows.find(r=>r.userId==='short')?.standing).toMatchObject({score:10,scoreRank:1,scoreAwardEligible:false,scoreAwardWinner:false});
 expect(rows.find(r=>r.userId==='full')?.standing).toMatchObject({scoreRank:2,scoreAwardEligible:true,scoreAwardWinner:true});
 expect(rows.some(r=>r.userId==='none')).toBe(false);
});
