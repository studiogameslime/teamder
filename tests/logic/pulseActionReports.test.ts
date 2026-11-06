import { readActionReport, sortedActions } from '../../pulse/src/services/actionReports';
import { fetchAnalyticsFull } from '../../pulse/src/services/analyticsFull';
import { pulseFetch } from '../../pulse/src/services/adminTransport';

jest.mock('../../pulse/src/services/adminTransport',()=>({pulseFetch:jest.fn()}));
jest.mock('../../pulse/src/services/cache',()=>({cached:(_key:string,work:()=>unknown)=>work()}));
jest.mock('../../pulse/src/services/auth',()=>({googleOAuthToken:async()=>'local'}));
jest.mock('../../pulse/src/config',()=>({config:{analytics:{propertyId:'local'}}}));
jest.mock('../../pulse/src/capabilities',()=>({has:{analytics:()=>true,firebase:()=>false}}));
jest.mock('../../pulse/src/services/collectionData',()=>({}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({}));
jest.mock('../../pulse/src/services/firebase',()=>({}));

const range={startDate:'6daysAgo',endDate:'today'};
const skip=new Set(['teamder_ui_action','screen_view']);
const row=(id:string,users:string,events:string)=>({dimensionValues:[{value:id}],metricValues:[{value:users},{value:events}]});

test('one metric pair for the whole range for every event, including a third page, a measured zero and no inferred rows',async()=>{
  const rows=Array.from({length:410},(_,i)=>row('event_'+String(i).padStart(3,'0'),'1','2'));
  rows.push(row('teamder_ui_action','10','20'),row('measured_zero','0','0'));
  const query=jest.fn(async(body:any)=>{
    expect(body.dateRanges).toEqual([range]);
    expect(body.dimensions).toEqual([{name:'eventName'}]);
    expect(body.metrics).toEqual([{name:'totalUsers'},{name:'eventCount'}]);
    return {rowCount:rows.length,rows:rows.slice(body.offset,body.offset+body.limit),
      metadata:body.offset===200?{subjectToThresholding:true,samplingMetadatas:[{}],dataLossFromOtherRow:true}:{}};
  });
  const report=await readActionReport(query,range,'events',{},skip);
  expect(query.mock.calls.map(([body])=>body.offset)).toEqual([0,200,400]);
  expect(report).toMatchObject({state:'ready',thresholded:true,sampled:true,other:true});
  expect(report.rows).toHaveLength(411);
  expect(report.rows[409]).toMatchObject({users:1,events:2});
  expect(report.rows[410]).toMatchObject({id:'measured_zero',users:0,events:0});
  expect(report.rows.some(r=>r.id==='live_goal_recorded')).toBe(false);
});

test.each(['failure','count changed','row repeated','missing metric'] as const)('an incomplete page (%s) never presents a partial or zero count',async(reason)=>{
  const query=jest.fn(async(body:any)=>{
    if(!body.offset)return {rowCount:2,rows:[row('a','2','7')]};
    if(reason==='failure')throw Error('403');
    if(reason==='count changed')return {rowCount:1,rows:[row('b','2','7')]};
    if(reason==='row repeated')return {rowCount:2,rows:[row('a','2','7')]};
    return {rowCount:2,rows:[{dimensionValues:[{value:'b'}],metricValues:[{value:'3'}]}]};
  });
  await expect(readActionReport(query,range,'events',{},skip)).resolves.toMatchObject({state:'error',rows:[]});
});

test.each(['contentId','eventName'])('the %s query can be denied independently of the other action report and the overview',async(denied)=>{
  jest.mocked(pulseFetch).mockImplementation(async(_url,init)=>{
    const body=JSON.parse(init!.body as string), dimension=body.dimensions?.[0]?.name;
    if(dimension===denied || !dimension)return {ok:false,status:403} as Response;
    const isControl=dimension==='contentId';
    if(isControl)expect(body.dimensionFilter).toEqual({filter:{fieldName:'eventName',stringFilter:{matchType:'EXACT',value:'teamder_ui_action'}}});
    expect(body.dateRanges).toEqual([range]);
    return {ok:true,json:async()=>({rowCount:1,rows:[row(isControl?'ui_known':'live_goal_recorded','1','2')]})} as Response;
  });
  const full=await fetchAnalyticsFull('7d');
  expect(full.actions.state).toBe(denied==='contentId'?'ready':'error');
  expect(full.controls.state).toBe(denied==='contentId'?'error':'ready');
  expect((denied==='contentId'?full.actions:full.controls).rows[0]).toMatchObject({users:1,events:2});
});

test('sorting by people and by performances yields different leaders without changing either metric',()=>{
  const a={id:'goal',label:'שער',users:1,events:12},b={id:'compare',label:'השוואה',users:5,events:6};
  expect(sortedActions([a,b],'users')).toEqual([b,a]);
  expect(sortedActions([a,b],'events')).toEqual([a,b]);
});
