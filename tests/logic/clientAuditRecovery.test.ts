import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute real service modules with isolated I/O. No account, network or production write.
function load(file: string, deps: Record<string, any> = {}, extra: Record<string, any> = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(js, { module, exports: module.exports, require: (n: string) => deps[n] ?? {}, __DEV__: false, console, setTimeout, clearTimeout, ...extra });
  return module.exports;
}
function ast(file: string) { return ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(file: ts.SourceFile, predicate: (n: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  function walk(n: ts.Node) { if (!found && predicate(n)) found = n; ts.forEachChild(n, walk); }
  walk(file); if (!found) throw new Error('source node missing'); return found;
}
function expression(source: string, context: any) {
  return vm.runInNewContext(ts.transpileModule(`(${source})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test('profile read failure preserves Firebase account without a cached user', async () => {
  const auth = { currentUser: { uid: 'real', isAnonymous: false } };
  const signIn = jest.fn();
  const service = load('src/services/userService.ts', {
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ auth }) },
    './storage': { storage: { getAuthUserJson: async () => null } },
    '@/firebase/auth': { waitForAuthRestore: async () => auth.currentUser, signInAnonymously: signIn },
    '@/firebase/firestore': { docs: { user: (id: string) => id } },
    'firebase/firestore': { getDoc: async () => { throw Error('offline'); } },
  }).userService;
  await expect(service.getCurrentUser()).rejects.toThrow('offline');
  expect(auth.currentUser.uid).toBe('real');
  expect(signIn).not.toHaveBeenCalled();
});

test('member equipment changes preserve other admins changes and report actual changes', async () => {
  const server = { ballHolderIds: ['a'], jerseysHolderIds: ['b'] };
  const service = load('src/services/groupService.ts', {
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) },
    '@/data/mockUsers': { mockGroup: { id: 'g' }, mockOtherGroup: { id: 'h' } },
    '@/firebase/firestore': { docs: { group: (id: string) => id } },
    'firebase/firestore': { runTransaction: async (_db: any, fn: any) => fn({ get: async () => ({ exists: () => true, data: () => ({ ...server }) }), update: (_ref: any, value: any) => Object.assign(server, value) }) },
  }).groupService;
  await service.setPlayerEquipment('g', 'c', { ball: true, jerseys: false });
  const result = await service.setPlayerEquipment('g', 'a', { ball: false, jerseys: true });
  expect(Array.from(server.ballHolderIds)).toEqual(['c']);
  expect(Array.from(server.jerseysHolderIds)).toEqual(['b', 'a']);
  expect(result.ballChanged).toBe(true);
  const repeated = await service.setPlayerEquipment('g', 'a', { ball: false, jerseys: true });
  expect(repeated.ballChanged).toBe(false); expect(repeated.jerseysChanged).toBe(false);
});

test('chat read and scroll effects see a new message in a full 100-message sliding window', () => {
  const file = ast('src/components/chat/ChatView.tsx');
  const latest = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'latestMessageId') as ts.VariableDeclaration;
  for (const needle of ['chatService.markChatRead', 'listRef.current?.scrollToEnd']) {
    const effect = find(file, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect' && !!n.arguments[0]?.getText(file).includes(needle)) as ts.CallExpression;
    const deps = (shift: number) => {
      const context: any = { messages: Array.from({ length: 100 }, (_, i) => ({ id: String(i + shift) })), me: { id: 'a' }, scope: 'community', parentId: 'g', denied: false, reduced: false };
      context.latestMessageId = expression(latest.initializer!.getText(file), context);
      return expression(effect.arguments[1].getText(file), context);
    };
    expect(deps(0)).not.toEqual(deps(1));
  }
});

test('email handoff closes the sheet without cancelling existing-account journey', async () => {
  const file = ast('src/components/auth/ContextualAuthSheet.tsx');
  const attempt = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'attempt') as ts.VariableDeclaration;
  const cancel = jest.fn(), transition = jest.fn(), navigate = jest.fn();
  const run = expression(attempt.initializer!.getText(file), { busy: null, setError() {}, logEvent() {}, AnalyticsEvent: {}, kind: 'account_upgrade', onCancel: cancel, onEmailTransition: transition, nav: { navigate } });
  await run('email');
  expect(transition).toHaveBeenCalledTimes(1); expect(cancel).not.toHaveBeenCalled(); expect(navigate).toHaveBeenCalledWith('EmailAuth');
});

function achievements() {
  const types = load('src/types/index.ts');
  return { types, service: load('src/services/achievementsService.ts', {
    '@/types': types, '@/data/achievements': load('src/data/achievements.ts'),
    '@/firebase/config': { USE_MOCK_DATA: false },
    '@/firebase/firestore': { col: { games: () => ({}), pairStats: () => ({}) } },
    'firebase/firestore': { query() {}, where() {}, getDocs: async () => { throw Error('offline'); } },
    '@/services/errorLog': { logError() {} },
  }).achievementsService };
}

test('failed achievement source rejects instead of inventing zero progress', async () => {
  await expect(achievements().service.deriveCounters('a')).rejects.toThrow('offline');
});

test('earned silver and bronze badges survive temporarily missing counters in every display path', () => {
  const { service, types } = achievements();
  const user = { id: 'a', achievements: { ...types.defaultAchievementState, unlocked: [{ id: 'games', tier: 'silver', unlockedAt: 123 }, { id: 'duo', tier: 'bronze', unlockedAt: 456 }] } };
  for (const items of [service.list(user), service.listFromCounters(user, types.defaultAchievementState)]) {
    expect(items.find((i: any) => i.def.id === 'games').currentTier.tier).toBe('silver');
    expect(items.find((i: any) => i.def.id === 'duo').currentTier.tier).toBe('bronze');
    expect(items.find((i: any) => i.def.id === 'games').unlockedAt).toBe(123);
  }
});


test('referrals retain a successful list on failure and recover in the same screen', async () => {
  const file = ast('src/screens/profile/ReferralsListScreen.tsx');
  const declaration = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'load') as ts.VariableDeclaration;
  const callback = (declaration.initializer as ts.CallExpression).arguments[0];
  let rows: any = [{ id: 'previous' }], failed = false, loading = false;
  const read = jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([{ id: 'new' }]);
  const run = expression(callback.getText(file), {
    requestRef: { current: 0 }, ownerRef: { current: 'me' }, currentUserId: 'me', openLoggedRef: { current: false },
    setRows: (next: any) => { rows = next; }, setFailed: (next: boolean) => { failed = next; }, setLoading: (next: boolean) => { loading = next; },
    userService: { listInvitedUsers: read }, logError() {}, logEvent() {}, AnalyticsEvent: {}, __DEV__: false,
  });
  await run(); expect(rows).toEqual([{ id: 'previous' }]); expect(failed).toBe(true); expect(loading).toBe(false);
  await run(); expect(rows).toEqual([{ id: 'new' }]); expect(failed).toBe(false);
});

test('referral first-load failure is an error, never a successful empty list', async () => {
  const file = ast('src/screens/profile/ReferralsListScreen.tsx');
  const declaration = find(file, n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'load') as ts.VariableDeclaration;
  const callback = (declaration.initializer as ts.CallExpression).arguments[0];
  let rows: any = null, failed = false, loading = false;
  const run = expression(callback.getText(file), {
    requestRef: { current: 0 }, ownerRef: { current: 'me' }, currentUserId: 'me', openLoggedRef: { current: false },
    setRows: (next: any) => { rows = next; }, setFailed: (next: boolean) => { failed = next; }, setLoading: (next: boolean) => { loading = next; },
    userService: { listInvitedUsers: async () => { throw Error('offline'); } }, logError() {}, logEvent() {}, AnalyticsEvent: {}, __DEV__: false,
  });
  await run(); expect(rows).toBeNull(); expect(failed).toBe(true); expect(loading).toBe(false);
});

test('statistics distinguishes compute failure from empty and retries without losing previous stats', async () => {
  const file = ast('src/screens/profile/StatisticsScreen.tsx');
  const effect = find(file, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect' && !!n.arguments[0]?.getText(file).includes('playerStatsService.compute')) as ts.CallExpression;
  let stats: any = { attendedGames: 8 }, failed = false, loading = false;
  const compute = jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce({ attendedGames: 9 });
  const run = expression(effect.arguments[0].getText(file), {
    statsOwnerRef: { current: 'me' }, localUser: { id: 'me', stats: {} }, userService: { getUserById: async () => ({ stats: {} }) }, playerStatsService: { compute },
    setStats: (s: any) => { stats = s; }, setFailed: (s: boolean) => { failed = s; }, setLoading: (s: boolean) => { loading = s; }, setPen() {}, setPeople() {}, logError() {},
  });
  run(); await new Promise(setImmediate);
  expect(stats.attendedGames).toBe(8); expect(failed).toBe(true); expect(loading).toBe(false);
  run(); await new Promise(setImmediate);
  expect(stats.attendedGames).toBe(9); expect(failed).toBe(false); expect(loading).toBe(false);
});

test('round chat treats failed read and genuinely absent round as different states', async () => {
  const file = ast('src/screens/chat/GameChatScreen.tsx');
  const effect = find(file, n => ts.isCallExpression(n) && n.expression.getText(file) === 'useEffect') as ts.CallExpression;
  let failed = false, loading = false, game: any;
  const read = jest.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'g' });
  const run = expression(effect.arguments[0].getText(file), {
    gameId: 'g', gameService: { getGameById: read }, setFailed: (s: boolean) => { failed = s; }, setLoading: (s: boolean) => { loading = s; }, setGame: (s: any) => { game = s; }, logEvent() {}, AnalyticsEvent: {},
  });
  run(); await new Promise(setImmediate); expect(failed).toBe(true); expect(loading).toBe(false);
  run(); await new Promise(setImmediate); expect(failed).toBe(false); expect(game).toBeNull();
  run(); await new Promise(setImmediate); expect(failed).toBe(false); expect(game.id).toBe('g');
});


test('referral services propagate read errors all the way to their screens and achievements', async () => {
  const service = load('src/services/userService.ts', {
    '@/firebase/config': { USE_MOCK_DATA: false },
    '@/firebase/firestore': { col: { users: () => ({}) } },
    'firebase/firestore': { query() {}, where() {}, getDocs: async () => { throw Error('offline'); }, getCountFromServer: async () => { throw Error('offline'); } },
    './errorLog': { logError() {}, isExpectedDenial: () => false },
  }).userService;
  await expect(service.listInvitedUsers('me')).rejects.toThrow('offline');
  await expect(service.getInvitedUsersCount('me')).rejects.toThrow('offline');
});


test('statistics service propagates source failures instead of reporting zero attended rounds', async () => {
  const service = load('src/services/playerStatsService.ts', {
    '@/firebase/config': { USE_MOCK_DATA: false },
    '@/firebase/firestore': { col: { games: () => ({}) } },
    'firebase/firestore': { query() {}, where() {}, getDocs: async () => { throw Error('offline'); } },
    '@/services/errorLog': { logError() {} },
  }).playerStatsService;
  await expect(service.compute('me', { goals: 2, assists: 1 })).rejects.toThrow('offline');
});

test('statistics clears previous account data even when the next account read fails',async()=>{
 const file=ast('src/screens/profile/StatisticsScreen.tsx');const effect=find(file,n=>ts.isCallExpression(n)&&n.expression.getText(file)==='useEffect') as ts.CallExpression;
 let stats:any={attendedGames:99},pen:any={penTaken:20},people:any={old:{id:'old'}},failed=false;
 const ctx={statsOwnerRef:{current:'old'},localUser:{id:'new'},setStats:(s:any)=>{stats=s;},setPen:(s:any)=>{pen=s;},setPeople:(s:any)=>{people=s;},setFailed:(s:boolean)=>{failed=s;},setLoading(){},logError(){},userService:{getUserById:async()=>{throw Error('offline');}}};
 expression(effect.arguments[0].getText(file),ctx)();await new Promise(setImmediate);
 expect(stats).toBeNull();expect(pen).toBeNull();expect(people).toEqual({});expect(failed).toBe(true);
});

test('contextual authentication does not resume its action after failed profile restoration',async()=>{
 const file=ast('src/hooks/useAuthenticatedAction.tsx');const decl=find(file,n=>ts.isVariableDeclaration(n)&&n.name.getText(file)==='onAuthenticated') as ts.VariableDeclaration;
 const cb=(decl.initializer as ts.CallExpression).arguments[0];const resume=jest.fn();const refresh=jest.fn(async()=>{throw Error('offline');});
 await expression(cb.getText(file),{setPendingKind(){},useUserStore:{getState:()=>({refreshFromSession:refresh})},logError(){},resumePendingAction:resume})({uid:'expected',isNewAccount:false});
 expect(refresh).toHaveBeenCalledWith('expected');expect(resume).not.toHaveBeenCalled();
});
