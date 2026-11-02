import fs from 'fs';
import ts from 'typescript';
function callable(db:any) {
  const source=fs.readFileSync('functions/src/index.ts','utf8');
  const start=source.indexOf('export const saveGamePhysical = onCall('),end=source.indexOf('// ── Pitch calibration',start);
  if(start<0||end<0)throw Error('Callable boundary missing');
  const code=ts.transpileModule(source.slice(start,end),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const exported:any={};new Function('exports','onCall','ENFORCE_APP_CHECK','db','HttpsError','gameRemovalBlocksWrite',code)(exported,(_:unknown,fn:unknown)=>fn,false,db,Error,async()=>false);
  return exported.saveGamePhysical;
}
test.each([[1000,500],[500,1000]])('parallel physical sync preserves the maximum (%s then %s)',async(first,second)=>{
  let stored:any={},version=0,retries=0,reads=0,release!:()=>void;
  const bothRead=new Promise<void>(r=>release=r);
  const ref={get:async()=>({data:()=>({...stored})}),set:async(data:any)=>{stored={...stored,...data};version++;}};
  const game={get:async()=>({exists:true,ref:game,data:()=>({players:['u'],status:'finished'})}),collection:()=>({doc:()=>ref})};
  const db={collection:()=>({doc:()=>game}),runTransaction:async(fn:any)=>{
    for(let i=0;i<4;i++){
      const readVersion=version;let pending:any;
      await fn({get:async(target:any)=>{if(target===game)return {exists:true};const copy={...stored};if(++reads===2)release();if(reads<=2)await bothRead;return {data:()=>copy};},set:(_:any,data:any)=>{pending=data;}});
      if(readVersion!==version){retries++;continue;}stored={...stored,...pending};version++;return;
    }throw Error('Retries exhausted');
  }};
  const save=callable(db);
  await Promise.all([first,second].map(distanceM=>save({auth:{uid:'u'},data:{gameId:'local',metrics:{distanceM,steps:distanceM*2,hrZones:{light:distanceM/10}}}})));
  expect(retries).toBe(1);expect(stored).toMatchObject({distanceM:1000,steps:2000,hrZones:{light:100}});
});

test('a physical sync that read the game before removal cannot recreate a physical row after removal',async()=>{
  const set=jest.fn(),game:any={get:async()=>({exists:true,ref:game,data:()=>({players:['u'],status:'finished'})}),collection:()=>({doc:()=>({})})};
  const db={collection:()=>({doc:()=>game}),runTransaction:async(fn:any)=>fn({get:async()=>({exists:false}),set})};
  await expect(callable(db)({auth:{uid:'u'},data:{gameId:'g',metrics:{distanceM:100}}})).rejects.toThrow();
  expect(set).not.toHaveBeenCalled();
});
