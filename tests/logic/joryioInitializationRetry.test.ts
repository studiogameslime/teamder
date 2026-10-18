import fs from 'fs';import vm from 'vm';import ts from 'typescript';
function fixture(){
 const source=ts.createSourceFile('j.ts',fs.readFileSync('src/services/joryio.ts','utf8'),ts.ScriptTarget.Latest,true);
 const functions=source.statements.filter((s):s is ts.FunctionDeclaration=>ts.isFunctionDeclaration(s)&&['initJoryio','registerPushToken'].includes(s.name?.text??'')).map(s=>s.getText(source).replace('export ',''));
 const sdk={initialize:jest.fn(async()=>{}),getDiagnostics:jest.fn(async()=>({apiEndpoint:'test-host'} as any)),registerPushToken:jest.fn(async()=>({success:true} as any)),getPushPermissionStatus:jest.fn(async()=>null),setAttribute:jest.fn()};
 const ctx:any={exports:{},USE_MOCK_DATA:false,KEY:'test-key',API_HOST:'test-host',APP_VERSION:'test',Platform:{OS:'android',Version:1},__DEV__:false,Joryio:sdk,logUnexpected:jest.fn()};
 vm.runInNewContext(ts.transpileModule('let started=false,initialization=null,lastInitializationError=null,retriedInitializationForPush=false;'+functions.join('\n')+'\nexports.init=initJoryio;exports.push=registerPushToken;',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 return {...ctx,sdk};
}
test('concurrent startup calls wait for one initialization instead of racing push registration',async()=>{
 const f=fixture();let resolve!:()=>void;f.sdk.initialize.mockImplementationOnce(()=>new Promise<void>(r=>{resolve=r;}));
 const init=f.exports.init(),push=f.exports.push('token');expect(f.sdk.initialize).toHaveBeenCalledTimes(1);expect(f.sdk.registerPushToken).not.toHaveBeenCalled();resolve();await Promise.all([init,push]);expect(f.sdk.registerPushToken).toHaveBeenCalledTimes(1);
});
test('explicit native initialization failure retries once and preserves final failure diagnostics',async()=>{
 const f=fixture();f.sdk.registerPushToken.mockResolvedValue({success:false,message:'SDK initialization failed'});
 expect(await f.exports.push('token')).toBe(false);expect(f.sdk.initialize).toHaveBeenCalledTimes(2);expect(f.sdk.registerPushToken).toHaveBeenCalledTimes(2);expect(f.logUnexpected).toHaveBeenCalledTimes(1);
 await f.exports.push('token');expect(f.sdk.initialize).toHaveBeenCalledTimes(2);
});
test('normal network failure does not reinitialize or duplicate registration',async()=>{
 const f=fixture();f.sdk.registerPushToken.mockResolvedValue({success:false,message:'offline',isRetryable:true});await f.exports.push('token');expect(f.sdk.initialize).toHaveBeenCalledTimes(1);expect(f.sdk.registerPushToken).toHaveBeenCalledTimes(1);
});

test('swallowed native initialization failure stays failed, retries once and redacts diagnostic secrets',async()=>{
 const f=fixture();
 f.sdk.getDiagnostics.mockResolvedValue({apiEndpoint:null,initializationError:{code:'INIT_ERROR',message:'Failed jry_sdk_android_privatekey123 https://host.test/path token ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'}});
 f.sdk.registerPushToken.mockResolvedValue({success:false,message:'SDK initialization failed'});
 expect(await f.exports.push('private-push-token')).toBe(false);
 expect(f.sdk.initialize).toHaveBeenCalledTimes(2);
 await f.exports.init();await f.exports.push('private-push-token');
 expect(f.sdk.initialize).toHaveBeenCalledTimes(2);
 const context=f.logUnexpected.mock.calls[0][1];
 expect(context.initializationCode).toBe('INIT_ERROR');
 expect(context.initializationMessage).toContain('Failed');
 expect(JSON.stringify(context)).not.toMatch(/privatekey|host.test|ABCDEFGHIJKLMNOPQRSTUVWXYZ|private-push-token/);
});

test('successful retry clears the initialization failure',async()=>{
 const f=fixture();f.sdk.getDiagnostics.mockResolvedValueOnce({initializationError:{code:'INIT_ERROR',message:'temporary'}});
 f.sdk.registerPushToken.mockResolvedValueOnce({success:false,message:'SDK initialization failed'});
 expect(await f.exports.push('token')).toBe(true);
 expect(f.sdk.initialize).toHaveBeenCalledTimes(2);
 expect(f.logUnexpected).not.toHaveBeenCalled();
});
