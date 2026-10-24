import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { createHash } from 'crypto';

const source = ts.transpileModule(fs.readFileSync('functions/src/comparisonActivity.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
class CallError extends Error { constructor(public code: string, message: string) { super(message); } }
function fixture() {
  const store = new Map<string, any>([
    ['users/viewer', { name: 'משווה', avatarId: 'a05', email: 'private@example.com', pushToken: 'secret' }],
    ['users/target', { name: 'בעל הכרטיס' }],
    ['groups/club', { name: 'המועדון', playerIds: ['viewer', 'target'], adminIds: [], seasons: { enabled: true } }],
  ]);
  const doc = (path: string) => ({ path });
  const snapshot = (ref: { path: string }) => ({ id: ref.path.split('/').at(-1), exists: store.has(ref.path), data: () => store.get(ref.path) });
  const reference = (path: string) => ({ path, get: async () => snapshot(doc(path)) });
  const db: any = {
    doc: reference,
    getAll: async (...refs: any[]) => refs.map(snapshot),
    collection: (path: string) => ({ get: async () => ({ docs: [...store.keys()].filter(key => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1).map(key => snapshot(doc(key))) }) }),
    runTransaction: async (callback: any) => {
      const writes: Array<() => void> = [];
      const result = await callback({ getAll: db.getAll,
        create: (ref: any, value: any) => writes.push(() => { if (store.has(ref.path)) throw Error('already exists'); store.set(ref.path, value); }),
        set: (ref: any, value: any) => writes.push(() => store.set(ref.path, value)) });
      writes.forEach(write => write()); return result;
    },
  };
  const exports: any = {};
  vm.runInNewContext(source, { exports, Buffer, Date, Intl, require: (name: string) => {
    if (name === 'node:crypto') return { createHash };
    if (name === 'firebase-admin/firestore') return { getFirestore: () => db };
    if (name === './appCheckPolicy') return { ENFORCE_APP_CHECK: true };
    if (name === './observedFunctions') return { HttpsError: CallError, onCall: (_options: any, handler: any) => handler };
    if (name === 'firebase-functions/v2/https') return { HttpsError: CallError, onCall: (_options: any, handler: any) => handler };
    if (name.startsWith('firebase-functions/v2/')) return {};
    if (name === './serverErrorLog') return { observeCaughtError: jest.fn() };
    throw Error(name);
  } });
  const request = (patch: any = {}) => ({ auth: { uid: 'viewer', token: { firebase: { sign_in_provider: 'password' } } }, data: { expectedUid: 'viewer', targetId: 'target', groupId: 'club', visitId: 'unique-visit-00001', scope: { k: 'current' }, ...patch } });
  const listRequest = (patch: any = {}) => ({ ...request(), auth: { uid: 'target', token: { firebase: { sign_in_provider: 'password' } } }, data: { expectedUid: 'target', range: 'month', ...patch } });
  return { api: exports, store, request, listRequest };
}

test('successful visit increments one server-time summary, repeated id is idempotent across scope changes', async () => {
  const f = fixture();
  await expect(f.api.recordPlayerComparison(f.request())).resolves.toEqual({ recorded: true });
  await expect(f.api.recordPlayerComparison(f.request({ scope: { k: 'all' } }))).resolves.toEqual({ recorded: false });
  const row = f.store.get('playerComparisonActivity/target/viewers/viewer');
  expect(row.total).toBe(1);
  expect(Object.values(row.days)).toEqual([1]);
  expect(row.lastAt).toBeGreaterThan(Date.now() - 10000);
  expect(row.lastGroupName).toBe('המועדון');
  expect(f.store.get('serverRateLimits/viewer_comparisonVisits').count).toBe(1);
  expect([...f.store.keys()].filter(path => path.startsWith('playerComparisonActivity/target/visits/'))).toHaveLength(1);
});

test('a second visit increments totals; spoofed names/times and actor ids never become server metadata', async () => {
  const f = fixture(); await f.api.recordPlayerComparison(f.request());
  await f.api.recordPlayerComparison(f.request({ visitId: 'unique-visit-00002', at: 1, viewerId: 'someone', groupName: 'fake', scopeLabel: 'fake' }));
  const row = f.store.get('playerComparisonActivity/target/viewers/viewer');
  expect(row.total).toBe(2); expect(row.lastGroupName).toBe('המועדון'); expect(row.lastScope).toBe('העונה הנוכחית');
  expect(f.store.has('playerComparisonActivity/target/viewers/someone')).toBe(false);
});

test('an older transaction cannot regress newer comparison context or remove its day bucket', async () => {
  const f = fixture(), now = Date.now(), later = now + 86400000;
  const today = f.api.comparisonWindow(now).today, tomorrow = f.api.comparisonWindow(later).today;
  f.store.set('playerComparisonActivity/target/viewers/viewer', { total: 5, days: { [today]: 2, [tomorrow]: 3 }, lastAt: later, lastGroupId: 'newer-club', lastGroupName: 'החדש', lastScope: 'כל הזמנים' });
  await f.api.recordPlayerComparison(f.request());
  const value = f.store.get('playerComparisonActivity/target/viewers/viewer');
  expect(value).toMatchObject({ total: 6, lastAt: later, lastGroupId: 'newer-club', lastGroupName: 'החדש', days: { [today]: 3, [tomorrow]: 3 } });
});

test.each(['anonymous', 'wrong identity', 'self', 'nonmember viewer', 'nonmember target', 'blocked viewer', 'blocked target', 'guest', 'missing target', 'personal club', 'deleted club'])('record rejects %s without creating history', async scenario => {
  const f = fixture(), request = f.request();
  if (scenario === 'anonymous') request.auth.token.firebase.sign_in_provider = 'anonymous';
  if (scenario === 'wrong identity') request.data.expectedUid = 'other';
  if (scenario === 'self') request.data.targetId = 'viewer';
  if (scenario === 'nonmember viewer') f.store.get('groups/club').playerIds = ['target'];
  if (scenario === 'nonmember target') f.store.get('groups/club').playerIds = ['viewer'];
  if (scenario === 'blocked viewer') f.store.set('users/viewer/blocked/target', {});
  if (scenario === 'blocked target') f.store.set('users/target/blocked/viewer', {});
  if (scenario === 'guest') f.store.get('users/viewer').isGuest = true;
  if (scenario === 'missing target') f.store.delete('users/target');
  if (scenario === 'personal club') f.store.get('groups/club').isPersonal = true;
  if (scenario === 'deleted club') f.store.get('groups/club').deletedAt = 1;
  await expect(f.api.recordPlayerComparison(request)).rejects.toBeInstanceOf(Error);
  expect([...f.store.keys()].some(key => key.startsWith('playerComparisonActivity/'))).toBe(false);
});

test('record validates selected archive and refuses an unrelated or absent season', async () => {
  const f = fixture();
  await expect(f.api.recordPlayerComparison(f.request({ scope: { k: 'season', id: 's1' } }))).rejects.toMatchObject({ code: 'invalid-argument' });
  f.store.set('seasonSummary/club__s1', { groupId: 'club', seasonNo: 2 });
  await f.api.recordPlayerComparison(f.request({ scope: { k: 'season', id: 's1' } }));
  expect(f.store.get('playerComparisonActivity/target/viewers/viewer').lastScope).toBe('עונה 2');
});

test('list belongs only to token owner and returns no contact fields', async () => {
  const f = fixture(); await f.api.recordPlayerComparison(f.request());
  await expect(f.api.getMyComparisonActivity(f.listRequest({ userId: 'viewer' }))).rejects.toMatchObject({ code: 'permission-denied' });
  const page = await f.api.getMyComparisonActivity(f.listRequest());
  expect(page.players).toBe(1); expect(page.comparisons).toBe(1);
  expect(page.rows[0]).toMatchObject({ id: 'viewer', name: 'משווה', count: 1, groupName: 'המועדון' });
  expect(JSON.stringify(page)).not.toMatch(/private@example|pushToken|secret/);
});

test.each(['blocked', 'deleted', 'guest'])('list filters %s viewers from rows and exact totals', async reason => {
  const f = fixture(); await f.api.recordPlayerComparison(f.request());
  if (reason === 'blocked') f.store.set('users/viewer/blocked/target', {});
  if (reason === 'deleted') f.store.delete('users/viewer');
  if (reason === 'guest') f.store.get('users/viewer').isGuest = true;
  expect(await f.api.getMyComparisonActivity(f.listRequest())).toMatchObject({ players: 0, comparisons: 0, rows: [] });
});

test('30-day window is Jerusalem calendar days and distinguishes month from lifetime', () => {
  const f = fixture(), now = Date.parse('2026-10-24T22:30:00Z'); // Jerusalem is already Oct 25.
  expect(f.api.comparisonWindow(now)).toEqual({ today: '2026-10-25', since: '2026-09-26' });
  const data = { total: 9, days: { '2026-09-25': 5, '2026-09-26': 2, '2026-10-25': 1, '2026-10-26': 1 } };
  expect(f.api.comparisonCount(data, 'month', now)).toBe(3);
  expect(f.api.comparisonCount(data, 'all', now)).toBe(9);
});

test('more than 30 distinct viewers retain exact totals across cursor pages, bound to owner/range', async () => {
  const f = fixture(), { today } = f.api.comparisonWindow(Date.now());
  for (let i = 0; i < 41; i++) {
    const uid = `viewer${String(i).padStart(2, '0')}`;
    f.store.set(`users/${uid}`, { name: uid });
    f.store.set(`playerComparisonActivity/target/viewers/${uid}`, { total: 2, days: { [today]: 2 }, lastAt: Date.now() - i * 1000, lastGroupName: 'מועדון', lastGroupId: 'club', lastScope: 'כל הזמנים' });
  }
  const first = await f.api.getMyComparisonActivity(f.listRequest());
  expect(first.rows).toHaveLength(30); expect(first.players).toBe(41); expect(first.comparisons).toBe(82);
  const second = await f.api.getMyComparisonActivity(f.listRequest({ cursor: first.cursor }));
  expect(second.rows).toHaveLength(11); expect(second.cursor).toBeNull();
  expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(41);
  await expect(f.api.getMyComparisonActivity(f.listRequest({ range: 'all', cursor: first.cursor }))).rejects.toMatchObject({ code: 'invalid-argument' });
});

test('rate-limited writes and reads reject instead of manufacturing empty history', async () => {
  const f = fixture(); f.store.set('serverRateLimits/viewer_comparisonVisits', { start: Date.now(), count: 30 });
  await expect(f.api.recordPlayerComparison(f.request())).rejects.toMatchObject({ code: 'resource-exhausted' });
  f.store.set('serverRateLimits/target_comparisonList', { start: Date.now(), count: 60 });
  await expect(f.api.getMyComparisonActivity(f.listRequest())).rejects.toMatchObject({ code: 'resource-exhausted' });
});
