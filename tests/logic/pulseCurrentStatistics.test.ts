import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const source=ts.createSourceFile('StatisticsScreen.tsx',fs.readFileSync('src/screens/profile/StatisticsScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let effect='';
function visit(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(source)==='useEffect'&&n.arguments[0]?.getText(source).includes('const uid = targetId'))effect=n.arguments[0].getText(source);ts.forEachChild(n,visit);}visit(source);
function fixture(){
 let resolve!:(data:any)=>void,reject!:(error:Error)=>void;
 const fresh=new Promise((yes,no)=>{resolve=yes;reject=no;});
 const setters=Object.fromEntries(['setStats','setPen','setPeople','setFailed','setLoading','setHighlightsLoading','setRestricted','setTargetUser'].map(k=>[k,jest.fn()]));
 const compute=jest.fn(async()=>({attendedGames:1})),observe=jest.fn(),log=jest.fn();
 const context:any={module:{exports:{}},...setters,targetId:'me',ownerKey:'me:me',statsOwnerRef:{current:'me:me'},otherPlayer:false,localUser:{id:'me'},
  userService:{getUserById:()=>fresh},playerStatsService:{compute},observeCaughtError:observe,logError:log};
 vm.runInNewContext(ts.transpileModule('module.exports='+effect,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const cleanup=context.module.exports();return{resolve,reject,cleanup,compute,observe,log,setters};
}
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};

test('leaving before the user read completes cancels quietly, without starting statistics or reporting an error',async()=>{
 const f=fixture();f.cleanup();f.resolve({stats:{goals:3}});await flush();
 expect(f.compute).not.toHaveBeenCalled();expect(f.observe).not.toHaveBeenCalled();expect(f.log).not.toHaveBeenCalled();expect(f.setters.setStats).not.toHaveBeenCalled();
});
test('a late failed read after leaving cannot report an obsolete failure or update a new screen',async()=>{
 const f=fixture();f.cleanup();f.reject(Error('unavailable'));await flush();expect(f.observe).not.toHaveBeenCalled();expect(f.log).not.toHaveBeenCalled();expect(f.setters.setFailed).not.toHaveBeenCalledWith(true);
});
test('a real failure while the screen is current still reports the error and exposes retry',async()=>{
 const f=fixture();f.reject(Error('unavailable'));await flush();expect(f.observe).toHaveBeenCalledTimes(1);expect(f.log).toHaveBeenCalledWith('loadStatistics',expect.any(Error),{userId:'me'});expect(f.setters.setFailed).toHaveBeenCalledWith(true);expect(f.setters.setLoading).toHaveBeenLastCalledWith(false);
});
test('a current successful read still computes and publishes the actual statistics',async()=>{
 const f=fixture();f.resolve({stats:{goals:3,assists:2}});await flush();expect(f.compute).toHaveBeenCalledWith('me',expect.objectContaining({goals:3,assists:2}));expect(f.setters.setStats).toHaveBeenCalledWith({attendedGames:1});expect(f.observe).not.toHaveBeenCalled();
});
