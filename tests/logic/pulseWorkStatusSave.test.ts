import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture(save:jest.Mock){
 const file=ts.createSourceFile('TasksScreen.tsx',fs.readFileSync('pulse/src/screens/TasksScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let body='';function find(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='saveState')body=n.initializer!.getText(file);ts.forEachChild(n,find);}find(file);
 const row={key:'chat:alice',state:'open',claude:null};let items=[row];
 const context:any={module:{exports:{}},savingItems:{current:new Set()},closeItem:save,reopenItem:save,Alert:{alert:jest.fn()},setItems:(update:any)=>{items=update(items);}};
 vm.runInNewContext(ts.transpileModule('module.exports='+body,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 return {run:context.module.exports,row,context,getItems:()=>items};
}
test.each([false,'throw'])('failed status writes leave the visible task open: %s',async outcome=>{
 const f=fixture(outcome==='throw'?jest.fn().mockRejectedValue(Error('offline')):jest.fn().mockResolvedValue(false));
 await f.run(f.row,false);expect(f.getItems()[0].state).toBe('open');expect(f.context.Alert.alert).toHaveBeenCalled();expect(f.context.savingItems.current.size).toBe(0);
});
test('pending status saves keep the row open and block duplicate taps',async()=>{
 let finish!:(value:boolean)=>void;const save=jest.fn(()=>new Promise<boolean>(r=>{finish=r;}));const f=fixture(save);
 const first=f.run(f.row,false);await f.run(f.row,false);expect(save).toHaveBeenCalledTimes(1);expect(f.getItems()[0].state).toBe('open');
 finish(true);await first;expect(f.getItems()[0].state).toBe('done');expect(f.context.Alert.alert).not.toHaveBeenCalled();
});
