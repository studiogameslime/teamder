import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file = ts.createSourceFile('section.tsx', fs.readFileSync('src/components/profile/ComparisonActivitySection.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback!: ts.Node;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useFocusEffect') callback = (node.arguments[0] as ts.CallExpression).arguments[0];
  ts.forEachChild(node, visit);
}
visit(file);
const code = ts.transpileModule(`globalThis.start = ${callback.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  let resolve!: (page: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  const account = { id: 'viewer' };
  const context: any = { authorised: true, ownerId: 'viewer', range: 'month', key: 'viewer:month', activeKey: { current: 'viewer:month' }, generation: { current: 0 }, moreRef: { current: false },
    useUserStore: { getState: () => ({ currentUser: account }) }, comparisonActivityService: { list: jest.fn(() => promise) }, isStaleSession: () => false, observeCaughtError: jest.fn() };
  for (const name of ['setResponse', 'setLoading', 'setFailed', 'setMoreFailed', 'setMoreBusy']) context[name] = jest.fn();
  vm.runInNewContext(code, context);
  return { context, account, resolve, reject, start: () => context.start() };
}
test.each(['blur', 'account', 'period', 'newer request'])('late history cannot cross %s', async scenario => {
  const f = fixture(), stop = f.start();
  if (scenario === 'blur') stop();
  if (scenario === 'account') f.account.id = 'other';
  if (scenario === 'period') f.context.activeKey.current = 'viewer:all';
  if (scenario === 'newer request') f.context.generation.current++;
  f.resolve({ players: 6 }); await flush();
  expect(f.context.setResponse).toHaveBeenCalledTimes(1); // clear only; no old page
});
test('failed history remains a visible error while genuine empty history is a zero result', async () => {
  const failed = fixture(); failed.start(); failed.reject(new Error('offline')); await flush();
  expect(failed.context.setFailed).toHaveBeenLastCalledWith(true);
  expect(failed.context.setResponse).toHaveBeenCalledTimes(1);
  const empty = fixture(); empty.start(); const page = { players: 0, comparisons: 0, rows: [], cursor: null }; empty.resolve(page); await flush();
  expect(empty.context.setResponse).toHaveBeenLastCalledWith({ key: 'viewer:month', page });
});
test('an unauthorised embedded section never starts history reads', () => {
  const f = fixture(); f.context.authorised = false; f.start();
  expect(f.context.comparisonActivityService.list).not.toHaveBeenCalled();
});
