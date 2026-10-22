let mockUid='A';
const mockUpdate=jest.fn(),mockSet=jest.fn(),mockAdd=jest.fn();
const mockSaved=jest.fn(async(_rows:unknown[])=>{}),mockRead=jest.fn(async()=>[] as unknown[]);
const mockCrashlytics=jest.fn();
jest.mock('@/services/crashlyticsService',()=>({reportCrashlyticsError:(input:unknown)=>mockCrashlytics(input)}));
jest.mock('react-native',()=>({Platform:{OS:'android',Version:35}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'1.1.test'}}}));
jest.mock('@/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({db:{},auth:{get currentUser(){return {uid:mockUid,displayName:'demo'};}}})}));
jest.mock('firebase/firestore',()=>({doc:(_db:unknown,_col:unknown,id:string)=>id,collection:()=>({}),serverTimestamp:()=>123,increment:(n:number)=>n,updateDoc:(...a:unknown[])=>mockUpdate(...a),setDoc:(...a:unknown[])=>mockSet(...a),addDoc:(...a:unknown[])=>mockAdd(...a)}));
jest.mock('firebase/functions',()=>({httpsCallable:()=> (data:Record<string,unknown>)=>mockUpdate('recordClientError',data)}));
jest.mock('@/store/userStore',()=>({useUserStore:{getState:()=>({currentUser:{name:'demo'}})}}));
jest.mock('@/services/diagnosticStorage',()=>({readPendingDiagnosticErrors:()=>mockRead(),savePendingDiagnosticErrors:(r:unknown[])=>mockSaved(r),persistDiagnosticJournal:jest.fn(),readPreviousDiagnosticJournal:jest.fn(async()=>undefined)}));
beforeEach(()=>{jest.resetModules();jest.useFakeTimers();mockUid='A';mockUpdate.mockReset().mockResolvedValue(undefined);mockSet.mockReset().mockResolvedValue(undefined);mockAdd.mockReset().mockResolvedValue({});mockRead.mockReset().mockResolvedValue([]);mockSaved.mockClear();mockCrashlytics.mockReset();});
afterEach(()=>jest.useRealTimers());
it('does not upload ordinary recorded navigation or touches',()=>{
 const j=require('@/services/diagnosticJournal');j.diagnosticRoute('MatchDetails',{gameId:'g1'});j.recordDiagnostic('tap','touch_start',{x:10,y:20});jest.advanceTimersByTime(60000);
 expect(mockUpdate).not.toHaveBeenCalled();expect(mockSet).not.toHaveBeenCalled();expect(mockAdd).not.toHaveBeenCalled();
});
it('attaches the exact failure-time journal to automatic errors',async()=>{
 const j=require('@/services/diagnosticJournal'),e=require('@/services/errorLog');
 j.diagnosticRoute('MatchDetails',{gameId:'g1'});e.logError('joinGame',new Error('actual bug'));
 j.diagnosticRoute('Profile');await e.flush();
 const payload=mockUpdate.mock.calls[0][1],snap=JSON.parse(payload.lastJournal);
 expect(snap.entries.at(-1).name).toBe('joinGame');expect(payload.lastJournal).not.toContain('Profile');expect(payload.lastTrail).toContain('err joinGame');
});
it('restores an unsent previous-process crash only for the same account',async()=>{
 mockRead.mockResolvedValue([{fp:'abc',entry:{operation:'uncaught',message:'crash',pending:1,userId:'A',context:{},journal:'{"schema":1}',trail:'old trail',version:'old-version'}}]);
 const e=require('@/services/errorLog');await e.restorePendingErrors('A');
 expect(mockUpdate.mock.calls[0][1]).toMatchObject({lastTrail:'old trail',appVersion:'old-version',lastJournal:'{"schema":1}'});
 expect(mockCrashlytics).not.toHaveBeenCalled();
});
it('does not send previous-account errors after switching accounts',async()=>{
 mockRead.mockResolvedValue([{fp:'abc',entry:{operation:'uncaught',message:'crash',pending:1,userId:'B',context:{},journal:'{}',trail:'private B',version:'old'}}]);
 const e=require('@/services/errorLog');await e.restorePendingErrors('A');expect(mockUpdate).not.toHaveBeenCalled();
});
it('redacts error details before writing the local outbox and the remote error',async()=>{
 const e=require('@/services/errorLog');
 e.logError('createUserDoc',new Error('failed for private@example.invalid Bearer private-token'),{email:'private@example.invalid',gameId:'round-123',nested:{refreshToken:'private-token'}});
 await e.flush();
 const payload=mockUpdate.mock.calls[0][1];
 expect(JSON.stringify(payload)).not.toMatch(/private@example|private-token/);
 expect(payload.lastContext.gameId).toBe('round-123');
 expect(JSON.stringify(mockSaved.mock.calls)).not.toMatch(/private@example|private-token/);
});
it('sanitizes pending error context and messages saved by an older version before retry',async()=>{
 mockRead.mockResolvedValue([{fp:'abc',entry:{operation:'uncaught',message:'private@example.invalid',pending:1,userId:'A',context:{token:'old-secret',gameId:'g'},journal:'{"schema":1}',trail:'old trail',version:'old'}}]);
 const e=require('@/services/errorLog');await e.restorePendingErrors('A');
 expect(JSON.stringify(mockUpdate.mock.calls)).not.toMatch(/private@example|old-secret/);
 expect(mockUpdate.mock.calls[0][1].lastContext.gameId).toBe('g');
});
it('attaches the frozen screenshot-time journal to manual feedback',async()=>{
 const j=require('@/services/diagnosticJournal'),f=require('@/services/feedbackService');
 j.diagnosticRoute('MatchDetails',{gameId:'selected'});const captured=f.captureFeedbackDiagnostics('MatchDetails');j.diagnosticRoute('Profile');
 await f.submitFeedback('bug','test','Profile',undefined,'bug',captured);
 expect(mockAdd.mock.calls[0][1]).toMatchObject({screen:'MatchDetails',journal:captured.journal});expect(captured.journal).not.toContain('Profile');
});
it('manual form identifies the originating screen instead of Feedback',async()=>{
 const j=require('@/services/diagnosticJournal'),f=require('@/services/feedbackService');j.diagnosticRoute('CommunityDetails',{groupId:'club'});j.diagnosticRoute('Feedback');
 await f.submitFeedback('bug','test','Feedback');expect(mockAdd.mock.calls[0][1].screen).toBe('CommunityDetails');
});
it('retains a failed error delivery locally for retry',async()=>{
 const e=require('@/services/errorLog');mockUpdate.mockRejectedValueOnce(new Error('offline'));mockSet.mockRejectedValueOnce(new Error('offline'));
 e.logError('joinGame',new Error('actual bug'));await e.flush();
 expect(mockSaved.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({entry:expect.objectContaining({pending:1})})]);
 mockUpdate.mockResolvedValue(undefined);await e.flush();expect(mockSaved.mock.calls.at(-1)?.[0]).toEqual([]);
});
it('keeps a network write in the local outbox until acknowledged',async()=>{
 let acknowledge!:()=>void;
 mockUpdate.mockImplementationOnce(()=>new Promise<void>(resolve=>{acknowledge=resolve;}));
 const e=require('@/services/errorLog');e.logError('joinGame',new Error('actual bug'));
 const sending=e.flush();jest.advanceTimersByTime(250);
 expect(mockSaved.mock.calls.at(-1)?.[0]).toEqual([expect.objectContaining({entry:expect.objectContaining({pending:1})})]);
 acknowledge();await sending;expect(mockSaved.mock.calls.at(-1)?.[0]).toEqual([]);
});
it('never retries an old-account write after the account changes',async()=>{
 let reject!:()=>void;
 mockUpdate.mockImplementationOnce(()=>new Promise<void>((_resolve,fail)=>{reject=()=>fail(new Error('offline'));}));
 const e=require('@/services/errorLog');e.logError('joinGame',new Error('actual bug'));
 const sending=e.flush();mockUid='B';e.clearPendingErrors();reject();await sending;
 expect(mockSet).not.toHaveBeenCalled();expect(mockSaved.mock.calls.at(-1)?.[0]).toEqual([]);
});
it('does not attach another account journal during the auth transition',async()=>{
 const j=require('@/services/diagnosticJournal'),e=require('@/services/errorLog');
 j.bindDiagnosticOwner('A');j.diagnosticRoute('MatchDetails',{gameId:'private-A'});mockUid='B';
 e.logError('joinGame',new Error('actual bug'));await e.flush();
 expect(mockUpdate.mock.calls[0][1]).toMatchObject({lastJournal:'',lastTrail:'',lastUserId:'B'});
});
it('refuses a screenshot captured under another account',async()=>{
 const j=require('@/services/diagnosticJournal'),f=require('@/services/feedbackService');j.bindDiagnosticOwner('A');
 const captured=f.captureFeedbackDiagnostics('MatchDetails');mockUid='B';
 await expect(f.submitFeedback('bug','test','MatchDetails',undefined,'bug',captured)).rejects.toThrow('session changed');
 expect(mockAdd).not.toHaveBeenCalled();
});

it('counts one caught Error once across service, screen and global observers',async()=>{
 const e=require('@/services/errorLog'),o=require('@/utils/errorObservation');
 const failure=new Error('same failure'), origin={source:'src/service.ts',handler:'load',site:'service:one'};
 o.observeCaughtError(failure,origin);e.logError('loadClub',failure,{groupId:'club'});
 o.observeCaughtError(failure,{...origin,source:'src/screen.ts'});e.logError('unhandledRejection',failure);
 await Promise.resolve();await e.flush();
 expect(mockUpdate).toHaveBeenCalledTimes(1);
 expect(mockUpdate.mock.calls[0][1]).toMatchObject({operation:'loadClub',count:1,lastContext:{source:'src/service.ts',groupId:'club'}});
 expect(mockCrashlytics).toHaveBeenCalledTimes(1);
 expect(mockCrashlytics.mock.calls[0][0]).toMatchObject({operation:'loadClub',...origin});
 expect(Object.keys(mockCrashlytics.mock.calls[0][0]).sort()).toEqual(['operation','message','code','stack','source','handler','site','isFatal'].sort());
});
it('keeps distinct occurrences, reports network failures and preserves plain-object codes',async()=>{
 const e=require('@/services/errorLog');
 e.logError('load',{message:'offline',code:'unavailable'});e.logError('load',{message:'offline',code:'unavailable'});
 await e.flush();expect(mockUpdate.mock.calls[0][1]).toMatchObject({count:2,lastCode:'unavailable',lastContext:{transient:true}});
});
it('reports undefined rejection reasons instead of silently failing normalization',async()=>{
 const e=require('@/services/errorLog');e.logError('load',undefined);await e.flush();
 expect(mockUpdate.mock.calls[0][1]).toMatchObject({lastMessage:'undefined',count:1});
});
it('freezes fallback evidence at the catch before navigation changes',async()=>{
 const e=require('@/services/errorLog'),o=require('@/utils/errorObservation'),j=require('@/services/diagnosticJournal');
 j.diagnosticRoute('MatchDetails',{gameId:'g'});
 o.observeCaughtError(new Error('hidden'),{source:'source.ts',handler:'load',site:'source:load'});
 j.diagnosticRoute('Profile');await Promise.resolve();await e.flush();
 const payload=mockUpdate.mock.calls[0][1];expect(payload.lastScreen).toBe('MatchDetails');
 expect(payload.lastJournal).toContain('MatchDetails');expect(payload.lastJournal).not.toContain('Profile');
});
it('retries a frozen batch with the same id without mixing in newer occurrences',async()=>{
 const e=require('@/services/errorLog');
 mockUpdate.mockRejectedValueOnce(new Error('response lost'));
 e.logError('load',new Error('bug'));await e.flush();const first=mockUpdate.mock.calls[0][1];
 e.logError('load',new Error('bug'));await e.flush();
 expect(mockUpdate.mock.calls[1][1]).toMatchObject({deliveryId:first.deliveryId,count:1});
 expect(mockUpdate.mock.calls[2][1].deliveryId).not.toBe(first.deliveryId);
 expect(mockUpdate.mock.calls[2][1].count).toBe(1);
});
it('deduplicates an explicit cause wrapper while retaining a separate occurrence',async()=>{
 const e=require('@/services/errorLog'),root=new Error('failed');
 e.logError('load',root);e.logError('load',Object.assign(new Error('wrapped'),{cause:root}));e.logError('load',new Error('failed'));
 await e.flush();
 expect(mockUpdate).toHaveBeenCalledTimes(1);expect(mockUpdate.mock.calls[0][1].count).toBe(2);
 expect(mockCrashlytics).toHaveBeenCalledTimes(2);
});

it('forwards startup errors to the native sink before sign-in while Pulse waits',async()=>{
 mockUid='';const e=require('@/services/errorLog');
 e.logError('startup',new Error('configuration failed'),{source:'src/startup.ts',token:'must-not-be-forwarded'});
 await e.flush();
 expect(mockUpdate).not.toHaveBeenCalled();expect(mockCrashlytics).toHaveBeenCalledTimes(1);
 expect(mockCrashlytics.mock.calls[0][0]).toMatchObject({operation:'startup',source:'src/startup.ts'});
 expect(JSON.stringify(mockCrashlytics.mock.calls)).not.toContain('must-not-be-forwarded');
});

it('preserves fatal handler chaining and deduplicates the global rejection path',async()=>{
 const g=globalThis as any,previousUtils=g.ErrorUtils,previousInstalled=g.__errorLogInstalled;
 const previous=jest.fn(),enable=jest.fn();let handler:(error:unknown,fatal?:boolean)=>void=()=>{};
 jest.doMock('promise/setimmediate/rejection-tracking',()=>({enable}));
 g.ErrorUtils={getGlobalHandler:()=>previous,setGlobalHandler:(next:typeof handler)=>{handler=next;}};
 delete g.__errorLogInstalled;
 try{
  const e=require('@/services/errorLog');e.installGlobalErrorHandlers();
  const failure=new Error('fatal startup failure');handler(failure,true);
  expect(previous).toHaveBeenCalledWith(failure,true);
  expect(mockCrashlytics).toHaveBeenCalledWith(expect.objectContaining({operation:'uncaught',isFatal:true}));
  const rejection=enable.mock.calls[0][0].onUnhandled;
  rejection(1,failure);rejection(2,new Error('another failure'));
  expect(mockCrashlytics).toHaveBeenCalledTimes(2);
  expect(mockCrashlytics.mock.calls[1][0].operation).toBe('unhandledRejection');
  await Promise.resolve();await e.flush();
 }finally{
  if(previousUtils===undefined)delete g.ErrorUtils;else g.ErrorUtils=previousUtils;
  if(previousInstalled===undefined)delete g.__errorLogInstalled;else g.__errorLogInstalled=previousInstalled;
  jest.dontMock('promise/setimmediate/rejection-tracking');
 }
});
