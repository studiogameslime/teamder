import fs from 'fs';
import ts from 'typescript';

function repair(parentExists:boolean) {
  const source=ts.createSourceFile('index.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);
  let callback:ts.Node|undefined;
  function visit(n:ts.Node){if(ts.isPropertyAssignment(n)&&n.name.getText(source)==='healHistory'&&ts.isConditionalExpression(n.initializer))callback=n.initializer.whenTrue;ts.forEachChild(n,visit);}visit(source);
  if(!callback)throw Error('Repair callback missing');
  const create=jest.fn(),parent={path:'games/g'},history={path:'games/g/roundHistory/r'};
  const db={runTransaction:async(fn:any)=>fn({get:async(ref:any)=>{expect(ref).toBe(parent);return {exists:parentExists};},create})};
  const code=ts.transpileModule('return ('+callback.getText(source)+');',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const invoke=new Function('db','snap','roundHistoryRef','roundHistoryDoc','HttpsError','console','gameId','roundId','observeCaughtError','gameRemovalBlocksWrite',code)(db,{ref:parent},history,{roundId:'r'},Error,{log:()=>{}},'g','r',()=>{},async()=>false);
  return {invoke,create,history};
}
test('late history healing refuses a removed parent',async()=>{const x=repair(false);await expect(x.invoke()).rejects.toThrow();expect(x.create).not.toHaveBeenCalled();});
test('legacy history healing still creates its receipt when the parent exists',async()=>{const x=repair(true);await x.invoke();expect(x.create).toHaveBeenCalledWith(x.history,{roundId:'r'});});
