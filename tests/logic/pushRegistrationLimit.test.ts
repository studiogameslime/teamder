import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture() {
  const getToken = jest.fn(), fallback = jest.fn(), observe = jest.fn(), write = jest.fn();
  const uid = { uid: 'owner', isAnonymous: false };
  const auth = { currentUser: uid };
  const permission = jest.fn().mockResolvedValue({ granted: true });
  const disk = new Map<string,string>();
  let onState: ((state:string)=>void) | undefined;
  const appState = { currentState:'active', addEventListener: (_:string, cb: (state:string)=>void) => {
    onState=cb; return { remove: () => { onState=undefined; } };
  }};
  const code = ts.transpileModule(fs.readFileSync('src/services/notificationsService.ts','utf8') + '\nexport {getFcmToken};',
    {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  function boot() {
    const exports: any = {};
    const run = (vm.runInNewContext as any).diagnosticOriginal ?? vm.runInNewContext;
    run(code, {exports, Date, setTimeout, clearTimeout, __DEV__:false, require: (name: string) => {
      if (name === '@react-native-firebase/messaging') return {default: () => ({getToken, isDeviceRegisteredForRemoteMessages:true})};
      if (name === 'expo-notifications') return {getDevicePushTokenAsync:fallback,getPermissionsAsync:permission};
      if (name === 'react-native') return {AppState:appState, Platform:{OS:'android'}};
      if (name === 'expo-constants') return {default:{}};
      if (name.endsWith('errorObservation')) return {observeCaughtError:observe};
      if (name.endsWith('firebase/config')) return {getFirebase:()=>({auth}),USE_MOCK_DATA:false};
      if (name.endsWith('firebase/firestore') && name.startsWith('@/')) return {docs:{userPrivatePush:(id:string)=>id}};
      if (name === 'firebase/firestore') return {setDoc:write,getDoc:async()=>({data:()=>({})}),arrayUnion:(x:string)=>x};
      if (name.endsWith('/joryio')) return {joryio:{registerPushToken:async()=>true}};
      if (name.endsWith('/errorLog')) return {logError:jest.fn()};
      if (name === '@react-native-async-storage/async-storage') return {default:{
        getItem:async(k:string)=>disk.get(k) ?? null,setItem:async(k:string,v:string)=>{disk.set(k,v);},
        removeItem:async(k:string)=>{disk.delete(k);},
      }};
      return {};
    }});
    return exports;
  }
  return {boot,getToken,fallback,observe,write,auth,permission,disk,appState,state:(s:string)=>{appState.currentState=s;onState?.(s);}};
}
beforeEach(()=>jest.useFakeTimers());
afterEach(()=>jest.useRealTimers());
const limited = new Error('java.io.IOException: TOO_MANY_REGISTRATIONS');
test('a provider limit survives a process restart and keeps simultaneous startup calls together',async()=>{
  const f=fixture();f.getToken.mockRejectedValueOnce(limited).mockResolvedValue('restored');
  const first=f.boot(), pending=first.getFcmToken();
  expect(first.getFcmToken()).toBe(pending);expect(await pending).toBeNull();
  const next=f.boot();expect(await next.getFcmToken()).toBeNull();expect(f.getToken).toHaveBeenCalledTimes(1);
  expect(f.observe).toHaveBeenCalledTimes(1);expect(f.fallback).not.toHaveBeenCalled();
  jest.advanceTimersByTime(30*60000);expect(await next.getFcmToken()).toBe('restored');
});
test('removing an old account can still obtain the device token during a persisted cooldown',async()=>{
  const f=fixture();f.getToken.mockRejectedValueOnce(limited).mockResolvedValue('device-token');
  await f.boot().getFcmToken();const next=f.boot();const parked=next.getFcmToken();
  expect(await next.getFcmToken(true)).toBe('device-token');await parked;
  expect(f.getToken).toHaveBeenCalledTimes(2);
});

test('expiry in background waits for foreground and a failed save is retried without prompting',async()=>{
  const f=fixture(), api=f.boot();
  f.getToken.mockRejectedValueOnce(limited).mockResolvedValue('device-token');
  f.write.mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(undefined);
  const stop=api.maintainPushRegistration(()=>api.notificationsService.registerPushTokenIfPermitted('owner'));
  await jest.advanceTimersByTimeAsync(1);expect(f.getToken).toHaveBeenCalledTimes(1);
  f.state('background');await jest.advanceTimersByTimeAsync(30*60000);
  expect(f.write).not.toHaveBeenCalled();
  f.state('active');f.state('active');await jest.advanceTimersByTimeAsync(1);
  expect(f.write).toHaveBeenCalledTimes(1);
  f.state('active');await jest.advanceTimersByTimeAsync(1);expect(f.write).toHaveBeenCalledTimes(2);
  f.state('active');await jest.advanceTimersByTimeAsync(1);expect(f.write).toHaveBeenCalledTimes(2);stop();
});

test('account change during a token read cannot register against the previous account',async()=>{
  const f=fixture(), api=f.boot();
  let done!: (value:string)=>void;f.getToken.mockImplementation(()=>new Promise(resolve=>{done=resolve;}));
  const result=api.notificationsService.registerPushTokenIfPermitted('owner');
  await jest.advanceTimersByTimeAsync(1);f.auth.currentUser={uid:'other',isAnonymous:false};
  done('device-token');expect(await result).toBeNull();expect(f.write).not.toHaveBeenCalled();
});

test('unmount cancels a scheduled automatic retry',async()=>{
  const f=fixture(), api=f.boot();f.getToken.mockRejectedValueOnce(limited);
  const stop=api.maintainPushRegistration(()=>api.notificationsService.registerPushTokenIfPermitted('owner'));
  await jest.advanceTimersByTimeAsync(1);stop();await jest.advanceTimersByTimeAsync(30*60000);
  expect(f.getToken).toHaveBeenCalledTimes(1);expect(jest.getTimerCount()).toBe(0);
});
