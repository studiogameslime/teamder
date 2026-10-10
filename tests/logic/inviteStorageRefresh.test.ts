const mockDisk = new Map<string,string>();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{
 getItem:jest.fn(async(k:string)=>mockDisk.get(k)??null),
 setItem:jest.fn(async(k:string,v:string)=>{mockDisk.set(k,v);}),
 removeItem:jest.fn(async(k:string)=>{mockDisk.delete(k);}),
}}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
import { storage, subscribePendingInvite } from '@/services/storage';
import { useEntryStore } from '@/store/entryStore';
beforeEach(()=>{mockDisk.clear();useEntryStore.setState({organicCompleted:null,invite:null,pendingIntent:null,suppressAutoConsume:false});});
test('actual persistent write updates the already hydrated first-entry store',async()=>{
 await useEntryStore.getState().hydrate();
 let refresh:Promise<void>|undefined;
 const unsubscribe=subscribePendingInvite(()=>{refresh=useEntryStore.getState().refreshInvite();});
 try {
  await storage.setPendingInvite({type:'app',invitedBy:'new-sender'});
  await refresh;
  expect(useEntryStore.getState().invite).toEqual({kind:'referral',invitedBy:'new-sender'});
  await storage.clearPendingInvite();await refresh;
  expect(useEntryStore.getState().invite).toBeNull();
 }finally{unsubscribe();}
});
test('deferred write cannot replace a fresh link even when both are queued together',async()=>{
 const fresh=storage.setPendingInvite({type:'team',id:'current',invitedBy:'current-sender'});
 const deferred=storage.setPendingInviteIfAbsent({type:'team',id:'old'});
 await fresh;
 expect(await deferred).toBe(false);
 expect(await storage.getPendingInvite()).toMatchObject({id:'current',invitedBy:'current-sender'});
});
test('fresh link still wins when arriving behind an earlier deferred write',async()=>{
 const deferred=storage.setPendingInviteIfAbsent({type:'team',id:'old'});
 const fresh=storage.setPendingInvite({type:'team',id:'current'});
 await Promise.all([deferred,fresh]);
 expect(await storage.getPendingInvite()).toMatchObject({id:'current'});
});
