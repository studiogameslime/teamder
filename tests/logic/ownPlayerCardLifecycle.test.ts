import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file = ts.createSourceFile('card.tsx', fs.readFileSync('src/components/profile/OwnPlayerCard.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function evaluate(node: ts.Node, context: any) {
  vm.runInNewContext(ts.transpileModule(`globalThis.run = ${node.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.run;
}
function find(predicate: (node: ts.Node) => boolean) {
  let result!: ts.Node;
  function visit(node: ts.Node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(file); if (!result) throw new Error('Source node missing'); return result;
}
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const data = deferred(), clubs = deferred(), referrals = deferred(), stats = deferred();
  const owner = { id: 'me' };
  const context: any = { preview: undefined, user: { id: 'me' }, generation: { current: 0 },
    useUserStore: { getState: () => ({ currentUser: owner }) }, observeCaughtError: jest.fn(),
    ownPlayerCardService: { load: jest.fn(() => data.promise), lastStats: jest.fn(() => stats.promise) },
    groupService: { listForUser: jest.fn(() => clubs.promise) }, userService: { getInvitedUsersCount: jest.fn(() => referrals.promise) } };
  for (const name of ['setData', 'setClubs', 'setReferrals', 'setLastStats']) context[name] = jest.fn();
  const call = find(n => ts.isCallExpression(n) && n.expression.getText(file) === 'useFocusEffect') as ts.CallExpression;
  const callback = (call.arguments[0] as ts.CallExpression).arguments[0];
  return { context, data, clubs, referrals, stats, owner, start: () => evaluate(callback, context)() };
}

test('sections load independently and last-round stats cannot block the main profile', async () => {
  const f = fixture(); f.start();
  f.clubs.resolve([{ id: 'club' }]); f.referrals.resolve(0); await flush();
  expect(f.context.setClubs).toHaveBeenLastCalledWith({ value: [{ id: 'club' }] });
  expect(f.context.setReferrals).toHaveBeenLastCalledWith({ value: 0 });
  f.data.resolve({ last: { id: 'full-id' }, attendedCount: 75 }); await flush();
  expect(f.context.setData).toHaveBeenLastCalledWith({ value: { last: { id: 'full-id' }, attendedCount: 75 } });
  expect(f.context.ownPlayerCardService.lastStats).toHaveBeenCalledWith('me', 'full-id');
  f.stats.reject(new Error('offline')); await flush();
  expect(f.context.setLastStats).toHaveBeenLastCalledWith({ failed: true });
});

test.each(['blur', 'new request', 'account'])('old profile responses are discarded after %s', async change => {
  const f = fixture(), stop = f.start();
  if (change === 'blur') stop();
  if (change === 'new request') f.context.generation.current++;
  if (change === 'account') f.owner.id = 'someone-else';
  f.data.resolve({ last: { id: 'old' } }); f.clubs.resolve([]); f.referrals.resolve(99); await flush();
  for (const name of ['setData', 'setClubs', 'setReferrals']) expect(f.context[name]).toHaveBeenCalledTimes(1);
  expect(f.context.ownPlayerCardService.lastStats).not.toHaveBeenCalled();
});

test('failed primary data never becomes a zero-history success', async () => {
  const f = fixture(); f.start(); f.data.reject(new Error('offline')); await flush();
  expect(f.context.setData).toHaveBeenLastCalledWith({ failed: true });
});

test.each(['ProfileEdit', 'Achievements', 'SocialPrivacy', 'Referrals'])('%s opens across every hosting tab without an unregistered local navigation', screen => {
  const node = find(n => ts.isVariableDeclaration(n) && n.name.getText(file) === 'go') as ts.VariableDeclaration;
  const navigate = jest.fn();
  const go = evaluate(node.initializer!, { preview: undefined, nav: { navigate, getState: () => ({ routeNames: ['PlayerCard', 'Statistics', 'MatchDetails', 'EveningSummary'] }) } });
  go(screen);
  expect(navigate).toHaveBeenCalledWith('ProfileTab', { screen, params: undefined, initial: false });
});
