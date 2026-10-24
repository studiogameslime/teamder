import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function source(path: string) {
  return ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function variable(file: ts.SourceFile, name: string): ts.Expression {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
function run(file: ts.SourceFile, expression: ts.Node, context: any) {
  vm.runInNewContext(ts.transpileModule(`globalThis.run = ${expression.getText(file)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return context.run;
}
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

function club() {
  const file = source('src/screens/communities/CommunityDetailsScreen.tsx');
  const member = deferred(), upcoming = deferred(), history = deferred(), stats = deferred();
  const state = { currentUser: { id: 'viewer' } };
  const ctx: any = {
    groupId: 'club', me: state.currentUser, loadScope: 'viewer:club',
    loadGeneration: { current: 0 }, currentLoadScope: { current: 'viewer:club' },
    useUserStore: { getState: () => state },
    groupService: { get: jest.fn().mockResolvedValue({ id: 'club', playerIds: ['p'] }), hydrateUsers: jest.fn(() => member.promise) },
    gameService: { getUpcomingGamesForGroup: jest.fn(() => upcoming.promise), getHistory: jest.fn(() => history.promise), getCommunityStats: jest.fn(() => stats.promise) },
    logEvent: jest.fn(), AnalyticsEvent: { GroupViewed: 'view' }, observeCaughtError: jest.fn(),
    isExpectedDenial: () => false, logError: jest.fn(), __DEV__: false,
  };
  for (const name of ['setGroup', 'setMembers', 'setUpcoming', 'setHistory', 'setCommunityStats', 'setLoading', 'setRefreshing', 'setTotalsReloadTick']) ctx[name] = jest.fn();
  const callback = (variable(file, 'reload') as ts.CallExpression).arguments[0];
  return { ctx, state, member, upcoming, history, stats, reload: run(file, callback, ctx) };
}

test('club next round and members render while history and stats are still pending', async () => {
  const f = club(), pending = f.reload();
  await flush();
  f.upcoming.resolve([{ id: 'next' }]); f.member.resolve([{ id: 'p' }]); await flush();
  expect(f.ctx.setUpcoming).toHaveBeenCalledWith([{ id: 'next' }]);
  expect(f.ctx.setMembers).toHaveBeenCalledWith([{ id: 'p' }]);
  expect(f.ctx.setHistory).not.toHaveBeenCalled();
  expect(f.ctx.setCommunityStats).not.toHaveBeenCalled();
  f.history.resolve([]); f.stats.resolve(null); await pending;
});

test('a failed club section keeps its previous data and does not hold back successful sections', async () => {
  const f = club(), pending = f.reload(); await flush();
  f.member.reject(new Error('offline')); await pending;
  f.upcoming.resolve([{ id: 'next' }]); f.history.reject(new Error('offline')); f.stats.reject(new Error('offline')); await flush();
  expect(f.ctx.setMembers).not.toHaveBeenCalled();
  expect(f.ctx.setUpcoming).toHaveBeenCalledWith([{ id: 'next' }]);
  expect(f.ctx.setHistory).not.toHaveBeenCalled();
  expect(f.ctx.setCommunityStats).not.toHaveBeenCalled();
});

test.each(['account', 'club', 'newer request'])('late club sections cannot cross %s', async change => {
  const f = club(), pending = f.reload(); await flush();
  if (change === 'account') f.state.currentUser = { id: 'other' };
  if (change === 'club') f.ctx.currentLoadScope.current = 'viewer:other';
  if (change === 'newer request') f.ctx.loadGeneration.current++;
  f.member.resolve([]); f.upcoming.resolve([]); f.history.resolve([]); f.stats.resolve(null); await pending;
  expect(f.ctx.setUpcoming).not.toHaveBeenCalled();
  expect(f.ctx.setMembers).not.toHaveBeenCalled();
  expect(f.ctx.setLoading).not.toHaveBeenCalledWith(false);
});

test.each(['MatchDetailsScreen', 'GamesListScreen'])('%s initial focus runs one reload and returning runs one more', name => {
  const file = source(`src/screens/games/${name}.tsx`);
  let reads = 0;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ['useEffect', 'useFocusEffect'].includes(node.expression.getText(file))) {
      const arg = node.arguments[0];
      // Execute the actual registration bodies which call reload directly.
      if (/^\s*(?:(?:React\.)?useCallback\()?\(\) => \{\s*reload\(\);/.test(arg.getText(file))) {
        const ctx: any = { reload: () => reads++, React: { useCallback: (cb: unknown) => cb }, useCallback: (cb: unknown) => cb };
        const effect = run(file, arg, ctx); effect();
        if (node.expression.getText(file) === 'useFocusEffect') effect();
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(reads).toBe(2);
});

test.each([
  { userId: 'viewer', isGuestViewer: false },
  { userId: 'other', isGuestViewer: false },
  { userId: 'viewer', isGuestViewer: true },
])('account profile is reused only for the full-account self view: %j', async ({ userId, isGuestViewer }) => {
  const file = source('src/screens/players/PlayerCardScreen.tsx');
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' &&
      node.arguments[0].getText(file).includes('.getUserById(userId)')) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(file);
  const read = deferred();
  const ctx: any = { userId, me: { id: 'viewer', name: 'אני' }, isGuestViewer,
    logEvent: jest.fn(), AnalyticsEvent: { PlayerCardOpened: 'view' },
    setUser: jest.fn(), setPublicUser: jest.fn(), setLoading: jest.fn(),
    userService: { getUserById: jest.fn(() => read.promise) },
    groupService: { hydratePublicUsers: jest.fn(() => read.promise) }, observeCaughtError: jest.fn() };
  run(file, callback!, ctx)();
  if (userId === 'viewer' && !isGuestViewer) {
    expect(ctx.setUser).toHaveBeenCalledWith(ctx.me);
    expect(ctx.setLoading).toHaveBeenCalledWith(false);
    read.reject(new Error('offline')); await flush();
    expect(ctx.setUser).toHaveBeenCalledTimes(1);
  } else {
    expect(ctx.setUser).toHaveBeenCalledWith(null);
    expect(ctx.userService.getUserById).not.toHaveBeenCalled();
    if (isGuestViewer) {
      expect(ctx.setLoading).toHaveBeenCalledWith(true);
      expect(ctx.groupService.hydratePublicUsers).toHaveBeenCalledWith(['viewer']);
      read.resolve([{ id: 'viewer', name: 'שם ציבורי' }]); await flush();
      expect(ctx.setPublicUser).toHaveBeenLastCalledWith({ id: 'viewer', name: 'שם ציבורי' });
    }
  }
});

test.each(['pending', 'fresh', 'empty'])('opening player invitations reuses %s preload', async mode => {
  const file = source('src/components/social/SocialPlayerProfile.tsx');
  const ctx: any = { preview: undefined, inviteLoading: mode === 'pending', inviteError: false,
    inviteGamesLoadedAt: { current: mode === 'pending' ? 0 : Date.now() },
    setInvites: jest.fn(), setInviteLoading: jest.fn(), setInviteError: jest.fn(), setGames: jest.fn(),
    gameService: { getMyGames: jest.fn() } };
  await run(file, variable(file, 'openInvites'), ctx)();
  expect(ctx.setInvites).toHaveBeenCalledWith(true);
  expect(ctx.gameService.getMyGames).not.toHaveBeenCalled();
});

test.each(['expired', 'failed'])('player invitation %s preload is fetched again', async mode => {
  const file = source('src/components/social/SocialPlayerProfile.tsx');
  const ctx: any = { preview: undefined, me: { id: 'viewer' }, managers: [], inviteLoading: false,
    inviteError: mode === 'failed', inviteGamesLoadedAt: { current: Date.now() - 31000 },
    setInvites: jest.fn(), setInviteLoading: jest.fn(), setInviteError: jest.fn(), setGames: jest.fn(),
    gameService: { getMyGames: jest.fn().mockResolvedValue([]) } };
  await run(file, variable(file, 'openInvites'), ctx)();
  expect(ctx.gameService.getMyGames).toHaveBeenCalledTimes(1);
  expect(ctx.setGames).toHaveBeenLastCalledWith([]);
});
