let mockState='active';const mockCallbacks:{change?:(value:string)=>void}={};
const mockProbe=jest.fn(),mockRemove=jest.fn();
jest.mock('react-native',()=>({Platform:{OS:'android'},NativeModules:{WatchBridge:{getNetworkDiagnostics:()=>mockProbe()}},AppState:{get currentState(){return mockState;},addEventListener:(_name:string,fn:(v:string)=>void)=>{mockCallbacks.change=fn;return {remove:mockRemove};}}}));
jest.mock('expo-constants',()=>({__esModule:true,default:{nativeBuildVersion:'301',expoConfig:{version:'1.1.65',extra:{diagnosticRevision:'revision-123'}}}}));
jest.mock('@/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:{currentUser:{uid:'viewer',isAnonymous:false}}})}));
jest.mock('@/store/userStore',()=>({useUserStore:{getState:()=>({hydrated:true,currentUser:{id:'viewer',email:'private@example.invalid'},profileRestoreFailed:false,isProfileComplete:()=>false,hasCompletedOnboarding:()=>false})}}));
jest.mock('@/store/groupStore',()=>({useGroupStore:{getState:()=>({hydrated:true,currentGroupId:'club',groups:[{id:'club',adminIds:['viewer'],playerIds:['viewer'],seasons:{currentId:'season'}}]})}}));
import {startDiagnosticRuntime} from '@/services/diagnosticRuntime';
import {diagnosticContext,resetDiagnosticJournal} from '@/services/diagnosticJournal';
beforeEach(()=>{jest.useFakeTimers();resetDiagnosticJournal();mockState='active';mockProbe.mockReset();});
afterEach(()=>jest.useRealTimers());
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('native route state preserves unknown internet reachability and excludes private provider fields',async()=>{
 mockProbe.mockResolvedValue({networkConnected:true,internetReachable:'unknown',networkType:'wifi',ssid:'private-network',ipAddress:'192.0.2.1'});
 const stop=startDiagnosticRuntime();await settle();
 expect(diagnosticContext()).toMatchObject({appVersion:'1.1.65',nativeBuild:'301',codeRevision:'revision-123',networkConnected:true,internetReachable:'unknown',authPhase:'authenticated',role:'admin',seasonId:'season'});
 expect(JSON.stringify(diagnosticContext())).not.toMatch(/private-network|private@example|192.0.2.1/);stop();
});
test('unavailable old native binary remains unknown, never an invented offline result',async()=>{
 mockProbe.mockResolvedValue(null);const stop=startDiagnosticRuntime();await settle();
 expect(diagnosticContext()).toMatchObject({networkConnected:'unknown',internetReachable:'unknown',networkObserver:'unavailable'});stop();
});
test('background probe is suppressed, foreground is recorded and cleanup stops sampling',async()=>{
 mockProbe.mockResolvedValue({networkConnected:false,internetReachable:false,networkType:'none'});
 const stop=startDiagnosticRuntime();await settle();expect(mockProbe).toHaveBeenCalledTimes(1);
 mockState='background';mockCallbacks.change!('background');jest.advanceTimersByTime(30000);expect(mockProbe).toHaveBeenCalledTimes(1);
 mockState='active';mockCallbacks.change!('active');await settle();expect(mockProbe).toHaveBeenCalledTimes(2);expect(diagnosticContext().lastResumeAt).toEqual(expect.any(Number));
 stop();jest.advanceTimersByTime(60000);expect(mockProbe).toHaveBeenCalledTimes(2);
});
test('a hung native route probe expires locally and never turns into a request storm',async()=>{
 mockProbe.mockImplementation(()=>new Promise(()=>{}));const stop=startDiagnosticRuntime();await settle();
 mockCallbacks.change!('active');await settle();expect(mockProbe).toHaveBeenCalledTimes(1);
 jest.advanceTimersByTime(750);await settle();expect(diagnosticContext().networkConnected).toBe('unknown');
 jest.advanceTimersByTime(30000);await settle();expect(mockProbe).toHaveBeenCalledTimes(2);stop();
});
