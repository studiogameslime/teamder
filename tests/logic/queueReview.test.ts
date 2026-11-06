import { UsageActivityQueue, USAGE_QUEUE_KEY } from '@/services/usageActivityQueue';
import { validUsageEvent } from '@/utils/usageActivity';
import { attachProductCollector, captureProductActor, recordProductAction } from '@/services/productActor';

function fixture() {
  let time = 1_800_000_000_000;
  let uid = 'first';
  let serial = 0;
  const disk = new Map<string,string>();
  const send = jest.fn(async (_owner:string,events:any[]) => ({acknowledged:events.map(event=>event.eventId)}));
  const store = {
    getItem: async (key:string) => disk.get(key) ?? null,
    setItem: async (key:string,value:string) => { disk.set(key,value); },
  };
  const queue = new UsageActivityQueue({storage:store,identity:()=>uid,now:()=>time,uuid:()=>`review-visit-${++serial}`,
    platform:'android',appVersion:'review',send,diagnostic:()=>{}});
  return {queue,send,store,advance:(ms:number)=>{time+=ms;},switchTo:(next:string)=>{uid=next;},
    rows:()=>JSON.parse(disk.get(USAGE_QUEUE_KEY)??'[]') as any[]};
}

test('a permanently rejected product action becomes a valid gap owned by the original account',async()=>{
  const f=fixture();
  f.queue.record('product_action',{productKey:'live_goal_recorded'});
  f.send.mockImplementationOnce(async (_owner,events)=>({acknowledged:[],rejected:events.map(e=>e.eventId)} as any));
  await f.queue.flush();
  expect(f.rows()).toHaveLength(1);
  expect(f.rows()[0]).toMatchObject({action:'coverage_gap',ownerUid:'first'});
  expect(f.rows()[0]).not.toHaveProperty('productKey');
  expect(validUsageEvent(f.rows()[0])).toBe(true);
  await f.queue.flush();
  expect(f.rows()).toEqual([]);
});

test('seven-day product retention includes the boundary, then replaces the event with a gap',async()=>{
  const f=fixture();
  f.queue.record('product_action',{productKey:'live_goal_recorded'});
  await f.queue.persist();
  f.advance(7*86400000);
  await f.queue.persist();
  expect(f.rows()[0].action).toBe('product_action');
  f.advance(1);
  await f.queue.persist();
  expect(f.rows().map(e=>e.action)).toEqual(['coverage_gap']);
  expect(f.rows().every(validUsageEvent)).toBe(true);
  expect(f.send).not.toHaveBeenCalled();
});

test('product overflow keeps at most 500 persisted rows and records the lost coverage',async()=>{
  const f=fixture();
  for(let index=0;index<800;index++)f.queue.record('product_action',{productKey:'live_goal_recorded'});
  await f.queue.persist();
  expect(f.rows().length).toBeLessThanOrEqual(500);
  expect(f.rows().some(e=>e.action==='coverage_gap')).toBe(true);
  expect(f.rows().every(validUsageEvent)).toBe(true);
});

test('800 immediate registration outcomes cannot exceed the in-memory bound while storage is stuck',()=>{
  const f=fixture();
  f.store.setItem=async()=>new Promise<void>(()=>{});
  f.queue.start();
  for(let index=0;index<800;index++)f.queue.beginRegistration('game-a','operation-'+index)('failed');
  const state=f.queue as unknown as {pending:any[];lost:Map<string,any>};
  expect(state.pending.length).toBeLessThanOrEqual(500);
  expect(state.lost.size).toBe(1);
  expect(state.pending.every(validUsageEvent)).toBe(true);
});

test('restored storage preserves registration ownership and delivers the bounded queue with its gap',async()=>{
  const f=fixture(), originalWrite=f.store.setItem;
  let release!:()=>void, started!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const writing=new Promise<void>(resolve=>{started=resolve;});
  let firstWrite=true;
  f.store.setItem=async(key,value)=>{
    if(firstWrite){firstWrite=false;started();await blocked;}
    await originalWrite(key,value);
  };
  f.queue.start();
  const firstSave=f.queue.persist();
  await writing;
  for(let index=0;index<800;index++)f.queue.beginRegistration('game-a','operation-'+index)('failed');
  const finish=f.queue.beginRegistration('game-a','last-operation');
  f.switchTo('second');
  f.queue.syncIdentity();
  finish('failed');
  f.queue.record('product_action',{productKey:'player_comparison_viewed'});
  release();
  await firstSave;
  await f.queue.persist();
  expect(f.rows().length).toBeLessThanOrEqual(500);
  expect(f.rows().every(validUsageEvent)).toBe(true);
  expect(f.rows().some(row=>row.action==='coverage_gap'&&row.ownerUid==='first')).toBe(true);
  const result=f.rows().find(row=>row.action==='registration_result'&&row.operationId==='last-operation');
  expect(result).toMatchObject({ownerUid:'first',visitId:'review-visit-1'});
  await f.queue.flush();
  expect(f.send.mock.calls[0][0]).toBe('second');
  expect(f.send.mock.calls[0][1].map(row=>row.productKey)).toEqual(['player_comparison_viewed']);
  const remaining=f.rows().length;
  f.switchTo('first');
  for(let attempt=0;attempt<30&&f.rows().length;attempt++)await f.queue.flush();
  const sent=f.send.mock.calls.filter(([owner])=>owner==='first').flatMap(([,rows])=>rows);
  expect(sent).toHaveLength(remaining);
  expect(new Set(sent.map(row=>row.eventId)).size).toBe(sent.length);
  expect(f.rows()).toEqual([]);
});

test('product events remain with their original account across delayed delivery',async()=>{
  const f=fixture();
  f.queue.record('product_action',{productKey:'live_goal_recorded'});
  await f.queue.persist();
  f.switchTo('second');
  f.queue.record('product_action',{productKey:'player_comparison_viewed'});
  await f.queue.flush();
  expect(f.send.mock.calls[0][0]).toBe('second');
  expect(f.send.mock.calls[0][1].map(e=>e.productKey)).toEqual(['player_comparison_viewed']);
  expect(f.rows().map(e=>e.ownerUid)).toEqual(['first']);
});

test('stopping an older collector does not turn off its replacement and stopping the current collector clears ownership',()=>{
  const oldRecord=jest.fn(),newRecord=jest.fn();
  const stopOld=attachProductCollector({actor:()=> 'first',record:oldRecord});
  const stopNew=attachProductCollector({actor:()=> 'second',record:newRecord});
  stopOld();
  recordProductAction('live_goal_recorded',captureProductActor());
  expect(newRecord.mock.calls).toEqual([['live_goal_recorded','second']]);
  expect(oldRecord).not.toHaveBeenCalled();
  stopNew();
  expect(captureProductActor()).toBeNull();
  recordProductAction('live_goal_recorded','second');
  expect(newRecord).toHaveBeenCalledTimes(1);
});
