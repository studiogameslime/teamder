const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const assert = require('assert/strict');
const results = [];
function load(path, mocks) {
  const source = fs.readFileSync(path, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => {
    if (name in mocks) return mocks[name];
    throw new Error('Missing isolated dependency: '+name);
  }, __DEV__: false, console, Date, setTimeout, clearTimeout }, { filename: path });
  return exports;
}
function deferred() { let resolve, reject; const promise = new Promise((r,j)=>{resolve=r; reject=j}); return {promise,resolve,reject}; }
function note(id, actual) { results.push({id,actual}); }
async function main() {
  const fail = async () => { throw new Error('offline'); };
  const inbox = load('src/services/requestsService.ts', {
    './friendsService': {friendsService:{listIncomingRequests:fail}},
    './groupService': {groupService:{listForUser:fail}},
    './gameService': {gameService:{getMyLiveOrUpcomingGames:fail}},
    './userService': {userService:{getUserById:fail}},
  });
  await assert.rejects(inbox.getInboxRequests('owner'), /offline/);
  await assert.rejects(inbox.getInboxCount('owner'), /offline/);
  note('B01', {failuresPropagated:true});
  const mismatch = load('src/services/requestsService.ts', {
    './friendsService': {friendsService:{listIncomingRequests:async()=>[]}},
    './groupService': {groupService:{listForUser:async()=>[{id:'g',adminIds:['owner'],pendingPlayerIds:['p'] }]}},
    './gameService': {gameService:{getMyLiveOrUpcomingGames:async()=>[]}},
    './userService': {userService:{getUserById:fail}},
  });
  const count=await mismatch.getInboxCount('owner');
  const detail=await mismatch.getInboxRequests('owner');
  assert.equal(count,1); assert.equal(detail.total,1);
  note('B02',{badge:count,inbox:detail.total,pendingUidStillExists:true});

  let store;
  const old=deferred();
  const groupModule=load('src/store/groupStore.ts',{
    react:{useMemo:()=>{}},
    zustand:{create:init=>{let state; const set=patch=>{state={...state,...(typeof patch==='function'?patch(state):patch)}}; const get=()=>state; state=init(set,get); store={getState:get,setState:set}; return store;}},
    '@/services/organiserSignals':{reportOrganiserState:()=>{}},
    '@/services':{groupService:{listForUser:id=>id==='A'?old.promise:Promise.resolve([{id:'clubB',playerIds:['B'],adminIds:[]}]),listPendingForUser:async()=>[]}},
    '@/services/storage':{storage:{getCurrentGroupId:async()=>null,setCurrentGroupId:async()=>{}}},
    '@/services/analyticsService':{AnalyticsEvent:{},logEvent:()=>{}},
    '@/services/achievementsService':{achievementsService:{}},
    '@/store/userStore':{useUserStore:{getState:()=>({currentUser:{id:'B'}})}},
    '@/services/errorLog':{logError:()=>{}},
    '@/services/staleSession':{isStaleSession:e=>e.name==='StaleSessionError'},
  });
  const s=groupModule.useGroupStore;
  s.setState({groups:[{id:'clubA',playerIds:['A'],adminIds:[]}],currentGroupId:'clubA'});
  const oldHydrate=s.getState().hydrate('A');
  s.getState().reset();
  await s.getState().hydrate('B');
  assert.equal(s.getState().groups[0].id,'clubB');
  old.reject(Object.assign(new Error('stale'),{name:'StaleSessionError'}));
  await oldHydrate;
  assert.equal(s.getState().groups[0].id,'clubB');
  note('B03',{account:'B',beforeLateResponse:'clubB',afterLateResponse:s.getState().groups[0].id});

  let pending={kind:'join_game',targetId:'A'};
  const wait=deferred();
  const coordinator=load('src/services/actionCoordinator.ts',{
    '@/services/pendingAction':{readPendingAction:async()=>pending,writePendingAction:async a=>{pending=a},clearPendingAction:async()=>{pending=null},clearPendingActionIfMatches:async expected=>{if(pending===expected)pending=null},isOpenKind:()=>false},
    '@/services/draftStore':{draftStore:{consume:async()=>{},write:async()=>{}}},
    '@/store/userStore':{useUserStore:{getState:()=>({currentUser:{id:'u',isGuest:false}})}},
    '@/services/actionOfferBridge':{announceOfferFor:()=>{}},
    '@/services/analyticsService':{AnalyticsEvent:{},logEvent:()=>{}},
    '@/services/errorLog':{logError:()=>{}},
    '@/utils/pendingActionMachine':{failureReasonFromCode:()=>'',isPresentButUnreadable:()=>false},
  });
  const action=coordinator.requestAction({kind:'join_game',targetId:'A',execute:()=>wait.promise});
  pending={kind:'open_club',targetId:'B'};
  wait.resolve({outcome:'joined',terminal:true});
  await action;
  assert.equal(pending.targetId,'B');
  note('B04',{newIntent:'open_club:B',afterOlderJoinFinishes:pending});

  // Extract exact source nodes with TypeScript, without rewriting their logic.
  function node(path,predicate) {const source=fs.readFileSync(path,'utf8'); const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true); let found; function visit(n){if(predicate(n)) found=n; ts.forEachChild(n,visit);} visit(ast); if(!found) throw Error('node missing '+path); return found.getText(ast);}
  const row=node('src/services/pairCompareService.ts',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='row');
  const pair=loadString(row+'\nexports.row=row;');
  const comparison=pair.row('losses','הפסדים',10,2,'int');
  assert.equal(comparison.winner,'b');
  note('B05',{lossesA:10,lossesB:2,winner:comparison.winner});
  const undo=node('src/services/gameService.ts',n=>ts.isMethodDeclaration(n)&&n.name.getText()==='undoLastShootoutKick');

  let kicks=[{id:'k1'},{id:'k2'}];
  const undoMod=loadString('exports.service={'+undo+'};',{
    USE_MOCK_DATA:false,getFirebase:()=>({db:{}}),docs:{game:id=>id},
    runTransaction:async(db,fn)=>{if(kicks.length===2&&kicks[1].id==='k2')kicks.push({id:'k3'});await fn({get:async()=>({data:()=>({status:'active',liveMatch:{shootout:{kicks}}})}),update:(ref,data)=>{kicks=data['liveMatch.shootout.kicks']}})},
  });
  await assert.rejects(undoMod.service.undoLastShootoutKick('g','k2'),/SHOOTOUT_CHANGED/);
  assert.equal(kicks.map(k=>k.id).join(','),'k1,k2,k3');
  await undoMod.service.undoLastShootoutKick('g','k3');
  assert.equal(kicks.map(k=>k.id).join(','),'k1,k2');
  note('B06',{concurrentKickPreserved:true});
  const protocol=load('functions/src/commitProtocol.ts',{});
  let history,stats,latch=false,clears=0;
  const outNode=node('functions/src/index.ts',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='outcome'&&n.getText().includes('commitRoundInOrder'));
  const commitMod=(value)=>loadString('exports.commit=async()=>{const '+outNode+';return outcome;};',{
    commitRoundInOrder:protocol.commitRoundInOrder,
    latchRef:{get:async()=>({exists:false})},
    roundHistoryDoc:{payload:value},
    roundHistoryRef:{create:async(doc)=>{if(history)throw Object.assign(new Error('exists'),{code:6});history=doc.payload}},
    sb:{build:batch=>batch},inc:()=>{},gameId:'g',roundId:'1',HttpsError:Error,
    liveGoalIds:[],snap:{ref:'game',updateTime:'v1'},now:123,
    admin:{firestore:{FieldValue:{delete:()=>({delete:true})}}},
    db:{batch:()=>{let doc,clear;return {
      set:(ref,v)=>{doc=v},
      update:(ref,patch,condition)=>{assert.equal(ref,'game');assert.equal(condition.lastUpdateTime,'v1');clear=patch},
      commit:async()=>{
        if(latch)throw Object.assign(new Error('exists'),{code:6});
        assert.equal(clear.lastCommittedRoundId,'1');assert.deepEqual(Array.from(clear['liveMatch.goals']),[]);
        latch=true;stats=value;history=doc.payload;clears++;
      },
    }}},
  });
  await Promise.all([commitMod('A').commit(),commitMod('B').commit()]);
  assert.equal(history,stats);assert.equal(stats,'A');
  assert.equal(clears,1);
  note('B07',{statsPayload:stats,historyPayload:history,statisticsAppliedOnce:true,boardClearedAtomicallyOnce:true});
  const health='src/services/healthService.ts';
  const overlap=node(health,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='overlapMs');
  const times=node(health,n=>ts.isFunctionDeclaration(n)&&n.name?.text==='recTimes');
  const clipped=node(health,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='clippedSum');
  const h=loadString(overlap+'\n'+times+'\nconst '+clipped+';exports.sum=clippedSum;',{windows:[{from:1000,to:5000}]});
  const total=h.sum([{time:new Date(3000).toISOString(),count:100}],r=>r.count);
  assert.equal(total,100);
  note('B08',{sampleAt:3000,window:[1000,5000],steps:100,counted:total});
  const validity=node('src/screens/games/MatchDetailsScreen.tsx',n=>ts.isFunctionDeclaration(n)&&n.name?.text==='teamsValidity');
  const v=loadString(validity+'\nexports.check=teamsValidity;',{toGuestRosterId:id=>'guest:'+id});
  const guestState=v.check({players:['p'],guests:[{id:'w',waitlisted:true}],liveMatch:{assignments:{'guest:w':'teamA'}}});
  assert.equal(guestState.state,'invalid');
  note('B09',{onlyAssignedGuestIsWaitlisted:true,result:guestState.state});
  const verify=load('src/services/eveningVerifyService.ts',{
    'firebase/firestore':{collection:()=>{},query:()=>{},where:()=>{},orderBy:()=>{},limit:()=>{},getDocs:fail},
    '@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({db:{}})},
    '@/services/errorLog':{logError:()=>{}},'@/utils/eveningPlayed':{eveningPlayState:()=>{}},'@/data/mockData':{mockGamesV2:[]},
  });
  await assert.rejects(verify.eveningVerifyService.listUnverified('g'), /offline/);
  note('B10',{primaryAndFallbackFailuresPropagated:true});
  const blockedMethod=node('src/services/chatService.ts',n=>ts.isMethodDeclaration(n)&&n.name.getText()==='subscribeBlocked');
  const blockedMod=loadString('exports.service={'+blockedMethod+'};',{
    onSnapshot:(q,success,error)=>{error(new Error('permission-denied'));return()=>{};},
    col:{userBlocked:()=>({})},logError:()=>{},__DEV__:false,USE_MOCK_DATA:false,
  });
  let blockedIds=new Set(['blocked-player']);
  blockedMod.service.subscribeBlocked('u',ids=>{blockedIds=ids});
  assert.equal(blockedIds.size,1);
  note('B11',{previousBlockedCount:1,listenerFailed:true,afterError:blockedIds.size});
  const chatStack=fs.readFileSync('src/navigation/ChatStack.tsx','utf8');
  const routes=[...chatStack.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map(m=>m[1]);
  const missing=['MatchDetails','CommunityHistory','CommunityEdit','AdminApproval'].filter(r=>!routes.includes(r));
  assert.equal(missing.length,0);
  note('B12',{host:'ChatStack',missingRoutes:missing,communityDetailsRegistered:routes.includes('CommunityDetails')});
  const participantsNode=node('src/screens/games/DraftSetupScreen.tsx',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='participants');
  const participantsMod=loadString('const '+participantsNode+';exports.participants=participants;',{
    useMemo:fn=>fn(),game:{players:['p'],guests:[{id:'w',name:'waitlisted',waitlisted:true}]},
    playersMap:{p:{displayName:'p'}},toGuestRosterId:id=>'guest:'+id,
  });
  assert.equal(participantsMod.participants.some(p=>p.id==='guest:w'),false);
  note('B13',{waitingGuestSelectableAsCaptain:false,participants:participantsMod.participants.map(p=>p.id)});
  const saveDraft=node('src/services/gameService.ts',n=>ts.isMethodDeclaration(n)&&n.name.getText()==='saveDraftTeams');
  let roster={players:['p'],guests:[{id:'w',waitlisted:true}]},draftWrites=0;
  const draftService=loadString('exports.service={'+saveDraft+'};',{
    USE_MOCK_DATA:false,toGuestRosterId:id=>'guest:'+id,docs:{game:()=>({})},getFirebase:()=>({db:{}}),stripUndefined:value=>value,
    runTransaction:async(_db,fn)=>fn({get:async()=>({exists:()=>true,data:()=>roster}),update:()=>{draftWrites++}}),
  }).service;
  const draft={method:'snake',teams:[{index:0,captainId:'guest:w',playerIds:['guest:w','p']}]};
  await assert.rejects(draftService.saveDraftTeams('g',draft,undefined,true),/DRAFT_ROSTER_CHANGED/);
  assert.equal(draftWrites,0);
  roster={players:['p'],guests:[{id:'w',waitlisted:false}]};
  await draftService.saveDraftTeams('g',draft,undefined,true);
  assert.equal(draftWrites,1);
  results.find(r=>r.id==='B13').actual.transactionRejectsWaitingCaptain=true;
  const accept=node('src/screens/profile/FriendsScreen.tsx',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='handleAccept');
  let friends=[],incoming=[{request:{fromUserId:'p'},user:{id:'p'}}];
  let alertCount=0;
  const friendsMod=loadString('const '+accept+';exports.accept=handleAccept;',{
    me:{id:'u'},incoming,friends,
    setBusyId:()=>{},setFriends:fn=>{friends=fn(friends)},setIncoming:fn=>{incoming=fn(incoming)},
    friendsService:{acceptRequest:fail},successHaptic:()=>{},toast:{success:()=>{}},he:{},load:async()=>{},
    __DEV__:false,appAlert:()=>{alertCount++},
  });
  await friendsMod.accept('p');
  assert.equal(friends.length,0);assert.equal(incoming.length,1);assert.equal(alertCount,1);
  note('B14',{serverAcceptFailed:true,friends:friends.map(f=>f.id),remainingIncoming:incoming.length,errorShown:true});
  const record=node('src/components/match/Shootout.tsx',n=>ts.isVariableDeclaration(n)&&n.name.getText()==='record');
  let screen='entry',stillSaving=true;
  const save=deferred();
  const shot=loadString('const '+record+';exports.record=record;',{
    writing:{current:false},attempt:{current:null},visibleRef:{current:true},uiEpoch:{current:0},reduced:true,setBusy:()=>{},setSaveError:()=>{},setTimeout,
    kickerId:'p',facingKeeperId:'k',gameId:'g',kickingTeam:'A',kicks:[],scoredOf:()=>0,
    gameService:{recordShootoutKick:()=>save.promise},logEvent:()=>{},AnalyticsEvent:{},
    setKickerId:()=>{},setAsking:()=>{},setFlying:()=>{},setKickResult:()=>{},resetBall:()=>{},setScreen:s=>{screen=s},
  });
  const saving=shot.record(true);
  assert.equal(screen,'entry');
  note('B15',{writeStillPending:stillSaving,screenBeforeWriteCompletes:screen});
  save.resolve();
  await saving;
  assert.equal(screen,'board');
  const retryIds=[];
  const retryAttempt={current:null};
  let retryScreen='entry',retryError=false;
  const retry=loadString('const '+record+';exports.record=record;',{
    writing:{current:false},attempt:retryAttempt,visibleRef:{current:true},uiEpoch:{current:0},reduced:true,setBusy:()=>{},setSaveError:v=>{retryError=v},setTimeout,
    kickerId:'p',facingKeeperId:'k',gameId:'g',kickingTeam:'A',kicks:[],scoredOf:()=>0,
    gameService:{recordShootoutKick:async(_game,kick)=>{retryIds.push(kick.id);if(retryIds.length===1)throw new Error('offline')}},logEvent:()=>{},AnalyticsEvent:{},
    setKickerId:()=>{},setAsking:()=>{},setFlying:()=>{},setKickResult:()=>{},resetBall:()=>{},setScreen:s=>{retryScreen=s},
  });
  await retry.record(true);
  assert.equal(retryScreen,'entry');assert.equal(retryError,true);assert.ok(retryAttempt.current);
  await retry.record(true);
  assert.equal(retryIds[0],retryIds[1]);assert.equal(retryScreen,'board');assert.equal(retryAttempt.current,null);
  results.find(r=>r.id==='B15').retryUsesSameKickId=true;
  return results;
}
function loadString(source,context={}) {const exports={}; const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(js,{exports,Date,...context});return exports;}
module.exports={main};
if(require.main===module)main().then(r=>{fs.writeFileSync(require('path').join(__dirname,'fix-results.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));}).catch(e=>{console.error(e);process.exitCode=1});
