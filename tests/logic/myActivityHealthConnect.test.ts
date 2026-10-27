import * as providers from '../../src/utils/activityProviders';
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as movement from '../../src/utils/activityMovement';

function fixture() {
  const sdk = { getSdkStatus: jest.fn(async () => 3), initialize: jest.fn(async () => true),
    getGrantedPermissions: jest.fn(async () => ['Distance', 'Steps', 'ActiveCaloriesBurned', 'TotalCaloriesBurned'].map(recordType => ({ accessType: 'read', recordType }))),
    requestPermission: jest.fn(async (p: unknown) => p),
    readRecords: jest.fn(async () => ({ records: [], pageToken: undefined } as any)),
    aggregateRecord: jest.fn(async ({ recordType }: any) => ({ dataOrigins: ['vendor.app'],
      ...(recordType === 'Distance' ? { DISTANCE: { inMeters: 123 } } : recordType === 'Steps' ? { COUNT_TOTAL: 0 }
        : recordType === 'ActiveCaloriesBurned' ? { ACTIVE_CALORIES_TOTAL: { inKilocalories: 0 } }
          : { ENERGY_TOTAL: { inKilocalories: 76 } }) } as any)),
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/myActivityHealthConnect.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => id === '@/config/sportsActivity' ? { assertSportsActivityEnabled: () => {} } : id === '../utils/activityProviders' ? providers : id === 'react-native' ? { Platform: { OS: 'android' } }
    : id === '../utils/errorObservation' ? { observeCaughtError: jest.fn() } : id === '../utils/activityMovement' ? movement : sdk });
  return { ...exports, sdk };
}

test('every aggregate uses the selected writer and preserves active zero separately from total calories', async () => {
  const f = fixture();
  const result = await f.readActivityHealthWindow('vendor.app', 1000, 3000);
  expect(result.metrics.map((m: any) => [m.recordType, m.value])).toEqual([
    ['distance', 123], ['steps', 0], ['active-calories', 0], ['total-calories', 76],
  ]);
  for (const [query] of f.sdk.aggregateRecord.mock.calls) expect(query.dataOriginFilter).toEqual(['vendor.app']);
});

test('no origins becomes null despite zero-filled native binding', async () => {
  const f = fixture(); f.sdk.aggregateRecord.mockResolvedValue({ dataOrigins: [], COUNT_TOTAL: 0 });
  expect((await f.readActivityHealthWindow('vendor.app', 1000, 3000)).metrics.every((m: any) => m.value === null)).toBe(true);
});

test('an unexpected writer is rejected rather than mixed into selected source', async () => {
  const f = fixture(); f.sdk.aggregateRecord.mockResolvedValue({ dataOrigins: ['other.app'], COUNT_TOTAL: 12 });
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 3000)).rejects.toMatchObject({ reason: 'origin-mismatch' });
});

test('discovery consumes every page and returns one option per writer, never totals', async () => {
  const f = fixture(); f.sdk.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'Steps' }]);
  f.sdk.readRecords.mockResolvedValueOnce({ records: [{ metadata: { dataOrigin: 'first.app' } }], pageToken: 'next' })
    .mockResolvedValueOnce({ records: [{ metadata: { dataOrigin: 'second.app' } }, { metadata: { dataOrigin: 'first.app' } }], pageToken: '' });
  const origins = await f.discoverActivityHealthOrigins(1000, 3000);
  expect(origins.map((o: any) => o.id)).toEqual(['first.app', 'second.app']);
  expect(f.sdk.readRecords.mock.calls[1][1].pageToken).toBe('next');
  expect(f.sdk.aggregateRecord).not.toHaveBeenCalled();
});

test('a repeated pagination token fails explicitly without a partial list', async () => {
  const f = fixture(); f.sdk.readRecords.mockResolvedValue({ records: [], pageToken: 'repeat' });
  await expect(f.discoverActivityHealthOrigins(1000, 3000)).rejects.toMatchObject({ reason: 'incomplete' });
});

test('provider installation recovers in same process after an unavailable result', async () => {
  const f = fixture(); f.sdk.getSdkStatus.mockResolvedValueOnce(2);
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 3000)).rejects.toMatchObject({ reason: 'unavailable' });
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 3000)).resolves.toHaveProperty('metrics');
});

test('partial grants do not trigger reads of denied data or silently zero it', async () => {
  const f = fixture(); f.sdk.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'Steps' }]);
  const result = await f.readActivityHealthWindow('vendor.app', 1000, 3000);
  expect(result.metrics).toHaveLength(1); expect(result.missingPermissions).toEqual(expect.arrayContaining(['distance', 'active-calories', 'total-calories', 'speed-max', 'running-ms']));
  expect(f.sdk.aggregateRecord).toHaveBeenCalledTimes(1);
});

test('failed aggregation does not become an empty successful snapshot', async () => {
  const f = fixture(); f.sdk.aggregateRecord.mockRejectedValue(new Error('provider failed'));
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 3000)).rejects.toThrow('provider failed');
});

test('no granted movement types is a permission error', async () => {
  const f = fixture(); f.sdk.getGrantedPermissions.mockResolvedValue([]);
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 3000)).rejects.toMatchObject({ reason: 'permission' });
});

test('out-of-Date-range and fractional timestamps fail with typed invalid-range', async () => {
  const f = fixture();
  await expect(f.readActivityHealthWindow('vendor.app', 8640000000000000, 8640000000000100)).rejects.toMatchObject({ reason: 'invalid-range' });
  await expect(f.readActivityHealthWindow('vendor.app', 1.5, 3000)).rejects.toMatchObject({ reason: 'invalid-range' });
});

test('permission request includes only supported read scopes and never heart rate, history or background', async () => {
  const f = fixture(); await f.requestActivityHealthPermissions();
  expect(f.sdk.requestPermission.mock.calls[0][0]).toEqual(['Distance', 'Steps', 'Speed', 'ActiveCaloriesBurned']
    .map(recordType => ({ recordType, accessType: 'read' })));
});

test('granting speed alone is sufficient to connect', async () => {
  const f = fixture(); f.sdk.requestPermission.mockResolvedValue([{ recordType: 'Speed', accessType: 'read' }]);
  await expect(f.requestActivityHealthPermissions()).resolves.toBeUndefined();
});

test('speed-only writer is discovered and full-day samples produce movement without exercise filtering', async () => {
  const f = fixture(); f.sdk.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'Speed' }]);
  f.sdk.readRecords.mockResolvedValue({ records: [{ metadata: { id: 'speed-record', dataOrigin: 'vendor.app' },
    samples: [0, 6, 6, 0].map((v, i) => ({ time: new Date(1000 + i * 1000).toISOString(), speed: { inMetersPerSecond: v } })) }], pageToken: '' });
  expect((await f.discoverActivityHealthOrigins(1000, 5000))[0].id).toBe('vendor.app');
  f.sdk.readRecords.mockClear();
  const result = await f.readActivityHealthWindow('vendor.app', 1000, 5000);
  expect(result.metrics).toEqual(expect.arrayContaining([
    expect.objectContaining({ recordType: 'speed-max', value: 21.6 }),
    expect.objectContaining({ recordType: 'stationary-ms', value: 1000 }),
    expect.objectContaining({ recordType: 'running-ms', value: 2000 }),
    expect.objectContaining({ recordType: 'sprints', value: 1 }),
  ]));
  expect(f.sdk.readRecords.mock.calls[0][1].dataOriginFilter).toEqual(['vendor.app']);
});

test('speed read failure or another origin never yields a successful partial day', async () => {
  const f = fixture(); f.sdk.getGrantedPermissions.mockResolvedValue([{ accessType: 'read', recordType: 'Speed' }]);
  f.sdk.readRecords.mockResolvedValue({ records: [{ metadata: { dataOrigin: 'other.app' }, samples: [] }] });
  await expect(f.readActivityHealthWindow('vendor.app', 1000, 5000)).rejects.toMatchObject({ reason: 'origin-mismatch' });
});
