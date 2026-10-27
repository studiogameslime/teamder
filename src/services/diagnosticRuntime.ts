import { AppState, NativeModules, Platform } from 'react-native';
import Constants from 'expo-constants';
import { setDiagnosticEnvironment, setDiagnosticContextProvider } from './diagnosticJournal';
import { getFirebase, USE_MOCK_DATA } from '../firebase/config';
import { useUserStore } from '../store/userStore';
import { useGroupStore } from '../store/groupStore';
import { SPORTS_ACTIVITY_ENABLED } from '../config/sportsActivity';

/** Read only explicit fields. Never copy profiles, route params, messages or credentials. */
export function startDiagnosticRuntime():()=>void{
 setDiagnosticContextProvider(()=>{
  const s=useUserStore.getState(),g=useGroupStore.getState();
  const auth=USE_MOCK_DATA?null:getFirebase().auth.currentUser;
  const same=!!auth&&s.currentUser?.id===auth.uid;
  const group=same?g.groups.find(x=>x.id===g.currentGroupId):undefined;
  return {stateCapturedAt:Date.now(),authPhase:!auth?'signed_out':auth.isAnonymous?'anonymous':'authenticated',
   authHydrated:s.hydrated,profilePresent:same,profileComplete:same&&s.isProfileComplete(),
   onboardingComplete:same&&s.hasCompletedOnboarding(),profileRestoreFailed:s.profileRestoreFailed,
   groupHydrated:same&&g.hydrated,groupId:group?.id,memberCount:group?.playerIds.length,
   seasonId:group?.seasons?.currentId,
   role:!group?'unknown':group.adminIds.includes(auth!.uid)?'admin':'member',
   // A store profile is not proof that a server write has committed.
   profileSource:same?'store':'unknown'};
 });
 const extra=Constants.expoConfig?.extra;
 setDiagnosticEnvironment({appVersion:Constants.expoConfig?.version??'unknown',
  nativeBuild:Constants.nativeBuildVersion??'unknown',buildId:extra?.diagnosticBuildId??'unknown',
  codeRevision:extra?.diagnosticRevision??'unknown',runtimeVersion:typeof Constants.expoConfig?.runtimeVersion==='string'?Constants.expoConfig.runtimeVersion:'unknown',
  sportsActivityEnabled:SPORTS_ACTIVITY_ENABLED,appState:AppState.currentState??'unknown',
  networkConnected:'unknown',internetReachable:'unknown',networkType:'unknown',networkObserver:'unavailable'});
 let alive=true,inFlight=false;
 const probe=()=>{
  if(AppState.currentState!=='active'||inFlight)return;
  if(Platform.OS==='web'){
   setDiagnosticEnvironment({networkConnected:typeof navigator==='undefined'?'unknown':navigator.onLine,internetReachable:'unknown',networkType:'unknown',networkObservedAt:Date.now(),networkObserver:'available'});return;
  }
  try{
   const bridge=Platform.OS==='ios'?require('expo-modules-core').requireOptionalNativeModule('WatchBridge'):NativeModules.WatchBridge;
   if(typeof bridge?.getNetworkDiagnostics!=='function')return;
   inFlight=true;
   let timeout:ReturnType<typeof setTimeout>;
   const deadline=new Promise<null>(resolve=>{timeout=setTimeout(()=>resolve(null),750);});
   void Promise.race([Promise.resolve().then(()=>bridge.getNetworkDiagnostics()),deadline]).then(value=>{
    if(!alive)return;
    setDiagnosticEnvironment(value&&typeof value.networkConnected==='boolean'?{...value,networkObservedAt:Date.now(),networkObserver:'available'}:
     {networkConnected:'unknown',internetReachable:'unknown',networkType:'unknown',networkObserver:'unavailable',networkObservedAt:Date.now()});
   }).catch(()=>{if(alive)setDiagnosticEnvironment({networkConnected:'unknown',internetReachable:'unknown',networkType:'unknown',networkObserver:'unavailable'});}).finally(()=>{clearTimeout(timeout);inFlight=false;});
  }catch{/* Old binary or unavailable route probe: keep explicit unknown state. */}
 };
 probe();
 const sub=AppState.addEventListener('change',state=>{setDiagnosticEnvironment({appState:state,...(state==='active'?{lastResumeAt:Date.now()}: {})});if(state==='active')probe();});
 const timer=setInterval(probe,30000);
 return ()=>{alive=false;sub.remove();clearInterval(timer);setDiagnosticContextProvider(()=>({}));};
}
