import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file=ts.createSourceFile('StatisticsScreen.tsx',fs.readFileSync('src/screens/profile/StatisticsScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const registrations:string[]=[];
function visit(node:ts.Node) {
 if(ts.isCallExpression(node)&&['useEffect','useFocusEffect'].includes(node.expression.getText(file)))registrations.push(node.getText(file));
 ts.forEachChild(node,visit);
}
visit(file);
const flush=()=>new Promise(setImmediate);
function deferred(){let resolve!:(value:any)=>void;const promise=new Promise(yes=>{resolve=yes;});return{promise,resolve};}
function fixture(otherPlayer=false) {
 const reads:ReturnType<typeof deferred>[]=[];
 const mount:Array<()=>any>=[],focus:Array<()=>any>=[];
 let cleanups:Array<()=>void>=[],tick=false;
 const highlights=deferred();
 const base={attendedGames:1,mostPlayedWith:{uid:'peer',count:1},mostWinsWith:{uid:'peer',count:1}};
 const setters=Object.fromEntries(['setStats','setPen','setPeople','setFailed','setLoading','setHighlightsLoading','setRestricted','setTargetUser'].map(name=>[name,jest.fn()]));
 const ctx:any={...setters,reloadTick:0,targetId:otherPlayer?'other':'me',ownerKey:otherPlayer?'me:other':'me:me',statsOwnerRef:{current:otherPlayer?'me:other':'me:me'},localUser:{id:'me',stats:{}},otherPlayer,
  userService:{getUserById:jest.fn((id:string)=>{if(id==='peer')return Promise.resolve({id,name:'חבר'});const r=deferred();reads.push(r);return r.promise;})},
  socialPlayersService:{profile:jest.fn(()=>{const r=deferred();reads.push(r);return r.promise;})},
  playerStatsService:{compute:jest.fn((_id:string,opts:any)=>{opts.onBase(base);return highlights.promise;})},
  React:{useCallback:(cb:any)=>cb},useEffect:(cb:any)=>mount.push(cb),useFocusEffect:(cb:any)=>focus.push(cb),
  setReloadTick:()=>{tick=true;},observeCaughtError:jest.fn(),logError:jest.fn()};
 vm.runInNewContext(ts.transpileModule(registrations.join(';'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const enter=()=>{
  cleanups=focus.map(cb=>cb()).filter(Boolean);
  if(tick){tick=false;for(const cb of mount)cb();}
 };
 for(const cb of mount)cb();
 enter();
 return {ctx,reads,base,highlights,blur:()=>{for(const cleanup of cleanups)cleanup();},enter};
}

test.each([false,true])('first entry loads once and returning refreshes once, otherPlayer=%s',async other=>{
 const f=fixture(other);
 expect(f.reads).toHaveLength(1);
 f.blur();f.enter();
 expect(f.reads).toHaveLength(2);
 if(other)expect(f.ctx.userService.getUserById).not.toHaveBeenCalled();
});

test('blur cancels the source before statistics computation and return can load again',async()=>{
 const f=fixture();f.blur();f.reads[0].resolve({stats:{goals:4}});await flush();
 expect(f.ctx.playerStatsService.compute).not.toHaveBeenCalled();
 f.enter();f.reads[1].resolve({stats:{goals:5}});await flush();
 expect(f.ctx.playerStatsService.compute).toHaveBeenCalledTimes(1);
});

test('peer identities resolve with base statistics while historical enrichment remains pending, without duplicate reads',async()=>{
 const f=fixture();f.reads[0].resolve({stats:{goals:4}});await flush();
 expect(f.ctx.userService.getUserById.mock.calls).toEqual([['me'],['peer']]);
 expect(f.ctx.setPeople).toHaveBeenCalledWith({peer:{id:'peer',name:'חבר'}});
 expect(f.ctx.setHighlightsLoading).not.toHaveBeenCalledWith(false);
 f.highlights.resolve({...f.base,highlights:{}});await flush();
 expect(f.ctx.userService.getUserById).toHaveBeenCalledTimes(2);
 expect(f.ctx.setHighlightsLoading).toHaveBeenLastCalledWith(false);
});

test('leaving prevents a late other-player response from publishing or calling private queries',async()=>{
 const f=fixture(true);f.blur();f.reads[0].resolve({player:{id:'other'},canSeeStatistics:true,statistics:{stats:{attendedGames:9},pen:{},people:{}}});await flush();
 expect(f.ctx.setStats).not.toHaveBeenCalledWith({attendedGames:9});
 expect(f.ctx.userService.getUserById).not.toHaveBeenCalled();
});

test('other-player access is checked again after returning and denial cannot keep old numbers',async()=>{
 const f=fixture(true);f.reads[0].resolve({player:{id:'other'},canSeeStatistics:true,statistics:{stats:{attendedGames:9},pen:{},people:{}}});await flush();
 f.blur();f.enter();
 expect(f.ctx.setStats).toHaveBeenLastCalledWith(null);
 f.reads[1].resolve({player:{id:'other'},canSeeStatistics:false});await flush();
 expect(f.ctx.socialPlayersService.profile).toHaveBeenCalledTimes(2);
 expect(f.ctx.setRestricted).toHaveBeenLastCalledWith(true);
});
