import fs from 'fs';
import ts from 'typescript';

test('legacy round batches guard the parent version even without a live-board payload',async()=>{
  const source=ts.createSourceFile('index.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);let callback:ts.Node|undefined;
  function visit(n:ts.Node){if(ts.isPropertyAssignment(n)&&n.name.getText(source)==='commitStats'&&n.initializer.getText(source).includes('sb.build'))callback=n.initializer;ts.forEachChild(n,visit);}visit(source);if(!callback)throw Error('Commit callback missing');
  const update=jest.fn(),commit=jest.fn(async()=>{}),batch={update,commit},db={batch:()=>batch};
  const code=ts.transpileModule('return ('+callback.getText(source)+');',{compilerOptions:{target:ts.ScriptTarget.ES2020}}).outputText;
  const fn=new Function('db','sb','inc','roundHistoryRef','roundHistoryDoc','liveGoalIds','snap','grpSnap','now',code)(db,{build:(x:unknown)=>x},()=>{},null,null,undefined,{ref:'game',updateTime:'captured-version'},null,123);
  await fn();expect(update).toHaveBeenCalledWith('game',{updatedAt:123},{lastUpdateTime:'captured-version'});expect(commit).toHaveBeenCalledTimes(1);
});

test('the operation limit always reserves the parent guard write',()=>{
  const source=fs.readFileSync('functions/src/index.ts','utf8');const start=source.indexOf('if (sb.opCount +'),end=source.indexOf('> MAX_ROUND_BATCH_OPS',start);
  const limit=source.slice(start,end);expect(limit).toContain('+ 1');expect(limit).not.toContain('liveGoalIds !== undefined ? 1 : 0');
});
