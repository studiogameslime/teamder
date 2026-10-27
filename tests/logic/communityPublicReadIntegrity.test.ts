import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

// Run the actual loading callback, including its generation fence and error
// handling. No Firestore writes or synthetic public clubs are involved.
function fixture() {
  const source = ts.createSourceFile('screen.tsx', fs.readFileSync('src/screens/communities/CommunityDetailsPublicScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'reload' && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(source);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!callback) throw new Error('Public loader not found');
  const state = { loading: false, failed: false, group: null as any, games: [{ id: 'previous' }] as any[] };
  const getPublic = jest.fn(async (..._args: any[]) => ({ id: 'club' }));
  const getGames = jest.fn(async (..._args: any[]) => [] as any[]);
  const context = { groupId: 'club', loadGeneration: { current: 0 }, groupService: { getPublic },
    gameService: { getUpcomingPublicGamesForGroup: getGames },
    setLoading: (v: boolean) => { state.loading = v; }, setLoadFailed: (v: boolean) => { state.failed = v; },
    setGroup: (v: any) => { state.group = v; }, setUpcomingGames: (v: any[]) => { state.games = v; },
    observeCaughtError: jest.fn(), logError: jest.fn(), __DEV__: false };
  const load = vm.runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) as () => Promise<void>;
  return { state, load, getPublic, getGames };
}

test('a failed public round read exposes failure instead of pretending the club has no rounds', async () => {
  const f = fixture();
  f.getGames.mockRejectedValueOnce(new Error('unavailable'));
  await f.load();
  expect(f.state.failed).toBe(true);
  expect(f.state.games).toEqual([{ id: 'previous' }]);
  expect(f.state.loading).toBe(false);
  f.getGames.mockResolvedValueOnce([{ id: 'upcoming' }]);
  await f.load();
  expect(f.state.failed).toBe(false);
  expect(f.state.games).toEqual([{ id: 'upcoming' }]);
});

test('a successful empty response remains an actual empty club schedule', async () => {
  const f = fixture(); await f.load();
  expect(f.state).toEqual({ loading: false, failed: false, group: { id: 'club' }, games: [] });
});

test('an older failing request cannot replace a newer successful reload', async () => {
  const f = fixture();
  let rejectOld!: (error: Error) => void;
  f.getGames.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  const old = f.load();
  f.getGames.mockResolvedValueOnce([{ id: 'current' }]);
  await f.load();
  rejectOld(new Error('offline'));
  await old;
  expect(f.state.failed).toBe(false);
  expect(f.state.games).toEqual([{ id: 'current' }]);
  expect(f.state.loading).toBe(false);
});
