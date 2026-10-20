import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
const file=ts.createSourceFile('PlayerDiscovery.tsx',fs.readFileSync('src/components/social/PlayerDiscovery.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let continuation='';
const walk=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(file)==='useEffect'&&node.arguments[0]?.getText(file).includes('void more()'))continuation=node.arguments[0].getText(file);ts.forEachChild(node,walk);};walk(file);
test('empty examined pages keep searching a name until a later page, without waiting for a manual tap',()=>{
 const more=jest.fn(),state={preview:undefined,cursor:'after-first-40',busy:false,failed:false,list:[],more};
 const run=vm.runInNewContext(ts.transpileModule(`(${continuation})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,state);
 run();expect(more).toHaveBeenCalledTimes(1);
 state.cursor='after-next-40';run();expect(more).toHaveBeenCalledTimes(2);
 state.list=[{id:'israel'}] as any;run();expect(more).toHaveBeenCalledTimes(2);
});
test.each([{cursor:null},{busy:true},{failed:true},{preview:[]},{list:[{id:'found'}]}])('pagination stops for %p',patch=>{
 const more=jest.fn(),state={preview:undefined,cursor:'next',busy:false,failed:false,list:[],more,...patch};
 const run=vm.runInNewContext(ts.transpileModule(`(${continuation})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,state);
 run();expect(more).not.toHaveBeenCalled();
});
