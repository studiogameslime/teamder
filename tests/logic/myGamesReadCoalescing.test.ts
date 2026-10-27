import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { isAttendedGame } from '@/utils/playedGames';
import { didEveningHappen } from '@/utils/eveningPlayed';

const file=ts.createSourceFile('gameService.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
const globals=new Set(['MY_GAMES_TTL_MS','myGamesCache','myGamesInFlight','myGamesGeneration']);
const helpers=new Set(['clearMyGamesCache','cachedMyGames']);
const declarations=file.statements.filter(s=>ts.isVariableStatement(s)&&s.declarationList.declarations.some(d=>globals.has(d.name.getText(file)))||ts.isFunctionDeclaration(s)&&s.name&&helpers.has(s.name.text));
const object=file.statements.filter(ts.isVariableStatement).flatMap(s=>s.declarationList.declarations).find(d=>d.name.getText(file)==='gameService')!.initializer as ts.ObjectLiteralExpression;
const methods=object.properties.filter(p=>ts.isMethodDeclaration(p)&&['getMyGames','getMyRecentGamesRaw','getMyLiveOrUpcomingGames','getJustFinishedGame'].includes(p.name.getText(file)));
function deferred(){let resolve!:(value:any)=>void,reject!:(error:Error)=>void;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(){
 let now=Date.now();
 const requests:Array<{query:any;response:ReturnType<typeof deferred>}>=[];
 const getDocs=jest.fn((q:any)=>{const response=deferred();requests.push({query:q,response});return response.promise;});
 const ctx:any={module:{exports:{}},Date:{now:()=>now},USE_MOCK_DATA:false,isAttendedGame,didEveningHappen,
  myGamesFloor:()=>now-48*60*60_000,isStaleAfterStart:()=>false,
  query:(_col:any,...filters:any[])=>filters,where:(field:string,op:string,value:any)=>({field,op,value}),col:{games:()=>({})},getDocs,
  withAuthRaceRetry:(read:any)=>read(),observeSettledErrors:(results:any)=>results,observeCaughtError:jest.fn(),logError:jest.fn(),__DEV__:false};
 const source=declarations.map(s=>s.getText(file)).join('\n')+`;module.exports={cachedMyGames,clearMyGamesCache,service:{${methods.map(m=>m.getText(file)).join(',')}}};`;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {...ctx.module.exports,requests,getDocs,setNow:(value:number)=>{now=value;},now:()=>now};
}
const snapshot=(rows:any[])=>({docs:rows.map(row=>({id:row.id,data:()=>row}))});

test('home upcoming and just-finished aliases share one two-query read on a cold cache',async()=>{
 const f=fixture(),open={id:'open',status:'open',players:['u'],startsAt:f.now()+60_000},finished={id:'finished',status:'finished',players:['u'],startsAt:f.now()-60_000,endedBy:'admin'};
 const upcoming=f.service.getMyLiveOrUpcomingGames('u'),recent=f.service.getJustFinishedGame('u');
 expect(f.getDocs).toHaveBeenCalledTimes(2);
 for(const r of f.requests)r.response.resolve(snapshot([finished,open]));
 expect((await upcoming).map((g:any)=>g.id)).toEqual(['open']);expect((await recent).id).toBe('finished');
 await f.service.getMyRecentGamesRaw('u');expect(f.getDocs).toHaveBeenCalledTimes(2);
});

test('an invalidated late response neither repopulates cache nor releases a newer pending read',async()=>{
 const f=fixture(),old=deferred(),fresh=deferred();
 const first=f.cachedMyGames('recent:u',()=>old.promise);
 f.clearMyGamesCache();
 const read=jest.fn(()=>fresh.promise),second=f.cachedMyGames('recent:u',read);
 old.resolve(['old']);await first;
 const third=f.cachedMyGames('recent:u',read);expect(read).toHaveBeenCalledTimes(1);
 fresh.resolve(['fresh']);await Promise.all([second,third]);
 expect(await f.cachedMyGames('recent:u',jest.fn())).toEqual(['fresh']);
});

test('failed requests are shared, never cached, and retry starts immediately',async()=>{
 const f=fixture(),failed=deferred(),read=jest.fn(()=>failed.promise);
 const first=f.cachedMyGames('recent:u',read),second=f.cachedMyGames('recent:u',read);
 const error=Error('offline');failed.reject(error);
 await expect(first).rejects.toBe(error);await expect(second).rejects.toBe(error);expect(read).toHaveBeenCalledTimes(1);
 expect(await f.cachedMyGames('recent:u',async()=>['fresh'])).toEqual(['fresh']);
});

test('user and list scope stay separate, and TTL starts at response completion',async()=>{
 const f=fixture(),slow=deferred(),read=jest.fn(()=>slow.promise),start=f.now();
 const pending=f.cachedMyGames('recent:u',read);
 expect(await f.cachedMyGames('recent:v',async()=>['v'])).toEqual(['v']);
 expect(await f.cachedMyGames('open:u',async()=>['open'])).toEqual(['open']);
 f.setNow(start+20_000);slow.resolve(['u']);await pending;
 f.setNow(start+34_999);expect(await f.cachedMyGames('recent:u',read)).toEqual(['u']);expect(read).toHaveBeenCalledTimes(1);
 f.setNow(start+35_000);expect(await f.cachedMyGames('recent:u',async()=>['updated'])).toEqual(['updated']);
});

test.each(['getMyGames','getMyRecentGamesRaw'])('%s does not cache complete source failure as an empty list',async method=>{
 const f=fixture(),pending=f.service[method]('u'),error=Error('offline');
 f.requests[0].response.reject(error);f.requests[1].response.reject(error);
 await expect(pending).rejects.toBe(error);
 const retry=f.service[method]('u');expect(f.getDocs).toHaveBeenCalledTimes(4);
 f.requests[2].response.resolve(snapshot([]));f.requests[3].response.resolve(snapshot([]));
 expect(await retry).toEqual([]);
});

test.each(['getMyGames','getMyRecentGamesRaw'])('%s preserves the existing successful half when only one query fails',async method=>{
 const f=fixture(),pending=f.service[method]('u');
 f.requests[0].response.reject(Error('one unavailable source'));
 f.requests[1].response.resolve(snapshot([{id:'open',status:'open',startsAt:f.now()+60_000}]));
 expect((await pending).map((g:any)=>g.id)).toEqual(['open']);
});
