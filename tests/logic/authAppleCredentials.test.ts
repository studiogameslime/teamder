import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

test('plain Apple sign-in consumes the token once in primary auth and never replays it to native auth',async()=>{
 const source=ts.createSourceFile('auth.ts',fs.readFileSync('src/firebase/auth.ts','utf8'),ts.ScriptTarget.Latest,true);
 const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='signInWithApple')!;
 const native=jest.fn(),signIn=jest.fn(async()=>({user:{uid:'apple-user'}}));
 const code=ts.transpileModule(`(${fn.getText(source).replace(/^export\s+/,'')})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const run=vm.runInNewContext(code,{USE_MOCK_DATA:false,Platform:{OS:'ios'},getFirebase:()=>({auth:'primary'}),
  acquireAppleCredential:async()=>({identityToken:'single-use',rawNonce:'nonce',fullName:'שם שחקן'}),
  OAuthProvider:class{credential(value:unknown){return value;}},signInWithCredential:signIn,mirrorToNativeAuth:native,
  observeCaughtError:jest.fn(),logError:jest.fn(),__DEV__:false});
 expect(await run()).toEqual({user:{uid:'apple-user'},fullName:'שם שחקן'});
 expect(signIn).toHaveBeenCalledTimes(1);
 expect(signIn).toHaveBeenCalledWith('primary',{idToken:'single-use',rawNonce:'nonce'});
 expect(native).not.toHaveBeenCalled();
});
