(globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
const hydratePublicUsers = jest.fn();
jest.mock('@/services', () => ({ groupService: { hydratePublicUsers: (...args: unknown[]) => hydratePublicUsers(...args) } }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
import { useGameStore } from '@/store/gameStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const identity = (id: string, name = id) => ({ id, name });
const hydrate = (ids: string[]) => useGameStore.getState().hydratePlayers(ids);
beforeEach(() => {
  useGameStore.getState().reset();
  hydratePublicUsers.mockReset();
  jest.useFakeTimers({ now: 1_000_000 });
});
afterEach(() => jest.useRealTimers());

test('overlapping requests read each player once and both callers wait for the shared result', async () => {
  const first = deferred<any[]>(), second = deferred<any[]>();
  hydratePublicUsers.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = hydrate(['a', 'a', '', 'b']);
  let bDone = false;
  const b = hydrate(['b', 'c']).then(() => { bDone = true; });
  expect(hydratePublicUsers.mock.calls).toEqual([[['a', 'b']], [['c']]]);
  second.resolve([identity('c')]);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  expect(bDone).toBe(false);
  first.resolve([identity('a'), identity('b')]);
  await Promise.all([a, b]);
  expect(Object.keys(useGameStore.getState().players).sort()).toEqual(['a', 'b', 'c']);
});

test('cache freshness starts at response completion, then refreshes after five minutes', async () => {
  const first = deferred<any[]>();
  hydratePublicUsers.mockReturnValueOnce(first.promise);
  const request = hydrate(['a']);
  jest.setSystemTime(1_000_000 + 6 * 60_000);
  first.resolve([identity('a')]); await request;
  await hydrate(['a']);
  expect(hydratePublicUsers).toHaveBeenCalledTimes(1);
  jest.setSystemTime(1_000_000 + 12 * 60_000);
  hydratePublicUsers.mockResolvedValueOnce([identity('a', 'updated')]);
  await hydrate(['a']);
  expect(useGameStore.getState().players.a.displayName).toBe('updated');
});

test.each(['success', 'failure'])('a late old-account %s cannot repopulate the reset store or release the new request', async outcome => {
  const old = deferred<any[]>(), fresh = deferred<any[]>();
  hydratePublicUsers.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  const before = hydrate(['a']);
  useGameStore.getState().reset();
  const after = hydrate(['a']);
  if (outcome === 'success') old.resolve([identity('a', 'old')]);
  else old.reject(Error('old-account'));
  await before;
  expect(useGameStore.getState().players).toEqual({});
  const overlapping = hydrate(['a']);
  expect(hydratePublicUsers).toHaveBeenCalledTimes(2);
  fresh.resolve([identity('a', 'new')]);
  await Promise.all([after, overlapping]);
  expect(useGameStore.getState().players.a.displayName).toBe('new');
});

test('failed and missing players can be retried; cached identities survive failure', async () => {
  hydratePublicUsers.mockResolvedValueOnce([identity('a')]); await hydrate(['a']);
  jest.setSystemTime(1_000_000 + 6 * 60_000);
  hydratePublicUsers.mockRejectedValueOnce(Error('offline')); await hydrate(['a', 'missing']);
  expect(useGameStore.getState().players.a.displayName).toBe('a');
  hydratePublicUsers.mockResolvedValueOnce([]); await hydrate(['missing']);
  hydratePublicUsers.mockResolvedValueOnce([identity('missing')]); await hydrate(['missing']);
  expect(hydratePublicUsers).toHaveBeenCalledTimes(4);
  expect(useGameStore.getState().players.missing.displayName).toBe('missing');
});
