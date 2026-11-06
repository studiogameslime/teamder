import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { buildScopeOptions, clubHasScopes, hasArchivedStats } from '@/utils/statsScope';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
const archive = [{ seasonId: 'closed-season', no: 1 }];
const enabled = { enabled: true, count: 1, currentNo: 2, startedAt: 1000 };

// The source hook body runs unchanged. Only native UI, services and React's
// scheduler are replaced; this verifies request ordering and state isolation.
function fixture() {
  const source = fs.readFileSync('src/screens/players/PlayerCompareScreen.tsx', 'utf8');
  const begin = source.indexOf('  const seasonContext =');
  const end = source.indexOf('  const onShare =', begin);
  expect(begin).toBeGreaterThan(0); expect(end).toBeGreaterThan(begin);
  const output = ts.transpileModule(`(function(input) {
    const {groupId,otherUid,viewerId,viewerIsGuest,useRef,useState,useEffect,useMemo,groupService,seasonHistoryService,pairCompareService,
      comparisonActivityService,randomUUID,useUserStore,observeCaughtError,isStaleSession,hasArchivedStats,buildScopeOptions,clubHasScopes,NO_PAST_SEASONS,logEvent,AnalyticsEvent} = input;
    ${source.slice(begin, end)}
    return { scope, model, loading, seasonsLoaded, pastSeasons, scopeOptions, setScope };
  })`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const metadata = deferred<any>();
  const archives = deferred<any>();
  const comparison = deferred<any>();
  const groupService = { get: jest.fn(() => metadata.promise) };
  const seasonHistoryService = { list: jest.fn(() => archives.promise) };
  const pairCompareService = { load: jest.fn(() => comparison.promise) };
  const account: any = { id: 'viewer', isGuest: false };
  let slots: any[] = [], index = 0, effects: (() => void)[] = [], queued = false, mounted = true;
  let result: any;
  const schedule = () => { if (queued || !mounted) return; queued = true; void Promise.resolve().then(() => { queued = false; render(); }); };
  const context: any = {
    groupId: 'club', otherUid: 'other', viewerId: 'viewer', viewerIsGuest: false,
    groupService, seasonHistoryService, pairCompareService, hasArchivedStats, buildScopeOptions, clubHasScopes,
    NO_PAST_SEASONS: [], observeCaughtError: jest.fn(), isStaleSession: () => false,
    comparisonActivityService: { record: jest.fn(async () => {}) }, randomUUID: () => 'visit',
    logEvent: jest.fn(), AnalyticsEvent: { PlayerComparisonViewed:'player_comparison_viewed' },
    useUserStore: { getState: () => ({ currentUser: account }) },
    useRef: (initial: any) => { const i = index++; return slots[i] ?? (slots[i] = { current: initial }); },
    useState: (initial: any) => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], (next: any) => {
      const value = typeof next === 'function' ? next(slots[i]) : next;
      if (!Object.is(value, slots[i])) { slots[i] = value; schedule(); }
    }]; },
    useMemo: (callback: any, deps: any[]) => { const i = index++, old = slots[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) slots[i] = { deps, value: callback() }; return slots[i].value; },
    useEffect: (callback: () => any, deps: any[]) => { const i = index++, old = slots[i]; if (!old || deps.some((value, j) => !Object.is(value, old.deps[j]))) {
      effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: callback() }; });
    } },
  };
  const body = vm.runInNewContext(output);
  function render() { if (!mounted) return result; index = 0; effects = []; result = body(context); effects.forEach(effect => effect()); return result; }
  const update = (next: Record<string, any>) => { Object.assign(context, next); if ('viewerId' in next) account.id = next.viewerId; if ('viewerIsGuest' in next) account.isGuest = next.viewerIsGuest; return render(); };
  render();
  return { metadata, archives, comparison, groupService, seasonHistoryService, pairCompareService, context,
    state: () => result, update, select: (scope: any) => result.setScope(scope),
    unmount: () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); slots = []; } };
}

test('current waits for club season boundaries, then loads before a slow archive without reloading when it arrives', async () => {
  const f = fixture(); await settle();
  expect(f.pairCompareService.load).not.toHaveBeenCalled();
  f.metadata.resolve({ seasons: enabled }); await settle();
  expect(f.seasonHistoryService.list).toHaveBeenCalledTimes(1);
  expect(f.pairCompareService.load).toHaveBeenCalledWith(expect.objectContaining({ seasons: enabled, scope: { k: 'current' }, pastSeasonIds: [] }));
  f.comparison.resolve({ marker: 'current' }); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: { marker: 'current' } });
  f.archives.resolve(archive); await settle();
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  expect(f.state().scopeOptions.map((option: any) => option.key)).toEqual(['current', 'all', 'closed-season']);
  f.unmount();
});

test.each([{ enabled: false, count: 1 }, { enabled: false, count: 0, hasArchivedPeriods: true }])('disabled seasons with archived history still default to all and wait for the archive: %j', async seasons => {
  const f = fixture(); f.metadata.resolve({ seasons }); await settle();
  expect(f.state().scope).toEqual({ k: 'all' });
  expect(f.pairCompareService.load).not.toHaveBeenCalled();
  f.archives.resolve(archive); await settle();
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  expect(f.pairCompareService.load).toHaveBeenCalledWith(expect.objectContaining({ scope: { k: 'all' }, pastSeasonIds: ['closed-season'], seasons }));
  f.unmount();
});

test('selecting all while the menu archive is pending never exposes current totals under all', async () => {
  const f = fixture(); f.metadata.resolve({ seasons: enabled }); f.comparison.resolve({ marker: 'current' }); await settle();
  f.select({ k: 'all' }); await settle();
  expect(f.state()).toMatchObject({ loading: true, model: null });
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  f.archives.resolve(archive); await settle();
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(2);
  expect(f.pairCompareService.load).toHaveBeenLastCalledWith(expect.objectContaining({ scope: { k: 'all' }, pastSeasonIds: ['closed-season'] }));
  f.unmount();
});

test('an archive failure leaves current data intact and all unavailable without summing an empty archive', async () => {
  const f = fixture(); f.metadata.resolve({ seasons: enabled }); f.comparison.resolve({ marker: 'current' }); await settle();
  f.archives.reject(new Error('offline')); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: { marker: 'current' } });
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  f.select({ k: 'all' }); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: null, scope: { k: 'all' } });
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  f.unmount();
});

test('disabled all-time archive failure shows unavailable, without requesting current or an incomplete sum', async () => {
  const f = fixture(); f.metadata.resolve({ seasons: { enabled: false, count: 1 } }); f.archives.resolve('error'); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: null, scope: { k: 'all' } });
  expect(f.pairCompareService.load).not.toHaveBeenCalled();
  f.unmount();
});

test('missing metadata never loads unbounded statistics', async () => {
  const f = fixture(); f.metadata.reject(new Error('denied')); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: null });
  expect(f.pairCompareService.load).not.toHaveBeenCalled();
  expect(f.seasonHistoryService.list).not.toHaveBeenCalled();
  f.unmount();
});

test('an old comparison cannot populate a new target while the replacement comparison is pending', async () => {
  const f = fixture(); f.metadata.resolve({ seasons: { enabled: true, count: 0 } }); await settle();
  const replacement = deferred<any>(); f.pairCompareService.load.mockImplementationOnce(() => replacement.promise);
  f.update({ otherUid: 'new-target' }); await settle();
  f.comparison.resolve({ marker: 'old-target' }); await settle();
  expect(f.state()).toMatchObject({ loading: true, model: null });
  replacement.resolve({ marker: 'new-target' }); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: { marker: 'new-target' } });
  expect(f.groupService.get).toHaveBeenCalledTimes(1);
  f.unmount();
});

test.each([{ viewerId: 'new-account' }, { viewerIsGuest: true }, { groupId: 'new-club' }])('context changes hide existing data immediately and ignore the old archive: %j', async next => {
  const f = fixture(); f.metadata.resolve({ seasons: enabled }); f.comparison.resolve({ marker: 'old-context' }); await settle();
  const metadata = deferred<any>(); f.groupService.get.mockImplementationOnce(() => metadata.promise);
  f.update(next);
  expect(f.state()).toMatchObject({ loading: true, model: null });
  await settle(); f.archives.resolve(archive); await settle();
  expect(f.state()).toMatchObject({ loading: true, model: null });
  expect(f.pairCompareService.load).toHaveBeenCalledTimes(1);
  expect(f.groupService.get).toHaveBeenCalledTimes(2);
  f.unmount();
});

test('a failed comparison ends loading with the existing unavailable state', async () => {
  const f = fixture(); f.metadata.resolve({ seasons: { enabled: true, count: 0 } }); f.comparison.reject(new Error('network')); await settle();
  expect(f.state()).toMatchObject({ loading: false, model: null });
  expect(f.context.observeCaughtError).toHaveBeenCalled();
  f.unmount();
});

test('controlled latency: current is visible at 500 ms while the 2200 ms archive is still pending', async () => {
  jest.useFakeTimers(); jest.setSystemTime(0);
  const f = fixture();
  const started: number[] = [];
  f.pairCompareService.load.mockImplementation(() => {
    started.push(Date.now());
    return new Promise(resolve => setTimeout(() => resolve({ marker: 'ready' }), 300));
  });
  setTimeout(() => f.metadata.resolve({ seasons: enabled }), 200);
  setTimeout(() => f.archives.resolve(archive), 2200);
  try {
    jest.advanceTimersByTime(200); await settle();
    expect(started).toEqual([200]);
    jest.advanceTimersByTime(299); await settle(); expect(f.state().loading).toBe(true);
    jest.advanceTimersByTime(1); await settle();
    expect(Date.now()).toBe(500);
    expect(f.state()).toMatchObject({ loading: false, model: { marker: 'ready' }, pastSeasons: [] });
    jest.advanceTimersByTime(1700); await settle();
    expect(f.state().pastSeasons).toEqual(archive);
    expect(started).toEqual([200]);
  } finally {
    f.unmount(); jest.useRealTimers();
  }
});
