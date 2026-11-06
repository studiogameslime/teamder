import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { mapConcurrent } from '../../src/utils/mapConcurrent';
import { didEveningHappen } from '../../src/utils/eveningPlayed';
import { inSeason } from '../../src/utils/seasonScope';
import { seasonReadStamp } from '../../src/utils/seasonReadConsistency';

const currentSource = 'src/services/managerDashboardService.ts';
// Keep the exact before source with the tests as well as the local evidence,
// so comparison checks also run in a checkout that excludes artifacts/.
const originalSource = 'tests/fixtures/managerDashboard.before-performance.txt';
const now = 2e12;
const group = { id: 'club', adminIds: ['admin'], playerIds: ['a'], internalRating: true };
const game = (id: string, days = 1, fields = {}) => ({ id, groupId: 'club', startsAt: now - days * 86400000, status: 'finished', endedBy: 'admin', players: ['a'], waitlist: [], ...fields });
function load(file: string, deps: Record<string, any>) {
  const module = { exports: {} as any };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => deps[name], Date, __DEV__: false });
  return module.exports;
}
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 24; i++) await Promise.resolve(); };
function fixture(source = currentSource, games = [game('recent')]) {
  const auth = { currentUser: { uid: 'admin' } }, get = jest.fn(async () => group as any), scores = jest.fn(async (_id: string): Promise<Record<string, number>> => ({ a: 8 }));
  const users = jest.fn(async () => [{ id: 'a', name: 'אבי' }]);
  const getDocs = jest.fn(async (q: any) => ({ docs: q === 'games' ? games.map(value => ({ data: () => value })) : [] }));
  const service = load(source, {
    '@/utils/mapConcurrent': { mapConcurrent },
    'firebase/firestore': { getDocs, query: (q: any) => q, where() {}, orderBy() {}, limit() {}, collection: (_db: any, name: string) => name },
    '@/firebase/firestore': { col: { games: () => 'games' } },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ auth, db: {} }) },
    '@/firebase/authRace': { withAuthRaceRetry: (fn: () => any) => fn() },
    './groupService': { groupService: { get, hydrateUsers: users } },
    './gameEveningScores': { getGameEveningScores: scores },
    '@/data/mockData': { mockGamesV2: [] },
    '@/utils/managerDashboard': { memberIds: (g: any) => [...new Set([...g.adminIds, ...g.playerIds])] },
    '@/utils/eveningPlayed': { didEveningHappen },
    '@/utils/seasonReadConsistency': { seasonReadStamp },
  });
  return { service, auth, get, users, getDocs, scores };
}

test('a 200-round overview reads zero score documents, preserving the old full API for other callers', async () => {
  const games = Array.from({ length: 200 }, (_, i) => game(`g${i}`, i + 1));
  const old = fixture(originalSource, games), fast = fixture(currentSource, games);
  const before = await old.service.loadManagerDashboard('club', 'admin');
  const after = await fast.service.loadManagerDashboard('club', 'admin', { includeScores: false });
  expect(old.scores).toHaveBeenCalledTimes(200); expect(fast.scores).not.toHaveBeenCalled();
  expect(after).toMatchObject({ group: before.group, users: before.users, games: before.games, events: before.events, scores: {}, scoresIncomplete: true });
  expect(fast.get).toHaveBeenCalledTimes(2);
});

test('controlled 100 ms sources and 200 score reads remove 5000 ms from the base critical path', async () => {
  jest.useFakeTimers();
  try {
    const measure = async (source: string, includeScores: boolean) => {
      const games = Array.from({ length: 200 }, (_, i) => game(`g${i}`, i + 1)), f = fixture(source, games);
      const delayed = <T,>(value: T) => new Promise<T>(resolve => setTimeout(() => resolve(value), 100));
      f.get.mockImplementation(() => delayed(group));
      f.users.mockImplementation(() => delayed([{ id: 'a', name: 'אבי' }]));
      f.getDocs.mockImplementation(q => delayed({ docs: q === 'games' ? games.map(value => ({ data: () => value })) : [] }));
      f.scores.mockImplementation(() => delayed({ a: 8 }));
      const start = Date.now(); let elapsed = -1;
      const request = f.service.loadManagerDashboard('club', 'admin', { includeScores }).then(() => { elapsed = Date.now() - start; });
      await jest.advanceTimersByTimeAsync(6000); await request;
      return elapsed;
    };
    expect(await measure(originalSource, true)).toBe(5300);
    expect(await measure(currentSource, false)).toBe(300);
  } finally { jest.useRealTimers(); }
});

test('deferred score loading gates access and season before reading and again before publishing', async () => {
  const f = fixture();
  f.get.mockResolvedValue({ ...group, adminIds: [] });
  await expect(f.service.loadManagerDashboardScores(group, 'admin', [game('g')])).rejects.toThrow('manager-access-revoked');
  expect(f.scores).not.toHaveBeenCalled();
  f.get.mockResolvedValueOnce(group).mockResolvedValueOnce({ ...group, seasons: { currentId: 'new' } });
  await expect(f.service.loadManagerDashboardScores(group, 'admin', [game('g')])).rejects.toThrow('manager-season-changed');
});

test('scores stay scoped to this club and happened evenings, deduplicate IDs, and preserve partial failure', async () => {
  const f = fixture();
  f.scores.mockImplementation(async id => { if (id === 'bad') throw Error('offline'); return { a: 9 }; });
  const result = await f.service.loadManagerDashboardScores(group, 'admin', [game('good'), game('good'), game('bad'), game('foreign', 1, { groupId: 'other' }), game('cancelled', 1, { status: 'cancelled' })]);
  expect(f.scores.mock.calls.map(call => call[0])).toEqual(['good', 'bad']);
  expect(result).toEqual({ scores: { good: { a: 9 } }, scoresIncomplete: true });
});

test.each(['identity', 'cancel'])('queued score reads stop after %s changes', async mode => {
  const f = fixture(), rows = Array.from({ length: 4 }, () => deferred<Record<string, number>>());
  let active = true;
  f.scores.mockImplementation(() => rows[f.scores.mock.calls.length - 1].promise);
  const pending = f.service.loadManagerDashboardScores(group, 'admin', Array.from({ length: 8 }, (_, i) => game(`g${i}`, i + 1)), { isCurrent: () => active });
  const rejected = expect(pending).rejects.toThrow(mode === 'identity' ? 'manager-session-changed' : 'manager-load-cancelled');
  await flush(); expect(f.scores).toHaveBeenCalledTimes(4);
  if (mode === 'identity') f.auth.currentUser = { uid: 'admin' }; else active = false;
  rows.forEach(row => row.resolve({ a: 8 }));
  await rejected; expect(f.scores).toHaveBeenCalledTimes(4);
});

function runtime() {
  const slots: any[] = []; let index = 0, effects: Array<() => void> = [];
  const same = (a: any[], b: any[]) => a?.length === b?.length && a?.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial: any) { const i = index++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (value: any) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef(initial: any) { const i = index++; return slots[i] ??= { current: initial }; },
    useMemo(fn: any, deps: any[]) { const i = index++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect(fn: any, deps: any[]) { const i = index++, prior = slots[i]; if (!same(prior?.deps, deps)) { const entry: any = { deps }; slots[i] = entry; effects.push(() => { prior?.cleanup?.(); entry.cleanup = fn(); }); } },
  };
  return { hooks, begin: () => { index = 0; }, effects: () => { const pending = effects; effects = []; pending.forEach(fn => fn()); }, unmount: () => slots.forEach(slot => slot?.cleanup?.()) };
}
const baseData = (games = [game('recent', 3), game('old', 50)]) => ({ group, games, users: [], scores: {}, scoresIncomplete: true, events: [], truncated: false, equipmentUnavailable: false });
function scoreHook() {
  const rt = runtime(), read = jest.fn(), refreshBase = jest.fn();
  const { useManagerDashboardScores, managerScoreGames } = load('src/screens/communities/useManagerDashboardScores.ts', {
    react: rt.hooks, '@/services/managerDashboardService': { loadManagerDashboardScores: read },
    '@/utils/eveningPlayed': { didEveningHappen }, '@/utils/seasonScope': { inSeason }, '@/utils/errorObservation': { observeCaughtError() {} },
  });
  const render = (base: any, enabled = true, period: any = 90, viewer = 'admin', clock = now) => { rt.begin(); return useManagerDashboardScores(base, viewer, enabled, period, clock, refreshBase); };
  return { rt, read, render, refreshBase, select: managerScoreGames };
}

test('overview/equipment do no score work, and a player read requests only its 90-day scope', async () => {
  const f = scoreHook(), base = baseData([game('recent', 3), game('ancient', 150)]), pending = deferred();
  f.read.mockReturnValue(pending.promise);
  f.render(base, false); f.rt.effects(); expect(f.read).not.toHaveBeenCalled();
  expect(f.render(base).loading).toBe(true); f.rt.effects();
  expect(f.read.mock.calls[0][2].map((g: any) => g.id)).toEqual(['recent']);
  pending.resolve({ scores: { recent: { a: 8 } }, scoresIncomplete: false }); await flush();
  expect(f.render(base)).toMatchObject({ loading: false, failed: false, data: { scoresIncomplete: false, scores: { recent: { a: 8 } } } });
  f.rt.unmount();
});

test('switching periods and returning to ratings reuses only matching successful rows', async () => {
  const f = scoreHook(), base = baseData();
  f.read.mockImplementation(async (_group, _viewer, games) => ({ scores: Object.fromEntries(games.map((g: any) => [g.id, { a: 8 }])), scoresIncomplete: false }));
  f.render(base, true, 30); f.rt.effects(); await flush();
  f.render(base, true, 90); f.rt.effects(); await flush();
  expect(f.read.mock.calls.map(call => call[2].map((g: any) => g.id))).toEqual([['recent'], ['old']]);
  f.render(base, false); f.rt.effects();
  f.render(base, true, 30); f.rt.effects(); await flush();
  expect(f.render(base, true, 30).loading).toBe(false); expect(f.read).toHaveBeenCalledTimes(2);
  f.rt.unmount();
});

test('partial failure preserves successful scores, disables recommendations, and retries missing rows only', async () => {
  const f = scoreHook(), base = baseData();
  f.read.mockResolvedValueOnce({ scores: { recent: { a: 9 } }, scoresIncomplete: true }).mockResolvedValueOnce({ scores: { old: {} }, scoresIncomplete: false });
  f.render(base); f.rt.effects(); await flush();
  const failed = f.render(base);
  expect(failed).toMatchObject({ failed: true, loading: false, data: { scoresIncomplete: true, scores: { recent: { a: 9 } } } });
  failed.retry(); f.render(base); f.rt.effects(); await flush();
  expect(f.read.mock.calls[1][2].map((g: any) => g.id)).toEqual(['old']);
  expect(f.render(base)).toMatchObject({ failed: false, loading: false, data: { scoresIncomplete: false, scores: { recent: { a: 9 }, old: {} } } });
  f.rt.unmount();
});

test('late results from an older base cannot leak into another account/club or release a new loader', async () => {
  const f = scoreHook(), base = baseData(), next = { ...baseData(), group: { ...group, id: 'other' }, games: [game('other-round', 1, { groupId: 'other' })] };
  const old = deferred(), fresh = deferred(); f.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
  f.render(base); f.rt.effects();
  expect(f.render(next, true, 90, 'next-admin').data.scores).toEqual({}); f.rt.effects();
  old.resolve({ scores: { recent: { a: 10 } }, scoresIncomplete: false }); await flush();
  expect(f.render(next, true, 90, 'next-admin')).toMatchObject({ loading: true, data: { scores: {} } });
  fresh.resolve({ scores: { 'other-round': { b: 7 } }, scoresIncomplete: false }); await flush();
  expect(f.render(next, true, 90, 'next-admin').data.scores).toEqual({ 'other-round': { b: 7 } });
  f.rt.unmount();
});

test('refresh creates a new score context and season mode never includes another season', async () => {
  const f = scoreHook(), base = baseData([game('current', 3, { seasonId: 's2' }), game('previous', 1, { seasonId: 's1' })]);
  base.group = { ...group, seasons: { enabled: true, currentId: 's2', currentNo: 2 } } as any;
  expect(f.select(base, 'season', now).map((g: any) => g.id)).toEqual(['current']);
  f.read.mockResolvedValue({ scores: { current: { a: 8 } }, scoresIncomplete: false });
  f.render(base, true, 'season'); f.rt.effects(); await flush();
  const refreshed = { ...base, scores: {} };
  expect(f.render(refreshed, true, 'season').loading).toBe(true); f.rt.effects(); await flush();
  expect(f.read).toHaveBeenCalledTimes(2); f.rt.unmount();
});

test('the shared screenshot fixture has complete scores and an explicit pending variant for the player view', () => {
  const preview = JSON.parse(fs.readFileSync('tests/fixtures/manager-dashboard-preview.json', 'utf8'));
  const f = scoreHook();
  expect(f.select(preview.data, 90, preview.now)).toHaveLength(5);
  expect(f.render(preview.loadingData, false, 90, preview.viewerId, preview.now).data.scoresIncomplete).toBe(true);
  expect(preview.loadingData.scores).toEqual({});
  expect(preview.states.playerLoading).toMatchObject({ initialPlayer: preview.initialPlayer, scoresLoading: true });
  f.rt.unmount();
});

test('season drift waits for manual retry, refreshes the base once, and succeeds from the new authorized base', async () => {
  const f = scoreHook(), base = baseData();
  f.read.mockRejectedValueOnce(Error('manager-season-changed'))
    .mockResolvedValueOnce({ scores: { recent: { a: 9 }, old: {} }, scoresIncomplete: false });
  f.render(base); f.rt.effects(); await flush();
  const failed = f.render(base);
  expect(failed).toMatchObject({ loading: false, failed: true, needsBaseRefresh: true, data: { scores: {}, scoresIncomplete: true } });
  f.rt.effects(); await flush();
  expect(f.read).toHaveBeenCalledTimes(1); expect(f.refreshBase).not.toHaveBeenCalled();
  failed.retry();
  expect(f.refreshBase).toHaveBeenCalledTimes(1);
  f.render(base); f.rt.effects(); await flush();
  expect(f.read).toHaveBeenCalledTimes(1);
  const newBase = { ...baseData(), group: { ...group, seasons: { enabled: true, currentId: 'new', currentNo: 2, revision: 2 } } };
  expect(f.render(newBase).loading).toBe(true); f.rt.effects(); await flush();
  expect(f.render(newBase)).toMatchObject({ loading: false, failed: false, needsBaseRefresh: false, data: { scores: { recent: { a: 9 }, old: {} }, scoresIncomplete: false } });
  expect(f.read).toHaveBeenCalledTimes(2); f.rt.unmount();
});
