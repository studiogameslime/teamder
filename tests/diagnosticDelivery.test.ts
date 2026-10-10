let mockUid='A';
const mockUpdate=jest.fn(),mockSet=jest.fn(),mockAdd=jest.fn();
const mockSaved=jest.fn(async(_rows:unknown[])=>{}),mockRead=jest.fn(async()=>[] as unknown[]);
jest.mock('react-native',()=>({Platform:{OS:'android',Version:35}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'1.1.test'}}}));
jest.mock('@/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({db:{},auth:{get currentUser(){return {uid:mockUid,displayName:'demo'};}}})}));
jest.mock('firebase/firestore',()=>({doc:(_db:unknown,_col:unknown,id:string)=>id,collection:()=>({}),serverTimestamp:()=>123,increment:(n:number)=>n,updateDoc:(...a:unknown[])=>mockUpdate(...a),setDoc:(...a:unknown[])=>mockSet(...a),addDoc:(...a:unknown[])=>mockAdd(...a)}));
jest.mock('@/store/userStore',()=>({useUserStore:{getState:()=>({currentUser:{name:'demo'}})}}));
jest.mock('@/services/diagnosticStorage',()=>({readPendingDiagnosticErrors:()=>mockRead(),savePendingDiagnosticErrors:(r:unknown[])=>mockSaved(r),persistDiagnosticJournal:jest.fn(),readPreviousDiagnosticJournal:jest.fn(async()=>undefined)}));
beforeEach(()=>{jest.resetModules();jest.useFakeTimers();mockUid='A';mockUpdate.mockReset().mockResolvedValue(undefined);mockSet.mockReset().mockResolvedValue(undefined);mockAdd.mockReset().mockResolvedValue({});mockRead.mockReset().mockResolvedValue([]);mockSaved.mockClear();});
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
});
it('does not send previous-account errors after switching accounts',async()=>{
 mockRead.mockResolvedValue([{fp:'abc',entry:{operation:'uncaught',message:'crash',pending:1,userId:'B',context:{},journal:'{}',trail:'private B',version:'old'}}]);
 const e=require('@/services/errorLog');await e.restorePendingErrors('A');expect(mockUpdate).not.toHaveBeenCalled();
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
