import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const file=ts.createSourceFile('feed.tsx',fs.readFileSync('src/screens/games/GamesListScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let callback:ts.Node;
function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='reload')callback=(node.initializer as ts.CallExpression).arguments[0];ts.forEachChild(node,visit);}visit(file);
const code=ts.transpileModule('('+callback!.getText(file)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
function fixture(){
  let owner='owner';const requests:Array<{resolve:(v:any)=>void;reject:(e:any)=>void}>=[];
  const read=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
  const state:any={loading:true,refreshing:false,loadFailed:false,feedOwner:null,myGames:[],communityGames:[],openGames:[],scheduledUpcoming:[]};
  const context:any={user:{id:'owner'},myCommunities:[],gameService:{getMyLiveOrUpcomingGames:read,getCommunityGames:read,getOpenGames:read,getMyUpcomingScheduledGames:read},feedRequest:{current:0},useUserStore:{getState:()=>({currentUser:{id:owner}})},hydratePlayers:jest.fn(),observeCaughtError:jest.fn(),logError:jest.fn(),__DEV__:false};
  Object.keys(state).forEach(key=>context['set'+key[0].toUpperCase()+key.slice(1)]=(v:any)=>{state[key]=v;});
  context.feedScope=JSON.stringify(['owner',false,[]]);context.currentFeedScope={current:context.feedScope};
  return {state,context,requests,reload:vm.runInNewContext(code,context),setOwner:(id:string)=>{owner=id;}};
}
test('failed initial reads cannot become an apparently empty round list, and a retry accepts a genuine empty response',async()=>{
  const f=fixture(),first=f.reload();f.requests[0].reject(Error('offline'));await first;expect(f.state).toMatchObject({loadFailed:true,feedOwner:null,loading:false});
  const retry=f.reload();f.requests.slice(4).forEach(r=>r.resolve([]));await retry;expect(f.state).toMatchObject({loadFailed:false,feedOwner:'owner',myGames:[],loading:false});
});
test('a failed refresh retains the prior confirmed snapshot including its owner',async()=>{
  const f=fixture();f.state.feedOwner='owner';f.state.myGames=[{id:'confirmed'}];const read=f.reload({pullToRefresh:true});
  expect(f.state.myGames).toEqual([{id:'confirmed'}]);f.requests[0].reject(Error('offline'));await read;
  expect(f.state).toMatchObject({loadFailed:true,refreshing:false,feedOwner:'owner',myGames:[{id:'confirmed'}]});
});
test('late replies and failures cannot replace a newer snapshot or its loading state',async()=>{
  const f=fixture(),old=f.reload(),current=f.reload();f.requests.slice(4).forEach(r=>r.resolve([{id:'new',players:[],waitlist:[]} ]));await current;
  f.requests[0].reject(Error('old'));await old;expect(f.state.myGames[0].id).toBe('new');expect(f.state.loadFailed).toBe(false);
});
test('switching account or leaving rejects old feed results before any list or owner is set',async()=>{
  const f=fixture(),old=f.reload();f.setOwner('other');f.requests.forEach(r=>r.resolve([{id:'private',players:[],waitlist:[]} ]));await old;
  expect(f.state.feedOwner).toBeNull();expect(f.state.myGames).toEqual([]);expect(f.context.hydratePlayers).not.toHaveBeenCalled();
  f.setOwner('owner');const left=f.reload();f.context.feedRequest.current++;f.requests.slice(4).forEach(r=>r.resolve([]));await left;expect(f.state.feedOwner).toBeNull();await flush();
});
