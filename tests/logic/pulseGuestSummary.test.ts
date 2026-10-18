import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test.each([null,{id:'guest-local',isGuest:true},{id:'me',isGuest:false}])('personal summary does not read private data for an anonymous visitor: %j',async currentUser=>{
  const source=ts.createSourceFile('screen.tsx',fs.readFileSync('src/screens/games/EveningSummaryScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let callback='';
  const visit=(node:ts.Node)=>{if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&!callback)callback=node.arguments[0].getText(source);ts.forEachChild(node,visit);};visit(source);
  const getEveningSummary=jest.fn(async()=>null),setLoading=jest.fn();
  const context:any={module:{exports:{}},currentUser,loadedOwner:{current:''},summaryOwner:'g:me',gameId:'g',setScoreInfoVisible:jest.fn(),setLoading,setFailed:jest.fn(),setModel:jest.fn(),eveningSummaryService:{getEveningSummary},logError:jest.fn(),logEvent:jest.fn()};
  vm.runInNewContext(ts.transpileModule('module.exports='+callback,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const cleanup=context.module.exports();await new Promise(resolve=>setImmediate(resolve));
  expect(getEveningSummary).toHaveBeenCalledTimes(currentUser&&!currentUser.isGuest?1:0);
  expect(setLoading).toHaveBeenLastCalledWith(false);expect(context.logError).not.toHaveBeenCalled();cleanup();
});
