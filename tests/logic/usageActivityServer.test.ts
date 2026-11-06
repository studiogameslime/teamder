import { createHash } from 'crypto';
import { joinDiagnosticId } from '../../functions/src/joinDiagnosticId';
const mockDocs = new Map<string, any>();
const mockRef = (path: string) => ({ path, get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }), update: async (value: any) => mockDocs.set(path, { ...mockDocs.get(path), ...value }) });
const mockDb = {
  doc: mockRef,
  runTransaction: async (work: any) => {
    const staged = new Map(mockDocs);
    const snap = (ref: any) => ({ exists: staged.has(ref.path), data: () => staged.get(ref.path) });
    const result = await work({ getAll: async (...refs: any[]) => refs.map(snap), get: async (ref: any) => snap(ref),
      create: (ref: any, value: any) => { if (staged.has(ref.path)) throw new Error('exists'); staged.set(ref.path, value); },
      set: (ref: any, value: any, options?: any) => staged.set(ref.path, options?.merge ? { ...staged.get(ref.path), ...value } : value),
    });
    mockDocs.clear(); staged.forEach((value, key) => mockDocs.set(key, value)); return result;
  },
};
jest.mock('firebase-admin', () => ({ firestore: Object.assign(() => mockDb, { Timestamp: { fromMillis: (value: number) => ({ toMillis: () => value }), now: () => ({ toMillis: Date.now }) } }) }), { virtual: true });
jest.mock('../../functions/src/observedFunctions', () => ({
  onCall: (_options: any, handler: any) => handler, onDocumentWritten: (_options: any, handler: any) => handler, onSchedule: (_options: any, handler: any) => handler,
  HttpsError: class extends Error { constructor(public code: string, message: string) { super(message); } },
}));
const { recordUsageActivity: ingest, onUsageJoinReceipt: receipt, materializeUsageOperation: materialize } = require('../../functions/src/usageActivity');
jest.mock('../../pulse/src/services/adminTransport',()=>({}));
jest.mock('../../pulse/src/services/auth',()=>({}));
jest.mock('../../pulse/src/config',()=>({}));
jest.mock('../../pulse/src/services/readMeter',()=>({}));
jest.mock('../../pulse/src/services/firestoreRest',()=>({}));
jest.mock('../../pulse/src/services/analyticsFull',()=>({EVENT_LABEL:{live_goal_recorded:'שער'}}));
const {readAccountActions}=require('../../pulse/src/services/accountActionReport');
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const row = (sequence = 1, extra: Record<string, unknown> = {}) => ({ eventId: `visit-00000-a-${sequence}`, visitId: 'visit-00000-a', sequence, action: 'screen_view', screen: 'MatchDetails', gameId: 'game-a', occurredAt: Date.now(), platform: 'android', appVersion: '1.2.3', schemaVersion: 1, ...extra });
const call = (events: any[], uid = 'alice', expectedUid = uid) => ingest({ auth: { uid }, data: { expectedUid, events } });
const stored = (collection: string) => [...mockDocs].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => value);
beforeEach(() => {
  mockDocs.clear(); process.env.USAGE_ACTIVITY_ENABLED = 'true';
  delete process.env.USAGE_ACTIVITY_UIDS;
  mockDocs.set('games/game-a', { title: 'יום שלישי', groupId: 'group-a', visibility: 'public' });
  mockDocs.set('groups/group-a', { name: 'מועדון פרטי', playerIds: ['alice'] });
});

test('rollout accepts configured test accounts and rejects others without storing usage', async () => {
  process.env.USAGE_ACTIVITY_UIDS = ' alice, qa-account ';
  const denied = await call([row()], 'other');
  expect(denied.collectionEnabled).toBe(false);
  expect(stored('usageActivity')).toHaveLength(0);
  const accepted = await call([row()]);
  expect(accepted.collectionEnabled).toBe(true);
  expect(stored('usageActivity')).toHaveLength(1);
});

test('disabled rollout does not materialize outcomes for accounts outside its scope', async () => {
  process.env.USAGE_ACTIVITY_UIDS = 'alice';
  await receipt({params:{gameId:'game-a',uid:'other'},data:{after:{data:()=>({state:'assigned',bucket:'players',tappedAt:Date.now()})}}});
  expect(stored('usageOperations')).toHaveLength(0);
  await materialize({data:{after:{data:()=>({uid:'other',attempt:row(),result:'players'})}}});
  expect(stored('usageActivity')).toHaveLength(0);
});

test('one account on two devices creates three action receipts even when a delivery is repeated', async () => {
  const make = (visitId:string,sequence:number) => ({
    ...row(sequence), screen:undefined, gameId:undefined, action:'product_action', productKey:'live_goal_recorded',
    visitId, eventId:visitId+'-'+sequence, params:{text:'private'}, uid:'other',
  });
  const events = [make('device-a-visit',1),make('device-a-visit',2),make('device-b-visit',1)];
  const send = (batch:unknown[], provider='password') => ingest({auth:{ uid:'alice',token:{firebase:{sign_in_provider:provider}} },
    data:{expectedUid:'alice',events:batch}});
  await send(events); await send(events.slice(0,2));
  const received = stored('usageActivity');
  expect(received).toHaveLength(3);
  expect(new Set(received.map((e:any)=>e.uid))).toEqual(new Set(['alice']));
  expect(received.every((e:any)=>e.productKey === 'live_goal_recorded' && !e.params && !e.screen && !e.playerId)).toBe(true);
  const now=Date.now(), readTime=new Date(now).toISOString();
  const pulse=await readAccountActions(async(body:any)=>body.readTime?received.map((e:any)=>({readTime,document:{
    name:'usageActivity/'+e.eventId,fields:{uid:{stringValue:e.uid},sortAt:{integerValue:String(e.sortAt)},productKey:{stringValue:e.productKey}}
  }})):[{readTime}],'today',now);
  expect(pulse).toMatchObject({accounts:1,accepted:3,rows:[{users:1,events:3}]});
  expect(JSON.stringify(pulse)).not.toContain('alice');
  const invalid = [
    {...make('device-x-visit',1),productKey:'unknown-user-entered-text'},
    {...make('device-x-visit',2),playerId:'somebody'},
  ];
  expect((await send(invalid)).rejected).toEqual(invalid.map(e=>e.eventId));
  expect((await send([make('device-c-visit',1)],'anonymous')).rejected).toEqual(['device-c-visit-1']);
  expect(stored('usageActivity')).toHaveLength(3);
});
test('server correction of an implausible product clock stays visible in the account report', async () => {
  const now=Date.now();
  const make=(sequence:number,occurredAt:number)=>row(sequence,{
    action:'product_action',productKey:'live_goal_recorded',screen:undefined,gameId:undefined,occurredAt,
  });
  await ingest({auth:{uid:'alice',token:{firebase:{sign_in_provider:'password'}}},
    data:{expectedUid:'alice',events:[make(1,now-1000),make(2,now+86400000)]}});
  const events=stored('usageActivity');
  expect(events[0]).toMatchObject({timeQuality:'device',sortAt:now-1000});
  expect(events[1]).toMatchObject({timeQuality:'unreliable',sortAt:events[1].receivedAt});
  const readTime=new Date(now).toISOString();
  const report=await readAccountActions(async(body:any)=>body.readTime?events.map((event:any)=>({
    readTime,document:{name:'usageActivity/'+event.eventId,fields:{
      uid:{stringValue:event.uid},sortAt:{integerValue:String(event.sortAt)},
      productKey:{stringValue:event.productKey},timeQuality:{stringValue:event.timeQuality},
    }},
  })):[{readTime}],'today',Date.now());
  expect(report).toMatchObject({accounts:1,accepted:2,partial:false,rows:[{users:1,events:2}],
    timeQuality:{device:1,received:1,unknown:0}});
});
test('token identity is mandatory and checked against expected owner', async () => {
  await expect(ingest({ data: { events: [row()] } })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(call([row()], 'alice', 'bob')).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(stored('usageActivity')).toEqual([]);
});
test('default-off activation does not collect and is separate from onboarding', async () => {
  delete process.env.USAGE_ACTIVITY_ENABLED;
  expect(await call([row()])).toMatchObject({ acknowledged: [], collectionEnabled: false });
  expect(stored('usageActivity')).toEqual([]);
});
test('replay and duplicate ids are counted once; the same id under another uid is a different event', async () => {
  const e = row(); await call([e, e]); await call([e]);
  expect(stored('usageActivity')).toHaveLength(1); expect(stored('usageSessions')[0]).toMatchObject({ eventCount: 1, screenEntries: 1, distinctGames: 1 });
  await call([e], 'bob'); expect(stored('usageActivity')).toHaveLength(2);
});
test('three real screen entries remain three while target distinct count stays one', async () => {
  await call([row(1), row(2), row(3)]);
  expect(stored('usageSessions')[0]).toMatchObject({ screenEntries: 3, distinctGames: 1, distinctGroups: 1, distinctScreens: 1 });
});
test('closed payload strips names, arbitrary params, uid claims and source claims; labels come from access-checked data', async () => {
  await call([row(1, { labelSnapshot: 'forged', uid: 'bob', source: 'server', query: 'private', params: { password: 'secret' } })]);
  expect(stored('usageActivity')[0]).toMatchObject({ uid: 'alice', source: 'app', labelSnapshot: 'יום שלישי / מועדון פרטי' });
  expect(stored('usageActivity')[0]).not.toHaveProperty('params'); expect(stored('usageActivity')[0]).not.toHaveProperty('query');
  mockDocs.set('groupsPublic/group-a', { name: 'מועדון ציבורי' });
  await call([row()], 'bob'); expect(stored('usageActivity').find((e: any) => e.uid === 'bob').labelSnapshot).toBe('מועדון ציבורי');
});
test('invalid row is rejected without blocking valid events; gap and future clock are marked explicitly', async () => {
  const bad = row(1, { screen: 'invented' }), valid = row(2, { occurredAt: Date.now() + 86400000 * 2 });
  expect(await call([bad, valid])).toMatchObject({ rejected: [bad.eventId], acknowledged: [valid.eventId] });
  expect(stored('usageActivity')[0].timeQuality).toBe('unreliable');
  await call([row(3, { action: 'coverage_gap' })]); expect(stored('usageSessions')[0].partial).toBe(true);
});
test('quota does not charge a duplicate again and does not acknowledge a fresh row', async () => {
  const e = row(); await call([e]); mockDocs.set(`usageActivityLimits/${sha('alice')}`, { window: Math.floor(Date.now() / 3600000), count: 600 });
  expect(await call([e, row(2)])).toMatchObject({ acknowledged: [e.eventId], retryAfterMs: expect.any(Number) });
  expect(stored('usageActivity')).toHaveLength(1);
});
test.each(['players', 'waitlist', 'pending'])('server receipt in either arrival order creates one linked %s outcome', async bucket => {
  const tappedAt = Date.now(), operationId = joinDiagnosticId('game-a', 'alice', tappedAt);
  const attempt = row(1, { action: 'registration_attempt', operationId, resultSequence: 2 });
  const event = { params: { uid: 'alice', gameId: 'game-a' }, data: { after: { data: () => ({ state: 'assigned', bucket, tappedAt, registrationCreated: true, assignedAt: Date.now() }) } } };
  await receipt(event); await call([attempt]);
  const path = `usageOperations/${sha(`alice:${operationId}`)}`;
  const materialization = () => materialize({ data: { after: { data: () => mockDocs.get(path), ref: mockRef(path) } } });
  await materialization(); await materialization();
  await call([row(2, { action: 'registration_result', result: bucket, operationId })]);
  expect(stored('usageActivity')).toHaveLength(2);
  expect(stored('usageActivity').find((e: any) => e.action === 'registration_result')).toMatchObject({ source: 'server', result: bucket, operationId });
  expect(stored('usageSessions')[0]).toMatchObject({ eventCount: 2, confirmedRegistrations: bucket === 'players' ? 1 : 0, waitlistRegistrations: bucket === 'waitlist' ? 1 : 0 });
});
test('attempt first then delayed receipt resolves a client failure using proof, without duplicating the attempt/result', async () => {
  const tappedAt = Date.now(), operationId = joinDiagnosticId('game-a', 'alice', tappedAt);
  await call([row(1, { action: 'registration_attempt', operationId, resultSequence: 2 }), row(2, { action: 'registration_result', result: 'failed', operationId })]);
  await receipt({ params: { uid: 'alice', gameId: 'game-a' }, data: { after: { data: () => ({ state: 'assigned', bucket: 'players', tappedAt, registrationCreated: true, assignedAt: Date.now() }) } } });
  const path = `usageOperations/${sha(`alice:${operationId}`)}`;
  await materialize({ data: { after: { data: () => mockDocs.get(path), ref: mockRef(path) } } });
  expect(stored('usageActivity')).toHaveLength(2); expect(stored('usageSessions')[0]).toMatchObject({ eventCount: 2, confirmedRegistrations: 1 });
});
test('client success without a business receipt never creates a verified result or count', async () => {
  await call([row(1, { action: 'registration_attempt', operationId: 'operation-a', resultSequence: 2 }), row(2, { action: 'registration_result', operationId: 'operation-a', result: 'players' })]);
  expect(stored('usageActivity')).toHaveLength(1); expect(stored('usageSessions')[0].confirmedRegistrations).toBe(0);
});
test('a receipt for another game cannot authenticate the claimed target of an attempt', async () => {
  const tappedAt = Date.now(), operationId = joinDiagnosticId('game-a', 'alice', tappedAt);
  await receipt({ params: { uid: 'alice', gameId: 'game-a' }, data: { after: { data: () => ({ state: 'assigned', bucket: 'players', tappedAt, registrationCreated: true, assignedAt: Date.now() }) } } });
  await call([row(1, { gameId: 'other-game', action: 'registration_attempt', operationId, resultSequence: 2 })]);
  const path = `usageOperations/${sha(`alice:${operationId}`)}`;
  await materialize({ data: { after: { data: () => mockDocs.get(path), ref: mockRef(path) } } });
  expect(stored('usageActivity')).toHaveLength(1); expect(stored('usageSessions')[0].confirmedRegistrations).toBe(0);
});
test('deleted target does not acquire a replacement name and deleted account cannot recreate usage', async () => {
  mockDocs.delete('games/game-a'); await call([row()]); expect(stored('usageActivity')[0].labelStatus).toBe('target_unavailable');
  mockDocs.set('users/alice', { deletedAt: Date.now() });
  await expect(call([row(2)])).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(stored('usageActivity')).toHaveLength(1);
});
test('a retry already seated by the first request reports its state without a second registration count', async () => {
  for (const [sequence, created] of [[1, true], [3, false]] as const) {
    const tappedAt = Date.now() + sequence, operationId = joinDiagnosticId('game-a', 'alice', tappedAt);
    await call([row(sequence, { action: 'registration_attempt', operationId, resultSequence: sequence + 1 })]);
    await receipt({ params: { uid: 'alice', gameId: 'game-a' }, data: { after: { data: () => ({ state: 'assigned', bucket: 'players', tappedAt, registrationCreated: created, assignedAt: Date.now() }) } } });
    const path = `usageOperations/${sha(`alice:${operationId}`)}`;
    await materialize({ data: { after: { data: () => mockDocs.get(path), ref: mockRef(path) } } });
  }
  expect(stored('usageSessions')[0]).toMatchObject({ confirmedRegistrations: 1, eventCount: 4 });
  expect(stored('usageActivity').filter((e: any) => e.action === 'registration_result').map((e: any) => e.registrationState)).toEqual(['created', 'existing']);
});
test('legacy receipt without transition proof marks the summary partial instead of inventing a fresh registration', async () => {
  const tappedAt = Date.now(), operationId = joinDiagnosticId('game-a', 'alice', tappedAt);
  await call([row(1, { action: 'registration_attempt', operationId, resultSequence: 2 })]);
  await receipt({ params: { uid: 'alice', gameId: 'game-a' }, data: { after: { data: () => ({ state: 'assigned', bucket: 'players', tappedAt, assignedAt: Date.now() }) } } });
  const path = `usageOperations/${sha(`alice:${operationId}`)}`;
  await materialize({ data: { after: { data: () => mockDocs.get(path), ref: mockRef(path) } } });
  expect(stored('usageSessions')[0]).toMatchObject({ confirmedRegistrations: 0, partial: true });
});
test('a delayed materialization after account/operation deletion exits without recreating data or retrying forever', async () => {
  const operationId = 'operation-a';
  const attempt = row(1, { action: 'registration_attempt', operationId, resultSequence: 2 });
  const op = { uid: 'alice', gameId: 'game-a', attempt, result: 'players', resultAt: Date.now(), registrationCreated: true };
  mockDocs.set('users/alice', { deletedAt: Date.now() });
  const path = `usageOperations/${sha(`alice:${operationId}`)}`;
  await expect(materialize({ data: { after: { data: () => op, ref: mockRef(path) } } })).resolves.toBeUndefined();
  expect(stored('usageActivity')).toHaveLength(0); expect(stored('usageOperations')).toHaveLength(0);
});
