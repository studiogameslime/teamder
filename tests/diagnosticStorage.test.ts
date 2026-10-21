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
it('retains all compact errors while keeping only the latest three full journals',async()=>{
 const s=require('@/services/diagnosticStorage');
 const rows=Array.from({length:5},(_,i)=>({fp:String(i),entry:{operation:'load',pending:1,journal:'details',trail:'steps'}}));
 await s.savePendingDiagnosticErrors(rows);const read=await s.readPendingDiagnosticErrors();
 expect(read).toHaveLength(5);expect(read[0].entry).toMatchObject({journal:'',trail:'',operation:'load',pending:1});
 expect(read.slice(-3).every((row:any)=>row.entry.journal==='details')).toBe(true);
});
it('bounds a runaway outbox and makes discarded batch evidence explicit',async()=>{
 const s=require('@/services/diagnosticStorage');
 await s.savePendingDiagnosticErrors(Array.from({length:205},(_,i)=>({fp:String(i),entry:{userId:'A',version:'1',pending:1,journal:'',trail:''}})));
 const read=await s.readPendingDiagnosticErrors();expect(read).toHaveLength(201);
 expect(read[0].entry).toMatchObject({operation:'diagnosticOutboxOverflow',userId:'A',context:{omittedBatches:5}});
});
