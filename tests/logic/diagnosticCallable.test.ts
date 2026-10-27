const mockCall=jest.fn(),mockStream=jest.fn(),mockFactory=jest.fn((..._args:unknown[])=>Object.assign(mockCall,{stream:mockStream}));
jest.mock('firebase/functions',()=>({httpsCallable:(...args:unknown[])=>mockFactory(...args)}));
import {httpsCallable} from '@/services/diagnosticCallable';
import {bindDiagnosticOwner,diagnosticSnapshot,resetDiagnosticJournal,diagnosticErrorOperation,runDiagnosticOperation} from '@/services/diagnosticJournal';
beforeEach(()=>{resetDiagnosticJournal();mockCall.mockReset();mockFactory.mockClear();bindDiagnosticOwner('A');});
test('preserves SDK options, result identity and payload while carrying a safe request id',async()=>{
 const result={data:{success:false,bucket:'pending',text:'private'}},payload={gameId:'round',text:'private'};mockCall.mockResolvedValue(result);
 const fn=httpsCallable({} as any,'join',{timeout:123});
 expect(await fn(payload)).toBe(result);expect(mockFactory.mock.calls[0][2]).toEqual({timeout:123});
 expect(mockCall.mock.calls[0][0]).toMatchObject({...payload,_diagnostic:{requestId:expect.any(String)}});
 expect(payload).not.toHaveProperty('_diagnostic');expect(diagnosticSnapshot().operations![0].before).not.toHaveProperty('text');
 expect(diagnosticSnapshot().operations![0].outcome).toEqual({success:false,bucket:'pending'});
 await fn.stream({gameId:'stream'});expect(mockStream).toHaveBeenCalledWith({gameId:'stream'});
});
test('links rejected SDK errors to the exact concurrent request without replacing the error',async()=>{
 const first=new Error('first'),second=new Error('second');
 mockCall.mockImplementation((data:any)=>Promise.reject(data.gameId==='first'?first:second));
 const fn=httpsCallable({}as any,'load');await Promise.allSettled([runDiagnosticOperation('outer_action',{},()=>fn({gameId:'first'})),fn({gameId:'second'})]);
 expect(diagnosticErrorOperation(first)?.before.gameId).toBe('first');expect(diagnosticErrorOperation(second)?.before.gameId).toBe('second');
 expect(diagnosticErrorOperation(first)?.id).not.toBe(diagnosticErrorOperation(second)?.id);
 expect(diagnosticErrorOperation(first)?.name).toBe('call:load');
});
test('diagnostic delivery bypasses instrumentation and primitive payload contracts are preserved',async()=>{
 mockCall.mockResolvedValue({data:true});await httpsCallable({}as any,'recordClientError')({count:1});
 expect(diagnosticSnapshot().operations).toHaveLength(0);
 await httpsCallable({}as any,'legacy')('text');expect(mockCall.mock.calls[1][0]).toBe('text');
});
