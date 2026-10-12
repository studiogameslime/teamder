import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';
import { playerSearchMatches, playerDiscoveryMatches } from '../../src/utils/socialPlayers';
function fixture(retry?: (fn:()=>Promise<any>)=>Promise<any>) {
  const auth={currentUser:{uid:'old',isAnonymous:false}},state={currentUser:{id:'old',isGuest:false}};
  const remote=jest.fn(async()=>({data:{players:[],cursor:null}})),local=jest.fn();
  const deps:Record<string,any>={
    'firebase/functions':{httpsCallable:()=>remote},
    '@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({auth,functions:{}})},
    '@/firebase/authRace':{withAuthRaceRetry:retry??((fn:()=>Promise<any>)=>fn())},
    './staleSession':{StaleSessionError},
    '@/store/userStore':{useUserStore:{getState:()=>state,setState:local}},
    '@/utils/socialPlayers':{playerSearchMatches,playerDiscoveryMatches},
  };
  const module={exports:{} as any};
  const code=ts.transpileModule(fs.readFileSync('src/services/socialPlayersService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>deps[name]});
  return {service:module.exports.socialPlayersService,auth,state,remote,local};
}
test('privacy form belonging to previous account cannot write current account',async()=>{
  const f=fixture();f.auth.currentUser.uid='new';f.state.currentUser.id='new';
  await expect(f.service.savePrivacy({discoverable:false,statistics:'onlyMe'},'old')).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.remote).not.toHaveBeenCalled();expect(f.local).not.toHaveBeenCalled();
});
test('identity switch before auth retry prevents a remote action',async()=>{
  let f:ReturnType<typeof fixture>;
  f=fixture(async fn=>{f.auth.currentUser.uid='new';f.state.currentUser.id='new';return fn();});
  await expect(f.service.search({text:'איתי'})).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.remote).not.toHaveBeenCalled();
});
test('late response cannot become results of another account',async()=>{
  const f=fixture();f.remote.mockImplementationOnce(async()=>{f.auth.currentUser.uid='new';return {data:{players:[],cursor:null}};});
  await expect(f.service.search({})).rejects.toBeInstanceOf(StaleSessionError);
});

test('multi-select remains compatible with deployed search and preserves pagination',async()=>{
  const f=fixture();
  const player={id:'p',name:'איתי',city:'אור יהודה',friend:false,availability:{availabilitySlots:{3:['evening'],5:['morning']}}};
  f.remote.mockResolvedValueOnce({data:{players:[player],cursor:'next'}} as any);
  const result=await f.service.search({days:[1,3],times:['morning','noon'],cursor:'previous'});
  expect(f.remote).toHaveBeenCalledWith({cursor:'previous'});
  expect(result.players).toEqual([]);
  expect(result.cursor).toBe('next');
  f.remote.mockResolvedValueOnce({data:{players:[player],cursor:null}} as any);
  expect((await f.service.search({days:[3],times:['evening','noon']})).players).toEqual([player]);
  expect(f.remote).toHaveBeenLastCalledWith({day:3});
});

test('legacy server pages keep their cursor when existing friends are excluded locally',async()=>{
 const f=fixture(),friend={id:'friend',name:'איתי',city:'',friend:true};
 f.remote.mockResolvedValueOnce({data:{players:[friend],cursor:'after-friend'}} as any);
 expect(await f.service.search({})).toEqual({players:[],cursor:'after-friend'});
 f.remote.mockResolvedValueOnce({data:{players:[friend],cursor:null}} as any);
 expect(await f.service.search({friendsOnly:true})).toEqual({players:[friend],cursor:null});
});
