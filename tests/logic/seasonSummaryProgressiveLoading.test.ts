import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as personal from '@/utils/seasonPersonal';
import * as awards from '@/utils/seasonAwards';
import * as club from '@/utils/seasonClubSummary';
import * as coverage from '@/utils/seasonCoverage';
import { seasonChoices } from '@/utils/seasonChoices';

const sourcePath = (file: string) => (process.env.DETAIL_SEASON_BASELINE === '1' ? 'artifacts/detail-performance-2026-11-04/before-src/' : '') + file;
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred<T = any>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; }
const players = [
  { userId: 'owner', displayName: 'שם שמור', games: 5, rounds: 12, wins: 8, goals: 9, assists: 2 },
  { userId: 'partner', games: 4, rounds: 9, wins: 5, goals: 3, assists: 6 },
];
const rows = (values: any[]) => { const docs = values.map(value => ({ data: () => value })); return { docs, forEach: (callback: any) => docs.forEach(callback) }; };
const identities = [{ id: 'owner', name: 'שם חדש' }, { id: 'partner', name: 'שותף', avatarId: 'avatar', photoUrl: 'photo' }];

function fixture(options: { timed?: boolean; archive?: any; formerMember?: boolean; failCore?: boolean } = {}) {
  const core = new Map<string, ReturnType<typeof deferred>>();
  const peers = deferred(), logError = jest.fn(), onBase = jest.fn();
  const group = { name: 'מועדון', seasons: { enabled: true, currentId: 's2', currentNo: 2, startedAt: 100, playedRounds: 5, cadence: { type: 'rounds', targetRounds: 10 } } };
  const values: Record<string, any[]> = { communityPlayerStats: players, communityPairStats: [{ a: 'owner', b: 'partner', sameTeam: 9, winsTogether: 5, winsA: 3, assistsAToB: 2 }], communityStats: [{ rounds: 12, goals: 12, assists: 8 }] };
  const delay = (value: any, ms: number) => new Promise(resolve => setTimeout(() => resolve(value), ms));
  const hydrateUsers = jest.fn(() => options.timed ? delay(identities, 500) : peers.promise);
  const getDocs = jest.fn((query: any) => {
    if (options.failCore) return Promise.reject(Error('core offline'));
    if (options.timed) return delay(rows(values[query.collection]), query.collection === 'communityPairStats' ? 60 : 40);
    const read = deferred(); core.set(query.collection, read); return read.promise;
  });
  const getDoc = jest.fn(async (collection: string) => {
    if (collection === 'groups' && options.formerMember) throw Object.assign(Error('former member'), { code: 'permission-denied' });
    const snapshot = { exists: () => collection === 'groups' || !!options.archive, data: () => collection === 'groups' ? group : options.archive };
    return options.timed ? delay(snapshot, 20) : snapshot;
  });
  const dependencies: Record<string, any> = {
    '../utils/errorObservation': { observeCaughtError: jest.fn() },
    './seasonArchiveData': { readSeasonArchiveData: async (_db: any, data: any) => data },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) },
    '@/utils/seasonChoices': { seasonChoices }, '@/services/errorLog': { logError },
    '@/services/groupService': { groupService: { hydrateUsers } },
    '@/utils/seasonPersonal': personal, '@/utils/seasonAwards': awards, '@/utils/seasonClubSummary': club, '@/utils/seasonCoverage': coverage,
    'firebase/firestore': { getDocs, getDoc, doc: (_db: any, collection: string) => collection, collection: (_db: any, collection: string) => collection, where: (...args: any[]) => args, query: (collection: string, ...filters: any[]) => ({ collection, filters }) },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(sourcePath('src/services/seasonSummaryService.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module, exports: module.exports, require: (name: string) => dependencies[name] ?? {}, console });
  const finishCore = () => { for (const [name, read] of core) read.resolve(rows(values[name])); };
  return { api: module.exports.seasonSummaryService, core, peers, hydrateUsers, getDocs, getDoc, logError, onBase, finishCore };
}

test('the accurate base appears at 80 ms instead of waiting another 500 ms for identities', async () => {
  jest.useFakeTimers({ now: 0 });
  try {
    const f = fixture({ timed: true }); let firstContentAt: number | undefined, finalAt: number | undefined;
    const pending = f.api.load({ groupId: 'club', userId: 'owner', seasonId: 's2', onBase: (base: any) => { firstContentAt = Date.now(); f.onBase(base); } }).then((model: any) => { finalAt = Date.now(); firstContentAt ??= finalAt; return model; });
    await jest.advanceTimersByTimeAsync(80);
    const baseCallsAt80 = f.onBase.mock.calls.length, contentAt80 = firstContentAt, finalAt80 = finalAt;
    await jest.advanceTimersByTimeAsync(500); await pending;
    if (process.env.DETAIL_SEASON_TIMING_REPORT) fs.writeFileSync(process.env.DETAIL_SEASON_TIMING_REPORT, JSON.stringify({ evidence: 'synthetic-delays-real-service-source', groupDelayMs: 20, coreMaxDelayMs: 60, identityDelayMs: 500, baseCallsAt80, contentAt80: contentAt80 ?? null, firstContentAt, finalAt }, null, 2) + '\n');
    if (process.env.DETAIL_SEASON_PREVIEW_FILE) fs.writeFileSync(process.env.DETAIL_SEASON_PREVIEW_FILE, JSON.stringify(f.onBase.mock.calls[0][0], null, 2) + '\n');
    expect(baseCallsAt80).toBe(1); expect(finalAt80).toBeUndefined();
    expect(f.onBase.mock.calls[0][0]).toMatchObject({ seasonId: 's2', completedRounds: 5, closed: false, peerIdentityStatus: 'loading', me: { goals: 9, assists: 2 } });
    expect(firstContentAt).toBe(80);
    expect(finalAt).toBe(580);
  } finally { jest.useRealTimers(); }
});

test('identity enrichment updates names, portraits and leader copy without mutating the base or recomputing numbers', async () => {
  const f = fixture(); const pending = f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase });
  await flush(); f.finishCore(); await flush();
  expect(f.onBase).toHaveBeenCalledTimes(1); const base = f.onBase.mock.calls[0][0];
  expect(base.names.partner).toBeUndefined(); expect(base.peerAvatars).toEqual({});
  f.peers.resolve(identities); const enriched = await pending;
  expect(enriched.names.partner).toBe('שותף'); expect(enriched.peerAvatars.partner).toMatchObject({ avatarId: 'avatar', photoUrl: 'photo' });
  expect(enriched.club.leaders.find((award: any) => award.key === 'topAssister').names).toEqual(['שותף']);
  expect(enriched.me).toBe(base.me); expect(enriched.club.numbers).toBe(base.club.numbers);
  expect(base.names).toEqual({ owner: 'שם שמור' }); expect(base.peerIdentityStatus).toBe('loading'); expect(enriched.peerIdentityStatus).toBe('ready');
});

test('identity failure retains accurate data and an explicit retryable identity error', async () => {
  const f = fixture(); const pending = f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase });
  await flush(); f.finishCore(); await flush(); f.peers.reject(Error('identity offline'));
  const model = await pending;
  expect(model).toMatchObject({ peerIdentityStatus: 'error', me: { goals: 9 }, names: { owner: 'שם שמור' } });
  expect(f.logError).toHaveBeenCalledWith('seasonSummaryPeerIdentity', expect.anything(), expect.objectContaining({ seasonId: 's2' }));
});

test('a successful lookup with missing identities is partial rather than a transport failure or invented identity', async () => {
  const f = fixture(); const pending = f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase });
  await flush(); f.finishCore(); await flush(); f.peers.resolve([identities[0]]);
  const model = await pending;
  expect(model.peerIdentityStatus).toBe('partial'); expect(model.names.partner).toBeUndefined(); expect(model.peerAvatars.partner).toBeUndefined(); expect(f.logError).not.toHaveBeenCalled();
});

test.each(['', '   '])('an effective blank peer name %j stays partial even when its identity document exists', async name => {
  const f = fixture(); const pending = f.api.load({ groupId: 'club', userId: 'owner' });
  await flush(); f.finishCore(); await flush(); f.peers.resolve([identities[0], { id: 'partner', name, avatarId: 'portrait' }]);
  const model = await pending;
  expect(model.peerIdentityStatus).toBe('partial'); expect(model.names.partner).toBeUndefined(); expect(model.peerAvatars.partner.avatarId).toBe('portrait');
});

test('a blank enriched name preserves a valid base name, and portraits remain optional', async () => {
  const f = fixture(); const pending = f.api.load({ groupId: 'club', userId: 'owner' });
  await flush(); f.finishCore(); await flush(); f.peers.resolve([{ id: 'owner', name: '   ' }, { id: 'partner', name: 'שותף' }]);
  const model = await pending;
  expect(model.names).toEqual({ owner: 'שם שמור', partner: 'שותף' }); expect(model.peerIdentityStatus).toBe('ready'); expect(model.peerAvatars).toEqual({});
});

test('core failures remain errors and never publish a believable empty summary', async () => {
  const f = fixture({ failCore: true });
  expect(await f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase })).toBe('error');
  expect(f.onBase).not.toHaveBeenCalled(); expect(f.hydrateUsers).not.toHaveBeenCalled();
});

test('cancellation during core reads rejects explicitly and does not start optional identity work', async () => {
  const f = fixture(); let current = true;
  const result = f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase, isCurrent: () => current }).catch((error: Error) => error);
  await flush(); current = false; f.finishCore(); f.peers.resolve(identities);
  expect((await result).name).toBe('SeasonSummaryCancelledError'); expect(f.onBase).not.toHaveBeenCalled(); expect(f.hydrateUsers).not.toHaveBeenCalled(); expect(f.logError).not.toHaveBeenCalled();
});

test('cancelling from the base callback prevents identity queries and does not masquerade as missing data', async () => {
  const f = fixture(); let current = true;
  const result = f.api.load({ groupId: 'club', userId: 'owner', onBase: () => { current = false; }, isCurrent: () => current }).catch((error: Error) => error);
  await flush(); f.finishCore(); f.peers.resolve(identities); expect((await result).name).toBe('SeasonSummaryCancelledError'); expect(f.hydrateUsers).not.toHaveBeenCalled();
});

test('a late identity result from a cancelled request cannot become its final model', async () => {
  const f = fixture(); let current = true;
  const result = f.api.load({ groupId: 'club', userId: 'owner', onBase: f.onBase, isCurrent: () => current }).catch((error: Error) => error);
  await flush(); f.finishCore(); await flush(); current = false; f.peers.resolve(identities);
  expect((await result).name).toBe('SeasonSummaryCancelledError'); expect(f.onBase).toHaveBeenCalledTimes(1); expect(f.logError).not.toHaveBeenCalled();
});

test('a former member archive uses frozen names without live counters, profile reads or live onBase', async () => {
  const f = fixture({ formerMember: true, archive: { seasonId: 's1', no: 1, startsAt: 10, endsAt: 90, completedRounds: 4, players: { owner: { displayName: 'שם קפוא', games: 4, rounds: 8, goals: 7 } }, pairs: {}, totals: {}, awards: {} } });
  const model = await f.api.load({ groupId: 'club', userId: 'owner', seasonId: 's1', onBase: f.onBase });
  expect(model).toMatchObject({ closed: true, seasonId: 's1', completedRounds: 4, names: { owner: 'שם קפוא' }, peerAvatars: {} });
  expect(f.getDocs).not.toHaveBeenCalled(); expect(f.hydrateUsers).not.toHaveBeenCalled(); expect(f.onBase).not.toHaveBeenCalled();
});

function screenFixture() {
  const source = ts.createSourceFile('screen.tsx', fs.readFileSync(sourcePath('src/screens/profile/SeasonSummaryScreen.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Node | undefined, shareCallback: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'load') callback = (node.initializer as ts.CallExpression).arguments[0]; if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'onShare') shareCallback = (node.initializer as ts.CallExpression).arguments[0]; ts.forEachChild(node, visit); }; visit(source);
  const screen = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'SeasonSummaryScreen') as ts.FunctionDeclaration;
  const reset = screen.body!.statements.find(node => ts.isIfStatement(node) && node.expression.getText(source).includes('confirmedSummary.current'))?.getText(source) ?? '';
  const compile = (node: ts.Node) => ts.transpileModule(`(() => { const { viewerId, viewerIsGuest, groupId, seasonId, summaryScope, currentUser, model, sharing, tab } = __inputs; ${reset} return ${node.getText(source)}; })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const program = compile(callback!), shareProgram = compile(shareCallback!);
  const reads: Array<{ args: any; result: ReturnType<typeof deferred> }> = [];
  const state: any = { model: null, loadedScope: null, loading: true, failed: false, refreshing: true, refreshFailed: false, sharing: false };
  const capture = deferred(), available = deferred(), share = jest.fn(async () => undefined);
  const sharingApi = { isAvailableAsync: jest.fn(() => available.promise), shareAsync: share };
  const context: any = { viewerId: 'owner', viewerIsGuest: false, currentUser: { id: 'owner' }, groupId: 'club', seasonId: 's2', summaryScope: 'owner:club:s2', currentSummaryScope: { current: 'owner:club:s2' }, confirmedSummary: { current: null }, loadSeq: { current: 0 }, shareGeneration: { current: 0 }, shareCardRef: { current: {} }, tab: 'personal',
    seasonSummaryService: { load: (args: any) => { const result = deferred(); reads.push({ args, result }); return result.promise; } },
    captureRef: jest.fn(() => capture.promise), require: () => sharingApi, he: {}, toast: { error: jest.fn() }, logError: jest.fn(),
    useUserStore: { getState: () => ({ currentUser: context.currentUser }) }, logEvent: jest.fn(), observeCaughtError: jest.fn(), AnalyticsEvent: {},
  };
  Object.keys(state).forEach(key => { context['set' + key[0].toUpperCase() + key.slice(1)] = (value: any) => { state[key] = value; }; });
  const sandbox = vm.createContext(context);
  const render = (sharing = false) => { context.currentSummaryScope.current = context.summaryScope; context.__inputs = { ...context, model: state.model, sharing: state.sharing }; return vm.runInContext(sharing ? shareProgram : program, sandbox); };
  return { context, state, reads, render, capture, available, sharingApi, share };
}

test('the screen becomes usable on base delivery and accepts optional enrichment failure without erasing its numbers', async () => {
  const f = screenFixture(); const pending = f.render()(); const base = { seasonNo: 2, closed: false, myTitles: [], peerIdentityStatus: 'loading', me: { goals: 9 } };
  f.reads[0].args.onBase(base); expect(f.state).toMatchObject({ model: base, loading: false, failed: false, refreshing: false });
  const final = { ...base, peerIdentityStatus: 'error' }; f.reads[0].result.resolve(final); await pending;
  expect(f.state).toMatchObject({ model: final, loading: false, failed: false });
});

test('screen scope and account guards reject old base callbacks and final enrichment', async () => {
  const f = screenFixture(); const old = f.render()();
  f.context.currentUser = { id: 'other' }; f.context.viewerId = 'other'; f.context.summaryScope = 'other:club:s2'; const current = f.render()();
  f.reads[0].args.onBase({ secret: 'old' }); expect(f.state.model).toBeNull();
  const fresh = { seasonNo: 2, closed: false, myTitles: [], marker: 'new' }; f.reads[1].args.onBase(fresh); f.reads[1].result.resolve(fresh); await current;
  f.reads[0].result.resolve({ ...fresh, marker: 'old' }); await old; expect(f.state.model.marker).toBe('new');
});

test('the screen invalidates a prior response immediately on route change, before a replacement load starts', async () => {
  const f = screenFixture(); const pending = f.render()();
  f.context.seasonId = 's1'; f.context.summaryScope = 'owner:club:s1'; f.render();
  expect(f.reads[0].args.isCurrent()).toBe(false); f.reads[0].args.onBase({ stale: true });
  f.reads[0].result.resolve(null); await pending; expect(f.state.model).toBeNull(); expect(f.state.loading).toBe(true);
});

test.each(['error-result', 'rejection'])('a failed same-scope identity retry (%s) retains the confirmed numbers with a real refresh error', async failure => {
  const f = screenFixture(); const first = f.render()();
  const confirmed = { seasonNo: 2, closed: false, myTitles: [], peerIdentityStatus: 'error', me: { goals: 9 } };
  f.reads[0].args.onBase(confirmed); f.reads[0].result.resolve(confirmed); await first;
  const retry = f.render()();
  if (failure === 'rejection') f.reads[1].result.reject(Error('base offline')); else f.reads[1].result.resolve('error');
  await retry;
  expect(f.state).toMatchObject({ model: { me: { goals: 9 } }, refreshFailed: true, failed: false, loading: false, refreshing: false });
});

test('a replacement refresh failure cannot leave retained identities loading forever', async () => {
  const f = screenFixture(); const old = f.render()();
  f.reads[0].args.onBase({ seasonNo: 2, closed: false, myTitles: [], peerIdentityStatus: 'loading', me: { goals: 9 } });
  const retry = f.render()(); f.reads[1].result.resolve('error'); await retry;
  expect(f.state.model.peerIdentityStatus).toBe('error'); expect(f.state.refreshFailed).toBe(true);
  f.reads[0].result.resolve({ me: { goals: 100 } }); await old; expect(f.state.model.me.goals).toBe(9);
});

test.each(['account', 'season'])('confirmed numbers cannot survive a failed read in another %s', async change => {
  const f = screenFixture(); const first = f.render()(); const confirmed = { seasonNo: 2, closed: false, myTitles: [], me: { goals: 9 } };
  f.reads[0].result.resolve(confirmed); await first;
  if (change === 'account') { f.context.viewerId = 'other'; f.context.currentUser = { id: 'other' }; }
  else f.context.seasonId = 's1';
  f.context.summaryScope = change === 'account' ? 'other:club:s2' : 'owner:club:s1';
  const next = f.render()(); f.reads[1].result.resolve('error'); await next;
  expect(f.state).toMatchObject({ model: null, failed: true, refreshFailed: false });
});

test.each(['identity', 'group'])('refresh ends immediately when %s is missing', async missing => {
  const f = screenFixture();
  if (missing === 'identity') { f.context.viewerId = undefined; f.context.currentUser = null; } else f.context.groupId = '';
  await f.render()(); expect(f.reads).toHaveLength(0); expect(f.state.refreshing).toBe(false); expect(f.state.loading).toBe(false);
});

test.each([
  ['capture', 'account'], ['capture', 'season'], ['availability', 'account'], ['availability', 'season'],
] as const)('sharing stops after %s when the %s changes', async (stage, change) => {
  const f = screenFixture(); f.state.model = { seasonNo: 2, myTitles: [], peerIdentityStatus: 'ready' };
  const pending = f.render(true)();
  if (stage === 'availability') { f.capture.resolve('captured'); await flush(); expect(f.sharingApi.isAvailableAsync).toHaveBeenCalledTimes(1); }
  if (change === 'account') f.context.currentUser = { id: 'other' };
  else { f.context.summaryScope = 'owner:club:s1'; f.render(); }
  if (stage === 'capture') f.capture.resolve('captured'); else f.available.resolve(true);
  await pending; expect(f.share).not.toHaveBeenCalled();
  if (stage === 'capture') expect(f.sharingApi.isAvailableAsync).not.toHaveBeenCalled();
});

test('sharing still works for the same account and season after both asynchronous checks', async () => {
  const f = screenFixture(); f.state.model = { seasonNo: 2, myTitles: [], peerIdentityStatus: 'ready' };
  const pending = f.render(true)(); f.capture.resolve('captured'); await flush(); f.available.resolve(true); await pending;
  expect(f.share).toHaveBeenCalledWith('captured', expect.anything()); expect(f.state.sharing).toBe(false);
});
