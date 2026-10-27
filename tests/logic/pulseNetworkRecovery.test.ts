import {fetchRead,retryRead} from '../../src/services/readRetry';
import {isMissingLinkHandler,isPlayInstallNotAllowed} from '../../src/utils/expectedIntegrationError';
import {errorPresentation} from '../../functions/src/errorPresentation';
import fs from 'fs';

jest.mock('@/utils/errorObservation',()=>({observeCaughtError:jest.fn()}));
const {observeCaughtError}=require('@/utils/errorObservation');
beforeEach(()=>{jest.useFakeTimers();jest.clearAllMocks();});
afterEach(()=>jest.useRealTimers());

test('a temporary gateway failure retries once and keeps the successful response',async()=>{
 const response={ok:true,status:200};
 global.fetch=jest.fn().mockResolvedValueOnce({ok:false,status:504}).mockResolvedValueOnce(response);
 const answer=fetchRead('https://example.invalid/forecast');
 await jest.advanceTimersByTimeAsync(1000);
 expect(await answer).toBe(response);expect(fetch).toHaveBeenCalledTimes(2);expect(observeCaughtError).not.toHaveBeenCalled();
});
test('a sustained failure stays rejected and is observed after the retry',async()=>{
 global.fetch=jest.fn().mockResolvedValue({ok:false,status:504});
 const answer=fetchRead('https://example.invalid/forecast').catch(e=>e);
 await jest.advanceTimersByTimeAsync(1000);
 expect(await answer).toMatchObject({code:'http/504'});expect(fetch).toHaveBeenCalledTimes(2);expect(observeCaughtError).toHaveBeenCalledTimes(1);
});
test('a caller cancellation keeps its original signal and cannot restart a cancelled lookup',async()=>{
 const controller=new AbortController(),failure=Object.assign(Error('cancelled'),{name:'AbortError'});
 global.fetch=jest.fn().mockRejectedValue(failure);
 await expect(fetchRead('https://example.invalid/location',{signal:controller.signal})).rejects.toBe(failure);
 expect(fetch).toHaveBeenCalledTimes(1);expect(fetch).toHaveBeenCalledWith(expect.any(String),{signal:controller.signal});
});
test('changing account during backoff prevents another inbox read',async()=>{
 let current='owner';const check=()=>{if(current!=='owner')throw Error('stale');};
 const read=jest.fn().mockRejectedValue({code:'functions/deadline-exceeded'});
 const answer=retryRead(read,check).catch(e=>e);await jest.advanceTimersByTimeAsync(1);current='other';await jest.advanceTimersByTimeAsync(500);
 expect(await answer).toMatchObject({message:'stale'});expect(read).toHaveBeenCalledTimes(1);
});
test('permission failures never retry or become a successful empty answer',async()=>{
 const failure={code:'permission-denied'},read=jest.fn().mockRejectedValue(failure);
 await expect(retryRead(read,()=>{})).rejects.toBe(failure);expect(read).toHaveBeenCalledTimes(1);
});
test('device install restrictions and missing link handlers are narrow expected cases',()=>{
 expect(isPlayInstallNotAllowed(Error('-6: Install Error(-6): not allowed'))).toBe(true);
 expect(isPlayInstallNotAllowed(Error('Install Error(-2)'))).toBe(false);
 expect(isMissingLinkHandler(Error('No Activity found to handle Intent'))).toBe(true);
 expect(isMissingLinkHandler(Error('native bridge failed'))).toBe(false);
});
test('an error summary uses Hebrew while keeping the raw code out of the notification',()=>{
 expect(errorPresentation('caught:receivedInvitationsService:39f13a4226','functions/deadline-exceeded','deadline-exceeded')).toEqual({title:'טעינת ההזמנות לא הושלמה',reason:'השרת לא השיב בזמן.'});
 expect(errorPresentation('unknown:abc').title).not.toMatch(/[a-z]/i);
 expect(fs.readFileSync('functions/src/errorPresentation.ts','utf8')).toBe(fs.readFileSync('pulse/src/services/errorPresentation.ts','utf8'));
});
