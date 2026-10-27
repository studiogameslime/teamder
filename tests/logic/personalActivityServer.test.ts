import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture(): any {
  const records = new Map<string, any>();
  const hooks: { beforeCommit?: () => void; attempts: number } = { attempts: 0 };
  const doc = (path: string): any => ({ path, id: path.split('/').pop(), collection: (name: string) => collection(`${path}/${name}`),
    get: async () => snapshot(path), set: async (data: any) => { records.set(path, { data, version: 10000 }); },
    delete: async () => { records.delete(path); } });
  const snapshot = (path: string): any => {
    const record = records.get(path), data = record ? JSON.parse(JSON.stringify(record.data)) : undefined, version = record?.version;
    return { ref: doc(path), id: path.split('/').pop(), exists: !!record, data: () => data,
      updateTime: record ? { toMillis: () => version } : undefined };
  };
  const collection = (path: string, filter?: [string, unknown]): any => ({ path, filter, doc: (id: string) => doc(`${path}/${id}`),
    where: (field: string, _op: string, value: unknown) => collection(path, [field, value]), limit: (limit: number) => ({
      path, limit, filter, get: async () => query(path, limit, filter) }), get: async () => query(path, 10000, filter) });
  const query = (path: string, limit: number, filter?: [string, unknown]) => {
    const docs = [...records.keys()].filter(k => k.startsWith(`${path}/`) && k.slice(path.length + 1).indexOf('/') < 0)
      .filter(k => !filter || records.get(k)?.data[filter[0]] === filter[1])
      .slice(0, limit).map(snapshot);
    return { docs, size: docs.length };
  };
  const recursiveDelete = jest.fn(async (ref: any) => {
    for (const key of [...records.keys()]) if (key === ref.path || key.startsWith(`${ref.path}/`)) records.delete(key);
  });
  const db = { doc, collection, runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      hooks.attempts++;
      const writes: Array<[string, any]> = [], versions = new Map<string, number | undefined>();
      const value = await fn({ get: async (ref: any) => {
        if (ref.limit) return query(ref.path, ref.limit, ref.filter);
        const result = snapshot(ref.path); versions.set(ref.path, records.get(ref.path)?.version); return result;
      }, set: (ref: any, data: any) => writes.push([ref.path, data]) });
      if (hooks.beforeCommit) { const before = hooks.beforeCommit; hooks.beforeCommit = undefined; before(); }
      if ([...versions].some(([path, version]) => records.get(path)?.version !== version)) continue;
      for (const [path, data] of writes) records.set(path, { data, version: (records.get(path)?.version ?? 9999) + 1 });
      return value;
    }
    throw new Error('Transaction retry limit');
  }, recursiveDelete };
  class TestError extends Error { constructor(public code: string, message: string) { super(message); } }
  const imports: Record<string, any> = {
    'node:crypto': require('crypto'), 'firebase-admin/firestore': { getFirestore: () => db },
    './observedFunctions': { onCall: (_options: any, handler: any) => handler, onDocumentUpdated: (_options: any, handler: any) => handler },
    'firebase-functions/v2/https': { onCall: (_options: any, handler: any) => handler },
    'firebase-functions/v2/firestore': { onDocumentUpdated: (_options: any, handler: any) => handler },
    'firebase-functions/v2/scheduler': {}, 'firebase-functions/v2/tasks': {},
    './appCheckPolicy': { ENFORCE_APP_CHECK: false }, './expectedCallableError': { ExpectedCallableError: TestError },
    './personalActivityWindows': { personalActivityPlayerIds: (g: any) => g.testPlayers ?? [] },
  };
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('functions/src/personalActivity.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => { if (!(id in imports)) throw new Error(id); return imports[id]; }, Date, Set, Map, JSON, Math });
  records.set('games/g', { data: { status: 'finished', players: ['u'] }, version: 10000 });
  records.set('users/u', { data: { name: 'משתמש', isGuest: false }, version: 10000 });
  records.set('users/other', { data: { name: 'אחר', isGuest: false }, version: 10000 });
  records.set('personalActivityJournal/g', { data: { version: 1, knownFrom: 1000 }, version: 10000 });
  records.set('personalActivityJournal/g/segments/a', { data: { from: 1000, to: 10000, eligibleFrom: 1000, eligibleTo: 10000,
    playerIds: ['u'], timerRunning: true }, version: 10000 });
  const input = (extra: Record<string, any> = {}) => ({ expectedUid: 'u', gameId: 'g', sessionId: 'session', revision: 1,
    source: 'wear-health-services', offsetMs: 0, clockUncertaintyMs: 0,
    samples: [{ id: 'one', startAtMs: 2000, endAtMs: 3000, distanceM: 4, steps: 3, heartRateBpm: 120 }], ...extra });
  const request = (data: any) => ({ auth: { uid: 'u', token: { firebase: { sign_in_provider: 'password' } } }, data });
  return { ...exports, records, input, request, hooks, recursiveDelete };
}

test('journal segments use prior lineup and a newly recorded timer stop', () => {
  const f = fixture();
  const segment = f.activitySegment({ status: 'active', testPlayers: ['u'], liveMatch: { timerRunning: true,
    timerLastStartedAt: 1500, activeIntervals: [] } }, { testPlayers: ['other'], liveMatch: { timerRunning: false,
    activeIntervals: [{ s: 1500, e: 2700 }] } }, 1000, 3000);
  expect(segment).toMatchObject({ eligibleFrom: 1500, eligibleTo: 2700, playerIds: ['u'] });
});
test('legacy stop without interval retains the commit boundary and never final lineup', () => {
  const f = fixture();
  expect(f.activitySegment({ testPlayers: ['u'], liveMatch: { timerRunning: true, timerLastStartedAt: 1000 } }, { testPlayers: [], liveMatch: { timerRunning: false } }, 1000, 3000))
    .toMatchObject({ eligibleTo: 3000, playerIds: ['u'] });
});
test.each(['finished', 'cancelled'])('terminal %s state creates no eligibility', status => {
  expect(fixture().activitySegment({ status, testPlayers: ['u'], liveMatch: { timerRunning: true } }, {}, 1, 2).playerIds).toEqual([]);
});
test('out of order and repeated events merge, but a middle gap never becomes ready', () => {
  const f = fixture();
  const segment = (from: number, to: number) => ({ from, to, eligibleFrom: from, eligibleTo: to, playerIds: ['u'], timerRunning: true });
  expect(f.activityEvidence([segment(3, 5), segment(1, 3), segment(3, 5)], 'u', 5, 1)).toMatchObject({ ready: true, windows: [{ from: 1, to: 5 }] });
  expect(f.activityEvidence([segment(1, 2), segment(3, 5)], 'u', 5, 1).ready).toBe(false);
});
test('baseline never infers eligibility before the earliest proven document version', () => {
  const f = fixture();
  const segment = { from: 1, to: 100, eligibleFrom: 1, eligibleTo: 100, playerIds: ['u'], timerRunning: true };
  expect(f.activityEvidence([segment], 'u', 100, 50)).toMatchObject({ ready: true, windows: [{ from: 50, to: 100 }], knownFrom: 50 });
  expect(f.activityEvidence([segment], 'u', 100, 100)).toMatchObject({ ready: true, windows: [] });
  expect(f.activityEvidence([segment], 'u', 100).ready).toBe(false);
});
test('delta crossing a bench boundary is excluded entirely while other samples survive', () => {
  const f = fixture();
  const input = f.input({ samples: [{ id: 'cross', startAtMs: 1500, endAtMs: 2500, distanceM: 5 },
    { id: 'inside', startAtMs: 2600, endAtMs: 3000, distanceM: 2, heartRateBpm: 140 }] });
  const result = f.accumulateActivity(f.emptyActivityAccumulation(), input, [{ from: 2000, to: 4000 }]);
  expect(result.totals.distanceM).toBe(2);
  expect(result.excludedBoundarySamples).toBe(1);
  expect(result.heartRateSamples).toBe(1);
});
test('clock offset and uncertainty are applied before eligibility', () => {
  const f = fixture();
  const input = f.input({ offsetMs: 1000, clockUncertaintyMs: 50 });
  expect(f.accumulateActivity(f.emptyActivityAccumulation(), input, [{ from: 3000, to: 5000 }]).totals.distanceM).toBeNull();
  expect(f.accumulateActivity(f.emptyActivityAccumulation(), input, [{ from: 2900, to: 5000 }]).totals.distanceM).toBe(4);
});
test('HR is a point and average is arithmetic sample average, never merged by maximum', () => {
  const f = fixture();
  const input = f.input({ samples: [{ id: 'a', startAtMs: 2000, endAtMs: 2000, heartRateBpm: 100 },
    { id: 'b', startAtMs: 3000, endAtMs: 3000, heartRateBpm: 160 }, { id: 'edge', startAtMs: 4000, endAtMs: 4000, heartRateBpm: 200 }] });
  const accumulation = f.accumulateActivity(f.emptyActivityAccumulation(), input, [{ from: 1000, to: 4000 }]);
  const result = f.summarizePersonalActivity('g', [accumulation], { windows: [{ from: 1000, to: 4000 }], knownFrom: 1000 }, 5000);
  expect(result).toMatchObject({ avgHeartRateBpm: 130, maxHeartRateBpm: 160, heartRateSamples: 2, distanceM: null, measuredMs: 0, coverageRatio: null });
});
test('missing metrics stay null while explicitly measured zero remains zero', () => {
  const f = fixture();
  const result = f.accumulateActivity(f.emptyActivityAccumulation(), f.input({ samples: [{ id: 'zero', startAtMs: 2000, endAtMs: 3000, steps: 0 }] }), [{ from: 1000, to: 4000 }]);
  expect(result.totals).toEqual({ distanceM: null, steps: 0, calories: null });
});
test('overlapping deltas and repeated heart-rate points are rejected across chunks', () => {
  const f = fixture(), input = f.input();
  const result = f.accumulateActivity(f.emptyActivityAccumulation(), input, [{ from: 1000, to: 4000 }]);
  expect(() => f.accumulateActivity(result, input, [{ from: 1000, to: 4000 }])).toThrow('replayed');
});
test.each([
  { source: 'healthconnect' }, { revision: 0 }, { clockUncertaintyMs: -1 }, { offsetMs: Infinity },
  { samples: [] }, { samples: Array(301).fill({}) },
  { samples: [{ id: 'a', startAtMs: 1, endAtMs: 2, distanceM: NaN }] },
  { samples: [{ id: 'a', startAtMs: 1, endAtMs: 1, steps: 0 }] },
  { samples: [{ id: 'a', startAtMs: 1, endAtMs: 2, heartRateBpm: 5 }] },
])('reject invalid upload %j', change => {
  const f = fixture(); expect(() => f.validateActivityUpload(f.input(change))).toThrow();
});
test('full account and matching expected uid are mandatory', async () => {
  const f = fixture();
  await expect(f.savePersonalActivity({ data: f.input() })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(f.savePersonalActivity(f.request(f.input({ expectedUid: 'someone-else' })))).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('save is durable and duplicate chunk does not add totals twice', async () => {
  const f = fixture(), request = f.request(f.input());
  expect(await f.savePersonalActivity(request)).toMatchObject({ status: 'saved', summary: { distanceM: 4, steps: 3 } });
  expect(await f.savePersonalActivity(request)).toMatchObject({ status: 'duplicate', retryable: false });
  expect(await f.getMyPersonalActivity(f.request({ expectedUid: 'u', gameId: 'g' }))).toMatchObject({ status: 'available', summary: { distanceM: 4 } });
});
test('same chunk revision with changed payload is rejected and sequence gap is retryable', async () => {
  const f = fixture(); await f.savePersonalActivity(f.request(f.input()));
  await expect(f.savePersonalActivity(f.request(f.input({ samples: [{ id: 'one', startAtMs: 2000, endAtMs: 3000, distanceM: 5 }] })))).rejects.toThrow('Chunk content changed');
  expect(await f.savePersonalActivity(f.request(f.input({ revision: 3 })))).toMatchObject({ status: 'processing', expectedRevision: 2, retryable: true });
});
test('next chunk appends once, with separate per-metric coverage', async () => {
  const f = fixture(); await f.savePersonalActivity(f.request(f.input()));
  const result = await f.savePersonalActivity(f.request(f.input({ revision: 2, samples: [{ id: 'two', startAtMs: 3000, endAtMs: 4000, distanceM: 3 }] })));
  expect(result).toMatchObject({ status: 'saved', summary: { distanceM: 7, measuredMs: 2000, coverageMs: { distanceM: 2000, steps: 1000, calories: 0 } } });
});
test('another session cannot duplicate an already recorded interval', async () => {
  const f = fixture(); await f.savePersonalActivity(f.request(f.input()));
  await expect(f.savePersonalActivity(f.request(f.input({ sessionId: 'another' })))).rejects.toThrow('Overlapping activity sessions');
});
test('pending journal is not acknowledged or persisted', async () => {
  const f = fixture(); f.records.delete('personalActivityJournal/g/segments/a');
  expect(await f.savePersonalActivity(f.request(f.input()))).toEqual({ status: 'processing', retryable: true });
  expect([...f.records.keys()].some(k => k.startsWith('personalActivityPrivate/'))).toBe(false);
});
test('get is bound to the caller and cannot read another player by passing a user id', async () => {
  const f = fixture(); await f.savePersonalActivity(f.request(f.input()));
  const request = { auth: { uid: 'other', token: {} }, data: { expectedUid: 'other', gameId: 'g', userId: 'u' } };
  await expect(f.getMyPersonalActivity(request)).rejects.toMatchObject({ code: 'permission-denied' });
});
test('trigger baseline and deterministic event records survive duplicate and reverse delivery', async () => {
  const f = fixture();
  const stamp = (at: number) => ({ seconds: Math.floor(at / 1000), nanoseconds: (at % 1000) * 1000000, toMillis: () => at });
  const event = (from: number, to: number) => ({ params: { gameId: 'new' }, data: {
    before: { data: () => ({ testPlayers: ['u'], liveMatch: { timerRunning: true, timerLastStartedAt: 1000 } }), updateTime: stamp(from) },
    after: { data: () => ({ liveMatch: { timerRunning: false } }), updateTime: stamp(to) },
  } });
  await f.onGamePersonalActivityChanged(event(2000, 3000));
  await f.onGamePersonalActivityChanged(event(1000, 2000));
  await f.onGamePersonalActivityChanged(event(2000, 3000));
  expect(f.records.get('personalActivityJournal/new').data.knownFrom).toBe(1000);
  expect([...f.records.keys()].filter((k: string) => k.startsWith('personalActivityJournal/new/segments/'))).toHaveLength(2);
});
test.each([undefined, null, NaN, -1, 5000])('a missing or invalid timer anchor %s creates no eligibility', anchor => {
  const f = fixture();
  expect(f.activitySegment({ testPlayers: ['u'], liveMatch: { timerRunning: true, timerLastStartedAt: anchor } }, {}, 1000, 3000).playerIds).toEqual([]);
});
test('samples before an incomplete baseline remain queued until older events arrive', async () => {
  const f = fixture();
  f.records.get('personalActivityJournal/g').data.knownFrom = 10000;
  expect(await f.savePersonalActivity(f.request(f.input()))).toMatchObject({ status: 'processing', reason: 'before-journal-baseline' });
  f.records.get('personalActivityJournal/g').data.knownFrom = 1000;
  expect(await f.savePersonalActivity(f.request(f.input()))).toMatchObject({ status: 'saved' });
});
test('sensor metric and timestamp sample identifiers are supported', () => {
  const f = fixture();
  expect(f.validateActivityUpload(f.input({ samples: [{ id: 'd:2000:3000', startAtMs: 2000, endAtMs: 3000, distanceM: 1 }] })).samples[0].id).toBe('d:2000:3000');
});
test('revision budget supports twelve hours of ten-second chunks and rejects its upper overflow', () => {
  const f = fixture();
  expect(f.validateActivityUpload(f.input({ revision: 4320 })).revision).toBe(4320);
  expect(f.validateActivityUpload(f.input({ revision: 5000 })).revision).toBe(5000);
  expect(() => f.validateActivityUpload(f.input({ revision: 5001 }))).toThrow('Invalid revision');
});
test('a running current snapshot proves recording time without waiting for any future game event', async () => {
  const f = fixture();
  f.records.delete('personalActivityJournal/g'); f.records.delete('personalActivityJournal/g/segments/a');
  f.records.set('games/g', { data: { status: 'active', players: ['u'], testPlayers: ['u'],
    liveMatch: { timerRunning: true, timerLastStartedAt: 1000 } }, version: 1000 });
  expect(await f.savePersonalActivity(f.request(f.input()))).toMatchObject({ status: 'saved', summary: { distanceM: 4 } });
});
test('a late first stop event proves its previous unchanged lineup and unblocks the recorded chunk', async () => {
  const f = fixture();
  f.records.delete('personalActivityJournal/g'); f.records.delete('personalActivityJournal/g/segments/a');
  expect(await f.savePersonalActivity(f.request(f.input()))).toMatchObject({ status: 'processing' });
  const stamp = (at: number) => ({ seconds: Math.floor(at / 1000), nanoseconds: (at % 1000) * 1000000, toMillis: () => at });
  await f.onGamePersonalActivityChanged({ params: { gameId: 'g' }, data: {
    before: { data: () => ({ status: 'active', testPlayers: ['u'], liveMatch: { timerRunning: true, timerLastStartedAt: 1000 } }), updateTime: stamp(1000) },
    after: { data: () => ({ status: 'finished', liveMatch: { timerRunning: false, activeIntervals: [{ s: 1000, e: 9000 }] } }), updateTime: stamp(10000) },
  } });
  expect(await f.savePersonalActivity(f.request(f.input()))).toMatchObject({ status: 'saved', summary: { distanceM: 4, eligibleMs: 8000 } });
});
test('account deletion removes only its private activity roots and every nested chunk, idempotently', async () => {
  const f = fixture();
  await f.savePersonalActivity(f.request(f.input()));
  f.records.set('personalActivityPrivate/other-root', { data: { userId: 'other' }, version: 1 });
  f.records.set('personalActivityPrivate/other-root/sessions/s/chunks/1', { data: { samples: [] }, version: 1 });
  const event = { params: { uid: 'u' }, data: { after: { data: () => ({ deletedAt: 12345 }) } } };
  await f.onPersonalActivityOwnerDeleted(event);
  await f.onPersonalActivityOwnerDeleted(event);
  expect(f.recursiveDelete).toHaveBeenCalledTimes(1);
  expect([...f.records.keys()].filter((key: string) => key.startsWith('personalActivityPrivate/')))
    .toEqual(['personalActivityPrivate/other-root', 'personalActivityPrivate/other-root/sessions/s/chunks/1']);
  expect(f.records.has('personalActivityJournal/g')).toBe(true);
});
test('ordinary profile updates never run activity deletion', async () => {
  const f = fixture();
  await f.onPersonalActivityOwnerDeleted({ params: { uid: 'u' }, data: { after: { data: () => ({ name: 'שם אחר' }) } } });
  await f.onPersonalActivityOwnerDeleted({ params: { uid: 'u' }, data: { after: { data: () => ({ deletedAt: null }) } } });
  expect(f.recursiveDelete).not.toHaveBeenCalled();
});
test('a partial descendant cleanup failure retains its searchable owner root so retry can finish', async () => {
  const f = fixture();
  await f.savePersonalActivity(f.request(f.input()));
  const root = [...f.records.keys()].find((key: string) => key.startsWith('personalActivityPrivate/') && f.records.get(key).data.userId === 'u');
  const chunk = [...f.records.keys()].find((key: string) => key.startsWith(`${root}/sessions/`) && key.includes('/chunks/'));
  const event = { params: { uid: 'u' }, data: { after: { data: () => ({ deletedAt: 12345 }) } } };
  f.recursiveDelete.mockImplementationOnce(async () => {
    f.records.delete(chunk);
    throw new Error('One descendant deletion failed');
  });
  await expect(f.onPersonalActivityOwnerDeleted(event)).rejects.toThrow('descendant deletion failed');
  expect(f.recursiveDelete.mock.calls[0][0].path).toBe(`${root}/sessions`);
  expect(f.records.get(root).data.userId).toBe('u');
  expect([...f.records.keys()].some((key: string) => key.startsWith(`${root}/sessions/`))).toBe(true);
  await f.onPersonalActivityOwnerDeleted(event);
  expect([...f.records.keys()].some((key: string) => key === root || key.startsWith(`${root}/`))).toBe(false);
  expect(f.recursiveDelete).toHaveBeenCalledTimes(2);
});
test.each(['missing', 'deleted', 'guest'])('unavailable owner profile %s cannot upload or read health data', async kind => {
  const f = fixture();
  if (kind === 'missing') f.records.delete('users/u');
  else f.records.set('users/u', { data: kind === 'deleted' ? { deletedAt: 1234 } : { isGuest: true }, version: 10001 });
  await expect(f.savePersonalActivity(f.request(f.input()))).rejects.toHaveProperty('code', kind === 'guest' ? 'permission-denied' : 'failed-precondition');
  await expect(f.getMyPersonalActivity(f.request({ expectedUid: 'u', gameId: 'g' }))).rejects.toHaveProperty('code', kind === 'guest' ? 'permission-denied' : 'failed-precondition');
  expect([...f.records.keys()].some((key: string) => key.startsWith('personalActivityPrivate/'))).toBe(false);
});
test('deletion committed during an upload forces a retry and prevents recreation using an old token', async () => {
  const f = fixture();
  f.hooks.beforeCommit = () => f.records.set('users/u', { data: { deletedAt: 1234 }, version: 10001 });
  await expect(f.savePersonalActivity(f.request(f.input()))).rejects.toMatchObject({ code: 'failed-precondition' });
  expect(f.hooks.attempts).toBe(2);
  expect([...f.records.keys()].some((key: string) => key.startsWith('personalActivityPrivate/'))).toBe(false);
});
test('unrealistic interval delta cannot pass static metric limits alone', () => {
  const f = fixture();
  expect(() => f.accumulateActivity(f.emptyActivityAccumulation(), f.input({ samples: [{ id: 'speed', startAtMs: 2000,
    endAtMs: 2100, distanceM: 2 }] }), [{ from: 1000, to: 3000 }])).toThrow('interval bound');
});
test('a true measured zero interval has coverage while an uncovered interval does not', () => {
  const f = fixture();
  const result = f.accumulateActivity(f.emptyActivityAccumulation(), f.input({ samples: [{ id: 'zero', startAtMs: 2000,
    endAtMs: 3000, distanceM: 0 }, { id: 'bench', startAtMs: 4000, endAtMs: 5000, distanceM: 1 }] }), [{ from: 1000, to: 3500 }]);
  const summary = f.summarizePersonalActivity('g', [result], { windows: [{ from: 1000, to: 3500 }], knownFrom: 1000 }, 6000);
  expect(summary).toMatchObject({ distanceM: 0, measuredMs: 1000, coverageRatio: 0.4, excludedBoundarySamples: 1 });
});
