const mockCall=jest.fn(),mockAuth={currentUser:{uid:'owner'}};
jest.mock('@/firebase/config',()=>({USE_MOCK_DATA:false,getFirebase:()=>({auth:mockAuth,functions:{}})}));
jest.mock('firebase/functions',()=>({httpsCallable:()=>mockCall}));
jest.mock('@/services/errorLog',()=>({logError:jest.fn()}));
jest.mock('@/data/mockData',()=>({mockGamesV2:[]}));
import {eveningVerifyService} from '@/services/eveningVerifyService';
beforeEach(()=>{jest.useFakeTimers();mockCall.mockReset();mockAuth.currentUser={uid:'owner'};});
afterEach(()=>{jest.clearAllTimers();jest.useRealTimers();});
test('unverified list recovers an internal failure and preserves the actual pending evenings',async()=>{
 mockCall.mockRejectedValueOnce({code:'functions/internal'}).mockResolvedValueOnce({data:{items:[{id:'pending',title:'מחזור',startsAt:1}]}});
 const pending=eveningVerifyService.listUnverified('club');await jest.advanceTimersByTimeAsync(500);
 await expect(pending).resolves.toEqual([{id:'pending',title:'מחזור',startsAt:1}]);expect(mockCall).toHaveBeenCalledTimes(2);
});
test('persistent list failure never becomes an empty success',async()=>{
 const error={code:'functions/internal'};mockCall.mockRejectedValue(error);
 const assertion=expect(eveningVerifyService.listUnverified('club')).rejects.toBe(error);await jest.advanceTimersByTimeAsync(500);await assertion;expect(mockCall).toHaveBeenCalledTimes(2);
});
test('a changed account aborts the read and never returns another user data',async()=>{
 mockCall.mockRejectedValue({code:'functions/internal'});const assertion=expect(eveningVerifyService.listUnverified('club')).rejects.toMatchObject({name:'StaleSessionError'});
 await jest.advanceTimersByTimeAsync(1);mockAuth.currentUser={uid:'other'};await jest.advanceTimersByTimeAsync(500);await assertion;expect(mockCall).toHaveBeenCalledTimes(1);
});
test('the admin verdict mutation is not replayed after an ambiguous error',async()=>{
 mockCall.mockRejectedValue({code:'functions/internal'});await expect(eveningVerifyService.setPlayed('pending',true)).resolves.toBe(false);expect(mockCall).toHaveBeenCalledTimes(1);
});
