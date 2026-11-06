import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

// Execute the production focus callbacks. Views/network are outside this
// boundary; deferred reads verify scheduling, publication and cancellation.
function callback(file: string, needle: string, context: Record<string, any>) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useFocusEffect' && node.getText(source).includes(needle)) {
      effect = (node.arguments[0] as ts.CallExpression).arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!effect) throw Error('Focus callback missing: ' + file);
  const module = { exports: null as any };
  vm.runInNewContext(ts.transpileModule('module.exports = ' + effect.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, { module, ...context });
  return module.exports as () => (() => void);
}
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

function personal(kind: 'home' | 'statistics') {
  const fresh = deferred(), highlights = deferred();
  const base = { attendedGames: 4, goals: 0, assists: 0, mostPlayedWith: { uid: 'partner', count: 3 } };
  let result: any = null;
  const setResult = jest.fn(value => { result = typeof value === 'function' ? value(result) : value; });
  const getUserById = jest.fn((id: string) => id === 'owner' ? fresh.promise : Promise.resolve({ id: 'partner', name: 'שותף' }));
  const compute = jest.fn(async (_id: string, options: any) => {
    const totals = await options.totals;
    const summary = { ...base, ...totals };
    options.onBase(summary);
    const enriched = await highlights.promise;
    options.onHighlights(enriched);
    return { ...summary, highlights: enriched };
  });
  const setStats = jest.fn(), setPen = jest.fn(), setPeople = jest.fn(), setFailed = jest.fn();
  const user = { id: 'owner', stats: { goals: 1, assists: 2 } };
  const focus = callback(kind === 'home' ? 'src/components/home/HomePersonalStats.tsx' : 'src/screens/profile/StatisticsScreen.tsx', 'playerStatsService.compute', {
    user, localUser: user, preview: undefined, setResult, setFailed, userService: { getUserById }, playerStatsService: { compute },
    observeCaughtError: jest.fn(), logError: jest.fn(), targetId: 'owner', ownerKey: 'owner:owner', statsOwnerRef: { current: 'owner:owner' },
    otherPlayer: false, setStats, setPen, setPeople, setLoading: jest.fn(), setHighlightsLoading: jest.fn(), setRestricted: jest.fn(), setTargetUser: jest.fn(),
  });
  return { fresh, highlights, compute, getUserById, setResult, setStats, setPen, setPeople, setFailed, focus, result: () => result };
}

test.each(['home', 'statistics'] as const)('%s starts statistics before the fresh user arrives and publishes only fresh totals', async kind => {
  const f = personal(kind), stop = f.focus();
  expect(f.getUserById).toHaveBeenCalledWith('owner');
  expect(f.compute).toHaveBeenCalledTimes(1);
  expect(f.setResult).not.toHaveBeenCalled(); expect(f.setStats).not.toHaveBeenCalled();
  f.fresh.resolve({ stats: { goals: 20, assists: 8 } }); await flush();
  if (kind === 'home') {
    expect(f.result()).toMatchObject({ owner: 'owner', stats: { goals: 20, assists: 8 }, partner: { id: 'partner' } });
    expect(f.getUserById.mock.calls.filter(([id]) => id === 'partner')).toHaveLength(1);
  } else {
    expect(f.setStats).toHaveBeenCalledWith(expect.objectContaining({ goals: 20, assists: 8 }));
    expect(f.setPen).toHaveBeenCalled();
  }
  f.highlights.resolve({ recentCount: 4 }); await flush();
  if (kind === 'home') expect(f.result()).toMatchObject({ partner: { id: 'partner' }, stats: { highlights: { recentCount: 4 } } });
  stop();
});

test.each(['home', 'statistics'] as const)('%s ignores a late base and highlights after blur', async kind => {
  const f = personal(kind), stop = f.focus(); stop();
  f.fresh.resolve({ stats: { goals: 20 } }); f.highlights.resolve({ recentCount: 4 }); await flush();
  expect(f.setResult).not.toHaveBeenCalled(); expect(f.setStats).not.toHaveBeenCalled(); expect(f.setPen).not.toHaveBeenCalled();
  expect(f.getUserById).toHaveBeenCalledTimes(1);
});

test.each(['home', 'statistics'] as const)('%s exposes a failed fresh-user read without publishing stale totals', async kind => {
  const f = personal(kind), stop = f.focus();
  f.fresh.reject(Error('offline')); await flush();
  expect(f.setFailed).toHaveBeenCalledWith(true);
  expect(f.setResult).not.toHaveBeenCalled(); expect(f.setStats).not.toHaveBeenCalled(); stop();
});

test('home clears an old partner immediately when the fresh summary names a different player', async () => {
  const f = personal('home'), stop = f.focus();
  f.fresh.resolve({ stats: { goals: 20 } }); f.highlights.resolve({ recentCount: 4 }); await flush();
  expect(f.result().partner.id).toBe('partner'); stop();
  const newPartner = deferred();
  f.getUserById.mockImplementation((id: string) => id === 'owner' ? f.fresh.promise : newPartner.promise);
  f.compute.mockImplementationOnce(async (_id: string, options: any) => {
    const summary = { attendedGames: 5, ...await options.totals, mostPlayedWith: { uid: 'new-partner', count: 4 } };
    options.onBase(summary); return summary;
  });
  const nextStop = f.focus(); await flush();
  expect(f.result().stats.mostPlayedWith.uid).toBe('new-partner'); expect(f.result().partner).toBeUndefined();
  newPartner.resolve({ id: 'new-partner', name: 'שותף חדש' }); await flush();
  expect(f.result().partner.id).toBe('new-partner'); nextStop();
});

test('draft setup ignores profile/reference churn but rechecks changed admin membership and account', async () => {
  const file = 'src/screens/games/DraftSetupScreen.tsx';
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let focus = '', key = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'adminScope') key = node.initializer!.getText(source);
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useFocusEffect' && node.getText(source).includes("logError('draftSetupLoad'")) focus = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  let dependencies: any[] | undefined, memo: any, mounted: any, cleanup: any;
  const getGameById = jest.fn().mockResolvedValue({ id: 'round', groupId: 'club', createdBy: 'other', players: [], numberOfTeams: 3 });
  const scope: any = {
    currentUser: { id: 'manager' }, myCommunities: [{ id: 'club', adminIds: ['manager'] }],
    gameId: 'round', params: {}, retryLoad: 0, hydratePlayers: jest.fn(), loadRevision: { current: 0 },
    gameService: { getGameById }, setGame: jest.fn(), setLoadingGame: jest.fn(), setLoadFailed: jest.fn(), setAutoNumTeams: jest.fn(),
    MIN_TEAMS: 2, MAX_TEAMS: 7, toast: { info: jest.fn() }, he: { draftAdminOnly: 'למנהלים' },
    nav: { canGoBack: () => true, goBack: jest.fn() }, logError: jest.fn(), observeCaughtError: jest.fn(),
    useCallback(fn: any, deps: any[]) {
      if (!dependencies || deps.some((v, i) => !Object.is(v, dependencies![i]))) { dependencies = deps; memo = fn; }
      return memo;
    },
    useFocusEffect(fn: any) { if (fn !== mounted) { cleanup?.(); mounted = fn; cleanup = fn(); } },
  };
  const script = ts.transpileModule(`{const adminScope=${key};${focus};}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const draw = () => vm.runInNewContext(script, scope);
  draw(); await flush();
  scope.currentUser = { id: 'manager', name: 'שם חדש' }; scope.myCommunities = [{ id: 'club', adminIds: ['manager'], name: 'שם מועדון חדש' }];
  draw(); await flush(); expect(getGameById).toHaveBeenCalledTimes(1);
  scope.myCommunities = [{ id: 'club', adminIds: [] }]; draw(); await flush();
  expect(getGameById).toHaveBeenCalledTimes(2); expect(scope.nav.goBack).toHaveBeenCalledTimes(1);
  scope.currentUser = { id: 'other' }; draw(); await flush(); expect(getGameById).toHaveBeenCalledTimes(3);
  cleanup?.();
});
