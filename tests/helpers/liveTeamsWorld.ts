import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as types from '@/types';
import * as rotationEngine from '@/services/rotationEngine';
import * as edit from '@/utils/liveTeamsEdit';
import * as goalTally from '@/utils/goalTally';
import * as decision from '@/utils/roundDecision';
import * as shootout from '@/utils/shootoutDecision';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import { stripUndefined } from '@/utils/stripUndefined';
import { createManualDraft } from '@/utils/manualAllocation';
import { readDraftTeams, readRotation, readLiveMatch } from '@/firebase/firestore';

const source=fs.readFileSync('src/services/gameService.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
export function liveTeamsFixture(count=4,size=4):types.Game {
  const rosters=Array.from({length:count},(_,team)=>Array.from({length:size},(_,i)=>`t${team}-p${i}`));
  return {id:'audit',title:'מחזור בדיקה',createdBy:'owner',groupId:'club',status:'active',format:`${size}v${size}` as types.GameFormat,
    players:rosters.flat(),guests:[],waitlist:[],matches:[],numberOfTeams:count,maxPlayers:count*size,startsAt:1,createdAt:1,fieldName:'מגרש',currentMatchIndex:0,locked:false,
    draftTeams:createManualDraft(rosters,'owner',1),rotation:{playing:[0,1],waiting:Array.from({length:count-2},(_,i)=>i+2),loans:[],round:2,roundInstanceId:'old-key',roundInstanceRound:2,updatedAt:1,wins:{0:1},fillUsage:{'t0-p0':{games:1,fills:0,lastRound:1}},baseTeams:rosters.map((playerIds,index)=>({index,playerIds}))},
    lastCommittedRoundId:'previous-game',liveMatch:{phase:'roundRunning',assignments:{},benchOrder:[],scoreA:1,scoreB:0,
      goals:[{id:'goal',team:'A',scorerId:'t0-p0',assisterId:'t0-p1',minute:1,at:1000}],goalTally:{'t0-p0':3},timerRunning:false,timerAccumulatedMs:90000,timerEvents:[],startedAt:100}};
}

/** Full production service + converter reads; only storage, transport and time are replaced.
 * Version checks model transaction retries, without any Firebase account or network. */
export function liveTeamsWorld(mock=false,initial=liveTeamsFixture()) {
  const state=structuredClone(initial),writes:any[]=[],events:any[]=[],committedHistory:any[]=[];
  let version=0,attempts=0,now=5000,beforeCommit:(()=>void)|undefined,failCommit=false,loseAck=false,exists=true;
  const mutate=(fn:(game:types.Game)=>void)=>{fn(state);version++;};
  const converted=()=>({...structuredClone(state),draftTeams:readDraftTeams(state.draftTeams),rotation:readRotation(state.rotation),liveMatch:readLiveMatch(state.liveMatch)});
  const apply=(patch:Record<string,any>)=>{
    for(const [key,value] of Object.entries(patch)){
      const path=key.split('.');let target:any=state;
      for(const part of path.slice(0,-1))target=target[part]??={};
      const last=path.at(-1)!;
      if(value?.union)target[last]=[...(target[last]??[]),...structuredClone(value.union)];
      else if(value?.inc!==undefined)target[last]=(target[last]??0)+value.inc;
      else if(value?.remove)target[last]=(target[last]??[]).filter((v:any)=>!value.remove.some((x:any)=>JSON.stringify(x)===JSON.stringify(v)));
      else if(value?.deleted)delete target[last];
      else target[last]=structuredClone(value);
    }
    version++;events.push(converted());
  };
  const transaction=async(_:unknown,callback:any)=>{
    for(let retry=0;retry<6;retry++){
      attempts++;let readVersion=-1;const staged:any[]=[];
      await callback({get:async()=>{readVersion=version;const data=converted();return{exists:()=>exists,data:()=>data};},update:(_ref:any,patch:any)=>staged.push(structuredClone(patch))});
      if(beforeCommit&&staged.length){const hook=beforeCommit;beforeCommit=undefined;hook();}
      if(readVersion!==version)continue;
      if(failCommit)throw new Error('UNAVAILABLE');
      for(const patch of staged){writes.push(patch);apply(patch);}
      if(loseAck&&staged.length)throw new Error('ACK_LOST');
      return;
    }
    throw new Error('TOO_MUCH_CONTENTION');
  };
  const logs=jest.fn(),callable=jest.fn();
  const io={runTransaction:transaction,doc:()=> 'audit',collection:()=> 'history',
    arrayUnion:(...union:any[])=>({union}),arrayRemove:(...remove:any[])=>({remove}),increment:(inc:number)=>({inc}),deleteField:()=>({deleted:true}),
    getDoc:async()=>({exists:()=>exists,data:converted}),getDocFromServer:async()=>({exists:()=>exists,data:converted}),
    updateDoc:async(_ref:any,patch:any)=>{writes.push(patch);apply(patch);}};
  const dependencies:Record<string,any>={
    '../utils/errorObservation':{observeCaughtError:jest.fn()},'firebase/firestore':io,'firebase/functions':{httpsCallable:()=>callable},
    '@/firebase/config':{USE_MOCK_DATA:mock,getFirebase:()=>({db:{},functions:{}})},'@/firebase/firestore':{docs:{game:()=> 'audit'}},
    '@/data/mockData':{mockGamesV2:[state],mockGame:{id:'other'},mockRoundHistory:committedHistory},
    '@/utils/liveTeamsEdit':edit,'@/utils/stripUndefined':{stripUndefined},'@/utils/goalTally':goalTally,
    '@/services/rotationEngine':rotationEngine,'@/services/rotationWriteSource':{rotationWriteSource},'@/utils/roundDecision':decision,
    '@/utils/shootoutDecision':shootout,'@/types':types,'@/services/serverClock':{serverNow:()=>now},'@/services/errorLog':{logError:logs,logUnexpected:logs},
    '@/firebase/authRace':{withAuthRaceRetry:(fn:any)=>fn()},
  };
  const exports:any={};
  class TestDate extends Date { static now(){return now;} }
  vm.runInNewContext(compiled,{exports,require:(name:string)=>{if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return dependencies[name]??{};},__DEV__:false,Date:TestDate,console,setTimeout,clearTimeout});
  const service=exports.gameService;
  service.getGameById=async()=>mock?structuredClone(state):converted();
  return{state,service,writes,events,logs,callable,committedHistory,mutate,read:()=>mock?structuredClone(state):converted(),attempts:()=>attempts,
    beforeCommit:(fn:()=>void)=>{beforeCommit=fn;},fail:()=>{failCommit=true;},recover:()=>{failCommit=false;loseAck=false;},
    loseAck:()=>{loseAck=true;},clock:(value:number)=>{now=value;},remove:()=>{exists=false;}};
}
