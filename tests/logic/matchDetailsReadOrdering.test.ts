import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const source=ts.createSourceFile('screen.tsx',fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function find(predicate:(n:ts.Node)=>boolean){let found:ts.Node|undefined;function walk(n:ts.Node){if(!found&&predicate(n))found=n;ts.forEachChild(n,walk);}walk(source);if(!found)throw Error('Callback not found');return found;}
const reloadNode=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(source)==='reload') as ts.VariableDeclaration;
const reload=((reloadNode.initializer as ts.CallExpression).arguments[0]).getText(source);
const liveCall=find(n=>ts.isCallExpression(n)&&n.expression.getText(source)==='useGameEvents') as ts.CallExpression;
const update=((liveCall.arguments[1] as ts.ObjectLiteralExpression).properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='onUpdate') as ts.PropertyAssignment).initializer as ts.CallExpression;
function callback(code:string,context:Record<string,unknown>){return vm.runInNewContext(ts.transpileModule(`(${code})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);}
function pending(){let resolve!:(g:any)=>void,reject!:(e:any)=>void;const promise=new Promise<any>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
 let game:any={id:'g',players:[],waitlist:[],status:'open'},loading=false,refreshing=false;
 const read=jest.fn(),setAccessBlocked=jest.fn(),logError=jest.fn();
 const c:any={gameId:'g',game,gameRef:{current:game},gameDataRevision:{current:0},gameLoadRequest:{current:0},gameRouteRef:{current:'g'},
  gameService:{getGameById:read},setGame:(value:any)=>{game=typeof value==='function'?value(game):value;c.gameRef.current=game;},
  setLoading:(v:boolean)=>{loading=v;},setRefreshing:(v:boolean)=>{refreshing=v;},setLoadError:jest.fn(),setAccessBlocked,setNotFound:jest.fn(),
  nav:{canGoBack:()=>false},hydratePlayers:jest.fn(),logEvent:jest.fn(),AnalyticsEvent:{},observeCaughtError:jest.fn(),logError,user:{id:'me'},__DEV__:false};
 return {c,read,load:callback(reload,c),live:callback(update.arguments[0].getText(source),c),get:()=>({game,loading,refreshing}),setAccessBlocked,logError};
}

test('a delayed focus read cannot overwrite the newer live registration roster',async()=>{
 const f=fixture(),r=pending();f.read.mockReturnValueOnce(r.promise);const loading=f.load();
 f.live({id:'g',players:['me'],waitlist:[],status:'open'});
 r.resolve({id:'g',players:[],waitlist:[],status:'open'});await loading;
 expect(f.get().game.players).toEqual(['me']);expect(f.get().loading).toBe(false);
});

test('a snapshot for the previous route is ignored',()=>{
 const f=fixture();f.c.gameRouteRef.current='new';f.live({id:'g',players:['old'],waitlist:[]});
 expect(f.get().game.players).toEqual([]);expect(f.c.gameDataRevision.current).toBe(0);
});

test('only the newest of two focus reads may change state or finish the spinner',async()=>{
 const f=fixture(),old=pending(),fresh=pending();f.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
 const a=f.load(),b=f.load();old.resolve({id:'g',players:['old']});await a;
 expect(f.get().loading).toBe(true);fresh.resolve({id:'g',players:['new'],waitlist:[]});await b;
 expect(f.get().game.players).toEqual(['new']);expect(f.get().loading).toBe(false);
});

test('an obsolete permission failure cannot blank a newer live roster',async()=>{
 const f=fixture(),r=pending();f.read.mockReturnValueOnce(r.promise);const loading=f.load({pullToRefresh:true});
 f.live({id:'g',players:['me'],waitlist:[]});r.reject(Object.assign(Error('old denial'),{code:'ACCESS_BLOCKED'}));await loading;
 expect(f.get().game.players).toEqual(['me']);expect(f.setAccessBlocked).not.toHaveBeenCalled();expect(f.logError).not.toHaveBeenCalled();
 expect(f.get().refreshing).toBe(false);
});

test('a read response cannot apply after the route changes or the screen is disposed',async()=>{
 for(const change of ['route','dispose']){
  const f=fixture(),r=pending();f.read.mockReturnValueOnce(r.promise);const loading=f.load();
  if(change==='route')f.c.gameRouteRef.current='other';else f.c.gameLoadRequest.current++;
  r.resolve({id:'g',players:['old'],waitlist:[]});await loading;expect(f.get().game.players).toEqual([]);
 }
});
