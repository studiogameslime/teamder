const mockCall=jest.fn(), mockAuth={currentUser:{uid:'admin'} as {uid:string}|null};
jest.mock('../src/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:mockAuth,functions:{}})}));
jest.mock('../src/services/diagnosticCallable',()=>({httpsCallable:()=>mockCall}));
import {loadManagerHistory,readManagerHistory} from '../src/services/managerHistoryService';
import type {Game} from '../src/types';
const games=[{id:'g',groupId:'club',startsAt:10000000}] as Game[];
const row={gameId:'g',groupId:'club',startsAt:10000000,opensAt:1000000,observedAt:11000000,complete:true,firstFullAt:null,promotions:0,waitlistAtStart:{at:9999999,count:0},cancellations:{}};
beforeEach(()=>{jest.clearAllMocks();mockAuth.currentUser={uid:'admin'};mockCall.mockResolvedValue({data:{rows:[row]}})});
it('decodes measured zero separately from unavailable or missing history',()=>{
 expect(readManagerHistory([row],'club',games)[0].promotions).toBe(0);
 expect(readManagerHistory([],'club',games)).toEqual([]);
});
it.each([{...row,groupId:'foreign'},{...row,startsAt:1},{...row,promotions:-1},{...row,observedAt:NaN},{...row,cancellations:{a:{total:1,late:2,unknownDeadline:0}}}])('rejects malformed or cross-scope metrics',r=>{
 expect(()=>readManagerHistory([r],'club',games)).toThrow('manager-history-invalid');
});
it('only treats not-deployed errors as unavailable, and propagates network/permission failure',async()=>{
 mockCall.mockRejectedValueOnce({code:'functions/not-found'});
 await expect(loadManagerHistory('club','admin',games)).resolves.toEqual({status:'unavailable',rows:[]});
 mockCall.mockRejectedValueOnce(Error('offline'));
 await expect(loadManagerHistory('club','admin',games)).rejects.toThrow('offline');
});
it('rejects a changed identity before and after loading',async()=>{
 mockAuth.currentUser={uid:'other'};await expect(loadManagerHistory('club','admin',games)).rejects.toThrow('manager-session-changed');expect(mockCall).not.toHaveBeenCalled();
 mockAuth.currentUser={uid:'admin'};mockCall.mockImplementationOnce(async()=>{mockAuth.currentUser=null;return{data:{rows:[row]}}});
 await expect(loadManagerHistory('club','admin',games)).rejects.toThrow('manager-session-changed');
});
