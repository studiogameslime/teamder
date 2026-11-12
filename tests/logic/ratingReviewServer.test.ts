import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';
import {reviewNights,reviewNow} from '../fixtures/ratingReview';
function fixture(){
  const data=new Map<string,any>(),cache=new Map<string,any>(),env:Record<string,string>={};let serial=0;const requests:string[]=[];
  class Ref {constructor(public path:string){} get id(){return this.path.split('/').pop()!;} collection(name:string){return new Query(`${this.path}/${name}`);} async get(){return snapshot(this,structuredClone(data.get(this.path)));} }
  class Query {filters:any[]=[];sort='';max=Infinity;constructor(public path:string){} doc(id=`auto${++serial}`){return new Ref(`${this.path}/${id}`);} where(k:string,op:string,v:any){this.filters.push([k,op,v]);return this;} orderBy(k:string){this.sort=k;return this;} limit(n:number){this.max=n;return this;} }
  const snapshot=(ref:Ref,value:any)=>({ref,id:ref.id,exists:value!==undefined,data:()=>value,get:(k:string)=>value?.[k]});
  const db:any={doc:(p:string)=>new Ref(p),collection:(p:string)=>new Query(p),runTransaction:async(fn:any)=>{
    const writes:(()=>void)[]=[];let writing=false;
    const tx={get:async(ref:any)=>{if(writing)throw Error('read-after-write');requests.push(ref.path);
      if(ref instanceof Ref)return snapshot(ref,structuredClone(data.get(ref.path)));
      const docs=[...data].filter(([p,v])=>p.startsWith(ref.path+'/')&&p.split('/').length===ref.path.split('/').length+1&&ref.filters.every(([k,op,x]:any)=>op==='=='&&v[k]===x)).sort((a,b)=>ref.sort?b[1][ref.sort]-a[1][ref.sort]:a[0].localeCompare(b[0])).slice(0,ref.max).map(([p,v])=>snapshot(new Ref(p),structuredClone(v)));
      return {docs,size:docs.length};},
      set:(ref:Ref,v:any)=>{writing=true;writes.push(()=>data.set(ref.path,structuredClone(v)));},
      update:(ref:Ref,v:any)=>{writing=true;writes.push(()=>{if(!data.has(ref.path))throw Error('missing');const next={...data.get(ref.path),...structuredClone(v)};Object.keys(next).forEach(k=>{if(next[k]==='DELETE')delete next[k];});data.set(ref.path,next);});},
      create:(ref:Ref,v:any)=>{writing=true;writes.push(()=>{if(data.has(ref.path))throw Error('exists');data.set(ref.path,structuredClone(v));});}};
    const result=await fn(tx);writes.forEach(w=>w());return result;
  }};
  class HttpsError extends Error{constructor(public code:string,message:string){super(message);}}
  const observed={onCall:(_options:any,fn:any)=>fn,onDocumentUpdated:(_path:any,fn:any)=>fn,HttpsError};
  function load(file:string):any{file=path.resolve(file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);
    const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,process:{env},Date,console,require:(id:string)=>{
      if(id==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue:{delete:()=> 'DELETE'}};
      if(id==='./observedFunctions'||id.startsWith('firebase-functions/v2/'))return observed;if(id==='./appCheckPolicy')return {ENFORCE_APP_CHECK:true};
      if(id.startsWith('.'))return load(path.resolve(path.dirname(file),id+'.ts'));return require(id);
    }});return module.exports;
  }
  data.set('groups/club',{adminIds:['admin'],playerIds:['a'],internalRating:true});
  data.set('groups/club/private/adminRatings',{ratings:{a:3.5}});
  const api=load('functions/src/ratingReview.ts'),ratings=load('functions/src/clubAdminRatings.ts'),store=load('functions/src/ratingReviewStore.ts');
  const request=(payload:any,uid='admin')=>({auth:{uid,token:{firebase:{sign_in_provider:'google.com'}}},data:{groupId:'club',...payload}});
  function seed(){for(const n of reviewNights()){
    data.set(`games/${n.id}`,{groupId:'club',status:'finished',endedBy:'admin',liveMatch:{startedAt:n.at},startsAt:n.at,seasonStartedAt:n.at,committedRoundCount:n.matches.length});
    data.set(`groups/club/private/rating_${n.id}`,n.snapshot);
    n.matches.forEach(m=>data.set(`games/${n.id}/roundHistory/${m.roundId}`,m));
    Object.entries(n.scores).forEach(([userId,score])=>data.set(`eveningStandings/${n.id}_${userId}`,{gameId:n.id,userId,score}));
  }}
  return {data,api,ratings,store,db,request,seed,requests,env,HttpsError};
}
beforeEach(()=>jest.spyOn(Date,'now').mockReturnValue(reviewNow));afterEach(()=>jest.restoreAllMocks());
test('nonadmins and anonymous callers cannot read or decide',async()=>{
  const f=fixture();await expect(f.api.getRatingReview(f.request({},'outsider'))).rejects.toMatchObject({code:'permission-denied'});
  const req=f.request({});req.auth.token.firebase.sign_in_provider='anonymous';await expect(f.api.getRatingReview(req)).rejects.toMatchObject({code:'unauthenticated'});
  expect(f.requests).not.toContain('games');
});
test('accept updates current rating, appends audit, resets evidence and retries exactly once',async()=>{
  const f=fixture();f.seed();const read=await f.api.getRatingReview(f.request({}));expect(read.rows.find((r:any)=>r.userId==='a').status).toBe('up');
  const req=f.request({playerId:'a',basis:read.basis,action:'accept',requestId:'one'});await f.api.decideRatingReview(req);await f.api.decideRatingReview(req);
  expect(f.data.get('groups/club/private/adminRatings').ratings.a).toBe(3.6);
  expect(f.data.get('groups/club/private/ratingReview').revisions.a).toBe(1);
  expect([...f.data.keys()].filter(p=>p.includes('/events/'))).toHaveLength(1);
  const after=await f.api.getRatingReview(f.request({}));expect(after.rows.find((r:any)=>r.userId==='a').eligible).toBe(0);
});
test('keep records a decision without changing the rating',async()=>{
  const f=fixture();f.seed();const read=await f.api.getRatingReview(f.request({}));await f.api.decideRatingReview(f.request({playerId:'a',basis:read.basis,action:'keep',requestId:'keep'}));
  expect(f.data.get('groups/club/private/adminRatings').ratings.a).toBe(3.5);expect(f.data.get('groups/club/private/ratingReview').since.a).toBe(reviewNow);
});
test('another admin edit or corrected outcome rejects the stale recommendation',async()=>{
  for(const correction of [false,true]){const f=fixture();f.seed();const read=await f.api.getRatingReview(f.request({}));
    if(correction)f.data.get('games/g0/roundHistory/r0').winnerSide='B';else await f.ratings.setClubAdminRating(f.request({playerId:'a',rating:3.7}));
    await expect(f.api.decideRatingReview(f.request({playerId:'a',basis:read.basis,action:'accept',requestId:'stale'}))).rejects.toMatchObject({code:'failed-precondition'});
  }
});
test('idempotency key cannot be reused for a different action or after losing admin access',async()=>{
  const f=fixture();f.seed();const read=await f.api.getRatingReview(f.request({})),req=f.request({playerId:'a',basis:read.basis,action:'keep',requestId:'once'});
  await f.api.decideRatingReview(req);await expect(f.api.decideRatingReview({...req,data:{...req.data,action:'accept'}})).rejects.toMatchObject({code:'already-exists'});
  f.data.get('groups/club').adminIds=[];await expect(f.api.decideRatingReview(req)).rejects.toMatchObject({code:'permission-denied'});
});
test('snapshot is private, includes guest ratings and roles, and cannot backfill a started game',async()=>{
  const f=fixture();f.data.set('users/a',{position:'def'});const game={groupId:'club',status:'locked',players:['a'],guests:[{id:'guest',estimatedRating:2.1}]};
  await f.db.runTransaction(async(tx:any)=>{const write=await f.store.prepareRatingSnapshot(f.db,tx,game,'new',{internalRating:true},reviewNow,{a:3.5});write();});
  const snap=f.data.get('groups/club/private/rating_new');expect(snap.roles.a).toBe('def');expect(snap.ratings['guest:guest']).toBe(2.1);
  await f.db.runTransaction(async(tx:any)=>{(await f.store.prepareRatingSnapshot(f.db,tx,game,'new',{internalRating:true},reviewNow+1,{a:4}))();});expect(f.data.get('groups/club/private/rating_new')).toEqual(snap);
  await f.db.runTransaction(async(tx:any)=>{(await f.store.prepareRatingSnapshot(f.db,tx,{...game,status:'active'},'old',{internalRating:true},reviewNow,{a:4}))();});expect(f.data.has('groups/club/private/rating_old')).toBe(false);
});
test('history limits fail explicitly instead of returning an empty successful list',async()=>{
  const f=fixture();for(let i=0;i<201;i++)f.data.set(`games/overflow${i}`,{groupId:'club',startsAt:reviewNow-i});
  await expect(f.api.getRatingReview(f.request({}))).rejects.toMatchObject({code:'resource-exhausted'});
});
test('the real atomic start freezes ratings before writes and retries without replacing them',async()=>{
  const f=fixture();f.data.set('users/a',{position:'mid'});f.data.set('games/new',{groupId:'club',status:'locked',players:['a'],startsAt:reviewNow});
  const source=fs.readFileSync('functions/src/seasonManager.ts','utf8'),method=source.slice(source.indexOf('  async startEvening('),source.indexOf('  async enable('));
  const module={exports:{} as any};vm.runInNewContext(ts.transpileModule(`const api={${method}};exports.start=api.startEvening`,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,HttpsError:f.HttpsError});
  const self={db:f.db,refresh:async()=>{},now:()=>reviewNow,deps:{ratingSnapshot:(tx:any,g:any,id:string,club:any,at:number)=>f.store.prepareRatingSnapshot(f.db,tx,g,id,club,at,{a:3.5})}};
  await module.exports.start.call(self,'new','admin');expect(f.data.get('games/new').status).toBe('active');expect(f.data.get('groups/club/private/rating_new').ratings.a).toBe(3.5);
  const previous=f.data.get('groups/club/private/rating_new');await module.exports.start.call(self,'new','admin');expect(f.data.get('groups/club/private/rating_new')).toEqual(previous);
});
test('legacy observations are idempotent and cannot move a newer decision backwards',async()=>{
  const f=fixture();f.env.TEAMDER_LEGACY_CLUB_RATINGS_COMPAT='true';f.data.get('groups/club').adminRatings={a:3.6};
  const event={params:{groupId:'club'},data:{before:{get:()=>({a:3.5})},after:{get:()=>({a:3.6}),updateTime:{toMillis:()=>reviewNow}}}};
  await f.api.onRatingReviewLegacyChange(event);await f.api.onRatingReviewLegacyChange(event);expect(f.data.get('groups/club/private/ratingReview').revisions.a).toBe(1);
  f.data.get('groups/club/private/ratingReview').since.a=reviewNow+100;
  await f.api.onRatingReviewLegacyChange(event);expect(f.data.get('groups/club/private/ratingReview').since.a).toBe(reviewNow+100);
});
