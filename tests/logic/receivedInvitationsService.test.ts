import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';
import { receivedInvitations } from '../../src/utils/receivedInvitations';
import { retryRead } from '../../src/services/readRetry';

function fixture() {
  const user={id:'me',isGuest:false},auth={currentUser:{uid:'me'}},read=jest.fn(async()=>({docs:[]}));
  const where=jest.fn((...args:any[])=>args);
  const deps:Record<string,any>={
    './readRetry':{retryRead},
    'firebase/firestore':{collection:()=>({}),where,query:(...x:any[])=>x,getDocs:read},
    '@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({db:{},auth})},
    '@/store/userStore':{useUserStore:{getState:()=>({currentUser:user})}},
    './staleSession':{StaleSessionError},'./notificationsService':{},
    '@/utils/receivedInvitations':{receivedInvitations},
    'firebase/functions':{httpsCallable:()=>async()=>{throw {code:'functions/not-found'};}},
  };
  const module={exports:{} as any};
  const code=ts.transpileModule(fs.readFileSync('src/services/receivedInvitationsService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return deps[name];}});
  return {service:module.exports.receivedInvitationsService,read,where,user,auth};
}
test('received invitation query is bound to recipient; permission failures are not empty results',async()=>{
  const f=fixture();expect(await f.service.list('me')).toEqual([]);
  expect(f.where).toHaveBeenCalledWith('recipientId','==','me');
  f.read.mockRejectedValueOnce(new Error('denied'));
  await expect(f.service.list('me')).rejects.toThrow('denied');
});
test('previous account cannot query or receive a late invitation response',async()=>{
  const f=fixture();
  await expect(f.service.list('other')).rejects.toBeInstanceOf(StaleSessionError);
  expect(f.read).not.toHaveBeenCalled();
  f.read.mockImplementationOnce(async()=>{f.auth.currentUser.uid='new';return {docs:[]};});
  await expect(f.service.list('me')).rejects.toBeInstanceOf(StaleSessionError);
});
test.each([true,'true',undefined])('club invitation routes boolean and push-string flags (%s)',flag=>{
  const nav={isReady:()=>true,navigate:jest.fn()},module={exports:{} as any};
  const deps:Record<string,any>={'react-native':{Linking:{}},'@react-navigation/native':{createNavigationContainerRef:()=>nav},'@/services/analyticsService':{AnalyticsEvent:{},logEvent:()=>{}}};
  const code=ts.transpileModule(fs.readFileSync('src/navigation/navigationRef.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:(name:string)=>{if(name.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(name.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(name==='@/services/diagnosticCallable')name='firebase/functions';return deps[name];}});
  expect(module.exports.navigateForPush('groupInvitation',{groupId:'club',invitationOnly:flag})).toBe(true);
  expect(nav.navigate).toHaveBeenCalledWith('CommunitiesTab',{screen:'CommunityDetailsPublic',initial:false,params:{groupId:'club',fromInvitation:true}});
});
