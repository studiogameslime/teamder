import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
function loadService(){
  let owner='owner';const auth={currentUser:{uid:'owner',isAnonymous:false}};
  let resolve!:(value:any)=>void;const promise=new Promise(yes=>{resolve=yes;});
  const invoke=jest.fn(()=>promise),setState=jest.fn();
  const store={getState:()=>({currentUser:{id:owner}}),setState};
  const imports:any={
    'firebase/firestore':{collection:jest.fn(),onSnapshot:jest.fn()},
    '@/services/diagnosticCallable':{httpsCallable:jest.fn(()=>invoke)},
    '@/firebase/config':{USE_MOCK_DATA:false,getFirebase:()=>({auth,functions:{},db:{}})},
    '@/firebase/authRace':{withAuthRaceRetry:(fn:any)=>fn()},'@/store/userStore':{useUserStore:store},
    './staleSession':{StaleSessionError:class extends Error{}},'./userSessionListeners':{},
  };
  const module={exports:{} as any};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/dmRequestService.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:(id:string)=>imports[id],Date,Math});
  return{api:module.exports.dmRequestService,invoke,resolve,setState,switchAccount:()=>{owner='other';auth.currentUser.uid='other';}};
}
test('request retries preserve the supplied operation id and exact text',async()=>{
  const f=loadService(),pending=f.api.action('owner','recipient','send','שלום','stable_operation');
  expect(f.invoke).toHaveBeenCalledWith({userId:'recipient',action:'send',text:'שלום',operationId:'stable_operation'});
  f.resolve({data:{status:'waiting'}});expect(await pending).toEqual({status:'waiting'});
});
test('account changed before call never sends, and a delayed response cannot reach the next account',async()=>{
  const f=loadService();f.switchAccount();await expect(f.api.action('owner','recipient','status')).rejects.toThrow();expect(f.invoke).not.toHaveBeenCalled();
  const g=loadService(),pending=g.api.action('owner','recipient','status');g.switchAccount();g.resolve({data:{status:'open'}});await expect(pending).rejects.toThrow();
});
test('a late privacy save does not update the next account',async()=>{
  const f=loadService(),pending=f.api.savePrivacy('owner','everyone');f.switchAccount();f.resolve({data:{policy:'everyone'}});
  await expect(pending).rejects.toThrow();expect(f.setState).not.toHaveBeenCalled();
});
test('real user converter preserves explicit/default choice and keeps legacy absence absent',()=>{
  const file=ts.createSourceFile('firestore.ts',fs.readFileSync('src/firebase/firestore.ts','utf8'),ts.ScriptTarget.Latest,true);
  let expression='';const walk=(n:ts.Node)=>{if(ts.isVariableDeclaration(n)&&n.name.getText(file)==='userConverter')expression=n.initializer!.getText(file);ts.forEachChild(n,walk);};walk(file);
  const context:any={module:{exports:{}},Date,diagnosticEntity:jest.fn()};for(const match of expression.matchAll(/\b(read\w+)\(/g))context[match[1]]=(v:any)=>v;
  vm.runInNewContext(ts.transpileModule(`module.exports=${expression}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
  const converter=context.module.exports;
  for(const policy of ['everyone','friends'])for(const source of ['explicit','default']){
    const user={id:'u',name:'שם',createdAt:1,dmRequestPolicy:policy,dmRequestPolicySource:source};
    const written=converter.toFirestore(user),read=converter.fromFirestore({id:'u',data:()=>written});
    expect(read.dmRequestPolicy).toBe(policy);expect(read.dmRequestPolicySource).toBe(source);
  }
  const legacy=converter.fromFirestore({id:'u',data:()=>({name:'שם',dmFriendsOnly:true})});
  expect(legacy.dmRequestPolicy).toBeUndefined();expect(converter.toFirestore(legacy)).not.toHaveProperty('dmRequestPolicy');
});
