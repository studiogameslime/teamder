import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture(): any {
  const records = new Map<string, any>(), hooks: { beforeCommit?: () => void } = {};
  const snapshot = (path: string): any => { const data = records.has(path) ? JSON.parse(JSON.stringify(records.get(path))) : undefined;
    return { exists: data !== undefined, id: path.split('/').pop(), ref: doc(path), data: () => data }; };
  const doc = (path: string): any => ({ path, collection: (name: string) => collection(`${path}/${name}`),
    delete: async () => { records.delete(path); } });
  const collection = (path: string, filters: any[] = [], orders: string[] = [], count = 10000, after?: any[]): any => ({ path,
    doc: (id: string) => doc(`${path}/${id}`),
    where: (...args: any[]) => collection(path, [...filters, args], orders, count, after),
    orderBy: (field: string) => collection(path, filters, [...orders, field], count, after),
    limit: (n: number) => collection(path, filters, orders, n, after),
    startAfter: (...args: any[]) => collection(path, filters, orders, count, args),
    get: async () => query(path, filters, count, after), query: true, filters, count, after });
  const query = (path: string, filters: any[], count: number, after?: any[]) => {
    let docs = [...records.keys()].filter(k => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(snapshot);
    for (const [key, op, value] of filters) docs = docs.filter(d => op === '==' ? d.data()[key] === value : op === '>=' ? d.data()[key] >= value : d.data()[key] <= value);
    docs.sort((a, b) => (a.data().endAtMs ?? 0) - (b.data().endAtMs ?? 0) || a.id.localeCompare(b.id));
    if (after) docs = docs.filter(d => d.data().endAtMs > after[0] || d.data().endAtMs === after[0] && d.id > after[1]);
    docs = docs.slice(0, count); return { docs, size: docs.length };
  };
  const recursiveDelete = jest.fn(async (ref: any) => { for (const key of [...records.keys()]) if (key.startsWith(`${ref.path}/`)) records.delete(key); });
  const db = { collection, doc, recursiveDelete, runTransaction: async (callback: any) => {
    for (let i = 0; i < 3; i++) {
      const reads = new Map<string, string>(), writes: any[] = [];
      const result = await callback({ get: async (ref: any) => {
        if (ref.query) return query(ref.path, ref.filters, ref.count, ref.after);
        reads.set(ref.path, JSON.stringify(records.get(ref.path))); return snapshot(ref.path);
      }, set: (ref: any, data: any, options?: any) => writes.push([ref.path, data, options]) });
      if (hooks.beforeCommit) { const change = hooks.beforeCommit; hooks.beforeCommit = undefined; change(); }
      if ([...reads].some(([key, value]) => JSON.stringify(records.get(key)) !== value)) continue;
      for (const [path, data, options] of writes) records.set(path, options?.merge ? { ...records.get(path), ...data } : data);
      return result;
    }
    throw new Error('Retry limit');
  } };
  class TestError extends Error { constructor(public code: string, message: string) { super(message); } }
  const imports: any = { 'node:crypto': require('crypto'), 'firebase-admin/firestore': { getFirestore: () => db, FieldPath: { documentId: () => '__name__' } },
    './observedFunctions': { onCall: (_: any, f: any) => f, onDocumentUpdated: (_: any, f: any) => f },
    'firebase-functions/v2/https': { onCall: (_: any, f: any) => f },
    'firebase-functions/v2/firestore': { onDocumentUpdated: (_: any, f: any) => f },
    'firebase-functions/v2/scheduler': {}, 'firebase-functions/v2/tasks': {},
    './appCheckPolicy': { ENFORCE_APP_CHECK: false }, './expectedCallableError': { ExpectedCallableError: TestError } };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('functions/src/myActivity.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: (id: string) => imports[id], Date, Map, Set, JSON });
  records.set('users/u', { isGuest: false });
  const request = (data: any, uid = 'u') => ({ auth: { uid, token: { firebase: { sign_in_provider: 'password' } } }, data: { expectedUid: uid, ...data } });
  const select = async (source: any = { kind: 'health-connect', sourceId: 'vendor.app', readerInstallationId: 'phone' }, generation = 0) => exports.setMyActivitySource(request({ expectedGeneration: generation, source }));
  const row = (extra = {}) => ({ id: 'hc:steps:1000:2000', recordType: 'steps', startAtMs: 1000, endAtMs: 2000, modifiedAtMs: 3000, value: 20, ...extra });
  const save = (binding: any, rows = [row()], batchId = 'batch') => exports.saveMyActivityRecords(request({ binding, records: rows, batchId }));
  return { ...exports, records, hooks, recursiveDelete, request, select, row, save };
}
test('source switch increments authoritative generation, rejects stale writes and hides previous records', async () => {
  const f = fixture(), first = await f.select();
  expect(first.source.generation).toBe(1); await f.save(first.source);
  const next = await f.select({ kind: 'wear-health-services', sourceId: 'watch', readerInstallationId: 'phone' }, 1);
  expect(next.generation).toBe(2); expect(await f.save(first.source)).toMatchObject({ status: 'stale' });
  expect((await f.getMyActivityState(f.request({ range: { from: 0, to: 4000 } }))).records).toEqual([]);
  expect([...f.records.keys()].some(k => k.includes(`/connections/${first.source.connectionId}/records/`))).toBe(true);
  await expect(f.select(null, 1)).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('immutable batches are idempotent, corrected snapshots replace totals including null and explicit zero', async () => {
  const f = fixture(), binding = (await f.select()).source;
  expect(await f.save(binding)).toMatchObject({ status: 'saved' });
  expect(await f.save(binding)).toMatchObject({ status: 'duplicate' });
  await expect(f.save(binding, [f.row({ value: 999 })])).rejects.toMatchObject({ code: 'already-exists' });
  await f.save(binding, [f.row({ value: null, modifiedAtMs: 4000 })], 'second');
  let page = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } })); expect(page.records[0].value).toBeNull();
  await f.save(binding, [f.row({ value: 0, modifiedAtMs: 5000 })], 'third');
  await f.save(binding, [f.row({ value: 100, modifiedAtMs: 3500 })], 'late');
  page = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } })); expect(page.records[0].value).toBe(0);
});
test('tombstones retain position and never count older replays', async () => {
  const f = fixture(), binding = (await f.select()).source; await f.save(binding);
  await f.save(binding, [f.row({ deleted: true, modifiedAtMs: 4000 })], 'delete');
  await f.save(binding, [f.row()], 'replay');
  const state = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } })); expect(state.records[0].deleted).toBe(true);
});
test('read pagination pins data revision and fails rather than mixing concurrent corrections', async () => {
  const f = fixture(), binding = (await f.select()).source;
  for (let p = 0; p < 2; p++) await f.save(binding, Array.from({ length: 251 }, (_, n) => f.row({ id: `id${p * 251 + n}`, endAtMs: 2000 + n + p * 251 })), `p${p}`);
  const first = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } })); expect(first.records).toHaveLength(500); expect(first.cursor).not.toBeNull();
  const second = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 }, cursor: first.cursor })); expect(second.records).toHaveLength(2);
  await f.save(binding, [f.row({ modifiedAtMs: 6000 })], 'correction');
  await expect(f.getMyActivityState(f.request({ range: { from: 0, to: 5000 }, cursor: first.cursor }))).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('deleted account guard is transactional, missing profile is an error and expectedUid is bound', async () => {
  const f = fixture(), binding = (await f.select()).source;
  f.hooks.beforeCommit = () => f.records.set('users/u', { deletedAt: 123 });
  await expect(f.save(binding)).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...f.records.keys()].filter(k => k.includes('/records/'))).toHaveLength(0);
  await expect(f.getMyActivityState(f.request({}))).rejects.toMatchObject({ code: 'failed-precondition' });
  f.records.delete('users/u'); await expect(f.select()).rejects.toMatchObject({ code: 'failed-precondition' });
  await expect(f.getMyActivityState(f.request({ expectedUid: 'other' }))).rejects.toMatchObject({ code: 'failed-precondition' });
});
test('cleanup preserves searchable owner root on descendant failure then removes everything on retry', async () => {
  const f = fixture(), binding = (await f.select()).source; await f.save(binding);
  const root = [...f.records.keys()].find(k => /^myActivityPrivate\/[^/]+$/.test(k));
  const event = { params: { uid: 'u' }, data: { after: { data: () => ({ deletedAt: 123 }) } } };
  f.recursiveDelete.mockRejectedValueOnce(new Error('child delete failed'));
  await expect(f.onMyActivityOwnerDeleted(event)).rejects.toThrow('child delete failed'); expect(f.records.has(root)).toBe(true);
  await f.onMyActivityOwnerDeleted(event); expect([...f.records.keys()].filter(k => k.startsWith('myActivityPrivate/'))).toEqual([]);
  await f.onMyActivityOwnerDeleted(event);
});
test('timestamps are integer server epochs, HR is a point, intervals and bounded input are validated', async () => {
  const f = fixture(), binding = (await f.select()).source;
  for (const change of [{ startAtMs: -1 }, { endAtMs: 1000 }, { endAtMs: 3000.5 }, { modifiedAtMs: Date.now() + 600000 },
    { recordType: 'heart-rate', value: 130 }, { value: undefined }, { value: -1 }]) {
    await expect(f.save(binding, [f.row(change)], JSON.stringify(change))).rejects.toMatchObject({ code: 'invalid-argument' });
  }
  await expect(f.save(binding, [f.row({ recordType: 'heart-rate', startAtMs: 2000, endAtMs: 2000, value: 241 })])).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(f.save(binding, [f.row({ recordType: 'heart-rate', startAtMs: 2000, endAtMs: 2000, value: 0 })])).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(f.save(binding, Array.from({ length: 301 }, (_, n) => f.row({ id: `${n}` })))).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(f.save(binding, [f.row(), f.row()])).rejects.toMatchObject({ code: 'invalid-argument' });
});
test('account deletion races source selection and cannot create a fresh data root', async () => {
  const f = fixture(); f.hooks.beforeCommit = () => f.records.set('users/u', { deletedAt: 123 });
  await expect(f.select()).rejects.toMatchObject({ code: 'failed-precondition' });
  expect([...f.records.keys()].filter(k => k.startsWith('myActivityPrivate/'))).toEqual([]);
});
test('source replacement racing an upload is retried against the new fence without committing old records', async () => {
  const f = fixture(), binding = (await f.select()).source;
  const root = [...f.records.keys()].find(k => /^myActivityPrivate\/[^/]+$/.test(k));
  f.hooks.beforeCommit = () => f.records.set(root, { ...f.records.get(root), generation: 2,
    source: { ...binding, generation: 2, connectionId: 'new-connection' }, dataRevision: 0 });
  expect(await f.save(binding)).toMatchObject({ status: 'stale' });
  expect([...f.records.keys()].filter(k => k.includes('/records/') || k.includes('/batches/'))).toEqual([]);
});
test('clock uncertainty is preserved for independent records and bounded rather than treated as exact', async () => {
  const f = fixture(), binding = (await f.select()).source;
  await f.save(binding, [f.row({ clockUncertaintyMs: 7000 })]);
  const result = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } }));
  expect(result.records[0].clockUncertaintyMs).toBe(7000);
  await expect(f.save(binding, [f.row({ clockUncertaintyMs: 60001 })], 'bad')).rejects.toMatchObject({ code: 'invalid-argument' });
});
test('unauthenticated, anonymous and guest access fail without a data write', async () => {
  const f = fixture();
  await expect(f.getMyActivityState({ data: { expectedUid: 'u' } })).rejects.toMatchObject({ code: 'unauthenticated' });
  await expect(f.getMyActivityState({ auth: { uid: 'u', token: { firebase: { sign_in_provider: 'anonymous' } } }, data: { expectedUid: 'u' } })).rejects.toMatchObject({ code: 'unauthenticated' });
  f.records.set('users/u', { isGuest: true });
  await expect(f.select()).rejects.toMatchObject({ code: 'permission-denied' });
  await expect(f.getMyActivityState(f.request({}))).rejects.toMatchObject({ code: 'permission-denied' });
  expect([...f.records.keys()].filter(k => k.startsWith('myActivityPrivate/'))).toEqual([]);
});
test('movement records retain measured zero and reject impossible speed or duration', async () => {
  const f = fixture(), binding = (await f.select()).source;
  await f.save(binding, [f.row({ recordType: 'speed', startAtMs: 2000, endAtMs: 2000, value: 0 })], 'speed-zero');
  const page = await f.getMyActivityState(f.request({ range: { from: 0, to: 5000 } }));
  expect(page.records[0]).toMatchObject({ recordType: 'speed', value: 0 });
  await expect(f.save(binding, [f.row({ recordType: 'speed', startAtMs: 2000, endAtMs: 2000, value: 13 })], 'speed-bad')).rejects.toMatchObject({ code: 'invalid-argument' });
  await expect(f.save(binding, [f.row({ recordType: 'running-ms', startAtMs: 1000, endAtMs: 2000, value: 1001 })], 'time-bad')).rejects.toMatchObject({ code: 'invalid-argument' });
});
