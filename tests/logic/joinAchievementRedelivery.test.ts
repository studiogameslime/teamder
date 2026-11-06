import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the production per-joiner batch and its catch. Database I/O is replaced.
const source = ts.createSourceFile('index.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);
let loop = '';
function find(node: ts.Node) {
  if (ts.isForOfStatement(node) && node.expression.getText(source)==='freshJoiners') loop=node.getText(source);
  ts.forEachChild(node,find);
}
find(source);

function harness(error?: unknown) {
  const observeCaughtError=jest.fn(), warn=jest.fn(),create=jest.fn(),set=jest.fn();
  const commit=jest.fn(async()=>{if(error)throw error;});
  const ref:any={collection:()=>ref,doc:()=>ref};
  const db={...ref,batch:()=>({create,set,commit})};
  const context:any={module:{exports:{}},db,observeCaughtError,console:{warn},Date,
    admin:{firestore:{FieldValue:{increment:(n:number)=>({increment:n})}}},event:{params:{gameId:'round'}}};
  vm.runInNewContext(ts.transpileModule(`module.exports=async(freshJoiners)=>{${loop}}`,{
    compilerOptions:{target:ts.ScriptTarget.ES2022},
  }).outputText,context);
  return {run:context.module.exports,observeCaughtError,warn,create,set,commit};
}

test.each([6,'already-exists'])('an already credited join is idempotent without a false error (%s)',async code=>{
  const f=harness({code});await f.run(['player']);
  expect(f.create).toHaveBeenCalledTimes(1);expect(f.commit).toHaveBeenCalledTimes(1);
  expect(f.observeCaughtError).not.toHaveBeenCalled();expect(f.warn).not.toHaveBeenCalled();
});

test('unexpected failures are still observed and do not prevent another joiner being processed',async()=>{
  const error={code:14};const f=harness(error);await f.run(['one','two']);
  expect(f.commit).toHaveBeenCalledTimes(2);
  expect(f.observeCaughtError).toHaveBeenCalledWith(error,expect.objectContaining({site:'index:20a83f91b9'}));
  expect(f.warn).toHaveBeenCalledTimes(2);
});

test('a fresh join keeps the marker and increment in the same batch',async()=>{
  const f=harness();await f.run(['player']);
  expect(f.set).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({achievements:{gamesJoined:{increment:1}}}),{merge:true});
  expect(f.commit).toHaveBeenCalledTimes(1);expect(f.observeCaughtError).not.toHaveBeenCalled();
});
