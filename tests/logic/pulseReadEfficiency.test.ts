jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../pulse/src/services/firestoreRest', () => ({ queryCollectionRecent: jest.fn(), listAll: jest.fn() }));
jest.mock('../../pulse/src/services/firebase', () => ({ fetchUsers: jest.fn() }));
import { cached, invalidate } from '../../pulse/src/services/cache';
import { queryCollectionRecent } from '../../pulse/src/services/firestoreRest';
import { fetchUsers } from '../../pulse/src/services/firebase';
import { fetchPushStats } from '../../pulse/src/services/pushStats';
import { fetchTokenHealth } from '../../pulse/src/services/tokenHealth';
import { fetchServerNotifs } from '../../pulse/src/services/serverNotifs';

beforeEach(() => { invalidate(); jest.clearAllMocks(); });
test('cold loads and overlapping forced refreshes share one operation', async () => {
  let finish!: (n: number) => void;
  const work = jest.fn(() => new Promise<number>(resolve => { finish = resolve; }));
  const first = cached('same', work);
  const forced = cached('same', work, { force: true });
  await Promise.resolve();
  expect(work).toHaveBeenCalledTimes(1); expect(forced).toBe(first);
  finish(9); expect(await first).toBe(9);
  expect(await cached('same', work)).toBe(9);
  expect(work).toHaveBeenCalledTimes(1);
});
test('failed reads retry; invalidating an in-flight request never reinstates its stale result', async () => {
  const fail = jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(7);
  await expect(cached('retry', fail)).rejects.toThrow('offline');
  expect(await cached('retry', fail)).toBe(7);
  let finish!: (n: number) => void;
  const old = cached('mutated', () => new Promise<number>(r => { finish = r; }));
  await Promise.resolve(); invalidate('mutated');
  expect(await cached('mutated', async () => 2)).toBe(2);
  finish(1); await old;
  expect(await cached('mutated', async () => 3)).toBe(2);
});
test('all notification views share one projected bounded recent query, refresh once, and propagate failures', async () => {
  (fetchUsers as jest.Mock).mockResolvedValue([{ id: 'u', name: 'שם' }]);
  (queryCollectionRecent as jest.Mock).mockResolvedValue([{ id: 'n', recipientId: 'u', type: 'joinRequest', createdAt: 10, stats: { ok: 2, failed: 1 } }]);
  const [stats, health, log] = await Promise.all([fetchPushStats(), fetchTokenHealth(), fetchServerNotifs()]);
  expect(queryCollectionRecent).toHaveBeenCalledTimes(1);
  expect(queryCollectionRecent).toHaveBeenCalledWith('notifications', 1000, ['type', 'recipientId', 'createdAt', 'stats', 'read', 'delivered']);
  expect(stats.totalAttempts).toBe(3); expect(health.reachable).toBe(1); expect(log[0].recipientName).toBe('שם');
  await Promise.all([fetchPushStats(true), fetchTokenHealth(true), fetchServerNotifs(250, true)]);
  expect(queryCollectionRecent).toHaveBeenCalledTimes(2);
  invalidate(); (queryCollectionRecent as jest.Mock).mockRejectedValue(Error('denied'));
  await expect(fetchPushStats()).rejects.toThrow('denied');
  await expect(fetchTokenHealth()).rejects.toThrow('denied');
  await expect(fetchServerNotifs()).rejects.toThrow('denied');
});
