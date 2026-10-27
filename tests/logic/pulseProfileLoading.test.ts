import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
const source=ts.createSourceFile('social.ts',fs.readFileSync('functions/src/socialPlayers.ts','utf8'),99,true);
function endpoint(name:string){
 let code='';function visit(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(source)===name)code=n.initializer!.getText(source);ts.forEachChild(n,visit);}visit(source);
 if(!code)throw Error(name);return code;
}
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test.each([true,false])('profile reads statistics concurrently only after privacy allows it: %s',async allowed=>{
 let finishClubs!:(v:any)=>void;const clubs=new Promise(r=>{finishClubs=r;});
 const records={kept:true},statistics={stats:{goals:42}};
 const context:any={module:{exports:{}},onCall:(_opts:any,fn:any)=>fn,ENFORCE_APP_CHECK:false,
  session:async()=>({uid:'me',user:{},db:{doc:(path:string)=>({get:async()=>path.startsWith('users/')?{exists:true,data:()=>({name:'איתי'})}:{data:()=>null}}),collection:()=>({where:()=>({get:async()=>({docs:[]})})})}}),
  blocked:async()=>false,validId:(id:string)=>id,clubsFor:()=>clubs,statisticsAllowed:()=>allowed,
  readStatisticsRows:jest.fn(async()=>records),readStatistics:jest.fn(async()=>statistics),
  socialIdentity:(id:string,u:any)=>({id,name:u.name}),socialPrivacy:()=>({statistics:'friends'}),socialPairSummary:()=>null,
  number:(n:unknown)=>typeof n==='number'?n:0,strings:(v:unknown)=>Array.isArray(v)?v:[]};
 vm.runInNewContext(ts.transpileModule('module.exports='+endpoint('getSocialPlayerProfile'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const pending=context.module.exports({data:{userId:'target'}});await flush();
 expect(context.readStatisticsRows).toHaveBeenCalledTimes(allowed?1:0);
 expect(context.readStatistics).not.toHaveBeenCalled();
 finishClubs({docs:[]});const profile=await pending;
 expect(profile.statistics).toEqual(allowed?statistics:null);
 if(allowed)expect(context.readStatistics).toHaveBeenCalledWith('target',expect.any(Object),[],0,records);
});
