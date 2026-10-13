import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {pairKey} from '@/utils/pairOrientation';

function fixture() {
  const source=ts.createSourceFile('pair.ts',fs.readFileSync('src/services/pairCompareService.ts','utf8'),ts.ScriptTarget.Latest,true);
  const reader=source.statements.find((s):s is ts.FunctionDeclaration=>ts.isFunctionDeclaration(s)&&s.name?.text==='readLivePair')!;
  const getDocs=jest.fn();
  const ctx:any={exports:{},getFirebase:()=>({db:'test-db'}),pairKey,getDocs,
    collection:(...args:unknown[])=>args,query:(...args:unknown[])=>args,
    where:(...args:unknown[])=>args,documentId:()=>'__name__',limit:(n:number)=>n,
    isExpectedDenial:()=>true,logError:jest.fn()};
  vm.runInNewContext(ts.transpileModule(reader.getText(source)+'\nexports.read=readLivePair;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  return {...ctx,getDocs};
}

test('missing pair is absent, and the query binds both club and exact sorted pair',async()=>{
  const f=fixture();f.getDocs.mockResolvedValue({docs:[]});
  expect(await f.exports.read('club','z','a')).toBeNull();
  expect(f.getDocs).toHaveBeenCalledWith([
    ['test-db','communityPairStats'],['groupId','==','club'],['a','==','a'],['b','==','z'],1,
  ]);
});
test('pair counters preserve orientation and finite values',async()=>{
  const f=fixture();f.getDocs.mockResolvedValue({docs:[{data:()=>({sameTeam:5,winsA:3,winsB:1,assistsAToB:2,assistsBToA:4,against:NaN})}]});
  expect(await f.exports.read('club','z','a')).toMatchObject({sameTeam:5,winsA:3,winsB:1,assistsAToB:2,assistsBToA:4,against:0});
});
test('genuine denied access is never turned into a claim that no pair exists',async()=>{
  const f=fixture(),error=Object.assign(new Error('Denied'),{code:'permission-denied'});
  f.getDocs.mockRejectedValue(error);
  await expect(f.exports.read('club','a','z')).rejects.toBe(error);
});
