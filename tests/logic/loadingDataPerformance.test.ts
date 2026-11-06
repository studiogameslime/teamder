import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { StaleSessionError } from '../../src/services/staleSession';
import { retryRead, isTransientReadError } from '../../src/services/readRetry';
import { mapConcurrent } from '../../src/utils/mapConcurrent';

function load(file: string, deps: Record<string, unknown>) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => deps[name], __DEV__: false });
  return module.exports;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function identities() {
  const auth = { currentUser: { uid: 'owner', isAnonymous: false } };
  const remote = jest.fn(), mirror = jest.fn();
  const service = load('src/services/publicPlayerService.ts', {
    '@/services/diagnosticCallable': { httpsCallable: () => remote },
    'firebase/firestore': { getDoc: mirror, doc: (_collection: string, id: string) => id },
    '@/firebase/config': { getFirebase: () => ({ auth, functions: {} }) },
    '@/firebase/firestore': { col: { usersPublic: () => 'usersPublic' } },
    '@/firebase/authRace': { withAuthRaceRetry: (fn: () => unknown) => fn() },
    './staleSession': { StaleSessionError }, './readRetry': { retryRead },
    '@/utils/mapConcurrent': { mapConcurrent },
  });
  return { service, auth, remote, mirror };
}

test('three simultaneous roster consumers share one request and later visits read again', async () => {
  const f = identities(), page = deferred<{ data: any[] }>();
  f.remote.mockReturnValue(page.promise);
  const reads = [f.service.readPlayerIdentities(['a', 'b']), f.service.readPlayerIdentities(['a', 'b', 'a']), f.service.readPlayerIdentities(['a', 'b'])];
  expect(f.remote).toHaveBeenCalledTimes(1);
  page.resolve({ data: [{ id: 'a' }, { id: 'b' }] });
  expect(await Promise.all(reads)).toEqual(Array.from({ length: 3 }, () => [{ id: 'a' }, { id: 'b' }]));
  await f.service.readPlayerIdentities(['a', 'b']);
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test('simultaneous name lookups share a mirror read without caching the fulfilled identity', async () => {
  const f = identities(), row = deferred<any>();
  f.mirror.mockReturnValue(row.promise);
  const reads = [f.service.readPlayerIdentity('a'), f.service.readPlayerIdentity('a')];
  expect(f.mirror).toHaveBeenCalledTimes(1);
  row.resolve({ exists: () => true, data: () => ({ id: 'a', name: 'אבי' }) });
  expect((await Promise.all(reads)).map(row => row.name)).toEqual(['אבי', 'אבי']);
  f.mirror.mockResolvedValue({ exists: () => true, data: () => ({ id: 'a', name: 'שם חדש' }) });
  expect((await f.service.readPlayerIdentity('a')).name).toBe('שם חדש');
  expect(f.mirror).toHaveBeenCalledTimes(2);
});

test('a failed shared roster read rejects all consumers and a retry starts a new request', async () => {
  const f = identities(), page = deferred<any>(), error = Error('offline');
  f.remote.mockReturnValueOnce(page.promise).mockResolvedValue({ data: [{ id: 'a' }] });
  const reads = [f.service.readPlayerIdentities(['a']), f.service.readPlayerIdentities(['a'])];
  const results = Promise.allSettled(reads);
  page.reject(error);
  expect(await results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
  expect(await f.service.readPlayerIdentities(['a'])).toEqual([{ id: 'a' }]);
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test.each(['other', 'owner'])('a replacement session for %s starts its own read and rejects the old response', async uid => {
  const f = identities(), old = deferred<any>();
  f.remote.mockReturnValueOnce(old.promise).mockResolvedValue({ data: [{ id: 'new' }] });
  const first = f.service.readPlayerIdentities(['a']);
  const stale = expect(first).rejects.toBeInstanceOf(StaleSessionError);
  f.auth.currentUser = { uid, isAnonymous: false };
  expect(await f.service.readPlayerIdentities(['a'])).toEqual([{ id: 'new' }]);
  old.resolve({ data: [{ id: 'old' }] });
  await stale;
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test('profile invalidation fences new reads and old cleanup cannot delete the replacement request', async () => {
  const f = identities(), old = deferred<any>(), current = deferred<any>();
  f.remote.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = f.service.readPlayerIdentities(['a']);
  f.service.invalidatePlayerIdentityReads();
  const second = f.service.readPlayerIdentities(['a']);
  old.resolve({ data: [{ id: 'before' }] }); await first;
  const third = f.service.readPlayerIdentities(['a']);
  expect(f.remote).toHaveBeenCalledTimes(2);
  current.resolve({ data: [{ id: 'after' }] });
  expect(await Promise.all([second, third])).toEqual([[{ id: 'after' }], [{ id: 'after' }]]);
});

function ratings() {
  const auth = { currentUser: { uid: 'owner' } }, remote = jest.fn();
  const service = load('src/services/clubAdminRatings.ts', {
    '@/services/diagnosticCallable': { httpsCallable: () => remote },
    '@/firebase/config': { getFirebase: () => ({ auth, functions: {} }) },
    './staleSession': { StaleSessionError }, './readRetry': { retryRead },
  });
  const group = { id: 'club', adminIds: ['owner'], playerIds: ['owner'], name: 'מועדון' };
  return { auth, remote, service, group };
}

test('list, detail and live club reads share ratings while keeping their own group snapshots', async () => {
  const f = ratings(), page = deferred<any>();
  f.remote.mockReturnValue(page.promise);
  const reads = [f.service.hydrateClubAdminRatings(f.group), f.service.hydrateClubAdminRatings({ ...f.group, name: 'שם מעודכן' }), f.service.hydrateClubAdminRatings(f.group)];
  expect(f.remote).toHaveBeenCalledTimes(1);
  page.resolve({ data: { ratings: { a: 4.3, bad: 6, zero: 0, string: '4' } } });
  const groups = await Promise.all(reads);
  expect(groups.map(group => group.adminRatings)).toEqual([{ a: 4.3 }, { a: 4.3 }, { a: 4.3 }]);
  expect(groups[1].name).toBe('שם מעודכן');
  await f.service.hydrateClubAdminRatings(f.group);
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test('a caller without rating visibility cannot join an authorized in-flight read', async () => {
  const f = ratings(), page = deferred<any>();
  f.remote.mockReturnValue(page.promise);
  const authorized = f.service.hydrateClubAdminRatings(f.group);
  expect((await f.service.hydrateClubAdminRatings({ ...f.group, adminIds: [], hideInternalRating: true, adminRatings: { a: 5 } })).adminRatings).toBeUndefined();
  expect(f.remote).toHaveBeenCalledTimes(1);
  page.resolve({ data: { ratings: { a: 5 } } }); await authorized;
});

test('rating failure is shared without an empty fallback and does not poison the next read', async () => {
  const f = ratings(), page = deferred<any>(), error = Error('offline');
  f.remote.mockReturnValueOnce(page.promise).mockResolvedValue({ data: { ratings: { a: 4 } } });
  const results = Promise.allSettled([f.service.hydrateClubAdminRatings(f.group), f.service.hydrateClubAdminRatings(f.group)]);
  page.reject(error);
  expect(await results).toEqual([{ status: 'rejected', reason: error }, { status: 'rejected', reason: error }]);
  expect((await f.service.hydrateClubAdminRatings(f.group)).adminRatings).toEqual({ a: 4 });
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test('rating mutation invalidation prevents a new read from joining a pre-write request', async () => {
  const f = ratings(), old = deferred<any>(), current = deferred<any>();
  f.remote.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = f.service.hydrateClubAdminRatings(f.group);
  f.service.invalidateClubAdminRatingRead(f.group.id);
  const second = f.service.hydrateClubAdminRatings(f.group);
  old.resolve({ data: { ratings: { a: 2 } } }); await first;
  const third = f.service.hydrateClubAdminRatings(f.group);
  expect(f.remote).toHaveBeenCalledTimes(2);
  current.resolve({ data: { ratings: { a: 4 } } });
  expect((await Promise.all([second, third])).map(group => group.adminRatings)).toEqual([{ a: 4 }, { a: 4 }]);
});

test.each(['other', 'owner'])('rating reads reject an old response when the session is replaced by %s', async uid => {
  const f = ratings(), old = deferred<any>();
  f.remote.mockReturnValueOnce(old.promise).mockResolvedValue({ data: { ratings: { a: 5 } } });
  const first = f.service.hydrateClubAdminRatings(f.group), stale = expect(first).rejects.toBeInstanceOf(StaleSessionError);
  f.auth.currentUser = { uid };
  await f.service.hydrateClubAdminRatings({ ...f.group, adminIds: [uid] });
  old.resolve({ data: { ratings: { a: 1 } } }); await stale;
  expect(f.remote).toHaveBeenCalledTimes(2);
});

test.each([false, true])('profile writes fence identity reads before and after completion, including failure=%s', async fails => {
  const write = deferred<void>(), invalidate = jest.fn(), error = Error('write offline');
  const owner = { uid: 'owner', isAnonymous: false };
  const service = load('src/services/userService.ts', {
    '../utils/errorObservation': { observeCaughtError: jest.fn() },
    './readRetry': { isTransientReadError, retryRead },
    './publicPlayerService': { invalidatePlayerIdentityReads: invalidate },
    'firebase/firestore': { updateDoc: () => write.promise },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({auth:{currentUser:owner}}) },
    '@/firebase/firestore': { docs: { user: (uid: string) => uid } },
    './errorLog': { logError() {} }, './storage': { storage: { setAuthUserJson: async () => {} } },
  }).userService;
  service.getCurrentUser = async () => ({ id: 'owner', name: 'אבי' });
  const pending = service.updateProfile({ photoUrl: 'new-photo' });
  const result = fails ? expect(pending).rejects.toBe(error) : pending;
  await new Promise(setImmediate);
  expect(invalidate).toHaveBeenCalledTimes(1);
  if (fails) write.reject(error); else write.resolve();
  await result;
  expect(invalidate).toHaveBeenCalledTimes(2);
});

test.each([false, true])('rating writes fence shared reads before and after completion, including failure=%s', async fails => {
  const write = deferred<void>(), invalidate = jest.fn(), error = Error('write offline');
  const service = load('src/services/groupService.ts', {
    './clubAdminRatings': { invalidateClubAdminRatingRead: invalidate },
    '@/data/mockUsers': { mockGroup: { id: 'g' }, mockOtherGroup: { id: 'h' } },
    '@/services/diagnosticCallable': { httpsCallable: () => () => write.promise },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ functions: {} }) },
  }).groupService;
  service.get = async () => ({ id: 'club', adminIds: ['owner'] });
  const pending = service.setAdminRating('club', 'owner', 'player', 4);
  const result = fails ? expect(pending).rejects.toBe(error) : pending;
  await new Promise(setImmediate);
  expect(invalidate.mock.calls).toEqual([['club']]);
  if (fails) write.reject(error); else write.resolve();
  await result;
  expect(invalidate.mock.calls).toEqual([['club'], ['club']]);
});

function statsFixture(getDocs: jest.Mock) {
  const evening = load('src/utils/eveningPlayed.ts', {});
  const played = load('src/utils/playedGames.ts', { '@/utils/eveningPlayed': evening });
  return load('src/services/playerStatsService.ts', {
    'firebase/firestore': { getDocs, query: (collection: string) => collection, where() {} },
    '@/firebase/firestore': { col: { games: () => 'games', pairStats: () => 'pairs' } },
    '@/firebase/config': { USE_MOCK_DATA: false }, '@/services/errorLog': { logError() {} },
    '@/utils/playedGames': played, '@/utils/eveningPlayed': evening,
    '@/utils/personalPartnerStats': load('src/utils/personalPartnerStats.ts', {}),
    './personalHighlightsService': { loadPersonalHighlights: async () => ({}) },
  }).playerStatsService;
}

test('base stats queries begin before fresh totals arrive, and calculations use the fresh totals', async () => {
  const totals = deferred<{ goals: number; assists: number }>(), onBase = jest.fn();
  const getDocs = jest.fn(async (collection: string) => ({ docs: collection === 'games' ? [{ id: 'round', data: () => ({ status: 'finished', startsAt: 1, endedBy: 'admin', players: ['owner'] }) }] : [] }));
  const pending = statsFixture(getDocs).compute('owner', { goals: 1, assists: 0, totals: totals.promise, onBase });
  expect(getDocs).toHaveBeenCalledTimes(3);
  await new Promise(setImmediate);
  expect(onBase).not.toHaveBeenCalled();
  totals.resolve({ goals: 12, assists: 7 });
  expect(await pending).toMatchObject({ goals: 12, assists: 7, attendedGames: 1, goalsPerEvening: 12 });
  expect(onBase).toHaveBeenCalledTimes(1);
});

test('fresh totals failure remains a failure and never publishes a misleading base summary', async () => {
  const totals = deferred<any>(), onBase = jest.fn(), error = Error('profile offline');
  const getDocs = jest.fn(async () => ({ docs: [] }));
  const pending = statsFixture(getDocs).compute('owner', { totals: totals.promise, onBase });
  totals.reject(error);
  await expect(pending).rejects.toBe(error);
  expect(onBase).not.toHaveBeenCalled();
});

test('controlled 400 ms profile and 600 ms stats latency changes the critical path from 1000 to 600 ms', async () => {
  jest.useFakeTimers();
  try {
    const getDocs = jest.fn(() => new Promise(resolve => setTimeout(() => resolve({ docs: [] }), 600)));
    const service = statsFixture(getDocs);
    const userRead = () => new Promise<{ goals: number }>(resolve => setTimeout(() => resolve({ goals: 8 }), 400));
    const sequentialStart = Date.now();
    const sequential = userRead().then(totals => service.compute('owner', totals));
    await jest.advanceTimersByTimeAsync(1000); await sequential;
    const sequentialMs = Date.now() - sequentialStart;
    const parallelStart = Date.now();
    const parallel = service.compute('owner', { totals: userRead() });
    await jest.advanceTimersByTimeAsync(600); await parallel;
    expect({ sequentialMs, parallelMs: Date.now() - parallelStart }).toEqual({ sequentialMs: 1000, parallelMs: 600 });
  } finally { jest.useRealTimers(); }
});
