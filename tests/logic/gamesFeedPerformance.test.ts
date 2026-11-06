import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the screen's actual scope, callback and focus-effect declarations.
// The small hook adapter retains dependency identity across renders; native
// views and the rest of the screen do not participate in this request test.
const source = ts.createSourceFile('feed.tsx', fs.readFileSync(
  process.env.PERFORMANCE_FEED_SOURCE ?? 'src/screens/games/GamesListScreen.tsx', 'utf8',
), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screen = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'GamesListScreen') as ts.FunctionDeclaration;
const statements = screen.body!.statements;
const named = (name: string) => statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(source) === name));
const scopeStatements = ['userId', 'feedScope', 'currentFeedScope'].map(named).filter((node): node is ts.Statement => !!node);
const updateScope = statements.find(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(source) === 'currentFeedScope.current');
const focus = statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'useFocusEffect');
const program = ts.transpileModule(`(() => {
  const { user, myCommunities } = __renderInputs;
  ${[...scopeStatements, updateScope, named('reload'), focus].filter(Boolean).map(node => node!.getText(source)).join('\n')}
  return reload;
})()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

type Pending = { owner: string; kind: string; groups?: string[]; resolve: (value: any[]) => void; reject: (error: Error) => void };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const round = (id: string) => ({ id, players: [], waitlist: [] });

function fixture() {
  const slots: any[] = [];
  let cursor = 0, focused = true;
  let effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const pending: Pending[] = [];
  const read = (kind: string) => jest.fn((owner: string, groups?: string[]) => new Promise<any[]>((resolve, reject) => pending.push({ owner, kind, groups, resolve, reject })));
  const state: any = { loading: true, refreshing: false, loadFailed: false, feedOwner: null, myGames: [], communityGames: [], openGames: [], scheduledUpcoming: [] };
  const context: any = {
    user: { id: 'owner', name: 'שם קודם', isGuest: false },
    myCommunities: [{ id: 'second', name: 'שני' }, { id: 'first', name: 'ראשון' }],
    feedRequest: { current: 0 }, hydratePlayers: jest.fn(),
    gameService: { getMyLiveOrUpcomingGames: read('mine'), getCommunityGames: read('community'), getOpenGames: read('open'), getMyUpcomingScheduledGames: read('scheduled') },
    useUserStore: { getState: () => ({ currentUser: context.user }) },
    observeCaughtError: jest.fn(), logError: jest.fn(), __DEV__: false,
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback: (callback: () => any, deps: any[]) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
    useFocusEffect: (effect: () => (() => void) | void) => {
      const index = cursor++, deps = [effect, focused];
      if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index], next: any = { deps };
      slots[index] = next;
      effects.push(() => { previous?.cleanup?.(); if (focused) next.cleanup = effect(); });
    },
  };
  Object.keys(state).forEach(key => { context['set' + key[0].toUpperCase() + key.slice(1)] = (value: any) => { state[key] = value; }; });
  const sandbox = vm.createContext(context);
  const draw = (flushEffects = true) => {
    cursor = 0;
    context.__renderInputs = { user: context.user, myCommunities: context.myCommunities };
    const reload = vm.runInContext(program, sandbox);
    if (flushEffects) { const queued = effects; effects = []; queued.forEach(effect => effect()); }
    return reload;
  };
  const complete = (from: number, id: string) => pending.slice(from, from + 4).forEach(request => request.resolve([round(id)]));
  return { context, state, pending, draw, complete, setFocused: (value: boolean) => { focused = value; } };
}

test('profile refreshes and club metadata/order changes do not repeat the four feed reads', async () => {
  const f = fixture(); f.draw();
  expect(f.pending).toHaveLength(4);
  f.complete(0, 'confirmed'); await flush();
  for (let index = 0; index < 5; index++) {
    f.context.user = { ...f.context.user, name: `שם ${index}`, stats: { goals: index } };
    f.context.myCommunities = f.context.myCommunities.map((group: any) => ({ ...group, name: `מועדון ${index}` })).reverse();
    f.draw();
  }
  expect(f.pending).toHaveLength(4);
  expect(f.state.myGames[0].id).toBe('confirmed');
});

test('adding or removing club membership issues one fresh set of reads with the actual club IDs', async () => {
  const f = fixture(); f.draw();
  f.context.myCommunities = [{ id: 'new-club' }]; f.draw();
  expect(f.pending).toHaveLength(8);
  for (const request of f.pending.slice(4).filter(request => request.kind !== 'mine')) expect(Array.from(request.groups!)).toEqual(['new-club']);
  f.complete(4, 'new'); await flush();
  f.complete(0, 'old'); await flush();
  expect(f.state.myGames[0].id).toBe('new');
});

test('a response from old membership is invalid as soon as the new scope renders, before effects flush', async () => {
  const f = fixture(); f.draw();
  f.context.myCommunities = []; f.draw(false);
  f.complete(0, 'old-membership'); await flush();
  expect(f.state.feedOwner).toBeNull();
  expect(f.state.myGames).toEqual([]);
});

test('switching accounts isolates both results and failures while loading the new account', async () => {
  const f = fixture(); f.draw();
  f.context.user = { id: 'other', isGuest: false }; f.draw();
  expect(f.pending.slice(4).every(request => request.owner === 'other')).toBe(true);
  f.complete(4, 'other-private'); await flush();
  f.pending[0].reject(Error('old account offline')); await flush();
  expect(f.state).toMatchObject({ feedOwner: 'other', loadFailed: false, loading: false });
  expect(f.state.myGames[0].id).toBe('other-private');
});

test('guest upgrade with the same UID refreshes scope and refuses the old guest response', async () => {
  const f = fixture(); f.context.user.isGuest = true; f.draw();
  f.context.user = { ...f.context.user, isGuest: false }; f.draw();
  expect(f.pending).toHaveLength(8);
  f.complete(4, 'member'); await flush();
  f.complete(0, 'guest'); await flush();
  expect(f.state.myGames[0].id).toBe('member');
});

test('blur cancels publication and refocus or manual refresh still reads current data', async () => {
  const f = fixture(); f.draw();
  f.setFocused(false); f.draw();
  f.complete(0, 'blurred'); await flush();
  expect(f.state.feedOwner).toBeNull();
  f.setFocused(true); const reload = f.draw();
  expect(f.pending).toHaveLength(8);
  f.complete(4, 'returned'); await flush();
  const refresh = reload({ pullToRefresh: true });
  expect(f.pending).toHaveLength(12);
  expect(f.state.refreshing).toBe(true);
  f.complete(8, 'manual'); await refresh;
  expect(f.state.myGames[0].id).toBe('manual');
  expect(f.state.refreshing).toBe(false);
});
