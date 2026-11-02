import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { isTransientReadError } from '@/services/readRetry';

function fixture(){
 const source=ts.createSourceFile('service.ts',fs.readFileSync('src/services/gameService.ts','utf8'),ts.ScriptTarget.Latest,true);
 let method:ts.MethodDeclaration|undefined;function walk(n:ts.Node){if(ts.isMethodDeclaration(n)&&n.name.getText(source)==='publishDraftTeams')method=n;ts.forEachChild(n,walk);}walk(source);
 if(!method)throw Error('Missing publication method');
 const original=Object.assign(Error('response lost'),{code:'functions/internal'});
 const auth={currentUser:{uid:'owner'}};
 const update=jest.fn(async()=>{}),notify=jest.fn(async()=>{throw original;});
 const receipt={draftTeams:{published:true,createdAt:10,teams:[{index:0,playerIds:['a'],colorKey:'red'}]},teamsNotifiedAt:150};
 const read=jest.fn(async()=>({exists:()=>true,data:()=>receipt}));
 const run=vm.runInNewContext(ts.transpileModule(`({${method.getText(source)}}).publishDraftTeams`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
  USE_MOCK_DATA:false,updateGameDoc:update,getFirebase:()=>({auth,db:'db'}),serverNow:()=>100,
  isTransientReadError,withAuthRaceRetry:(f:()=>unknown)=>f(),getDocFromServer:read,doc:(_db:unknown,_collection:string,id:string)=>id,observeCaughtError:jest.fn(),
 });
 const target={getGameById:async()=>({id:'g',status:'open',draftTeams:{published:true,createdAt:10,teams:[{index:0,playerIds:['a'],colorKey:'red'}]}}),notifyTeamsReady:notify};
 return {publish:()=>run.call(target,'g'),read,update,notify,original,receipt,auth};
}

test('a lost notification response is recovered only by a matching new server receipt, without replaying a write',async()=>{
 const f=fixture();await expect(f.publish()).resolves.toBeUndefined();
 expect(f.update).toHaveBeenCalledTimes(1);expect(f.notify).toHaveBeenCalledTimes(1);expect(f.read).toHaveBeenCalledTimes(1);
});
test.each(['old','different split','changed players','changed colour','unpublished','invalid time'] as const)('an %s receipt cannot hide an unconfirmed notification failure',async kind=>{
 const f=fixture();if(kind==='old')f.receipt.teamsNotifiedAt=99;
 if(kind==='different split')f.receipt.draftTeams.createdAt=11;
 if(kind==='changed players')f.receipt.draftTeams.teams[0].playerIds=['other'];
 if(kind==='changed colour')f.receipt.draftTeams.teams[0].colorKey='blue';
 if(kind==='unpublished')f.receipt.draftTeams.published=false;
 if(kind==='invalid time')f.receipt.teamsNotifiedAt=NaN;
 await expect(f.publish()).rejects.toBe(f.original);expect(f.notify).toHaveBeenCalledTimes(1);
});
test('a denial is never replaced with success from an old server receipt',async()=>{
 const f=fixture(),denial=Object.assign(Error('denied'),{code:'functions/permission-denied'});f.notify.mockRejectedValueOnce(denial);
 await expect(f.publish()).rejects.toBe(denial);expect(f.read).not.toHaveBeenCalled();
});
test('account switch or failure during receipt verification retains the failure and never resends',async()=>{
 for(const mode of ['switch','offline']){
  const f=fixture();f.read.mockImplementationOnce(async()=>{if(mode==='offline')throw Error('offline');f.auth.currentUser.uid='other';return {exists:()=>true,data:()=>f.receipt};});
  await expect(f.publish()).rejects.toBe(f.original);expect(f.notify).toHaveBeenCalledTimes(1);
 }
});
