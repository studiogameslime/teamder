import { invitePreflight } from '@/services/invitePreflight';
// Regression tests execute the actual navigation bodies with controlled services.
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const mockDisk = new Map<string,string>();
(globalThis as any).__DEV__=false;
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{
 getItem:jest.fn(async(k:string)=>mockDisk.get(k)??null),
 setItem:jest.fn(async(k:string,v:string)=>{mockDisk.set(k,v);}),
 removeItem:jest.fn(async(k:string)=>{mockDisk.delete(k);}),
}}));
jest.mock('react-native',()=>({AppState:{currentState:'active',addEventListener:jest.fn(()=>({remove:jest.fn()}))}}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
jest.mock('expo-linking',()=>({parse:(url:string)=>{const u=new URL(url);return {scheme:u.protocol.slice(0,-1),hostname:u.hostname,path:u.pathname.slice(1),queryParams:Object.fromEntries(u.searchParams)};}}));
import { storage } from '@/services/storage';
import { stashPendingInvite,resolveInviteUrl } from '@/services/deepLinkService';
import { readPendingAction,writePendingAction,clearPendingAction,clearPendingActionIfMatches,pendingActionMatches,receivePendingInvite } from '@/services/pendingAction';
import { resolveIncomingInvite, retryUnresolvedInvite } from '@/services/incomingInvite';
import { useEntryStore } from '@/store/entryStore';
beforeEach(()=>{mockDisk.clear();useEntryStore.setState({organicCompleted:null,invite:null,pendingIntent:null,suppressAutoConsume:false});});
const action=(id:string,kind:'open_game'|'open_club'='open_game')=>({version:2 as const,kind,targetId:id,invitedBy:'sender-'+id,origin:'deep_link' as const,createdAt:Date.now()});
function runRootConsumer(getGameById:Function=async()=>({}),navigate=()=>true){
 const source=fs.readFileSync('src/navigation/RootNavigator.tsx','utf8');
 const begin=source.indexOf('    (async () => {',source.indexOf('const consumedRef'));
 const end=source.indexOf('\n  }, [',begin);
 const js=ts.transpileModule(source.slice(begin,end),{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 const context:any={__DEV__:false,readPendingAction,clearPendingAction,clearPendingActionIfMatches,pendingActionMatches,activeAction:null,viewerIsGuest:true,
  useEntryStore, retryRef:{current:{count:0}},retryTimer:{current:null},setInviteRetry:jest.fn(),setTimeout:jest.fn(),clearTimeout:jest.fn(),
  AnalyticsEvent:new Proxy({},{get:(_,key)=>key}),logEvent:jest.fn(),consumedRef:{current:true},
  gameService:{getGameById},groupService:{getPublic:async()=>({})},
  useGroupStore:{getState:()=>({groups:[]})},navigateInvite:navigate,
  wasLandingShown:async()=>false,navigatePersonalInvite:()=>true,markLandingShown:async()=>{},
  invitePreflight,canNavigateInvitation:()=>!useEntryStore.getState().suppressAutoConsume,currentUser:{id:"qa"},disposedRef:{current:false},
  scheduleInviteRetry:(action:any)=>{context.retryRef.current.count++;context.setTimeout();},
  isOpenKind:(kind:string)=>['open_game','open_club','open_invite'].includes(kind),
  toast:{error:jest.fn()},console};
 return {pending:vm.runInNewContext(js,context) as Promise<void>,context};
}
test('R01: a fresh link replaces an old v2 navigation and refreshes the entry card',async()=>{
 await writePendingAction(action('old-game'));
 await stashPendingInvite({type:'team',id:'new-club',invitedBy:'new-sender'});
 await useEntryStore.getState().refreshInvite();
 expect(await storage.getPendingInvite()).toMatchObject({id:'new-club'});
 expect(await readPendingAction()).toMatchObject({targetId:'new-club'});
 expect(useEntryStore.getState().invite).toMatchObject({kind:'club',targetId:'new-club'});
});
test('R02: fresh cold-start link replaces an older invitation',async()=>{
 await storage.setPendingInvite({type:'app',invitedBy:'old-sender'});
 await stashPendingInvite({type:'team',id:'wanted-club',invitedBy:'new-sender'});
 expect(await storage.getPendingInvite()).toMatchObject({type:'team',id:'wanted-club',invitedBy:'new-sender'});
});
test.each(['open_game','open_club'] as const)('R03: actual root consumer retains guest attribution after opening %s',async kind=>{
 await writePendingAction(action('game',kind));
 expect(await storage.getPendingInvite()).toHaveProperty('invitedBy','sender-game');
 await runRootConsumer().pending;
 expect(await storage.getPendingInvite()).toBeNull();
 expect(await storage.getInviteAttribution('new-account')).toHaveProperty('invitedBy','sender-game');
 expect(await storage.getInviteAttribution('different-account')).toBeNull();
 expect(await readPendingAction()).toBeNull();
});
test('R04: old preflight cannot navigate or clear a newly arrived invitation',async()=>{
 await writePendingAction(action('old-game'));
 let enter!:()=>void;const entered=new Promise<void>(r=>{enter=r;});
 let finish!:()=>void;const gate=new Promise<void>(r=>{finish=r;});
 const running=runRootConsumer(async()=>{enter();await gate;return {};},jest.fn(()=>true));
 await entered;
 await writePendingAction(action('new-club','open_club'));
 expect(await readPendingAction()).toHaveProperty('targetId','new-club');
 finish();await running.pending;
 expect(await readPendingAction()).toHaveProperty('targetId','new-club');
 expect(running.context.navigateInvite).not.toHaveBeenCalled();
});
test('R05: failed navigation schedules a bounded retry',async()=>{
 await writePendingAction(action('game'));
 const running=runRootConsumer(async()=>({}),()=>false);
 await running.pending;
 expect(await readPendingAction()).toHaveProperty('targetId','game');
 expect(running.context.consumedRef.current).toBe(false);
 expect(running.context.retryRef.current.count).toBe(1);
 expect(running.context.setTimeout).toHaveBeenCalled();
});
test('R06: iPhone smart primary follows retargeting without a duplicate installed-app button',async()=>{
 const html=fs.readFileSync('public/invite.html','utf8');
 const start=html.indexOf('(function(){',html.indexOf('<script>'));const stop=html.indexOf('  var V={',start);
 const elements=new Map<string,any>();
 const ctx:any={location:{pathname:'/session/old',search:'?invitedBy=sender'},window:{__INVITE__:{},addEventListener:jest.fn(),removeEventListener:jest.fn()},URLSearchParams,encodeURIComponent,decodeURIComponent,escape,atob,Promise,setTimeout:jest.fn(()=>1),clearTimeout:jest.fn(),
 localStorage:{setItem(){}},navigator:{userAgent:'iPhone',sendBeacon(){}},document:{addEventListener:jest.fn(),removeEventListener:jest.fn(),querySelectorAll:()=>[],getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,{addEventListener(_name:string,fn:Function){this.click=fn;}});return elements.get(id);}}};
 vm.runInNewContext(html.slice(start,stop)+'window.retarget=retarget;window.deepLink=deepLink;})();',ctx);
 await elements.get('ctaBtn').click();
 expect(ctx.location.href).toBe('footy://session/old?invitedBy=sender');
 ctx.window.retarget('team','new-club');
 expect(ctx.window.deepLink()).toContain('team/new-club');
 await elements.get('ctaBtn').click();
 expect(ctx.location.href).toBe('footy://team/new-club?invitedBy=sender');
 expect(html).not.toContain('id="openInstalled"');
 expect(html).not.toContain('id="heroOpen"');
});
test('R07: unresolved short URL survives offline and retries while retaining known credit',async()=>{
 const original=globalThis.fetch;globalThis.fetch=jest.fn(async()=>{throw new Error('offline');}) as any;
 try{
  expect(await resolveIncomingInvite('https://teamderfc.web.app/i/Ab123xy?invitedBy=known-sender')).toBeNull();
  expect(mockDisk.get('footy.invite.unresolved')).toContain('Ab123xy');
  expect(await storage.getInviteAttribution('new-account')).toBeNull();
  globalThis.fetch=jest.fn(async()=>({ok:true,text:async()=>JSON.stringify({type:'team',id:'club',invitedBy:'known-sender'})})) as any;
  expect(await retryUnresolvedInvite()).toBe(true);
  expect(await readPendingAction()).toHaveProperty('targetId','club');
  expect(mockDisk.has('footy.invite.unresolved')).toBe(false);
 }finally{globalThis.fetch=original;}
});
test('R08: browser visit and code resolution both update the actual click counters',async()=>{
 const src=fs.readFileSync('functions/src/index.ts','utf8').replace(/\r\n/g,'\n');
 const at=src.indexOf('export const serveInviteCode');
 const begin=src.indexOf('  async (req, res) => {',at);
 const end=src.indexOf('\n  },\n);',begin);
 const handlerSource='('+src.slice(begin,end)+'\n  })';
 const js=ts.transpileModule(handlerSource,{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
 let linkClicks=0;let inviterClicks=0;
 const aggregate=jest.fn(async()=>{});
 const db={collection:(name:string)=>({doc:()=>({
   get:async()=>({exists:true,data:()=>name==='inviteLinks'?{type:'app',targetId:'',invitedBy:'sender'}:{name:'מזמין דמו'},ref:{set:async()=>{if(name==='inviteLinks')linkClicks++;}}}),
   set:async()=>{if(name==='inviteClicks')inviterClicks++;},
 })})};
 const firestore:any=()=>({});firestore.FieldValue={increment:(n:number)=>n};
 const handler=vm.runInNewContext(js,{db,admin:{firestore},Date,JSON,console,bumpLinkClickAggregate:aggregate,
  loadTemplate:()=>'<head></head>',INVITE_TEMPLATE_PATH:'local',injectMeta:(html:string)=>html});
 let html='';const response:any={set(){return this;},status(){return this;},send(s:string){html=s;return this;},json(s:any){html=JSON.stringify(s);return this;}};
 await handler({path:'/i/Ab123xy',query:{}},response); // the browser visit
 expect(linkClicks).toBe(1);
 const original=globalThis.fetch;
 globalThis.fetch=jest.fn(async()=>{await handler({path:'/i/Ab123xy',query:{resolve:'1'}},response);return {ok:true,text:async()=>html};}) as any;
 try{expect(await resolveInviteUrl('https://teamderfc.web.app/i/Ab123xy')).toMatchObject({type:'app',invitedBy:'sender'});}
 finally{globalThis.fetch=original;}
 expect(linkClicks).toBe(1);expect(inviterClicks).toBe(1);expect(aggregate).toHaveBeenCalledTimes(1);
});
import { sanitizeDisplayString } from '@/utils/validate';
test('R09: public inviter display name is text in both landing templates',()=>{
 const harmless='<em>שם בדיקה</em>';
 expect(sanitizeDisplayString(harmless)).toBe(harmless);
 for(const file of ['public/invite.html','functions/templates/invite.html']){
  const source=fs.readFileSync(file,'utf8');
  const fn=source.split('\n').find(line=>line.includes('function applyV(t,nm)'))!;
  const els=new Map<string,any>();
  const ctx:any={isIOS:false,V:{personal_invite:{badge:'הזמנה',title:'הזמנה',sub:'פרטים',cta:'פתח',final:'סיום'}},document:{getElementById:(id:string)=>{if(!els.has(id))els.set(id,{});return els.get(id);}}};
  vm.runInNewContext(fn+'\napplyV("personal_invite",'+JSON.stringify(harmless)+');',ctx);
  expect(els.get('title').textContent).toContain('<em>שם בדיקה</em>');
  expect(els.get('title').innerHTML).toBeUndefined();
  expect(els.get('badgeTxt').textContent).toContain('<em>שם בדיקה</em>');
 }
});
test('R10: only the root consumes targets and respects explicit choices',async()=>{
 await useEntryStore.getState().chooseIntent('create_club');
 expect(useEntryStore.getState().suppressAutoConsume).toBe(true);
 const app=fs.readFileSync('App.tsx','utf8');
 expect(app).not.toMatch(/navigateInvite\s*\(/);
 const root=fs.readFileSync('src/navigation/RootNavigator.tsx','utf8');
 const gate=root.indexOf('if (suppressAutoConsume)');
 expect(gate).toBeGreaterThan(0);
 expect(gate).toBeLessThan(root.indexOf('consumedRef.current = true'));
});
test('a fresh link never discards an interrupted business draft',async()=>{
 await writePendingAction({version:2,kind:'create_club',draftId:'draft',origin:'in_app',createdAt:Date.now()});
 await stashPendingInvite({type:'team',id:'new-club',invitedBy:'sender'});
 expect(await readPendingAction()).toMatchObject({kind:'create_club',draftId:'draft'});
 expect(await storage.getInviteAttribution('new')).toHaveProperty('invitedBy','sender');
});
test('deferred link cannot overwrite explicit navigation and a new explicit tap replaces it',async()=>{
 await receivePendingInvite({type:'team',id:'explicit'});
 expect(await receivePendingInvite({type:'session',id:'deferred'},'deferred_deep_link')).toBe(false);
 expect(await readPendingAction()).toHaveProperty('targetId','explicit');
 await receivePendingInvite({type:'session',id:'latest'});
 expect(await readPendingAction()).toHaveProperty('targetId','latest');
});
