import React from 'react';
import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { activeDraftRosterIds } from '@/utils/draftIntegrity';

let mockRoute:any, mockFocused=true;
const mockNavigation={navigate:jest.fn(),canGoBack:()=>true,goBack:jest.fn()};
const mockHydrate=jest.fn().mockResolvedValue(undefined);
const mockCaptains=['captain-a','captain-b','captain-c'];
jest.mock('react',()=>{
  let slots:any[]=[],index=0,pending:Array<()=>void>=[];
  const same=(a?:any[],b?:any[])=>!!a&&!!b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
  const hooks:any={...jest.requireActual('react'),
    __runtime:{begin:()=>{index=0;},effects:()=>{const effects=pending;pending=[];effects.forEach(fn=>fn());},reset:()=>{slots.forEach(slot=>slot?.cleanup?.());slots=[];index=0;pending=[];}},
    useState:(initial:any)=>{const i=index++;if(!slots[i])slots[i]={value:typeof initial==='function'?initial():initial};return[slots[i].value,(next:any)=>{slots[i].value=typeof next==='function'?next(slots[i].value):next;}];},
    useRef:(initial:any)=>{const i=index++;return slots[i]??(slots[i]={current:initial});},
    useMemo:(fn:any,deps:any[])=>{const i=index++;if(!same(slots[i]?.deps,deps))slots[i]={deps,value:fn()};return slots[i].value;},
    useCallback:(fn:any,deps:any[])=>hooks.useMemo(()=>fn,deps),
    useEffect:(effect:any,deps:any[])=>{const i=index++;if(!same(slots[i]?.deps,deps)){const previous=slots[i];slots[i]={deps};pending.push(()=>{previous?.cleanup?.();slots[i].cleanup=effect();});}},
  };return hooks;
});
jest.mock('react-native',()=>({ActivityIndicator:'Spinner',Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',View:'View',StyleSheet:{create:(value:any)=>value}}));
jest.mock('react-native-safe-area-context',()=>({SafeAreaView:'SafeAreaView'}));
jest.mock('@react-navigation/native',()=>({useRoute:()=>({params:mockRoute}),useNavigation:()=>mockNavigation,
  useFocusEffect:(fn:any)=>{require('react').useEffect(()=>mockFocused?fn():undefined,[fn,mockFocused]);}}));
jest.mock('@expo/vector-icons',()=>({Ionicons:'Icon'}));
jest.mock('@/components/SafeModal',()=>({SafeModal:'Modal'}));
jest.mock('@/components/match/rotationView',()=>({TEAM_PALETTE:[]}));
jest.mock('@/components/ScreenHeader',()=>({ScreenHeader:'Header'}));
jest.mock('@/components/PressableScale',()=>({PressableScale:'PressableScale'}));
jest.mock('@/components/UserAvatar',()=>({UserAvatar:'Avatar'}));
jest.mock('@/components/Button',()=>({Button:'Button'}));
jest.mock('@/components/AppDialog',()=>({appAlert:jest.fn()}));
jest.mock('@/components/draft/DraftOrderPath',()=>({DraftOrderPath:'OrderPath'}));
jest.mock('@/components/draft/DraftTeamCard',()=>({DraftTeamCard:'TeamCard'}));
jest.mock('@/components/draft/DraftScalePop',()=>({GrowIn:'GrowIn',ShrinkOut:'ShrinkOut'}));
jest.mock('@/components/anim/Breathing',()=>({Breathing:'Breathing'}));
jest.mock('@/store/gameStore',()=>({useGameStore:(select:any)=>select({players:{},hydratePlayers:mockHydrate})}));
jest.mock('@/store/userStore',()=>{const currentUser={id:'manager'};return{useUserStore:(select:any)=>select({currentUser})};});
jest.mock('@/store/groupStore',()=>{const groups:any[]=[];return{useGroupStore:(select:any)=>select({groups})};});
jest.mock('@/services',()=>({gameService:{getGameById:jest.fn(),saveDraftTeams:jest.fn()}}));
jest.mock('@/components/Toast',()=>({toast:{info:jest.fn(),error:jest.fn()}}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
jest.mock('@/services/analyticsService',()=>({AnalyticsEvent:{},logEvent:jest.fn()}));
jest.mock('@/theme',()=>({colors:{primary:'#2463EB'},spacing:{},radius:{},typography:{},shadows:{},RTL_LABEL_ALIGN:'left'}));
jest.mock('@/theme/overlays',()=>({overlaySurfaces:{},overlayTheme:{}}));

import {DraftBoardScreen} from '@/screens/games/DraftBoardScreen';
import {gameService} from '@/services';
const runtime=(require('react') as any).__runtime;
const read=gameService.getGameById as jest.Mock;
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve!:(value:any)=>void;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const nodes=(node:any):any[]=>!node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];
const text=(node:any):string=>typeof node==='string'||typeof node==='number'?String(node):node&&typeof node==='object'?React.Children.toArray(node.props?.children).map(text).join(' '):'';
const cards=(tree:any)=>nodes(tree).filter(node=>node.type==='TeamCard');
const cardIds=(tree:any)=>cards(tree).map(node=>[node.props.captain.id,...node.props.members.map((player:any)=>player.id)]);
function game(version=1){const teams=mockCaptains.map((captainId,index)=>({index,captainId,playerIds:[captainId,...Array.from({length:6},(_,i)=>`v${version}-${index}-${i}`)]}));
  return{id:'same-evening',groupId:'club',createdBy:'manager',format:'7v7',players:teams.flatMap(team=>team.playerIds),guests:[],draftTeams:{method:'snake',numTeams:3,createdAt:version,createdBy:'manager',teams,published:false}};}
function render(){runtime.begin();return DraftBoardScreen();}
beforeEach(()=>{runtime.reset();mockFocused=true;mockRoute={gameId:'same-evening',captainIds:mockCaptains,method:'snake',resume:true,expectedDraftCreatedAt:1};jest.clearAllMocks();read.mockReset().mockResolvedValue(game());});

test('regeneration with the same game and captains hides old teams synchronously before focus effects',async()=>{
  render();runtime.effects();await flush();expect(cardIds(render())).toEqual(game(1).draftTeams.teams.map(team=>team.playerIds));
  const latest=deferred();read.mockReturnValueOnce(latest.promise);
  mockRoute={...mockRoute,expectedDraftCreatedAt:2};
  const beforeEffects=render();expect(cards(beforeEffects)).toHaveLength(0);expect(text(beforeEffects)).toContain('טוענים את הכוחות המעודכנים');
  runtime.effects();expect(cards(render())).toHaveLength(0);
  latest.resolve(game(2));await flush();
  expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
  expect(gameService.saveDraftTeams).not.toHaveBeenCalled();
});

test('a stale refetch never displays the previous saved draft and a retry accepts only the acknowledged revision',async()=>{
  mockRoute.expectedDraftCreatedAt=2;read.mockResolvedValueOnce(game(1));
  render();runtime.effects();await flush();const failed=render();
  expect(cards(failed)).toHaveLength(0);expect(text(failed)).toContain('לא הצלחנו לטעון את הכוחות המעודכנים');expect(text(failed)).not.toContain('שחקנים זמינים');
  read.mockResolvedValueOnce(game(2));nodes(failed).find(node=>node.type==='Button'&&node.props.title==='נסו שוב')!.props.onPress();
  render();runtime.effects();await flush();expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
});

test('resume without a saved draft fails explicitly instead of falling back to captain picks',async()=>{
  read.mockResolvedValueOnce({...game(),draftTeams:undefined});
  render();runtime.effects();await flush();const failed=render();
  expect(text(failed)).toContain('לא הצלחנו לטעון את הכוחות המעודכנים');expect(text(failed)).not.toContain('שחקנים זמינים');expect(cards(failed)).toHaveLength(0);
});

test('a late response cannot publish after the revision changed, even before the old focus cleanup ran',async()=>{
  const old=deferred();read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(game(2));
  render();runtime.effects();mockRoute={...mockRoute,expectedDraftCreatedAt:2};render();
  old.resolve(game(1));await flush();expect(cards(render())).toHaveLength(0);
  runtime.effects();await flush();expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
});

test('a blurred pending read cannot replace the saved teams loaded on the next focus',async()=>{
  const old=deferred();read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(game(2));
  render();runtime.effects();mockFocused=false;render();runtime.effects();
  mockFocused=true;mockRoute={...mockRoute,expectedDraftCreatedAt:2};render();runtime.effects();await flush();
  old.resolve(game(1));await flush();expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
});

test('legacy resume without an expected revision still opens the exact saved allocation',async()=>{
  delete mockRoute.expectedDraftCreatedAt;render();runtime.effects();await flush();
  expect(cardIds(render())).toEqual(game().draftTeams.teams.map(team=>team.playerIds));
  expect(read).toHaveBeenCalledWith('same-evening');
});

function serviceReadHarness(){
  const file=ts.createSourceFile('gameService.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
  let method='',helper='';function visit(node:ts.Node){if(ts.isMethodDeclaration(node)&&node.name.getText(file)==='getGameById')method=node.getText(file);if(ts.isFunctionDeclaration(node)&&node.name?.text==='waitForSavedDraft')helper=node.getText(file);ts.forEachChild(node,visit);}visit(file);
  const snapshot=(value:any,metadata={fromCache:false,hasPendingWrites:false})=>({exists:()=>value!==null,data:()=>value,metadata});
  const listeners:any[]=[],unsubscribe=jest.fn();
  const context:any={module:{exports:{}},USE_MOCK_DATA:false,mockGamesV2:[],docs:{game:(id:string)=>({id})},setTimeout,clearTimeout,
    getDoc:jest.fn().mockResolvedValue(snapshot(game(1))),getDocFromServer:jest.fn().mockResolvedValue(snapshot(game(2))),
    onSnapshot:jest.fn((_ref:any,options:any,next:any,error:any)=>{listeners.push({options,next,error});next(snapshot(game(2)));return unsubscribe;})};
  vm.runInNewContext(ts.transpileModule(helper+';module.exports={'+method+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  return Object.assign(context,{service:context.module.exports,snapshot,listeners,unsubscribe});
}

test('a generated result waits for the exact server allocation without exposing an older value or requiring a retry',async()=>{
  const source=serviceReadHarness();read.mockImplementation(source.service.getGameById);
  mockRoute.expectedDraftCreatedAt=2;
  render();runtime.effects();await flush();
  expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
  expect(read).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledWith('same-evening',{source:'server',expectedDraftCreatedAt:2,signal:expect.any(AbortSignal)});
  expect(source.onSnapshot).toHaveBeenCalledTimes(1);expect(source.listeners[0].options).toEqual({includeMetadataChanges:true});
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(source.getDocFromServer).not.toHaveBeenCalled();expect(source.getDoc).not.toHaveBeenCalled();
});

test('ordinary service readers retain the existing default source',async()=>{
  const source=serviceReadHarness();expect((await source.service.getGameById('same-evening')).draftTeams.createdAt).toBe(1);
  expect(source.getDoc).toHaveBeenCalledTimes(1);expect(source.getDocFromServer).not.toHaveBeenCalled();
});

test('a fresh read failure preserves its error instead of falling back to a stale cache',async()=>{
  const source=serviceReadHarness(),failure=Object.assign(new Error('offline'),{code:'unavailable'});
  source.getDocFromServer.mockRejectedValue(failure);
  await expect(source.service.getGameById('same-evening',{source:'server'})).rejects.toBe(failure);
  expect(source.getDoc).not.toHaveBeenCalled();
});

test('fresh service reads retain missing-document and blocked-access outcomes',async()=>{
  const source=serviceReadHarness();source.getDocFromServer.mockResolvedValueOnce(source.snapshot(null));
  await expect(source.service.getGameById('same-evening',{source:'server'})).resolves.toBeNull();
  source.getDocFromServer.mockRejectedValueOnce(Object.assign(new Error('denied'),{code:'permission-denied'}));
  await expect(source.service.getGameById('same-evening',{source:'server'})).rejects.toMatchObject({code:'ACCESS_BLOCKED'});
  expect(source.getDoc).not.toHaveBeenCalled();
});

test('fresh source in demo mode still uses the same in-memory contract',async()=>{
  const source=serviceReadHarness();source.USE_MOCK_DATA=true;source.mockGamesV2.push(game(2));
  await expect(source.service.getGameById('same-evening',{source:'server'})).resolves.toMatchObject({id:'same-evening',matches:[],draftTeams:{createdAt:2}});
  expect(source.getDoc).not.toHaveBeenCalled();expect(source.getDocFromServer).not.toHaveBeenCalled();
});

function pendingService(){
  const source=serviceReadHarness();
  source.onSnapshot.mockImplementation((_ref:any,options:any,next:any,error:any)=>{source.listeners.push({options,next,error});return source.unsubscribe;});
  return source;
}
afterEach(()=>{jest.useRealTimers();});

test('old server values, pending writes, cache and unmatched newer versions stay loading until the exact acknowledged server snapshot',async()=>{
  jest.useFakeTimers();const source=pendingService(),done=jest.fn();
  const promise=source.service.getGameById('same-evening',{source:'server',expectedDraftCreatedAt:2});promise.then(done);
  const listener=source.listeners[0];
  listener.next(source.snapshot(game(1)));await flush();expect(done).not.toHaveBeenCalled();
  listener.next(source.snapshot(game(2),{fromCache:true,hasPendingWrites:false}));
  listener.next(source.snapshot(game(2),{fromCache:false,hasPendingWrites:true}));
  listener.next(source.snapshot(game(3)));await flush();expect(done).not.toHaveBeenCalled();
  listener.next(source.snapshot(game(2)));await expect(promise).resolves.toMatchObject({id:'same-evening',draftTeams:{createdAt:2}});
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
  expect(source.getDoc).not.toHaveBeenCalled();expect(source.getDocFromServer).not.toHaveBeenCalled();
});

test('only metadata changing from pending/cache to server confirmation can complete the same draft data',async()=>{
  jest.useFakeTimers();const source=pendingService();
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2});
  source.listeners[0].next(source.snapshot(game(2),{fromCache:true,hasPendingWrites:true}));
  expect(source.unsubscribe).not.toHaveBeenCalled();
  source.listeners[0].next(source.snapshot(game(2)));
  await expect(promise).resolves.toMatchObject({draftTeams:{createdAt:2}});
  expect(source.listeners[0].options.includeMetadataChanges).toBe(true);expect(source.unsubscribe).toHaveBeenCalledTimes(1);
});

test('a missing saved split stays pending and times out after eight seconds with no read loop or old result',async()=>{
  jest.useFakeTimers();const source=pendingService(),done=jest.fn();
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2});const rejected=expect(promise).rejects.toMatchObject({code:'SAVED_DRAFT_UNAVAILABLE'});promise.then(done,()=>{});
  source.listeners[0].next(source.snapshot({...game(2),draftTeams:undefined}));
  jest.advanceTimersByTime(7999);await flush();expect(done).not.toHaveBeenCalled();expect(source.unsubscribe).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1);await rejected;expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
  expect(source.onSnapshot).toHaveBeenCalledTimes(1);expect(source.getDoc).not.toHaveBeenCalled();expect(source.getDocFromServer).not.toHaveBeenCalled();
});

test.each(['unavailable','permission-denied'])('a stream failure %s rejects and disposes instead of presenting a cached allocation',async code=>{
  jest.useFakeTimers();const source=pendingService(),error=Object.assign(new Error('read failed'),{code});
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2});source.listeners[0].error(error);
  if(code==='permission-denied')await expect(promise).rejects.toMatchObject({code:'ACCESS_BLOCKED'});else await expect(promise).rejects.toBe(error);
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);expect(source.getDoc).not.toHaveBeenCalled();
});

test('an already aborted draft load never subscribes or starts a deadline',async()=>{
  jest.useFakeTimers();const source=pendingService(),controller=new AbortController();controller.abort();
  await expect(source.service.getGameById('same-evening',{expectedDraftCreatedAt:2,signal:controller.signal})).rejects.toMatchObject({name:'AbortError',code:'DRAFT_LOAD_ABORTED'});
  expect(source.onSnapshot).not.toHaveBeenCalled();expect(jest.getTimerCount()).toBe(0);
});

test('cancellation removes the listener, abort callback and deadline and ignores an already queued success',async()=>{
  jest.useFakeTimers();const source=pendingService(),controller=new AbortController(),remove=jest.spyOn(controller.signal,'removeEventListener');
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2,signal:controller.signal});const rejected=expect(promise).rejects.toMatchObject({code:'DRAFT_LOAD_ABORTED'});
  const late=source.listeners[0].next;controller.abort();late(source.snapshot(game(2)));await rejected;
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(remove).toHaveBeenCalledWith('abort',expect.any(Function));expect(jest.getTimerCount()).toBe(0);
});

test('a success disposes once even if abort, error and another snapshot arrive afterward',async()=>{
  jest.useFakeTimers();const source=pendingService(),controller=new AbortController();
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2,signal:controller.signal});
  source.listeners[0].next(source.snapshot(game(2)));controller.abort();source.listeners[0].error(new Error('late'));source.listeners[0].next(source.snapshot(game(1)));
  await expect(promise).resolves.toMatchObject({draftTeams:{createdAt:2}});expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});

test('synchronous subscription setup errors clean up the deadline and preserve the error',async()=>{
  jest.useFakeTimers();const source=pendingService(),error=new Error('subscribe setup');source.onSnapshot.mockImplementation(()=>{throw error;});
  await expect(source.service.getGameById('same-evening',{expectedDraftCreatedAt:2})).rejects.toBe(error);expect(jest.getTimerCount()).toBe(0);
});

test('abort while the subscription is registering still disposes the returned listener exactly once',async()=>{
  jest.useFakeTimers();const source=pendingService(),controller=new AbortController();
  source.onSnapshot.mockImplementation(()=>{controller.abort();return source.unsubscribe;});
  await expect(source.service.getGameById('same-evening',{expectedDraftCreatedAt:2,signal:controller.signal})).rejects.toMatchObject({code:'DRAFT_LOAD_ABORTED'});
  expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});

test('a converter failure is ignored on cache but preserved and cleaned up on a confirmed server event',async()=>{
  jest.useFakeTimers();const source=pendingService(),error=new Error('malformed converter data');
  const promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2});
  const bad={exists:()=>true,data:()=>{throw error;},metadata:{fromCache:true,hasPendingWrites:false}};
  source.listeners[0].next(bad);expect(source.unsubscribe).not.toHaveBeenCalled();
  source.listeners[0].next({...bad,metadata:{fromCache:false,hasPendingWrites:false}});
  await expect(promise).rejects.toBe(error);expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});

test('a server-confirmed missing document keeps the missing-document contract',async()=>{
  jest.useFakeTimers();const source=pendingService(),promise=source.service.getGameById('same-evening',{expectedDraftCreatedAt:2});
  source.listeners[0].next(source.snapshot(null));await expect(promise).resolves.toBeNull();expect(source.unsubscribe).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});

test('demo version validation remains local and does not pretend to subscribe to a server',async()=>{
  const source=serviceReadHarness();source.USE_MOCK_DATA=true;source.mockGamesV2.push(game(2));
  await expect(source.service.getGameById('same-evening',{expectedDraftCreatedAt:2})).resolves.toMatchObject({draftTeams:{createdAt:2}});
  await expect(source.service.getGameById('same-evening',{expectedDraftCreatedAt:1})).rejects.toThrow('SAVED_DRAFT_UNAVAILABLE');
  expect(source.onSnapshot).not.toHaveBeenCalled();expect(source.getDoc).not.toHaveBeenCalled();expect(source.getDocFromServer).not.toHaveBeenCalled();
});

test('the real board stays loading through an older stream event and displays only the new exact members',async()=>{
  const source=pendingService();read.mockImplementation(source.service.getGameById);mockRoute.expectedDraftCreatedAt=2;
  render();runtime.effects();source.listeners[0].next(source.snapshot(game(1)));await flush();
  expect(cards(render())).toHaveLength(0);expect(text(render())).toContain('טוענים את הכוחות המעודכנים');expect(text(render())).not.toContain('לא הצלחנו');
  source.listeners[0].next(source.snapshot(game(2)));await flush();expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
  expect(read).toHaveBeenCalledTimes(1);expect(source.unsubscribe).toHaveBeenCalledTimes(1);
});

test('blur aborts the real subscription and a queued old event cannot replace the next focused allocation',async()=>{
  const source=pendingService();read.mockImplementation(source.service.getGameById);
  render();runtime.effects();const old=source.listeners[0];
  mockFocused=false;render();runtime.effects();await flush();expect(source.unsubscribe).toHaveBeenCalledTimes(1);
  mockFocused=true;mockRoute={...mockRoute,expectedDraftCreatedAt:2};render();runtime.effects();
  old.next(source.snapshot(game(1)));await flush();expect(cards(render())).toHaveLength(0);
  source.listeners[1].next(source.snapshot(game(2)));await flush();expect(cardIds(render())).toEqual(game(2).draftTeams.teams.map(team=>team.playerIds));
  expect(source.unsubscribe).toHaveBeenCalledTimes(2);
});

test('generation forwards the saved result revision only after saving is acknowledged',async()=>{
  const file=ts.createSourceFile('DraftSetupScreen.tsx',fs.readFileSync('src/screens/games/DraftSetupScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback='';function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='runGenerate')callback=(node.initializer as ts.CallExpression).arguments[0].getText(file);ts.forEachChild(node,visit);}visit(file);
  const ack=deferred(),result=game(2).draftTeams,navigate=jest.fn();
  const context:any={module:{exports:{}},game:game(1),currentUser:{id:'manager'},generating:false,participants:game(1).players.map(id=>({id})),autoNumTeams:3,
    myCommunities:[],splitMode:'auto',useCompletions:false,hasTeams:true,
    balanceTeams:()=>({result,unratedCount:0,gap:0,band:'A',repeat:0,fallback:false,teamAverages:[3,3,3]}),
    gameService:{getRecentSplits:jest.fn().mockResolvedValue([]),saveDraftTeams:jest.fn().mockReturnValue(ack.promise)},
    setGenerating:jest.fn(),setGame:jest.fn(),logEvent:jest.fn(),logError:jest.fn(),AnalyticsEvent:{},toast:{info:jest.fn(),error:jest.fn()},he:{},nav:{navigate},
    activeDraftRosterIds,toGuestRosterId:(id:string)=>`guest:${id}`,balanceTiming:()=>({minComputeMs:0}),__DEV__:false,Date};
  vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const pending=context.module.exports();await flush();expect(navigate).not.toHaveBeenCalled();
  ack.resolve(undefined);await pending;
  expect(navigate).toHaveBeenCalledWith('DraftBoard',expect.objectContaining({gameId:'same-evening',resume:true,expectedDraftCreatedAt:2}));
});
