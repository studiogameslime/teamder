const mockFetch = jest.fn();
import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
jest.mock('../../pulse/src/services/adminTransport', () => ({ pulseFetch: (...args: any[]) => mockFetch(...args) }));
jest.mock('../../pulse/src/services/auth', () => ({ googleAccessToken: async () => 'token' }));
jest.mock('../../pulse/src/config', () => ({ config: { firebase: { projectId: 'demo-test' } } }));
jest.mock('../../pulse/src/services/readMeter', () => ({ recordRead: jest.fn() }));
import { fetchUsageVisits, fetchUsageEvents, usageCutoff, usageTime } from '../../pulse/src/services/usageActivity';

const document = (n: number, field = 'lastActivityAt') => ({ document: { name: `projects/demo-test/databases/(default)/documents/usageSessions/id-${n}`, fields: { [field]: { integerValue: String(100 - n) }, uid: { stringValue: 'alice' }, visitId: { stringValue: `v-${n}` } } }, readTime: '2026-11-04T10:00:00.123456Z' });
beforeEach(() => mockFetch.mockReset());
test('latest visit query is ordered by the server and carries a snapshot/name cursor to the next page', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => Array.from({ length: 21 }, (_, n) => document(n)) });
  const first = await fetchUsageVisits('alice', 50);
  const query = JSON.parse(mockFetch.mock.calls[0][1].body).structuredQuery;
  expect(query.orderBy).toEqual([{ field: { fieldPath: 'lastActivityAt' }, direction: 'DESCENDING' }, { field: { fieldPath: '__name__' }, direction: 'DESCENDING' }]);
  expect(query.limit).toBe(21); expect(first.rows).toHaveLength(20);
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [document(20)] });
  const next = await fetchUsageVisits('alice', 50, first.cursor);
  const body = JSON.parse(mockFetch.mock.calls[1][1].body);
  expect(body.readTime).toBe('2026-11-04T10:00:00.123456Z');
  expect(body.structuredQuery.startAt).toEqual({ values: [{ integerValue: '81' }, { referenceValue: expect.stringContaining('id-19') }], before: false });
  expect(next.rows).toHaveLength(1); expect(next.cursor).toBeNull();
});
test('event query binds both account and visit and orders ascending sequence', async () => {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [{ readTime: '2026-11-04T10:00:00Z' }] });
  const next = await fetchUsageEvents('alice', 'visit-a');
  const query = JSON.parse(mockFetch.mock.calls[0][1].body).structuredQuery;
  expect(query.where.compositeFilter.filters.map((f: any) => f.fieldFilter.value.stringValue)).toEqual(['alice', 'visit-a']);
  expect(query.orderBy[0]).toEqual({ field: { fieldPath: 'sequence' }, direction: 'ASCENDING' });
  expect(query.limit).toBe(51); expect(next.rows).toEqual([]);
});

test('inserting a newer visit between reads does not move rows across the saved page boundary', async()=>{
  const snapshot='2026-11-04T10:00:00.123456Z';
  const original=Array.from({length:23},(_,i)=>document(i));
  let current=original;
  mockFetch.mockImplementation(async (_url:string,req:{body:string})=>{
    const {readTime,structuredQuery:q}=JSON.parse(req.body);
    const pool=readTime===snapshot?original:current;
    const cursorName=q.startAt?.values[1].referenceValue;
    const start=cursorName?pool.findIndex(item=>item.document.name===cursorName)+1:0;
    return {ok:true,json:async()=>pool.slice(start,start+q.limit)};
  });
  const first=await fetchUsageVisits('alice',0);
  current=[document(-1),...current];
  const second=await fetchUsageVisits('alice',0,first.cursor);
  expect([...first.rows,...second.rows].map(row=>row.id)).toEqual(original.map((_,i)=>'id-'+i));
  expect(second.cursor).toBeNull();
  expect((await fetchUsageVisits('alice',0)).rows[0].id).toBe('id--1');
});
test('the page snapshot uses the final read time, which also covers earlier stream rows', async () => {
  const rows = Array.from({ length: 21 }, (_, n) => ({ ...document(n), readTime: `2026-11-04T10:00:${String(n).padStart(2, '0')}.123456Z` }));
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => rows });
  const page = await fetchUsageVisits('alice', 0);
  expect(page.cursor?.readTime).toBe('2026-11-04T10:00:20.123456Z');
});
test('read errors and missing snapshot are errors, never a false empty activity', async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, status: 403 }); await expect(fetchUsageVisits('alice', 0)).rejects.toThrow('USAGE_READ_FAILED_403');
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [] }); await expect(fetchUsageVisits('alice', 0)).rejects.toThrow('USAGE_SNAPSHOT_MISSING');
});
test.each([
  ['2026-11-04T15:00:00Z', '2026-11-03T22:00:00Z'],
  ['2026-07-04T15:00:00Z', '2026-07-03T21:00:00Z'],
  ['2026-10-25T15:00:00Z', '2026-10-24T21:00:00Z'],
])('Jerusalem day boundaries are independent of machine zone for %s', (at, expected) => {
  expect(new Date(usageCutoff('today', Date.parse(at))).toISOString()).toBe(new Date(expected).toISOString());
});
test('display and rolling periods use the same explicit time zone and units', () => {
  const now = Date.parse('2026-11-04T15:00:00Z');
  expect(usageTime(now)).toBe('17:00'); expect(usageCutoff('week', now)).toBe(now - 7 * 86400000);
  expect(usageCutoff('quarter', now)).toBe(now - 90 * 86400000);
});
test('historical player events select the original player ahead of club context and never fall back to another target', () => {
  const source = ts.createSourceFile('screen.tsx', fs.readFileSync('pulse/src/screens/UserDetailScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'target') expression = node.initializer!.getText(source); ts.forEachChild(node, visit); };
  visit(source); expect(expression).toBeTruthy();
  const target = (row: unknown) => vm.runInNewContext('(' + expression + ')', { row });
  expect(target({ screen: 'PlayerCard', playerId: 'player-a', groupId: 'club-a' })).toMatchObject({ path: 'users/player-a', screen: 'UserDetail' });
  expect(target({ screen: 'PlayerCompare', groupId: 'club-a' })).toBeNull();
  expect(target({ screen: 'MatchDetails', gameId: 'game-a', groupId: 'club-a' })).toMatchObject({ path: 'games/game-a', screen: 'GameDetail' });
});
