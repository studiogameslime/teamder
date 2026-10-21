let mockSignedIn = true;
let mockSessionChanged: () => void;
const mockRequest = jest.fn();
jest.mock('expo-constants',()=>({__esModule:true,default:{expoConfig:{version:'pulse-test'}}}));
jest.mock('react-native',()=>({Platform:{OS:'android'}}));
jest.mock('../../pulse/src/services/adminSession',()=>({isPulseSignedIn:()=>mockSignedIn,onPulseSessionChanged:(fn:()=>void)=>{mockSessionChanged=fn;},pulseAdminRequest:(body:unknown)=>mockRequest(body)}));
const origin={source:'pulse/src/services/example.ts',handler:'load',site:'example:load'};
beforeEach(()=>{
 jest.resetModules();jest.useFakeTimers();mockSignedIn=true;mockRequest.mockReset();
 jest.doMock(require.resolve('expo-constants',{paths:[process.cwd()+'/pulse']}),()=>({__esModule:true,default:{expoConfig:{version:'pulse-test'}}}));
 jest.doMock(require.resolve('react-native',{paths:[process.cwd()+'/pulse']}),()=>({Platform:{OS:'android'}}));
});
afterEach(()=>jest.useRealTimers());
test('same error propagating through multiple catches produces one conditional write',async()=>{
 mockRequest.mockResolvedValueOnce({status:404,body:'{}'}).mockResolvedValueOnce({status:200});
 const log=require('../../pulse/src/services/errorLog');const error=new Error('private@example.invalid');
 log.logPulseError(error,origin);log.logPulseError(error,origin);await log.flushPulseErrors();
 expect(mockRequest).toHaveBeenCalledTimes(2);
 const patch=mockRequest.mock.calls[1][0];expect(patch.url).toContain('currentDocument.exists=false');
 const fields=JSON.parse(patch.body).fields;expect(fields.count.integerValue).toBe('1');expect(patch.body).not.toContain('private@example.invalid');
});
test('lost acknowledgement retries the receipt without counting the batch again',async()=>{
 let saved:any;
 mockRequest.mockImplementation(async body=>{
  if(body.method==='GET')return saved?{status:200,body:JSON.stringify(saved)}:{status:404,body:'{}'};
  saved={...JSON.parse(body.body),updateTime:'2026-10-20T20:00:00Z'};throw new Error('response lost');
 });
 const warn=jest.spyOn(console,'warn').mockImplementation(()=>{});
 const log=require('../../pulse/src/services/errorLog');log.logPulseError(new Error('failed'),origin);
 await log.flushPulseErrors();await log.flushPulseErrors();
 expect(mockRequest.mock.calls.filter(([body])=>body.method==='PATCH')).toHaveLength(1);
 expect(saved.fields.count.integerValue).toBe('1');warn.mockRestore();
});
test('new failures during an in-flight delivery are not deleted by its acknowledgement',async()=>{
 let release!:()=>void;
 mockRequest.mockResolvedValue({status:404,body:'{}'}).mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({status:404,body:'{}'});}));
 mockRequest.mockImplementationOnce(async()=>({status:200}));
 const log=require('../../pulse/src/services/errorLog');log.logPulseError(new Error('failed'),origin);
 const first=log.flushPulseErrors();log.logPulseError(new Error('failed'),origin);release();await first;
 mockRequest.mockResolvedValueOnce({status:404,body:'{}'}).mockResolvedValueOnce({status:200});await log.flushPulseErrors();
 expect(mockRequest.mock.calls.filter(([body])=>body.method==='PATCH')).toHaveLength(2);
});
test('account change during a read never sends the previous account report',async()=>{
 let release!:(value:unknown)=>void;mockRequest.mockImplementation(()=>new Promise(resolve=>{release=resolve;}));
 const log=require('../../pulse/src/services/errorLog');log.logPulseError(new Error('failed'),origin);
 const sending=log.flushPulseErrors();mockSignedIn=false;mockSessionChanged();release({status:404,body:'{}'});await sending;
 expect(mockRequest).toHaveBeenCalledTimes(1);
});
test('cause wrappers are one occurrence but an independent identical failure still counts',async()=>{
 mockRequest.mockResolvedValueOnce({status:404,body:'{}'}).mockResolvedValueOnce({status:200});
 const log=require('../../pulse/src/services/errorLog'),root=new Error('failed');
 log.logPulseError(root,origin);log.logPulseError(Object.assign(new Error('wrapped'),{cause:root}),origin);log.logPulseError(new Error('failed'),origin);
 await log.flushPulseErrors();
 expect(JSON.parse(mockRequest.mock.calls[1][0].body).fields.count.integerValue).toBe('2');
});
