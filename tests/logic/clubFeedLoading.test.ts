import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const source = ts.createSourceFile('PublicGroupsFeedScreen.tsx', fs.readFileSync('src/screens/communities/PublicGroupsFeedScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!found && predicate(node)) found = node; ts.forEachChild(node, visit); };
  visit(source);
  if (!found) throw Error('Missing feed source region');
  return found as any;
}
function evaluate(node: ts.Node, context: object) {
  return vm.runInNewContext(ts.transpileModule('(' + node.getText(source) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText, { ...context });
}
const effect = find(node => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.getText(source).includes('groupService.listPublicGroups')).arguments[0];
const initial = find(node => ts.isVariableDeclaration(node) && node.name.getText(source) === 'initialLoading').initializer;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const requests: Array<{ resolve: (value: any) => void; reject: (error: Error) => void }> = [];
  const read = jest.fn(() => new Promise((resolve, reject) => requests.push({ resolve, reject })));
  const state: any = { items: null, loading: false, loadFailed: false };
  let scheduled: (() => void) | undefined, cleanup: (() => void) | undefined;
  const context: any = { text: '', resultQuery: {current:null}, groupService: { listPublicGroups: read, searchPublicGroups: read },
    AnalyticsEvent: { GroupSearch: 'search' }, logEvent: jest.fn(), observeCaughtError: jest.fn(), logError: jest.fn(),
    setTimeout: (callback: () => void) => { scheduled = callback; return 1; }, clearTimeout: jest.fn() };
  for (const key of Object.keys(state)) context['set' + key[0].toUpperCase() + key.slice(1)] = (value: unknown) => { state[key] = value; };
  const start = () => { cleanup?.(); cleanup = evaluate(effect, context)(); scheduled?.(); };
  return { state, context, requests, read, start, pending: () => evaluate(initial, state), leave: () => cleanup?.() };
}

test('club feed shows a skeleton before the effect and resolves an empty response as a real empty state', async () => {
  const f = fixture();
  expect(f.pending()).toBe(true);
  f.start(); expect(f.state.loading).toBe(true);
  f.requests[0].resolve([]); await flush();
  expect(f.pending()).toBe(false); expect(f.state).toEqual({ items: [], loading: false, loadFailed: false });
  f.start(); expect(f.pending()).toBe(false);
});

test('initial failure ends the skeleton without inventing an empty list, and retry can recover', async () => {
  const f = fixture(); f.start(); f.requests[0].reject(Error('offline')); await flush();
  expect(f.state).toEqual({ items: null, loading: false, loadFailed: true }); expect(f.pending()).toBe(false);
  f.start(); expect(f.pending()).toBe(true);
  f.requests[1].resolve([{ id: 'club' }]); await flush();
  expect(f.state).toEqual({ items: [{ id: 'club' }], loading: false, loadFailed: false });
});

test('refresh and failed search preserve confirmed club cards', async () => {
  const f = fixture(); f.start(); f.requests[0].resolve([{ id: 'club' }]); await flush();
  f.context.text = 'מועדון'; f.start();
  expect(f.pending()).toBe(false); expect(f.state.items).toEqual([{ id: 'club' }]);
  f.requests[1].reject(Error('search failed')); await flush();
  expect(f.state).toEqual({ items: [{ id: 'club' }], loading: false, loadFailed: true });
  f.start(); f.requests[2].resolve([]); await flush();
  expect(f.state).toEqual({ items: [], loading: false, loadFailed: false });
});

test('obsolete searches and responses after leaving cannot replace the current feed', async () => {
  const f = fixture(); f.start(); f.context.text = 'חדש'; f.start();
  f.requests[1].resolve([{ id: 'current' }]); await flush();
  f.requests[0].resolve([{ id: 'obsolete' }]); await flush();
  expect(f.state.items).toEqual([{ id: 'current' }]);
  f.start(); f.leave(); f.requests[2].reject(Error('late')); await flush();
  expect(f.state.items).toEqual([{ id: 'current' }]); expect(f.state.loadFailed).toBe(false);
});
