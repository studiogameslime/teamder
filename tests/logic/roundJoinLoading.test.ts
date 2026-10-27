import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the real handler with deferred network responses, without RN rendering.
function fixture(redBlocked = false) {
  const source=ts.createSourceFile('screen.tsx',fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler='';
  const visit=(node:ts.Node)=>{
    if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='performPrimary') handler=node.initializer!.getText(source);
    ts.forEachChild(node,visit);
  };
  visit(source);
  let resolve!:(value:any)=>void, reject!:(error:Error)=>void;
  const pending=new Promise<any>((r,j)=>{resolve=r;reject=j;});
  const setBusy=jest.fn(),requestJoinGame=jest.fn(()=>pending),hasActiveRedCard=jest.fn(()=>pending);
  const context:any={exports:{},user:{id:'me'},game:{id:'round',groupId:'club',players:[],waitlist:[],pending:[]},
    primaryInFlight:{current:false},isGuest:false,setBusy,statusForUser:()=> 'none',canJoinGame:()=>true,
    redBlocked,myCommunities:[],communityEventsService:{hasActiveRedCard},setRedBlocked:jest.fn(),
    gameService:{requestJoinGame},toast:{info:jest.fn(),error:jest.fn(),success:jest.fn()},he:{},
    __DEV__:false,reload:jest.fn(),setGame:jest.fn(),joinAudit:{current:null},
    setRegAnim:jest.fn(),successHaptic:jest.fn(),setCelebrate:jest.fn(),
    setTimeout:jest.fn(),clearTimeout:jest.fn(),JOIN_AUDIT_DELAY_MS:1000,gameRef:{current:null},logUnexpected:jest.fn()};
  vm.runInNewContext(ts.transpileModule('exports.run='+handler,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,Object.assign(context,{joinDiagnosticId:require('@/utils/joinDiagnosticId').joinDiagnosticId,runDiagnosticOperation:require('@/services/diagnosticJournal').runDiagnosticOperation,diagnosticEntity:require('@/services/diagnosticJournal').diagnosticEntity}));
  return {...context,run:context.exports.run as ()=>Promise<void>,resolve,reject,requestJoinGame,hasActiveRedCard};
}
test('join shows busy before the request settles and rapid presses send only one request',async()=>{
  const f=fixture(),first=f.run();
  expect(f.setBusy).toHaveBeenCalledWith(true);
  expect(f.requestJoinGame).toHaveBeenCalledTimes(1);
  await f.run();
  expect(f.requestJoinGame).toHaveBeenCalledTimes(1);
  f.resolve({bucket:'players'});await first;
  expect(f.toast.success).toHaveBeenCalledTimes(1);
  expect(f.toast.error).not.toHaveBeenCalled();
  expect(f.setBusy).toHaveBeenLastCalledWith(false);
  expect(f.primaryInFlight.current).toBe(false);
});
test('failed request clears busy and permits retry',async()=>{
  const f=fixture(),first=f.run();
  f.reject(new Error('unavailable'));await first;
  expect(f.toast.error).toHaveBeenCalledTimes(1);
  expect(f.setBusy).toHaveBeenLastCalledWith(false);
  expect(f.primaryInFlight.current).toBe(false);
  await f.run();expect(f.requestJoinGame).toHaveBeenCalledTimes(2);
});
test('busy also covers the preliminary red-card check and clears on early return',async()=>{
  const f=fixture(true),first=f.run();
  expect(f.setBusy).toHaveBeenCalledWith(true);
  await f.run();expect(f.hasActiveRedCard).toHaveBeenCalledTimes(1);
  f.resolve(true);await first;
  expect(f.requestJoinGame).not.toHaveBeenCalled();
  expect(f.setBusy).toHaveBeenLastCalledWith(false);
  expect(f.primaryInFlight.current).toBe(false);
});
