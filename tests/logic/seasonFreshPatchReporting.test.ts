import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('competing season snapshots request a later sweep without an incident; other failures propagate',async()=>{
 const observe=jest.fn(),update=jest.fn(),module={exports:{} as any};
 ((vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext)(ts.transpileModule(fs.readFileSync('functions/src/seasonManager.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,
  {module,exports:module.exports,require:(name:string)=>name==='./serverErrorLog'?{observeCaughtError:observe}:{},Date});
 const manager=new module.exports.SeasonManager({db:{}}),snapshot={updateTime:'version'};
 for(const code of [9,'failed-precondition']) {
  update.mockRejectedValueOnce({code});expect(await manager.patchIfFresh({update},snapshot,{playedRounds:3})).toBe(false);
 }
 expect(observe).not.toHaveBeenCalled();
 const error={code:14};update.mockRejectedValueOnce(error);
 await expect(manager.patchIfFresh({update},snapshot,{playedRounds:3})).rejects.toBe(error);
 expect(observe).toHaveBeenCalledWith(error,expect.anything());
 update.mockResolvedValueOnce(undefined);expect(await manager.patchIfFresh({update},snapshot,{playedRounds:3})).toBe(true);
 expect(update).toHaveBeenLastCalledWith({'seasons.playedRounds':3},{lastUpdateTime:'version'});
});
