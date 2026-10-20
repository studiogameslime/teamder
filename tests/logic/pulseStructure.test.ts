jest.mock('../../pulse/src/capabilities', () => ({ has: { firebase: () => true } }));
jest.mock('../../pulse/src/config', () => ({ MOCK_WORK: false }));
jest.mock('../../pulse/src/services/cache', () => ({ cached: (_key: string, fn: () => unknown) => fn(), invalidate: jest.fn() }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ listAll: jest.fn(), queryCollectionRecent: jest.fn(), getDoc: jest.fn(), patchDoc: jest.fn() }));
jest.mock('../../pulse/src/services/teamderChatService', () => ({ listAwaitingReply: jest.fn() }));
jest.mock('../../pulse/src/services/firebase', () => ({ fetchUsers: jest.fn() }));
import { listAll, queryCollectionRecent, getDoc, patchDoc } from '../../pulse/src/services/firestoreRest';
import { listAwaitingReply } from '../../pulse/src/services/teamderChatService';
import { fetchUsers } from '../../pulse/src/services/firebase';
import { fetchIssue, fetchIssues, setErrorStatus } from '../../pulse/src/services/errorsService';
import { listWork, listWorkSnapshot, retainFailedWork } from '../../pulse/src/services/workItems';
import { readDeviceVersions, fetchVersionInventory, summarizeVersions } from '../../pulse/src/services/deviceVersions';
import { fetchPushStats } from '../../pulse/src/services/pushStats';

beforeEach(() => { jest.clearAllMocks(); (listAll as jest.Mock).mockResolvedValue([]); (listAwaitingReply as jest.Mock).mockResolvedValue([]); });

test('closed feedback is normalized and writes the native closed state back to its own collection', async () => {
  (listAll as jest.Mock).mockImplementation(async c => c === 'feedback' ? [{ id: 'same', status: 'done' }] : [{ id: 'same', status: 'new' }]);
  expect((await fetchIssues()).map(i => [i.coll, i.status])).toEqual([['errors', 'new'], ['feedback', 'resolved']]);
  (patchDoc as jest.Mock).mockResolvedValue(true);
  await setErrorStatus('same', 'resolved', 'feedback');
  expect(patchDoc).toHaveBeenCalledWith('feedback/same', { status: 'done' });
});

test('detail loads the exact collection even when another collection has the same id', async () => {
  (getDoc as jest.Mock).mockResolvedValue({ id: 'same', message: 'report', status: 'done' });
  expect((await fetchIssue('same', 'feedback'))?.message).toBe('report');
  expect(getDoc).toHaveBeenCalledWith('feedback/same');
  expect(listAll).not.toHaveBeenCalled();
});

test('partial work retains failed sources, replaces successful sources and rejects unqualified counts', async () => {
  (listAll as jest.Mock).mockImplementation(async c => {
    if (c === 'errors') throw Error('offline');
    return c === 'tasks' ? [{ id: 'new', title: 'new', status: 'new' }] : [];
  });
  const result = await listWorkSnapshot();
  expect(result.failedStreams).toEqual(['error']);
  const old = [{ key: 'error:old', stream: 'error', state: 'open', priority: 'normal', createdAt: 0 }, { key: 'task:old', stream: 'task', state: 'open', priority: 'normal', createdAt: 0 }];
  expect(retainFailedWork(old as any, result).map(i => i.key).sort()).toEqual(['error:old', 'task:new']);
  await expect(listWork()).rejects.toThrow('PULSE_WORK_INCOMPLETE');
});

test('device reader ignores retired tokens, incomplete metadata and never exposes token values', () => {
  const rows = readDeviceVersions({ fcmTokens: ['active-secret', 'active-secret', 'missing'], devices: {
    'active-secret': { appVersion: '1.1.56', platform: 'android', registeredAt: 100 },
    retired: { appVersion: '1.1.20', platform: 'android', registeredAt: 10 },
    missing: { appVersion: '1.1.56' },
  } });
  expect(rows).toHaveLength(1); expect(rows[0].version).toBe('1.1.56');
  expect(JSON.stringify(rows)).not.toContain('secret');
  expect(readDeviceVersions(null)).toEqual([]);
});

test('inventory separates unknown from failed, excludes deleted/test accounts and deduplicates users per version', async () => {
  (fetchUsers as jest.Mock).mockResolvedValue([{ id: 'a', name: 'A' }, { id: 'b' }, { id: 'c' }, { id: 'test', isTest: true }, { id: 'deleted', deleted: true }]);
  (getDoc as jest.Mock).mockImplementation(async path => {
    if (path.includes('/c/')) throw Error('denied');
    if (path.includes('/b/')) return null;
    return { fcmTokens: ['one', 'two', 'old'], devices: {
      one: { appVersion: '1.1.56', platform: 'android', registeredAt: 20 },
      two: { appVersion: '1.1.56', platform: 'android', registeredAt: 30 },
      old: { appVersion: '1.1.55', platform: 'ios', registeredAt: 10 },
    } };
  });
  const result = await fetchVersionInventory(); const summary = summarizeVersions(result);
  expect(result).toHaveLength(3); expect(getDoc).toHaveBeenCalledTimes(3);
  expect(summary).toMatchObject({ known: 1, unknown: 1, failed: 1 });
  expect(summary.groups.map(g => g.users.length)).toEqual([1, 1]);
});

test('delivery denominator counts attempts to devices, independently of notification rows', async () => {
  (queryCollectionRecent as jest.Mock).mockResolvedValue([{ stats: { ok: 2, failed: 1 } }, { stats: { skippedNoToken: 1 } }]);
  expect(await fetchPushStats()).toMatchObject({ totalSent: 2, totalOk: 2, totalFailed: 1, totalAttempts: 3, totalNoToken: 1 });
  (queryCollectionRecent as jest.Mock).mockRejectedValue(Error('offline'));
  await expect(fetchPushStats()).rejects.toThrow('offline');
});

test('linked historical tasks preserve their report id in the projected list without merging statuses', async () => {
  (listAll as jest.Mock).mockImplementation(async (collection, _limit, fields) => {
    if (collection !== 'tasks') return [];
    expect(fields).toContain('sourceId');
    return [{ id: 'copy', source: 'teamder', sourceId: 'original', status: 'new' }];
  });
  expect((await listWorkSnapshot()).items[0]).toMatchObject({ sourceReportId: 'original', state: 'open', docPath: 'tasks/copy' });
});

test('queue publishes its result for badges without a second database request', async () => {
  const { onWorkSnapshot } = await import('../../pulse/src/services/workItems');
  const listener = jest.fn(); const unsubscribe = onWorkSnapshot(listener);
  const snapshot = await listWorkSnapshot();
  expect(listener).toHaveBeenCalledWith(snapshot);
  expect(listAll).toHaveBeenCalledTimes(5);
  unsubscribe(); await listWorkSnapshot();
  expect(listener).toHaveBeenCalledTimes(1);
});

test('feedback detail preserves its screenshot through the actual converter without a collection scan', async () => {
  (getDoc as jest.Mock).mockResolvedValue({ id: 'report-image', image: 'jpeg-proof', status: 'new', message: 'צילום' });
  expect(await fetchIssue('report-image', 'feedback')).toMatchObject({ image: 'jpeg-proof', coll: 'feedback' });
  expect(getDoc).toHaveBeenCalledWith('feedback/report-image');
  expect(listAll).not.toHaveBeenCalled();
});

test('version adoption counts latest observation per user and platform, with failed and missing excluded from denominator', () => {
 const {latestPlatformVersions}=require('../../pulse/src/services/deviceVersions');
 const device=(version:string,observedAt:number,platform='android')=>({version,observedAt,platform,device:''});
 const rows=[{userId:'a',name:'a',failed:false,devices:[device('1.0',1),device('2.0',5),device('9.0',10,'ios')]},{userId:'b',name:'b',failed:false,devices:[device('1.0',2)]},{userId:'c',name:'c',failed:false,devices:[device('9.0',3,'ios')]},{userId:'d',name:'d',failed:true,devices:[]}];
 const summary=latestPlatformVersions(rows,'android','2.0');
 expect(summary).toMatchObject({known:2,current:1,other:1,missing:1,failed:1,percent:50});
 expect(summary.entries[0].device.version).toBe('2.0');
 expect(latestPlatformVersions(rows,'ios','9.0')).toMatchObject({known:2,current:2,percent:100});
 expect(latestPlatformVersions(rows,'android')).toMatchObject({percent:null});
 expect(latestPlatformVersions([],'android','2.0')).toMatchObject({known:0,percent:null});
});
