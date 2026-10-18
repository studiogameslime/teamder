import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture() {
  const file = ts.createSourceFile('FriendsScreen.tsx', fs.readFileSync('src/screens/profile/FriendsScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer = '';
  function walk(node: ts.Node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'load') initializer = node.initializer!.getText(file); ts.forEachChild(node, walk); }
  walk(file);
  const pending: Array<(rows: any[]) => void> = [];
  const failures: Array<(error: Error) => void> = [];
  const read = () => new Promise<any[]>((resolve, reject) => { pending.push(resolve); failures.push(reject); });
  const state: Record<string, any> = {};
  let currentId = 'owner';
  const context: any = { me: { id: 'owner', isGuest: false }, ownerId: 'owner', isGuest: false, epoch: { current: 0 }, isCurrentUser: () => currentId === 'owner',
    useCallback: (fn: any) => fn, friendsService: { listFriends: read, listIncomingRequests: read, listOutgoingRequests: read }, logError: jest.fn(), __DEV__: false };
  for (const name of ['Friends', 'Incoming', 'Outgoing', 'Loading', 'Refreshing', 'LoadFailed', 'InviteRefresh', 'BusyId']) context['set' + name] = (value: any) => { state[name] = value; };
  const code = ts.transpileModule('(' + initializer + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const load = vm.runInNewContext(code, context);
  return { load, pending, failures, state, switchOwner: () => { currentId = 'other'; }, epoch: context.epoch };
}

test('a slow earlier refresh cannot replace newer friends or requests', async () => {
  const f = fixture(), first = f.load(), second = f.load();
  f.pending.slice(3).forEach(resolve => resolve([{ id: 'new' }])); await second;
  f.pending.slice(0, 3).forEach(resolve => resolve([{ id: 'old' }])); await first;
  expect(f.state.Friends).toEqual([{ id: 'new' }]); expect(f.state.Incoming).toEqual([{ id: 'new' }]);
});

test('results of the account that left the screen cannot populate the next account', async () => {
  const f = fixture(), loading = f.load(); f.switchOwner();
  f.pending.forEach(resolve => resolve([{ id: 'old-private-result' }])); await loading;
  expect(f.state.Friends).toBeUndefined(); expect(f.state.Incoming).toBeUndefined();
});

test('focus cleanup invalidates an in-flight friends response', async () => {
  const f = fixture(), loading = f.load(); f.epoch.current++;
  f.pending.forEach(resolve => resolve([{ id: 'late' }])); await loading;
  expect(f.state.Friends).toBeUndefined();
});

test('network failure preserves the last list, exposes a failure and recovers on retry', async () => {
  const f = fixture(); f.state.Friends = [{ id: 'cached' }];
  const failed = f.load({ pull: true }); f.failures.forEach(reject => reject(Error('offline'))); await failed;
  expect(f.state.Friends).toEqual([{ id: 'cached' }]); expect(f.state.LoadFailed).toBe(true);
  expect(f.state.Refreshing).toBe(false);
  const retry = f.load(); f.pending.slice(3).forEach(resolve => resolve([{ id: 'fresh' }])); await retry;
  expect(f.state.LoadFailed).toBe(false); expect(f.state.Friends).toEqual([{ id: 'fresh' }]);
});
