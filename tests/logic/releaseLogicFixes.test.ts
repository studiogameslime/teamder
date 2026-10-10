import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { eveningPlayState } from '@/utils/eveningPlayed';
import { inSeason } from '@/utils/seasonScope';
import { roundCommitKey } from '@/services/rotationEngine';
import { decideSpotOffer } from '../../functions/src/spotOfferDecision';

function load(file: string, deps: Record<string, any>) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {exports,require:(id:string)=>deps[id]??{},__DEV__:false,console,Date,setTimeout,clearTimeout});
  return exports;
}
const gamesSource='src/services/gameService.ts';
test('rescheduling preserves only an existing waitlist offer, never a new join',()=>{
  const game={status:'scheduled',players:['a'],waitlist:['b','c'],pending:['d'],maxPlayers:3,pendingPromotion:{uid:'b'}};
  const result=decideSpotOffer(game,'b','confirm',100);
  expect(result.changed).toBe(true);
  if(result.changed){expect(result.patch.players).toEqual(['a','b']);expect(result.patch.waitlist).toEqual(['c']);expect(result.patch.pendingPromotion).toEqual({uid:'c',offeredAt:100});}
  expect(()=>decideSpotOffer(game,'x','confirm',100)).toThrow('STALE_OFFER');
  expect(()=>decideSpotOffer({...game,status:'active'},'b','confirm',100)).toThrow('GAME_NOT_OPEN');
  expect(game.players).toEqual(['a']);expect(game.waitlist).toEqual(['b','c']);
});
test.each(['scheduled','locked','active'])('actual offer expiry sweep handles %s safely',async status=>{
  const source=fs.readFileSync('functions/src/index.ts','utf8'),tree=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);
  const node=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runExpireStaleOffers')!;
  const game={status,players:['a'],waitlist:['b','c'],pending:['d'],maxPlayers:3,pendingPromotion:{uid:'b',offeredAt:Date.now()-3600000}};
  const update=jest.fn(),snapshot={id:'round',ref:{id:'round'},exists:true,data:()=>game};
  const query:any={where:()=>query,limit:()=>query,get:async()=>({empty:false,docs:[snapshot]})};
  const db={collection:()=>query,runTransaction:async(fn:any)=>fn({get:async()=>snapshot,update})};
  const run=vm.runInNewContext(ts.transpileModule(`${node.getText(tree)}; runExpireStaleOffers`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,
    {db,Date,MIN_OFFER_TTL_MS:120000,PROMO_OFFER_TTL_MS:1200000,console:{log(){},error(){}}});
  await run();
  if(status==='active')expect(update).not.toHaveBeenCalled();
  else{
    expect(update).toHaveBeenCalledTimes(1);
    expect(Array.from(update.mock.calls[0][1].waitlist)).toEqual(['c','b']);
    expect(update.mock.calls[0][1].pendingPromotion.uid).toBe('c');
    expect(Array.from(update.mock.calls[0][1].participantIds)).toEqual(['a','c','b','d']);
  }
});
function service(io: any, extras: any={}) {
  return load(gamesSource,{
    'firebase/firestore':io,'@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({db:{}})},
    '@/firebase/firestore':{col:{games:()=> 'games'},docs:{game:(id:string)=>id}},
    '@/utils/eveningPlayed':{eveningPlayState},'@/utils/seasonScope':{inSeason},
    '@/services/rotationEngine':{roundCommitKey},'./errorLog':{logError(){}},'@/services/errorLog':{logError(){}},...extras,
  }).gameService;
}
const raw=Array.from({length:401},(_,i)=>({id:`g${i}`,status:'finished',endedBy:'admin',startsAt:i+1,players:['u'],seasonId:i<10?'s1':'s2'}));
function pages(failPage=0) {
  let reads=0;
  return {
    query:(_col:any,...clauses:any[])=>clauses,where:(...x:any[])=>({where:x}),orderBy:()=>({order:true}),limit:(n:number)=>({limit:n}),startAfter:(cursor:any)=>({cursor}),
    getDocs:jest.fn(async (clauses:any[])=>{
      if(++reads===failPage)throw Error('offline');
      const cursor=clauses.find(c=>c.cursor)?.cursor,after=cursor?raw.findIndex(g=>g.id===cursor.id)+1:0;
      return {docs:raw.slice(after,after+clauses.find(c=>c.limit).limit).map(g=>({id:g.id,data:()=>g}))};
    }),
  };
}
test('lifetime scans every page and keeps the season numerator separate',async()=>{
  const io=pages(),s=await service(io).getCommunityStats('club',{currentId:'s2',currentNo:2},true);
  expect(io.getDocs).toHaveBeenCalledTimes(3);
  expect(s.lifetime.totalFinished).toBe(401);expect(s.totalFinished).toBe(391);expect(s.attendedByUser.u).toBe(391);
  expect(s.lifetime.longestStreak).toBe(401);
});
test('a later page failure never returns partial lifetime data',async()=>{
  const io=pages(2);
  await expect(service(io).getCommunityStats('club',undefined,true)).rejects.toThrow('offline');
});
test.each([
  [{players:[],waitlist:[],pending:[],registeredUserIds:['old'],waitlistUserIds:['old'],pendingUserIds:['old']},[]],
  [{players:null,waitlist:null,pending:null,registeredUserIds:['old'],waitlistUserIds:['old'],pendingUserIds:['old']},[]],
  [{registeredUserIds:['old'],waitlistUserIds:['old'],pendingUserIds:['old']},['old']],
])('actual game converter respects absent versus explicitly empty roster: %j',(input,expected)=>{
  const module=load('src/firebase/firestore.ts',{
    'firebase/firestore':{collection:()=>({withConverter:(converter:any)=>converter})},
    './config':{getFirebase:()=>({db:{}})},'@/types':{TEAM_SIZE_MIN:2,TEAM_SIZE_MAX:11},
  });
  const result=module.col.games().fromFirestore({id:'g',data:()=>input});
  for(const field of ['players','waitlist','pending','participantIds'])expect(Array.from(result[field])).toEqual(expected);
});
function transactional(initial:any){
  const state={...initial};const update=jest.fn((_ref:any,patch:any)=>{
    for(const [key,value]of Object.entries(patch)){
      const path=key.split('.');if(path.length===1)state[key]=value;else if(path.length===2)state[path[0]][path[1]]=value;else state[path[0]][path[1]][path[2]]=value;
    }
  });
  const io={runTransaction:async(_db:any,fn:any)=>fn({get:async()=>({data:()=>state}),update})};
  return {state,update,service:service(io)};
}
test('starting twice does not reset existing shootout kicks or keepers',async()=>{
  const x=transactional({status:'active',rotation:{roundInstanceId:'r'},liveMatch:{scoreA:0,scoreB:0}});
  await x.service.startShootout('g','A','r');
  x.state.liveMatch.shootout.kicks.push({id:'kick'});x.state.liveMatch.shootout.keeperA='keeper';
  await x.service.startShootout('g','B','r');
  expect(x.update).toHaveBeenCalledTimes(1);expect(x.state.liveMatch.shootout.firstTeam).toBe('A');
  expect(x.state.liveMatch.shootout.kicks).toHaveLength(1);expect(x.state.liveMatch.shootout.keeperA).toBe('keeper');
});
test('stale round cannot start or modify the next shootout',async()=>{
  const x=transactional({status:'active',rotation:{roundInstanceId:'next'},liveMatch:{shootout:{firstTeam:'A',kicks:[]}}});
  await expect(x.service.startShootout('g','A','previous')).rejects.toThrow('SHOOTOUT_CHANGED');
  await expect(x.service.setShootoutKeeper('g','A','u','previous')).rejects.toThrow('SHOOTOUT_CHANGED');
  expect(x.update).not.toHaveBeenCalled();
});
test('closed shootout writes reject instead of reporting success',async()=>{
  const x=transactional({status:'finished',liveMatch:{shootout:{firstTeam:'A',kicks:[]}}});
  await expect(x.service.startShootout('g','B')).rejects.toThrow('SHOOTOUT_CLOSED');
  await expect(x.service.setShootoutKeeper('g','A','u')).rejects.toThrow('SHOOTOUT_CLOSED');
  expect(x.update).not.toHaveBeenCalled();
});
function initializer(name:string,context:any){
  const text=fs.readFileSync('src/components/match/Shootout.tsx','utf8'),file=ts.createSourceFile('Shootout.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let expression:string|undefined;
  const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(file)===name)expression=n.initializer?.getText(file);ts.forEachChild(n,visit);};visit(file);
  if(!expression)throw Error(name);
  return vm.runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
test('setup failure retains retry and a double tap cannot issue another write',async()=>{
  const ctx:any={writing:{current:false},setupAttempt:{current:null},uiEpoch:{current:1},visibleRef:{current:true},setBusy:jest.fn(),setSaveError:jest.fn()};
  const save=initializer('saveSetup',ctx);
  let reject!:(error:Error)=>void;const write=jest.fn(()=>new Promise<void>((_resolve,r)=>{reject=r}));
  const running=save(write);await save(write);expect(write).toHaveBeenCalledTimes(1);
  reject(Error('offline'));await running;expect(ctx.setSaveError).toHaveBeenLastCalledWith(true);
  expect(ctx.setupAttempt.current).toBe(write);expect(ctx.writing.current).toBe(false);expect(ctx.setBusy).toHaveBeenLastCalledWith(false);
  const successful=jest.fn(async()=>{});await save(successful);expect(ctx.setupAttempt.current).toBeNull();
});
test('keeper picker closes only after successful acknowledgement, including retry',async()=>{
  const ctx:any={writing:{current:false},setupAttempt:{current:null},uiEpoch:{current:1},visibleRef:{current:true},setBusy:jest.fn(),setSaveError:jest.fn(),setKeeperPicking:jest.fn(),rotation:undefined,
    gameId:'g',defendingTeam:'B',kicks:[],gameService:{setShootoutKeeper:jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(undefined)},logEvent:jest.fn(),AnalyticsEvent:{}};
  ctx.saveSetup=initializer('saveSetup',ctx);const pick=initializer('pickKeeper',ctx);
  pick('keeper');await new Promise(resolve=>setTimeout(resolve,0));expect(ctx.setKeeperPicking).not.toHaveBeenCalled();
  await ctx.saveSetup(ctx.setupAttempt.current);expect(ctx.setKeeperPicking).toHaveBeenCalledWith(false);
});
