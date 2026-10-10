const mockDisk=new Map<string,string>();
jest.mock('@react-native-async-storage/async-storage',()=>({__esModule:true,default:{
 getItem:jest.fn(async(k:string)=>mockDisk.get(k)??null),
 setItem:jest.fn(async(k:string,v:string)=>{mockDisk.set(k,v);}),
 multiRemove:jest.fn(async(keys:string[])=>{keys.forEach(k=>mockDisk.delete(k));}),
}}));
beforeEach(()=>{jest.resetModules();jest.useFakeTimers();mockDisk.clear();});
afterEach(()=>jest.useRealTimers());
it('stores locally after a batch, with no write per tap',async()=>{
 const j=require('@/services/diagnosticJournal'),s=require('@/services/diagnosticStorage');
 const storage=require('@react-native-async-storage/async-storage').default;
 j.bindDiagnosticOwner('A');s.startDiagnosticStorage();await s.persistDiagnosticJournal();storage.setItem.mockClear();
 for(let i=0;i<100;i++)j.recordDiagnostic('tap','touch_start',{x:i,y:100});
 expect(storage.setItem).not.toHaveBeenCalled();jest.advanceTimersByTime(2000);await s.persistDiagnosticJournal();
 const saved=JSON.parse(mockDisk.get('teamder.diagnostic.current.v1')!);
 expect(saved.owner).toBe('A');expect(JSON.parse(saved.journal).total).toBe(101);
});
it('archives one preceding process and only exposes it to its original account',async()=>{
 mockDisk.set('teamder.diagnostic.current.v1',JSON.stringify({owner:'A',journal:JSON.stringify({schema:1,total:1,entries:[{name:'old_round',seq:1}]})}));
 const s=require('@/services/diagnosticStorage');s.startDiagnosticStorage();await s.persistDiagnosticJournal();
 expect(await s.readPreviousDiagnosticJournal('A')).toContain('old_round');
 expect(await s.readPreviousDiagnosticJournal('B')).toBeUndefined();
});
it('clear is serialized after older writes, so sign-out leaves nothing behind',async()=>{
 const j=require('@/services/diagnosticJournal'),s=require('@/services/diagnosticStorage');s.startDiagnosticStorage();j.recordDiagnostic('press','old_user');
 void s.persistDiagnosticJournal();await s.clearDiagnosticStorage();jest.advanceTimersByTime(3000);
 expect([...mockDisk.keys()]).toEqual([]);
});
it('corrupt storage and write failures never escape or become an upload',async()=>{
 const s=require('@/services/diagnosticStorage'),storage=require('@react-native-async-storage/async-storage').default;
 mockDisk.set('teamder.diagnostic.errors.v1','not-json');expect(await s.readPendingDiagnosticErrors()).toEqual([]);
 storage.setItem.mockRejectedValueOnce(new Error('disk-full'));await expect(s.persistDiagnosticJournal()).resolves.toBeUndefined();
});
it('bounds the local crash outbox to three error snapshots',async()=>{
 const s=require('@/services/diagnosticStorage');await s.savePendingDiagnosticErrors([1,2,3,4]);expect(await s.readPendingDiagnosticErrors()).toEqual([2,3,4]);
});
