import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import { personalHighlights } from '../../src/utils/personalStatistics';

const file=path.resolve(__dirname,'../../functions/src/socialPlayers.ts');
const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
const selected=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='readStatistics'||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['strings','number'].includes(d.name.getText(source))));
const code=selected.map(n=>n.getText(source)).join('\n')+'\nresult=readStatistics;';
const context:any={getFirestore:()=>({}),result:null};
vm.runInNewContext(ts.transpileModule(code,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);

test.each([
  {},{rounds:2,wins:1},{goals:0,assists:0,rounds:1},{goals:-1,assists:NaN,rounds:2},
  {goals:Infinity,assists:2,rounds:2,losses:1},{goals:2,rounds:0.5,wins:0.5},
  {goals:3,rounds:2,wins:null},{goals:0,rounds:2,wins:3},{assists:0,rounds:2,losses:-1},
])('social and self highlights use identical sparse/invalid data semantics: %j',async row=>{
  const played=[{id:'g',data:()=>({players:['u'],startsAt:10})}],rows={docs:[{data:()=>({gameId:'g',...row})}]};
  const server=await context.result('u',{stats:{}},played,1,[{docs:[{data:()=>({gameId:'g',score:6.7})}]},rows,{docs:[]},{docs:[]}]);
  expect(JSON.parse(JSON.stringify(server.stats.highlights))).toEqual(personalHighlights([{gameId:'g',at:10}],{g:6.7},{g:row}));
});
