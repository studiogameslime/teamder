import {beginDiagnosticOperation,bindDiagnosticOwner,diagnosticAttachment,diagnosticContext,diagnosticData,diagnosticEntity,diagnosticRoute,diagnosticSnapshot,resetDiagnosticJournal,runDiagnosticOperation,setDiagnosticContextProvider,setDiagnosticEnvironment,diagnosticErrorOperation} from '@/services/diagnosticJournal';

beforeEach(()=>{resetDiagnosticJournal();setDiagnosticContextProvider(()=>({}));});
test('records intent, before/after state and exact error identity without copying private input',async()=>{
 let present=false;
 setDiagnosticContextProvider(()=>({profilePresent:present,email:'private@example.invalid',token:'secret',authPhase:'authenticated'}));
 const error=Object.assign(new Error('failed'),{code:'functions/unauthenticated'});
 await expect(runDiagnosticOperation('save_profile',{password:'hidden'},async()=>{present=true;throw error;})).rejects.toBe(error);
 const op=diagnosticSnapshot().operations![0];
 expect(op).toMatchObject({name:'save_profile',result:'failure',before:{profilePresent:false},after:{profilePresent:true},code:'functions/unauthenticated'});
 expect(diagnosticErrorOperation(error)?.id).toBe(op.id);
 expect(diagnosticAttachment()).not.toMatch(/private@example|password|secret|hidden/);
});
test('parallel operations retain independent ids, results and pending count',async()=>{
 const first=beginDiagnosticOperation('one'),second=beginDiagnosticOperation('two');
 expect(first.id).not.toBe(second.id);expect(diagnosticContext().pendingRequests).toBe(2);
 second.finish(new Error('failure'));first.finish();first.finish();
 expect(diagnosticSnapshot().operations!.map(x=>x.result)).toEqual(['success','failure']);
 expect(diagnosticContext().pendingRequests).toBe(0);
});
test('account switch fences old completions and cached entity evidence',()=>{
 bindDiagnosticOwner('A');diagnosticEntity('profile','A',{profileDocumentPresent:true});
 const span=beginDiagnosticOperation('old_account');bindDiagnosticOwner('B');span.finish(new Error('late'));
 expect(diagnosticSnapshot().operations).toEqual([]);expect(diagnosticContext().pendingRequests).toBe(0);
 expect(diagnosticContext().profileDocumentPresent).toBeUndefined();
});
test('route state selects the matching read and immutable snapshots retain cache and pending writes',()=>{
 diagnosticEntity('game','one',{playerCount:4,dataSource:'cache',hasPendingWrites:true});
 diagnosticEntity('game','two',{playerCount:9,dataSource:'server',hasPendingWrites:false});
 diagnosticRoute('MatchDetails',{gameId:'one'});const snap=diagnosticSnapshot();
 diagnosticRoute('MatchDetails',{gameId:'two'});
 expect(snap.context).toMatchObject({gameId:'one',playerCount:4,dataSource:'cache',hasPendingWrites:true});
 expect(diagnosticContext()).toMatchObject({gameId:'two',playerCount:9});
});
test('operation bound discloses omitted spans without losing the pending count',()=>{
 const spans=Array.from({length:30},()=>beginDiagnosticOperation('request'));
 expect(diagnosticSnapshot()).toMatchObject({operationsOmitted:10,context:{pendingRequests:30}});
 expect(diagnosticSnapshot().operations).toHaveLength(20);spans.forEach(x=>x.finish());
 expect(diagnosticContext().pendingRequests).toBe(0);
});
test('bounded envelopes remain valid and disclose removed operation evidence',()=>{
 setDiagnosticEnvironment({networkConnected:'unknown',nativeBuild:'123',codeRevision:'abc',accessToken:'hidden'});
 for(let i=0;i<30;i++){const span=beginDiagnosticOperation('request',{gameId:'x'.repeat(100)});span.finish();}
 const raw=diagnosticAttachment(10000),snap=JSON.parse(raw);
 expect(raw.length).toBeLessThanOrEqual(10000);expect(snap.operationsOmitted).toBeGreaterThanOrEqual(10);
 expect(snap.context).toMatchObject({networkConnected:'unknown',nativeBuild:'123'});
 expect(raw).not.toContain('hidden');
});
test('snapshot provider failure cannot change the original result',async()=>{
 setDiagnosticContextProvider(()=>{throw new Error('unavailable');});
 await expect(runDiagnosticOperation('read',{},async()=>42)).resolves.toBe(42);
 expect(diagnosticData({typedText:'secret',networkType:'wifi'})).toEqual({networkType:'wifi'});
});
