import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
import { createHash } from 'crypto';
import { gameRemovalBlocksWrite } from '../../functions/src/gameProcessingGuard';
import { measureRoundChange } from '../../functions/src/managerRoundMeasurement';

function world(parent:boolean,reserved:boolean){
  const records=new Map<string,any>();if(parent)records.set('games/g',{status:'finished'});if(reserved)records.set('gameProcessingGuards/g',{state:'removing',active:{},operationId:'op'});
  const ref=(path:string):any=>({path,id:path.split('/').pop(),collection:(name:string)=>({doc:(id:string)=>ref(path+'/'+name+'/'+id)})});
  const db={doc:ref,collection:(p:string)=>({doc:(id:string)=>ref(p+'/'+id)}),runTransaction:async(fn:any)=>fn({get:async(r:any)=>({exists:records.has(r.path),data:()=>records.get(r.path)}),set:(r:any,v:any)=>records.set(r.path,v),create:(r:any,v:any)=>records.set(r.path,v)})};
  const source=ts.createSourceFile('managerRoundHistory.ts',fs.readFileSync('functions/src/managerRoundHistory.ts','utf8'),ts.ScriptTarget.Latest,true);
  const node=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)==='onManagerRoundChanged'));if(!node)throw Error('Manager trigger missing');
  const code=ts.transpileModule(node.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,ctx:any={exports:{},onDocumentWritten:(_p:any,fn:any)=>fn,getFirestore:()=>db,createHash,gameRemovalBlocksWrite,measureRoundChange};
  vm.runInNewContext(code,ctx);const before={exists:true,data:()=>({groupId:'club',players:['a'],maxPlayers:10,startsAt:10000})},after={exists:true,id:'g',updateTime:{toMillis:()=>20000},data:()=>({groupId:'club',players:['a','b'],maxPlayers:10,startsAt:10000})};
  return{records,invoke:()=>ctx.exports.onManagerRoundChanged({id:'event',params:{gameId:'g'},data:{before,after}})};
}
test.each([[false,false],[true,true]])('late manager measurement cannot create data when parent=%s reserved=%s',async(parent,reserved)=>{const w=world(parent,reserved),before=[...w.records];await w.invoke();expect([...w.records]).toEqual(before);});
test('normal manager measurement remains available',async()=>{const w=world(true,false);await w.invoke();expect(w.records.has('managerRoundMetrics/g')).toBe(true);});
