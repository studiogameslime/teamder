import {errorCauseObjects} from '../../src/utils/errorIdentity';
test('explicit object causes connect wrappers without grouping separate occurrences',()=>{
 const root=new Error('same message'),wrapper=Object.assign(new Error('context'),{cause:root});
 expect(errorCauseObjects(wrapper)).toEqual([wrapper,root]);
 expect(errorCauseObjects(new Error('same message'))).not.toContain(root);
 expect(errorCauseObjects('same message')).toEqual([]);
});
test('cycles, accessors, revoked proxies and long chains are safe and bounded',()=>{
 const cycle:any={};cycle.cause=cycle;expect(errorCauseObjects(cycle)).toEqual([cycle]);
 const getter=jest.fn(()=>{throw Error('must not run');});const accessor=Object.defineProperty({},'cause',{get:getter});
 expect(errorCauseObjects(accessor)).toEqual([accessor]);expect(getter).not.toHaveBeenCalled();
 const {proxy,revoke}=Proxy.revocable({},{});revoke();expect(errorCauseObjects(proxy)).toHaveLength(1);
 let chain:any={};for(let i=0;i<100;i++)chain={cause:chain};expect(errorCauseObjects(chain)).toHaveLength(32);
});
test('all runtimes use the same identity semantics',()=>{
 const fs=require('fs'),source=fs.readFileSync('src/utils/errorIdentity.ts','utf8');
 for(const path of ['functions/src/errorIdentity.ts','pulse/src/services/errorIdentity.ts'])expect(fs.readFileSync(path,'utf8')).toBe(source);
});
