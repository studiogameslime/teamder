import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { applyChosenFill, nextFillNeeded, rosterOf } from '../../src/services/rotationEngine';

const file=path.resolve(__dirname,'../../src/screens/AdvancedLiveMatchScreen.tsx');
const ast=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function load(name:string,context:any){let code='';const visit=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)code=n.initializer!.getText(ast);ts.forEachChild(n,visit);};visit(ast);if(!code)throw Error(name);vm.runInNewContext(ts.transpileModule('module.exports='+code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);return context.module.exports;}
function world(mode:'temporary'|'permanent'='temporary'){
 const flow={draft:{teams:[]},working:{teams:[{index:0,playerIds:['a']},{index:1,playerIds:['b']},{index:2,playerIds:['x','y']}],loans:[]},playing:[0,1],perTeam:2,fillMode:mode,queue:[1],current:null,loserFirst:2,keepClock:false,savedResult:{a:2,b:0,winner:'האדומים'}};
 const context:any={module:{exports:{}},fillFlowRef:{current:flow},gameId:'g',nextFillNeeded,rosterOf,applyChosenFill,
  teamName:(i:number)=>['האדומים','הכחולים','הירוקים'][i],teamColor:()=> '#2865FF',resolveFillPlayer:(id:string)=>({id,name:id}),
  draftTeams:{teams:[]},toast:{info:jest.fn()},he:{},logEvent:jest.fn(),AnalyticsEvent:{},
  setFillRequest:(v:any)=>context.fillRequest=v,setBalancedRequest:(v:any)=>context.balancedRequest=v,
  advanceFillFlow:jest.fn()};
 return {context,flow};
}
test('sequential flow opens the new design for only the current team without inventing ratings or usage',async()=>{
 const {context}=world('permanent');
 await load('advanceFillFlow',context)();
 expect(context.balancedRequest.editableSide).toBe(1);
 expect(context.balancedRequest.sides.map((s:any)=>s.playerIds)).toEqual([['a'],['b']]);
 expect(context.balancedRequest.sides.map((s:any)=>s.members.map((p:any)=>p.id))).toEqual([['a'],['b']]);
 expect(context.balancedRequest.players.map((p:any)=>p.id)).toEqual(['x','y']);
 expect(context.balancedRequest.fillMode).toBe('permanent');
 expect(context.balancedRequest.showComparison).toBe(false);expect(context.balancedRequest.showUsage).toBe(false);
 expect(context.balancedRequest.savedResult).toContain('2–0');
});
test.each(['temporary','permanent'] as const)('new-design confirmation preserves %s completion behavior',mode=>{
 const {context,flow}=world(mode);flow.current=1 as any;
 context.fillRequest={requiredCount:1,players:[{id:'x'},{id:'y'}]};context.balancedRequest={editableSide:1};
 context.onFillConfirm=load('onFillConfirm',context);
 load('onBalancedConfirm',context)([[],['x']]);
 expect(context.advanceFillFlow).toHaveBeenCalledTimes(1);expect(flow.current).toBeNull();
 expect(rosterOf(1,flow.working.teams,flow.working.loans)).toEqual(['b','x']);
 expect(flow.working.loans).toHaveLength(mode==='temporary'?1:0);
 expect(flow.working.teams[2].playerIds).toEqual(mode==='temporary'?['x','y']:['y']);
});
test.each([{picks:[['x'],[]]},{picks:[[],['z']]},{picks:[[],['x','y']]},{picks:[[],['x','x']]}])('invalid selection cannot advance the sequential flow: %j',({picks})=>{
 const {context,flow}=world();flow.current=1 as any;
 context.fillRequest={requiredCount:1,players:[{id:'x'},{id:'y'}]};context.balancedRequest={editableSide:1};context.onFillConfirm=jest.fn();
 load('onBalancedConfirm',context)(picks);
 expect(context.onFillConfirm).not.toHaveBeenCalled();expect(context.balancedRequest).not.toBeNull();
});
