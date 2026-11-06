import { readAccountActions, ACCOUNT_ACTION_LIMIT, accountRange } from '../../pulse/src/services/accountActionReport';
jest.mock('../../pulse/src/services/adminTransport',()=>({}));
jest.mock('../../pulse/src/services/auth',()=>({}));
jest.mock('../../pulse/src/config',()=>({}));
jest.mock('../../pulse/src/services/readMeter',()=>({}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({}));
jest.mock('../../pulse/src/services/analyticsFull',()=>({EVENT_LABEL:{live_goal_recorded:'שער',player_comparison_viewed:'השוואה'}}));
const now=Date.parse('2026-11-04T21:00:00+02:00');
const readTime='2026-11-04T19:00:00.123456Z';
const row=(n:number,uid:string,id='live_goal_recorded')=>({readTime,document:{
  name:'projects/test/databases/(default)/documents/usageActivity/'+String(n).padStart(5,'0'),
  fields:{uid:{stringValue:uid},productKey:{stringValue:id},sortAt:{integerValue:String(now-1000)}},
}});
test('the same account with two visits on two devices makes three performances and one actor',async()=>{
  // The source documents contain two visits/devices; the report projection never requests those identifiers.
  const source=[{device:'phone1',visit:'visit1',at:1},{device:'phone2',visit:'visit2',at:2},{device:'phone2',visit:'visit2',at:3}];
  const request=jest.fn(async(body:any)=>{
    const sq=body.structuredQuery;
    expect(sq.where.compositeFilter.filters[0].fieldFilter).toMatchObject({field:{fieldPath:'action'},value:{stringValue:'product_action'}});
    if(!body.readTime){expect(sq.limit).toBe(1);return [{readTime}];}
    expect(body.readTime).toBe(readTime);
    expect(sq.select.fields.map((f:any)=>f.fieldPath)).toEqual(['uid','productKey','sortAt','timeQuality']);
    return source.map(e=>row(e.at,'same-account'));
  });
  const report=await readAccountActions(request,'today',now);
  expect(report).toMatchObject({accounts:1,accepted:3,partial:false,rows:[{id:'live_goal_recorded',users:1,events:3}]});
  expect(JSON.stringify(report)).not.toContain('same-account');
  expect(report.timeQuality).toEqual({device:0,received:0,unknown:3});
});
test('receipt-time attribution is disclosed while accepted counts remain unchanged and old rows retain coverage',async()=>{
  const device={...row(1,'same-account'),document:{...row(1,'same-account').document,fields:{
    ...row(1,'same-account').document.fields,timeQuality:{stringValue:'device'}}}};
  const shifted={...row(2,'same-account'),document:{...row(2,'same-account').document,fields:{
    ...row(2,'same-account').document.fields,timeQuality:{stringValue:'unreliable'}}}};
  const legacy=row(3,'same-account');
  const report=await readAccountActions(async(body:any)=>body.readTime?[device,shifted,legacy]:[{readTime}],'today',now);
  expect(report).toMatchObject({accounts:1,accepted:3,partial:false,rows:[{users:1,events:3}],
    timeQuality:{device:1,received:1,unknown:1}});
});
test('fixed read time and document tie-break handle over a page of tied event times',async()=>{
  const data=Array.from({length:218},(_,i)=>row(i,i<201?'first':'second',i%2?'live_goal_recorded':'player_comparison_viewed'));
  const request=jest.fn(async(body:any)=>{
    if(!body.readTime)return [{readTime}];
    expect(body.readTime).toBe(readTime);
    const query=body.structuredQuery;
    if(!query.startAt)return data.slice(0,201);
    expect(query.startAt).toEqual({before:false,values:[{integerValue:String(now-1000)},{referenceValue:data[199].document.name}]});
    return data.slice(200);
  });
  const r=await readAccountActions(request,'today',now);
  expect(r).toMatchObject({accounts:2,accepted:218,partial:false});
  expect(r.rows.map(x=>[x.users,x.events])).toEqual([[2,109],[2,109]]);
});
test('the cap yields an explicitly partial snapshot; new activity after the snapshot is excluded',async()=>{
  const docs=Array.from({length:ACCOUNT_ACTION_LIMIT+2},(_,i)=>row(i,'uid'+String(i%3)));
  const r=await readAccountActions(async(body:any)=>{
    if(!body.readTime)return [{readTime}];
    const q=body.structuredQuery,start=q.startAt?1+Number(q.startAt.values[1].referenceValue.split('/').pop()):0;
    return docs.slice(start,start+q.limit);
  },'all',now);
  expect(r).toMatchObject({partial:true,accepted:ACCOUNT_ACTION_LIMIT,accounts:3});
  expect(accountRange('all',now)).toEqual({start:now-30*86400000,end:now});
});
test('missing data, malformed actors, denied reads and changing snapshots cannot present a complete zero',async()=>{
  const none=await readAccountActions(async()=>[{readTime}],'today',now);
  expect(none).toMatchObject({partial:false,accepted:0,rows:[]});
  const unknown=await readAccountActions(async(body:any)=>body.readTime?[row(0,'','unknown')]:[{readTime}],'today',now);
  expect(unknown).toMatchObject({partial:true,accepted:0,rows:[]});
  await expect(readAccountActions(async()=>{throw Error('denied');},'today',now)).rejects.toThrow('denied');
  await expect(readAccountActions(async(body:any)=>body.readTime?[{...row(1,'a'),readTime:'later'}]:[{readTime}],'today',now)).rejects.toThrow('SNAPSHOT_CHANGED');
});
test('abandoned reports stop before reading another page',async()=>{
  const request=jest.fn(async()=>[{readTime}]);
  await expect(readAccountActions(request,'today',now,()=>false)).rejects.toThrow('CANCELLED');
  expect(request).toHaveBeenCalledTimes(1);
});
