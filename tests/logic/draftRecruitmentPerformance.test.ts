import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { activeDraftRosterIds } from '@/utils/draftIntegrity';
import { draftColorTeams } from '@/utils/draftColors';
import { reconstructPicks } from '@/utils/draft';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const captains = ['captain-a', 'captain-b'];
const game = (extra: Record<string, any> = {}) => ({ id: 'round', groupId: 'club', createdBy: 'another-manager', format: '2v2', players: [...captains, 'registered'], waitlist: ['waiting'], pending: ['pending'], draftTeams: { createdAt: 9, teams: [], published: true }, ...extra });

function sourceProgram(name: 'AddMembersScreen' | 'DraftBoardScreen') {
  const prefix = process.env.PERFORMANCE_PICKERS_BASELINE === '1' ? 'artifacts/performance-2026-11-04/before-src/' : '';
  const source = ts.createSourceFile(name + '.tsx', fs.readFileSync(prefix + 'src/screens/games/' + name + '.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
  const statements = screen.body!.statements;
  const names = name === 'AddMembersScreen' ? ['loadScope', 'currentLoadScope'] : ['viewerId', 'viewerIsGuest', 'adminScope', 'captainScope', 'ownerKey', 'currentOwner'];
  const declarations = statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(source))));
  const assignment = statements.find(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && /^(currentLoadScope|currentOwner)\.current$/.test(node.expression.left.getText(source)));
  const effect = statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.getText(source).includes('gameService.getGameById'));
  if (!effect) throw Error('Missing real screen loader: ' + name);
  return ts.transpileModule(`(() => {
    const { currentUser, myCommunities, captainIds, gameId, reserve, method, resume, readOnly, expectedDraftCreatedAt, retryLoad } = __renderInputs;
    const me = currentUser;
    ${[...declarations, assignment, effect].filter(Boolean).map(node => node!.getText(source)).join('\n')}
  })()`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const programs = { AddMembersScreen: sourceProgram('AddMembersScreen'), DraftBoardScreen: sourceProgram('DraftBoardScreen') };

type Request = { id: string; options?: any; resolve: (value: any) => void; reject: (error: Error) => void };
function fixture(name: keyof typeof programs, deferUsers = false) {
  const slots: any[] = [], reads: Request[] = [], userReads: Request[] = [];
  let cursor = 0, focused = true, effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const state: any = { game: null, members: [], loading: true, loadFailed: false, picks: [], teamColors: {}, selected: new Set(['old-selection']), availableIds: new Set(), dataScope: null, requestOwner: null };
  const context: any = {
    AbortController, gameId: 'round', reserve: false, currentUser: { id: 'owner', isGuest: false, name: 'שם קודם' }, me: null,
    myCommunities: [{ id: 'club', name: 'מועדון קודם', adminIds: ['owner'], playerIds: [...captains, 'registered', 'waiting', 'pending', 'candidate'] }],
    captainIds: [...captains], method: 'snake', resume: false, readOnly: false, expectedDraftCreatedAt: undefined, retryLoad: 0,
    gameService: { getGameById: jest.fn((id: string, options?: any) => new Promise((resolve, reject) => reads.push({ id, options, resolve, reject }))) },
    userService: { getUserById: jest.fn((id: string) => deferUsers ? new Promise((resolve, reject) => userReads.push({ id, resolve, reject })) : Promise.resolve({ id, name: id })) },
    useUserStore: { getState: () => ({ currentUser: context.currentUser }) },
    hydratePlayers: jest.fn(), activeDraftRosterIds, draftColorTeams, reconstructPicks,
    isGuestId: (id: string) => id.startsWith('guest:'),
    nav: { canGoBack: () => true, goBack: jest.fn() }, toast: { info: jest.fn() }, he: { draftAdminOnly: 'מנהלים בלבד', error: 'שגיאה' }, appAlert: jest.fn(),
    observeCaughtError: jest.fn(), logError: jest.fn(), logEvent: jest.fn(), AnalyticsEvent: {},
    useRef: (initial: unknown) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useCallback: (callback: () => any, deps: any[]) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: callback, deps };
      return slots[index].value;
    },
  };
  const register = (effect: () => any, deps: any[]) => {
    const index = cursor++;
    if (same(slots[index]?.deps, deps)) return;
    const previous = slots[index], next: any = { deps };
    slots[index] = next;
    effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
  };
  context.useEffect = register;
  context.useFocusEffect = (effect: () => any) => register(() => focused ? effect() : undefined, [effect, focused]);
  Object.keys(state).forEach(key => { context['set' + key[0].toUpperCase() + key.slice(1)] = (value: any) => { state[key] = value; }; });
  const sandbox = vm.createContext(context);
  const draw = (flushEffects = true) => {
    cursor = 0;
    context.__renderInputs = Object.fromEntries(['currentUser', 'myCommunities', 'captainIds', 'gameId', 'reserve', 'method', 'resume', 'readOnly', 'expectedDraftCreatedAt', 'retryLoad'].map(key => [key, context[key]]));
    vm.runInContext(programs[name], sandbox);
    if (flushEffects) { const queued = effects; effects = []; queued.forEach(effect => effect()); }
  };
  return { context, state, reads, userReads, draw, setFocused: (value: boolean) => { focused = value; } };
}

test.each(['AddMembersScreen', 'DraftBoardScreen'] as const)('%s ignores five profile/club metadata refreshes and club/member array reordering', async name => {
  const f = fixture(name); f.draw(); f.reads[0].resolve(game()); await flush();
  for (let index = 0; index < 5; index++) {
    f.context.currentUser = { ...f.context.currentUser, name: `שם ${index}`, stats: { goals: index } };
    f.context.myCommunities = f.context.myCommunities.map((group: any) => ({ ...group, name: `מועדון ${index}`, photoUrl: String(index), playerIds: [...group.playerIds].reverse() })).reverse();
    f.context.captainIds = [...captains]; f.draw();
  }
  expect(f.reads).toHaveLength(1);
  expect(f.state.game.id).toBe('round');
});

test('recruitment refreshes when member IDs change and filters registered, waiting and pending players', async () => {
  const f = fixture('AddMembersScreen'); f.draw(); f.reads[0].resolve(game()); await flush();
  expect(f.context.userService.getUserById.mock.calls.map(([id]: [string]) => id)).toEqual(['candidate']);
  f.context.myCommunities = [{ ...f.context.myCommunities[0], playerIds: ['new-candidate'] }]; f.draw();
  expect(f.reads).toHaveLength(2);
  f.reads[1].resolve(game()); await flush();
  expect(f.state.members.map((user: any) => user.id)).toEqual(['new-candidate']);
  expect(f.state.selected.size).toBe(0);
});

test('reserve mode still includes the manager while ordinary recruitment excludes them', async () => {
  const f = fixture('AddMembersScreen'); f.draw(); f.reads[0].resolve(game()); await flush();
  expect(f.context.userService.getUserById).not.toHaveBeenCalledWith('owner');
  f.context.reserve = true; f.draw(); f.reads[1].resolve(game()); await flush();
  expect(f.context.userService.getUserById).toHaveBeenCalledWith('owner');
});

test('recruitment rejects an old membership reply before the replacement effect starts', async () => {
  const f = fixture('AddMembersScreen'); f.draw();
  f.context.myCommunities = [{ ...f.context.myCommunities[0], playerIds: ['new'] }]; f.draw(false);
  f.reads[0].resolve(game()); await flush();
  expect(f.state.game).toBeNull();
  expect(f.context.userService.getUserById).not.toHaveBeenCalled();
});

test('recruitment refuses late identity enrichment after account switch', async () => {
  const f = fixture('AddMembersScreen', true); f.draw(); f.reads[0].resolve(game()); await flush();
  expect(f.userReads).toHaveLength(1);
  f.context.currentUser = { id: 'other', isGuest: false }; f.context.myCommunities = [{ id: 'club', adminIds: ['other'], playerIds: ['other-candidate'] }]; f.draw();
  f.reads[1].resolve(game()); await flush();
  f.userReads[1].resolve({ id: 'other-candidate', name: 'חדש' }); await flush();
  f.userReads[0].resolve({ id: 'candidate', name: 'ישן' }); await flush();
  expect(f.state.members.map((user: any) => user.id)).toEqual(['other-candidate']);
  expect(f.state.loading).toBe(false);
});

test.each(['AddMembersScreen', 'DraftBoardScreen'] as const)('%s refuses responses after the active account changes even before render', async name => {
  const f = fixture(name); f.draw();
  f.context.currentUser = { id: 'other', isGuest: false };
  f.reads[0].resolve(game()); await flush();
  expect(f.state.game).toBeNull();
});

test('board admin demotion invalidates pending access before effects and still blocks editing', async () => {
  const f = fixture('DraftBoardScreen'); f.draw();
  f.context.myCommunities = [{ ...f.context.myCommunities[0], adminIds: [] }]; f.draw(false);
  f.reads[0].resolve(game()); await flush(); expect(f.state.game).toBeNull();
  f.draw(); f.reads[1].resolve(game()); await flush();
  expect(f.state.game).toBeNull();
  expect(f.context.nav.goBack).toHaveBeenCalledTimes(1);
  expect(f.context.toast.info).toHaveBeenCalledWith('מנהלים בלבד');
});

test('board read-only mode still hides unpublished teams from non-managers', async () => {
  const f = fixture('DraftBoardScreen'); f.context.readOnly = true; f.context.myCommunities = [];
  f.draw(); f.reads[0].resolve(game({ draftTeams: { teams: [], published: false } })); await flush();
  expect(f.state.game).toBeNull(); expect(f.context.nav.goBack).toHaveBeenCalledTimes(1);
});

test('board creator access and captain integrity checks remain independent of club administration', async () => {
  const f = fixture('DraftBoardScreen'); f.context.myCommunities = [];
  f.draw(); f.reads[0].resolve(game({ createdBy: 'owner' })); await flush();
  expect(f.state.game?.id).toBe('round'); expect(f.context.nav.goBack).not.toHaveBeenCalled();
  f.context.captainIds = ['captain-a', 'captain-a']; f.draw(); f.reads[1].resolve(game({ createdBy: 'owner' })); await flush();
  expect(f.context.appAlert).toHaveBeenCalledTimes(1);
  expect(f.context.nav.goBack).toHaveBeenCalledTimes(1);
});

test('board preserved-draft loads retain server-only options, abort on blur and reject outdated revisions', async () => {
  const f = fixture('DraftBoardScreen'); f.context.resume = true; f.context.expectedDraftCreatedAt = 9;
  f.draw(); expect(f.reads[0].options).toMatchObject({ source: 'server', expectedDraftCreatedAt: 9 });
  f.setFocused(false); f.draw(); expect(f.reads[0].options.signal.aborted).toBe(true);
  f.reads[0].resolve(game()); await flush(); expect(f.state.game).toBeNull();
  f.setFocused(true); f.draw(); f.reads[1].resolve(game({ draftTeams: { createdAt: 8, teams: [{ playerIds: captains }] } })); await flush();
  expect(f.state.loadFailed).toBe(true); expect(f.state.game).toBeNull();
});

test.each(['AddMembersScreen', 'DraftBoardScreen'] as const)('%s refreshes when a guest upgrades with the same UID', name => {
  const f = fixture(name); f.context.currentUser.isGuest = true; f.draw();
  f.context.currentUser = { ...f.context.currentUser, isGuest: false }; f.draw();
  expect(f.reads).toHaveLength(2);
});
