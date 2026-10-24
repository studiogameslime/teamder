import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {reconcileJoinAfterWindow} from '../../functions/src/joinReconcileDispatch';
import {roundJoinAccess,validManagerInvitation} from '../../functions/src/invitationPolicy';

const source=ts.createSourceFile('server.ts',fs.readFileSync('functions/src/index.ts','utf8'),ts.ScriptTarget.Latest,true);
function node(predicate:(n:ts.Node)=>boolean){let result:ts.Node|undefined;function visit(n:ts.Node){if(predicate(n))result=n;else ts.forEachChild(n,visit);}visit(source);if(!result)throw Error('Missing source');return result;}
const expression=(node(n=>ts.isVariableDeclaration(n)&&n.name.getText(source)==='onJoinRequestCreated')as ts.VariableDeclaration).initializer!.getText(source);
const reconcileSource=node(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='reconcileGameJoins').getText(source);
const compile=(code:string)=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;

test.each([[900,1000,400],[500,1000,0],[0,1000,0],[undefined,1000,500],[5000,1000,500]] as const)('receipt %s at time %s waits only %s ms, then invokes the same reconciler',async(created,now,expected)=>{
 const reconcile=jest.fn(async()=>{}),wait=jest.fn(async()=>{});await reconcileJoinAfterWindow(created,500,reconcile,()=>now,wait);
 if(expected)expect(wait).toHaveBeenCalledWith(expected);else expect(wait).not.toHaveBeenCalled();expect(reconcile).toHaveBeenCalledTimes(1);
});
test('the real event trigger reconciles directly and requests redelivery when its transaction fails',async()=>{
 let options:any;const reconcile=jest.fn().mockRejectedValueOnce(Error('unavailable')).mockResolvedValue(undefined);
 const handler=vm.runInNewContext(compile(`(${expression})`),{onDocumentCreated:(o:any,fn:any)=>{options=o;return fn;},JOIN_SETTLE_MS:500,reconcileJoinAfterWindow,reconcileGameJoins:reconcile,Date,observeCaughtError:jest.fn(),console:{error:jest.fn()}});
 expect(options).toEqual({document:'games/{gameId}/joinRequests/{uid}',retry:true});
 const event={params:{gameId:'g'},data:{createTime:{toMillis:()=>0}}};await expect(handler(event)).rejects.toThrow('unavailable');await handler(event);expect(reconcile.mock.calls).toEqual([['g'],['g']]);
});

/** Real reconciliation body, including audience/capacity/order checks. All
 * writes stage until a complete transaction succeeds; redeliveries serialize. */
function world(){
 class Timestamp{constructor(public ms:number){}toMillis(){return this.ms;}}
 const data=new Map<string,any>([['games/g',{status:'open',createdBy:'owner',groupId:'club',players:[],waitlist:[],pending:[],maxPlayers:1}],['groups/club',{playerIds:['early','late']}],['users/early',{}],['users/late',{}],
  ['games/g/joinRequests/late',{uid:'late',state:'queued',tappedAt:1050,requestedAt:new Timestamp(1100)}],['games/g/joinRequests/early',{uid:'early',state:'queued',tappedAt:1000,requestedAt:new Timestamp(1200)}]]);
 const snapshot=(path:string)=>({id:path.split('/').at(-1),exists:data.has(path),ref:ref(path),data:()=>data.get(path)});
 function ref(path:string,filters:any[]=[]):any{return{path,collection:(s:string)=>ref(path+'/'+s),doc:(id:string)=>ref(path+'/'+id),where:(key:string,_op:string,value:any)=>ref(path,[...filters,[key,value]]),orderBy:()=>ref(path,filters),limit:()=>ref(path,filters),filters};}
 let chain=Promise.resolve(),fail=false;const db={collection:ref,runTransaction:(fn:any)=>{const result=chain.then(async()=>{const writes:any[]=[];
  await fn({get:async(r:any)=>r.path.split('/').length%2===0?snapshot(r.path):{empty:![...data].some(([p,v])=>p.startsWith(r.path+'/')&&r.filters.every(([k,x]:any[])=>v[k]===x)),docs:[...data].filter(([p,v])=>p.startsWith(r.path+'/')&&p.split('/').length===r.path.split('/').length+1&&r.filters.every(([k,x]:any[])=>v[k]===x)).map(([p])=>snapshot(p))},update:(r:any,patch:any)=>writes.push([r.path,patch])});
  if(fail)throw Error('UNAVAILABLE');for(const [p,patch]of writes)data.set(p,{...data.get(p),...patch});});chain=result.catch(()=>{});return result;}};
 const context:any={module:{exports:{}},db,admin:{firestore:{Timestamp}},roundJoinAccess,validManagerInvitation,TAP_BACKDATE_GRACE_MS:15000,Date,observeCaughtError:jest.fn()};
 vm.runInNewContext(compile(reconcileSource+';module.exports=reconcileGameJoins;'),context);
 return{data,run:()=>context.module.exports('g'),fail:(value:boolean)=>{fail=value;}};
}
test('two concurrent deliveries and a redelivery assign the earliest tap once, even when its receipt arrived later',async()=>{
 const w=world();await Promise.all([w.run(),w.run()]);const before=JSON.stringify([...w.data]);await w.run();expect(JSON.stringify([...w.data])).toBe(before);
 expect(w.data.get('games/g')).toMatchObject({players:['early'],waitlist:['late'],participantIds:['early','late']});expect(w.data.get('games/g/joinRequests/early').bucket).toBe('players');
});
test('a failed transaction leaves the queue and roster untouched and succeeds on retry',async()=>{
 const w=world();const before=JSON.stringify([...w.data]);w.fail(true);await expect(w.run()).rejects.toThrow('UNAVAILABLE');expect(JSON.stringify([...w.data])).toBe(before);w.fail(false);await w.run();expect(w.data.get('games/g').players).toEqual(['early']);
});
test.each(['finished','cancelled'])('a %s game rejects both queued requests rather than assigning seats',async status=>{
 const w=world();w.data.get('games/g').status=status;await w.run();expect(w.data.get('games/g').players).toEqual([]);expect(w.data.get('games/g/joinRequests/early')).toMatchObject({state:'rejected',reason:'GAME_NOT_OPEN'});
});
