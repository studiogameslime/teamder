import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import type { Game } from '@/types';
import { createManualDraft } from '@/utils/manualAllocation';
import { acceptsReorder, applyChosenFill, resolveRoundInstance, rosterOf, roundCommitKey } from '@/services/rotationEngine';
import { readLiveMatch, readRotation } from '@/firebase/firestore';
import { assertLiveTeamsEdit, liveTeamsChanged, liveTeamsEditContext, liveTeamsEditSkeleton, moveLiveWaiting, replaceLiveTeam, resetLiveForTeamChange, validateLiveTeamsFill } from '@/utils/liveTeamsEdit';

function fixture(): Game {
  const players=Array.from({length:12},(_,i)=>`p${i}`);
  return {id:'g',createdBy:'owner',groupId:'club',status:'active',format:'3v3',players,guests:[],matches:[],numberOfTeams:4,
    title:'מחזור בדיקה',startsAt:1,createdAt:1,fieldName:'מגרש',maxPlayers:12,currentMatchIndex:0,locked:false,waitlist:[],
    draftTeams:createManualDraft([players.slice(0,3),players.slice(3,6),players.slice(6,9),players.slice(9)],'owner',1),
    rotation:{playing:[0,1],waiting:[2,3],loans:[],round:2,roundInstanceId:'game-2',roundInstanceRound:2,wins:{0:1},fillUsage:{p0:{games:1,fills:0,lastRound:1}},baseTeams:[{index:0,playerIds:['p0','p1','p2']}]},
    lastCommittedRoundId:'game-1',
    liveMatch:{phase:'roundRunning',assignments:{p0:'teamA'},benchOrder:[],scoreA:2,scoreB:1,goals:[
      {id:'g1',team:'A',scorerId:'p0',assisterId:'p1',minute:0,at:100}, {id:'g2',team:'A',scorerId:'p0',minute:1,at:200}, {id:'g3',team:'B',scorerId:'p3',minute:2,at:300},
    ],goalTally:{p0:5,p3:1,p9:2},startedAt:100,timerAccumulatedMs:270000,timerRunning:true,timerLastStartedAt:1000,
      timerEvents:[{type:'start',at:1000,byName:'מנהל'}],activeIntervals:[{s:100,e:300}],
      shootout:{firstTeam:'A',keeperA:'p0',keeperB:'p3',kicks:[{id:'k',team:'A',kickerId:'p1',keeperId:'p3',scored:true,at:1500}]},roundNumber:2},
  } as Game;
}

function harness(mock=false) {
  const current=fixture(),updates:any[]=[];
  const ast=ts.createSourceFile('service.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
  const methods:string[]=[];
  const walk=(node:ts.Node)=>{if(ts.isMethodDeclaration(node)&&['prepareLiveTeamsEdit','saveLiveTeamsEdit','reorderWaiting'].includes(node.name.getText(ast)))methods.push(node.getText(ast));ts.forEachChild(node,walk);};walk(ast);
  let beforeRead:(()=>void)|undefined;
  const context:any={module:{exports:{}},Date,USE_MOCK_DATA:mock,mockGamesV2:[current],assertLiveTeamsEdit,liveTeamsChanged,liveTeamsEditContext,liveTeamsEditSkeleton,resetLiveForTeamChange,validateLiveTeamsFill,resolveRoundInstance,acceptsReorder,roundCommitKey,
    serverNow:()=>5000,playersPerTeamFor:()=>3,effFillMode:(_g:Game,d:any)=>d.completionMode==='balanced'?'temporary':d.fillMode??'temporary',
    stripUndefined:(v:any)=>JSON.parse(JSON.stringify(v)),docs:{game:()=>({})},getFirebase:()=>({db:{}}),
    runTransaction:async(_:any,fn:any)=>{const staged:any[]=[];await fn({get:async()=>{beforeRead?.();return {exists:()=>true,data:()=>structuredClone(current)};},update:(_:any,patch:any)=>staged.push(patch)});for(const patch of staged){updates.push(patch);Object.assign(current,patch);}},
  };
  vm.runInNewContext(ts.transpileModule(`module.exports={${methods.join(',')}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const service=context.module.exports;
  service.getGameById=async()=>structuredClone(current);
  return {service,current,updates,readRace:(fn:()=>void)=>{beforeRead=fn;}};
}
const actor={userId:'owner',userName:'מנהל'};
const replacement={playing:[0,2] as [number,number],waiting:[3,1]};

test.each([false,true])('replacing a side resets only the current game atomically (mock=%s)',async mock=>{
  const h=harness(mock),before=structuredClone(h.current),expected=liveTeamsEditContext(h.current)!;
  await h.service.saveLiveTeamsEdit('g',replacement,expected,actor);
  const after=h.current;
  expect(after.rotation).toMatchObject({playing:[0,2],waiting:[3,1],round:2,wins:before.rotation!.wins,fillUsage:before.rotation!.fillUsage,baseTeams:before.rotation!.baseTeams,roundInstanceRound:2});
  expect(roundCommitKey(after.rotation!)).not.toBe(expected.roundId);
  expect(after.liveMatch).toMatchObject({scoreA:0,scoreB:0,goals:[],goalTally:{p0:3,p9:2},timerRunning:false,timerAccumulatedMs:0,timerLastStartedAt:null,timerEvents:[],phase:'roundReady',startedAt:100,roundNumber:2,assignments:{}});
  expect(after.liveMatch!.shootout).toBeUndefined();expect(after.lastCommittedRoundId).toBe('game-1');
  expect(after.liveMatch!.activeIntervals![0]).toEqual({s:100,e:300});
  expect(after.draftTeams!.originalTeams).toEqual(before.draftTeams!.originalTeams);
  expect(after.draftTeams!.teams).toEqual(before.draftTeams!.teams);
  if(!mock){expect(h.updates).toHaveLength(1);expect(Object.keys(h.updates[0]).sort()).toEqual(['draftTeams','liveMatch','rotation','updatedAt']);}
});

test.each([false,true])('queue-only edits preserve every live field, loan and identity (mock=%s)',async mock=>{
  const h=harness(mock),before=structuredClone(h.current);
  h.current.rotation!.loans=[{playerId:'p9',homeTeam:3,filledTeam:0}];
  const loans=structuredClone(h.current.rotation!.loans);
  await h.service.saveLiveTeamsEdit('g',{playing:[0,1],waiting:[3,2]},liveTeamsEditContext(h.current),actor);
  expect(h.current.liveMatch).toEqual(before.liveMatch);expect(h.current.draftTeams).toEqual(before.draftTeams);
  expect(h.current.rotation).toMatchObject({waiting:[3,2],playing:[0,1],loans,roundInstanceId:'game-2',wins:{0:1}});
});

test.each(['goal','score','penalty','clock','lineup','queue','committed','round','finished','cancelled','registration'])('rejects a stale edit after %s without a partial write',async reason=>{
  const h=harness(),expected=liveTeamsEditContext(h.current)!;
  const mutate=()=>{
    if(reason==='goal')h.current.liveMatch!.goals!.push({id:'new',team:'A',scorerId:'p0'} as any);
    if(reason==='score')h.current.liveMatch!.scoreA++;
    if(reason==='penalty')h.current.liveMatch!.shootout!.kicks.push({id:'new'} as any);
    if(reason==='clock')h.current.liveMatch!.timerRunning=false;
    if(reason==='lineup')h.current.draftTeams!.teams[0].playerIds.pop();
    if(reason==='queue')h.current.rotation!.waiting.reverse();
    if(reason==='committed')h.current.lastCommittedRoundId='game-2';
    if(reason==='round')h.current.rotation!.roundInstanceId='game-3';
    if(reason==='finished'||reason==='cancelled')h.current.status=reason;
    if(reason==='registration')h.current.players.pop();
  };
  h.readRace(mutate);
  await expect(h.service.saveLiveTeamsEdit('g',replacement,expected,actor)).rejects.toMatchObject({code:'LIVE_TEAMS_CHANGED'});
  expect(h.updates).toHaveLength(0);
});

test.each([
  {playing:[0,0],waiting:[2,3]}, {playing:[0,2],waiting:[1]}, {playing:[0,2],waiting:[1,1]},
  {playing:[0,7],waiting:[1,3]}, {playing:[0,2],waiting:[1,2,3]},
])('invalid plans never write: %j',async plan=>{
  const h=harness(),before=JSON.stringify(h.current);
  await expect(h.service.saveLiveTeamsEdit('g',plan,liveTeamsEditContext(h.current),actor)).rejects.toThrow();
  expect(JSON.stringify(h.current)).toBe(before);expect(h.updates).toHaveLength(0);
});

test('a retired team stays retired and cannot be reintroduced',()=>{
  const g=fixture();g.rotation!.waiting=[2];
  expect(()=>liveTeamsEditSkeleton(g,replacement,3,'temporary')).toThrow();
});

test('loans return from an incoming home team or outgoing target; paired swaps return together',()=>{
  const g=fixture();g.rotation!.loans=[{playerId:'p6',homeTeam:2,filledTeam:0},{playerId:'p9',homeTeam:3,filledTeam:1},
    {playerId:'p10',homeTeam:3,filledTeam:0}];
  const result=liveTeamsEditSkeleton(g,replacement,4,'temporary');
  expect(result.rotation.loans).toEqual([{playerId:'p10',homeTeam:3,filledTeam:0}]);
  const paired=fixture();paired.rotation!.loans=[{playerId:'p0',homeTeam:0,filledTeam:1,swapId:'swap'},{playerId:'p3',homeTeam:1,filledTeam:0,swapId:'swap'}];
  expect(liveTeamsEditSkeleton(paired,replacement,3,'temporary').rotation.loans).toEqual([]);
});

test.each(['temporary','permanent','balanced'])('fills are replayed and saved with reset, keeping base allocation (%s)',async mode=>{
  const h=harness();
  h.current.draftTeams!.fillMode=mode==='permanent'?'permanent':'temporary';
  if(mode==='balanced')h.current.draftTeams!.completionMode='balanced';
  h.current.draftTeams!.teams[2].playerIds.pop();
  const before=structuredClone(h.current),expected=liveTeamsEditContext(h.current)!;
  const {skeleton}=await h.service.prepareLiveTeamsEdit('g',replacement,expected);
  const filled=applyChosenFill(skeleton.teams,skeleton.rotation.loans,2,['p3'],skeleton.fillMode);
  await h.service.saveLiveTeamsEdit('g',replacement,expected,actor,filled);
  expect(rosterOf(2,h.current.draftTeams!.teams,h.current.rotation!.loans)).toContain('p3');
  expect(h.current.rotation!.baseTeams).toEqual(before.rotation!.baseTeams);
  expect(h.current.rotation!.fillUsage).toEqual(before.rotation!.fillUsage);
  expect(h.current.draftTeams!.originalTeams).toEqual(before.draftTeams!.originalTeams);
  if(mode==='permanent')expect(h.current.draftTeams!.teams[1].captainId).toBe('p4');
  expect(h.updates).toHaveLength(1);
});

test('illegal fills, duplication and tampered rosters cannot be persisted',()=>{
  const g=fixture(),skeleton=liveTeamsEditSkeleton(g,replacement,3,'temporary');
  const tampered={teams:structuredClone(skeleton.teams),loans:[]};tampered.teams[0].playerIds.push('outsider');
  expect(()=>validateLiveTeamsFill(skeleton,tampered)).toThrow();
  const duplicate={teams:structuredClone(skeleton.teams),loans:[{playerId:'p3',homeTeam:1,filledTeam:2}]};
  expect(()=>validateLiveTeamsFill(skeleton,duplicate)).toThrow();
});

test('departed players and waitlisted guests cannot enter new lineups',()=>{
  const g=fixture();g.draftTeams!.leftHome=[{playerId:'p6',teamIndex:2}] as any;
  g.draftTeams!.teams[2].playerIds=['p6'];
  expect(()=>liveTeamsEditSkeleton(g,replacement,3,'temporary')).toThrow('ללא שחקנים');
});

test('replacing either or both sides preserves untouched slots and appends outgoing teams to queue',()=>{
  const original={playing:[0,1] as [number,number],waiting:[2,3]};
  const first=replaceLiveTeam(original,1,2),both=replaceLiveTeam(first,0,3);
  expect(first).toEqual({playing:[0,2],waiting:[3,1]});expect(both).toEqual({playing:[3,2],waiting:[1,0]});
  expect(replaceLiveTeam(first,1,0)).toBe(first);expect(original.waiting).toEqual([2,3]);
  expect(moveLiveWaiting(first,1,-1).waiting).toEqual([1,3]);expect(moveLiveWaiting(first,3,-1)).toBe(first);
});

test('own goals and unattributed goals never reduce prior scorer credits',()=>{
  const live=fixture().liveMatch!;live.goals=[{team:'A',scorerId:'p0',ownGoal:true},{team:'B',scorerId:null}] as any;
  expect(resetLiveForTeamChange(live,'owner','מנהל',5000).goalTally).toEqual(live.goalTally);
});

test('retrying an acknowledged replacement cannot reset the newly started game',async()=>{
  const h=harness(),expected=liveTeamsEditContext(h.current)!;
  await h.service.saveLiveTeamsEdit('g',replacement,expected,actor);
  h.current.liveMatch!.scoreA=1;const before=structuredClone(h.current);
  await expect(h.service.saveLiveTeamsEdit('g',replacement,expected,actor)).rejects.toMatchObject({code:'LIVE_TEAMS_CHANGED'});
  expect(h.current).toEqual(before);expect(h.updates).toHaveLength(1);
});

test('the existing inline queue uses the same transaction and rejects a concurrent replacement',async()=>{
  const h=harness();
  h.readRace(()=>{h.current.rotation!.playing=[0,2];h.current.rotation!.waiting=[1,3];h.current.rotation!.roundInstanceId='replaced';});
  await expect(h.service.reorderWaiting('g',[3,2])).rejects.toMatchObject({code:'LIVE_TEAMS_CHANGED'});
  expect(h.current.rotation!.waiting).toEqual([1,3]);expect(h.updates).toHaveLength(0);
});

test('the real readers retain replacement identity and reset fields, without a new schema',async()=>{
  const h=harness(),before=structuredClone(h.current);
  await h.service.saveLiveTeamsEdit('g',replacement,liveTeamsEditContext(h.current),actor);
  const rotation=readRotation(h.current.rotation)!,live=readLiveMatch(h.current.liveMatch)!;
  expect(rotation.playing).toEqual([0,2]);expect(rotation.waiting).toEqual([3,1]);
  expect(roundCommitKey(rotation)).not.toBe(roundCommitKey(before.rotation!));
  expect(rotation.baseTeams).toEqual(before.rotation!.baseTeams);
  expect(live).toMatchObject({scoreA:0,scoreB:0,goals:[],timerRunning:false,timerAccumulatedMs:0,goalTally:{p0:3,p9:2}});
  expect(live.shootout).toBeUndefined();
});

test('both short teams can be filled in either picker order',()=>{
  const g=fixture();g.draftTeams!.teams[0].playerIds.pop();g.draftTeams!.teams[2].playerIds.pop();
  const skeleton=liveTeamsEditSkeleton(g,replacement,3,'temporary');
  let filled=applyChosenFill(skeleton.teams,skeleton.rotation.loans,2,['p3'],'temporary');
  filled=applyChosenFill(filled.teams,filled.loans,0,['p4'],'temporary');
  expect(validateLiveTeamsFill(skeleton,filled).loans).toHaveLength(2);
  expect(g.rotation!.fillUsage!.p0.games).toBe(1);
});

test('preparation does not write; a change during the filler picker rejects the entire save',async()=>{
  const h=harness(),expected=liveTeamsEditContext(h.current)!;
  await h.service.prepareLiveTeamsEdit('g',replacement,expected);expect(h.updates).toHaveLength(0);
  h.current.liveMatch!.scoreB=2;
  await expect(h.service.saveLiveTeamsEdit('g',replacement,expected,actor)).rejects.toThrow();
  expect(h.current.liveMatch!.scoreB).toBe(2);expect(h.current.rotation!.playing).toEqual([0,1]);expect(h.updates).toHaveLength(0);
});

test.each([false,true])('queue-only edits stabilize a legacy identity without changing its commit key (mock=%s)',async mock=>{
  const h=harness(mock);delete h.current.rotation!.roundInstanceId;delete h.current.rotation!.roundInstanceRound;
  h.current.rotation!.updatedAt=123;
  const oldKey=roundCommitKey(h.current.rotation!),before=structuredClone(h.current.liveMatch);
  await h.service.saveLiveTeamsEdit('g',{playing:[0,1],waiting:[3,2]},liveTeamsEditContext(h.current),actor);
  expect(roundCommitKey(h.current.rotation!)).toBe(oldKey);expect(h.current.rotation!.roundInstanceRound).toBe(2);
  expect(h.current.liveMatch).toEqual(before);
});
