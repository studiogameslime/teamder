import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError, isStaleSession } from '../../src/services/staleSession';
import { clearCaughtErrorOrigins, installCaughtErrorSink } from '../../src/utils/errorObservation';
function fixture(): any {
  let uid = 'u'; const observe = jest.fn(); clearCaughtErrorOrigins(); installCaughtErrorSink(observe);
  const source = { kind: 'wear-health-services', sourceId: 'watch', readerInstallationId: 'phone', connectionId: 'conn', generation: 1, connectedAt: 1000 };
  const chunk = (extra = {}) => ({ mode: 'standalone', userId: 'u', source: source.kind, deviceId: 'watch', connectionId: 'conn',
    sourceGeneration: 1, readerInstallationId: 'phone', sessionId: 'session', revision: 1, startedAtMs: 1000, endedAtMs: 3000,
    offsetMs: 0.4, clockUncertaintyMs: 10, samples: [{ id: 'one', startAtMs: 2000, endAtMs: 3000, distanceM: 4 }], ...extra });
  const native = { getPendingStandaloneActivity: jest.fn(async () => [chunk()]), ackStandaloneActivity: jest.fn(async () => true), publishActivitySource: jest.fn(async () => true) };
  const read = jest.fn(async (_: any) => ({ data: { source, generation: 1, dataRevision: 0, records: [], cursor: null } }));
  const save = jest.fn(async (_: any) => ({ data: { status: 'saved' } })), select = jest.fn(async (_: any) => ({ data: { source, generation: 1, dataRevision: 0 } }));
  const imports: any = { '@/config/sportsActivity': { SPORTS_ACTIVITY_ENABLED: true, assertSportsActivityEnabled: () => {} }, 'react-native': { NativeModules: { WatchBridge: native }, Platform: { OS: 'android' } },
    'firebase/functions': { httpsCallable: (_: any, name: string) => name === 'getMyActivityState' ? read : name === 'saveMyActivityRecords' ? save : select },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ functions: {}, auth: { currentUser: { uid, isAnonymous: false } } }) },
    '@/store/userStore': { useUserStore: { getState: () => ({ currentUser: { id: uid, isGuest: false } }) } },
    './staleSession': { StaleSessionError, isStaleSession }, '../utils/activityMovement': movement, '../utils/errorObservation': { observeCaughtError: observe } };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/myActivityService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => {if(id.endsWith('/joinDiagnosticId'))return require('@/utils/joinDiagnosticId');if(id.endsWith('/diagnosticJournal'))return require('@/services/diagnosticJournal');if(id==='@/services/diagnosticCallable')id='firebase/functions';return imports[id];}, Map, Set, JSON, Promise });
  return { ...exports, source, chunk, native, read, save, select, observe, switchUser: () => { uid = 'other'; } };
}
test('standalone upload uses deterministic namespaced scalar records and activity envelope then ACK', async () => {
  const f = fixture(); expect(await f.flushMyActivity('u')).toEqual({ uploaded: 1, pending: 0 });
  expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ expectedUid: 'u', batchId: 'session:1:0', binding: { connectionId: 'conn', generation: 1, kind: 'wear-health-services', sourceId: 'watch', readerInstallationId: 'phone' },
    records: [{ id: 'session:one:distanceM', recordType: 'distance', value: 4, startAtMs: 2000, endAtMs: 3000, modifiedAtMs: 3000, clockUncertaintyMs: 10 },
      { id: 'session:activity', recordType: 'activity', startAtMs: 1000, endAtMs: 3000, modifiedAtMs: 3000, activityType: 'football', clockUncertaintyMs: 10 }] }));
  expect(f.native.ackStandaloneActivity).toHaveBeenCalledWith('session', 1);
});
test('stale binding and server stale response retain chunks without ACK', async () => {
  const f = fixture(); f.native.getPendingStandaloneActivity.mockResolvedValue([f.chunk({ sourceGeneration: 0 }), f.chunk()]);
  f.save.mockResolvedValue({ data: { status: 'stale' } });
  expect(await f.flushMyActivity('u')).toEqual({ uploaded: 0, pending: 2 }); expect(f.save).toHaveBeenCalledTimes(1);
  expect(f.native.ackStandaloneActivity).not.toHaveBeenCalled();
});
test('concurrent flush is deduplicated and all deterministic parts must succeed before ACK', async () => {
  const f = fixture(); f.native.getPendingStandaloneActivity.mockResolvedValue([f.chunk({ samples: Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, startAtMs: 2000, endAtMs: 3000, steps: 1, distanceM: 2, calories: 0.1, heartRateBpm: 100 })) })]);
  const first = f.flushMyActivity('u'); expect(f.flushMyActivity('u')).toBe(first); await first;
  expect(f.save.mock.calls.map((c: any[]) => [c[0].batchId, c[0].records.length])).toEqual([['session:1:0', 300], ['session:1:1', 300], ['session:1:2', 201]]);
  expect(f.save.mock.calls[0][0].records[2].recordType).toBe('total-calories');
  expect(f.native.ackStandaloneActivity).toHaveBeenCalledTimes(1);
});
test('switching account while native read fails throws stale without logging sensor text', async () => {
  const f = fixture(); f.native.getPendingStandaloneActivity.mockImplementation(async () => { f.switchUser(); throw new Error('distanceM=9876'); });
  await expect(f.flushMyActivity('u')).rejects.toMatchObject({ name: 'StaleSessionError' }); expect(f.observe).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled();
});
test('native and callable errors are sanitized before observation or rethrow', async () => {
  const f = fixture(); f.save.mockRejectedValue(Object.assign(new Error('distanceM=9876'), { code: 'functions/unavailable', payload: { steps: 678 } }));
  await expect(f.flushMyActivity('u')).rejects.toMatchObject({ message: 'Activity request failed', code: 'functions/unavailable' });
  expect(f.native.ackStandaloneActivity).not.toHaveBeenCalled(); expect(f.observe).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.observe.mock.calls)).not.toMatch(/9876|678|distanceM|steps/);
});
test('logout while upload completes cannot acknowledge its chunk or expose a prior account error', async () => {
  const f = fixture(); f.save.mockImplementation(async () => { f.switchUser(); return { data: { status: 'saved' } }; });
  await expect(f.flushMyActivity('u')).rejects.toMatchObject({ name: 'StaleSessionError' });
  expect(f.native.ackStandaloneActivity).not.toHaveBeenCalled(); expect(f.observe).not.toHaveBeenCalled();
});
test('all immutable parts must be saved before ACK and clock bounds over one minute stay queued', async () => {
  const f = fixture(); f.native.getPendingStandaloneActivity.mockResolvedValue([f.chunk({ samples: Array.from({ length: 200 }, (_, i) => ({ id: `${i}`, startAtMs: 2000, endAtMs: 3000, steps: 1, distanceM: 1 })) }), f.chunk({ sessionId: 'bad-clock', clockUncertaintyMs: 60001 })]);
  f.save.mockResolvedValueOnce({ data: { status: 'saved' } }).mockResolvedValueOnce({ data: { status: 'stale' } });
  expect(await f.flushMyActivity('u')).toEqual({ uploaded: 0, pending: 2 }); expect(f.save).toHaveBeenCalledTimes(2);
  expect(f.native.ackStandaloneActivity).not.toHaveBeenCalled();
});
test('source publishing includes authenticated expectedUid and null generation', async () => {
  const f = fixture(); f.select.mockResolvedValue({ data: { generation: 2, source: null, dataRevision: 0 } });
  await f.setMyActivitySource('u', 1, null);
  expect(JSON.parse(f.native.publishActivitySource.mock.calls[0][0])).toEqual({ expectedUid: 'u', generation: 2, source: null, dataRevision: 0 });
});
test('pagination combines a consistent revision and refuses mixed generations', async () => {
  const f = fixture(), row = { id: 'a', recordType: 'steps', startAtMs: 1000, endAtMs: 2000, value: 2, modifiedAtMs: 3000 };
  f.read.mockResolvedValueOnce({ data: { source: f.source, generation: 1, dataRevision: 2, records: [row], cursor: { id: 'a', endAtMs: 2000, generation: 1, dataRevision: 2 } } })
    .mockResolvedValueOnce({ data: { source: f.source, generation: 1, dataRevision: 2, records: [{ ...row, id: 'b', startAtMs: 2000, endAtMs: 3000 }], cursor: null } });
  expect((await f.getMyActivityState('u', { from: 0, to: 4000 })).summary.steps).toBe(4);
  f.read.mockResolvedValueOnce({ data: { source: f.source, generation: 1, dataRevision: 2, records: [], cursor: { id: 'a' } } })
    .mockResolvedValueOnce({ data: { source: f.source, generation: 2, dataRevision: 0, records: [], cursor: null } });
  await expect(f.getMyActivityState('u', { from: 0, to: 4000 })).rejects.toThrow('Activity page changed');
});
test('summary preserves unknown vs zero, excludes boundary snapshots, unions activity and rejects overlapping metrics', () => {
  const f = fixture(), record = (type: string, value: number | null, s: number, e: number, id = type) => ({ id, recordType: type, value, startAtMs: s, endAtMs: e, modifiedAtMs: 5000 });
  const summary = f.summarizeMyActivity([record('steps', 0, 1000, 2000), record('distance', 3, 0, 2000),
    record('active-calories', null, 1000, 2000), record('total-calories', 8, 1000, 2000),
    record('heart-rate', 100, 2000, 2000), record('heart-rate', 140, 3000, 3000, 'h2'),
    record('activity', null, 1000, 2500), record('activity', null, 2000, 3000, 'a2')], { from: 1000, to: 4000 });
  expect(summary).toMatchObject({ steps: 0, distanceM: null, activeCalories: null, totalCalories: 8, avgHeartRateBpm: 120, maxHeartRateBpm: 140, activityMs: 2000, excludedBoundaryRecords: 1 });
  const overlap = f.summarizeMyActivity([record('steps', 4, 1000, 2500), record('steps', 6, 2000, 3000, 'two')], { from: 0, to: 4000 });
  expect(overlap.steps).toBeNull(); expect(overlap.conflictingMetrics).toEqual(['steps']);
  expect(f.summarizeMyActivity([record('activity', null, 0, 5000)], { from: 1000, to: 4000 }).activityMs).toBe(3000);
});
test('uncertain scalar and HR day boundaries are excluded and ambiguous activity duration stays unknown', () => {
  const f = fixture(), rows = [
    { id: 's', recordType: 'steps', value: 5, startAtMs: 1100, endAtMs: 2000, modifiedAtMs: 2000, clockUncertaintyMs: 200 },
    { id: 'h', recordType: 'heart-rate', value: 120, startAtMs: 900, endAtMs: 900, modifiedAtMs: 2000, clockUncertaintyMs: 200 },
    { id: 'a', recordType: 'activity', startAtMs: 0, endAtMs: 3000, modifiedAtMs: 3000, clockUncertaintyMs: 10 },
  ];
  const summary = f.summarizeMyActivity(rows, { from: 1000, to: 4000 });
  expect(summary).toMatchObject({ steps: null, avgHeartRateBpm: null, heartRateSamples: 0, activityMs: null, activityBoundaryUncertain: true, excludedBoundaryRecords: 3 });
  expect(f.summarizeMyActivity([{ ...rows[2], startAtMs: 1500 }], { from: 1000, to: 4000 })).toMatchObject({ activityMs: 1500, activityBoundaryUncertain: false });
});
import * as movement from '../../src/utils/activityMovement';
test('standalone speed keeps native point timestamps and is summarized without game filters', async () => {
  const f = fixture(); f.native.getPendingStandaloneActivity.mockResolvedValue([f.chunk({ samples: [0, 6, 6, 0].map((speedMps, i) => ({ id: `v${i}`, startAtMs: 2000 + i * 1000, endAtMs: 2000 + i * 1000, speedMps })) })]);
  await f.flushMyActivity('u');
  const records = f.save.mock.calls[0][0].records;
  expect(records[0]).toMatchObject({ recordType: 'speed', value: 0, startAtMs: 2000, endAtMs: 2000 });
  expect(f.summarizeMyActivity(records, { from: 0, to: 10000 }).movement).toMatchObject({ maxSpeedKmh: 21.6, sampledMs: 3000, runningMs: 2000, sprints: 1 });
});
