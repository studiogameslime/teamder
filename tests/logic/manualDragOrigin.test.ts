import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture(){
 const file=ts.createSourceFile('ManualAllocation.tsx',fs.readFileSync('src/components/draft/ManualAllocation.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let callback='';const visit=(node:ts.Node)=>{if(ts.isJsxAttribute(node)&&node.name.getText(file)==='onDrag'&&node.initializer&&ts.isJsxExpression(node.initializer))callback=node.initializer.expression!.getText(file);ts.forEachChild(node,visit);};visit(file);
 let measured:(...coords:number[])=>void=()=>{};
 const context:any={module:{exports:{}},p:{id:'player'},point:{current:null},root:{current:{measure:(fn:typeof measured)=>{measured=fn;}}},setOrigin:jest.fn(),setDrag:jest.fn()};
 vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {context,drag:context.module.exports,measure:()=>measured(0,0,411,727,0,75)};
}

test('first drag waits for the settled native screen origin and uses the latest pointer',()=>{
 const f=fixture();f.drag(209,301);expect(f.context.setDrag).not.toHaveBeenCalled();
 f.drag(225,305);f.measure();
 expect(f.context.setOrigin).toHaveBeenLastCalledWith({x:0,y:75,width:411});
 expect(f.context.setDrag).toHaveBeenLastCalledWith({id:'player',x:225,y:305});
});
test('a delayed native measurement cannot resurrect a released drag',()=>{
 const f=fixture();f.drag(209,301);f.context.point.current=null;f.measure();
 expect(f.context.setDrag).not.toHaveBeenCalled();expect(f.context.setOrigin).not.toHaveBeenCalled();
});
