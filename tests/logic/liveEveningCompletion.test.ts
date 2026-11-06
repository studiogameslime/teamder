import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('a failed evening completion stays on the live screen and releases the ending latch for retry',async()=>{
 const source=ts.createSourceFile('live.tsx',fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let expression='';function walk(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='onEndGame')expression=node.initializer!.getText(source);ts.forEachChild(node,walk);}walk(source);
 const error=Error('offline'),endedHereRef={current:false},leaveLiveScreen=jest.fn(),setEnding=jest.fn(),toast={error:jest.fn()};
 const fn=vm.runInNewContext(ts.transpileModule(`(${expression})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
  gameId:'game',timerFeedback:{isPending:()=>false},endedHereRef,setEnding,leaveLiveScreen,toast,
  gameService:{endEvening:jest.fn().mockRejectedValue(error)},observeCaughtError:jest.fn(),logError:jest.fn(),__DEV__:false,
  roundSaveError:(_error:unknown,fallback:string)=>fallback,
 });
 await fn();
 expect(endedHereRef.current).toBe(false);expect(leaveLiveScreen).not.toHaveBeenCalled();
 expect(setEnding.mock.calls).toEqual([[true],[false]]);expect(toast.error).toHaveBeenCalledWith('המחזור לא הסתיים. בדקו את החיבור ונסו שוב.');
});
