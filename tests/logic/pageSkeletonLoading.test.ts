import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function source(path: string) { return ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); }
function find(file: ts.Node, predicate: (node: ts.Node) => boolean): any {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (!found && predicate(node)) found = node; ts.forEachChild(node, visit); };
  visit(file); if (!found) throw Error('Missing source region'); return found;
}
function evaluate(expression: ts.Node, file: ts.SourceFile, context: any) {
  return vm.runInNewContext(ts.transpileModule('(' + expression.getText(file) + ')', {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
}
function variable(file: ts.SourceFile, name: string) {
  return find(file, node => ts.isVariableDeclaration(node) && node.name.getText(file) === name).initializer;
}
const chat = source('src/components/chat/ChatInbox.tsx');
const friends = source('src/screens/profile/FriendsScreen.tsx');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const pending: ReturnType<typeof deferred>[] = [];
  const read = jest.fn(() => { const request = deferred(); pending.push(request); return request.promise; });
  const ctx: any = { me: { id: 'owner', isGuest: false }, mode: 'new', preview: undefined,
    friends: [], friendsDataKey: null, friendsRequestKey: null, friendsLoading: false, friendsFailed: false,
    friendsService: { listFriends: read }, observeCaughtError: jest.fn(),
    useUserStore: { getState: () => ({ currentUser: ctx.me }) } };
  for (const key of ['friends','friendsDataKey','friendsRequestKey','friendsLoading','friendsFailed']) {
    ctx['set' + key[0].toUpperCase() + key.slice(1)] = jest.fn(value => { ctx[key] = value; });
  }
  const effect = find(chat, node => ts.isCallExpression(node) && node.expression.getText(chat) === 'useEffect' && node.getText(chat).includes('friendsService.listFriends')).arguments[0];
  const render = () => {
    ctx.friendsScope = evaluate(variable(chat, 'friendsScope'), chat, ctx);
    ctx.ownsFriends = evaluate(variable(chat, 'ownsFriends'), chat, ctx);
    return { pending: evaluate(variable(chat, 'friendsPending'), chat, ctx),
      rows: evaluate(variable(chat, 'visibleFriends'), chat, ctx) };
  };
  let cleanup: (() => void) | undefined;
  // Evaluate the registration body, then invoke the actual effect callback.
  const start = () => {
    cleanup?.(); render();
    // React creates a separate lexical binding for each render's viewer/scope.
    cleanup = evaluate(effect, chat, { ...ctx, me: { ...ctx.me }, friendsScope: ctx.friendsScope })();
  };
  return { ctx, read, pending, render, start, leave: () => cleanup?.() };
}

test('friends use a skeleton for the first load and a new access context, while an answered empty list stays visible during refresh', () => {
  const scope = JSON.stringify(['owner', false]);
  const context: any = { displayScope: scope, displayedOwner: { current: scope }, loadedScope: null, loading: true };
  const draw = () => evaluate(variable(friends, 'initialLoading'), friends, context);
  expect(draw()).toBe(true);
  context.loadedScope = scope; expect(draw()).toBe(false);
  context.loading = false; expect(draw()).toBe(false);
  context.displayScope = JSON.stringify(['other', false]); expect(draw()).toBe(true);
  context.displayScope = JSON.stringify(['owner', true]); expect(draw()).toBe(true);
});

test('new conversation starts with a skeleton, then retains its friends during refresh and after failure', async () => {
  const f = fixture(); expect(f.render().pending).toBe(true); f.start();
  expect(f.render().pending).toBe(true); expect(f.read).toHaveBeenCalledTimes(1);
  f.pending[0].resolve([{ id: 'peer', name: 'חבר' }]); await flush();
  expect(f.render()).toMatchObject({ pending: false, rows: [{ id: 'peer' }] });
  f.start(); expect(f.render()).toMatchObject({ pending: false, rows: [{ id: 'peer' }] });
  f.pending[1].reject(Error('offline')); await flush();
  expect(f.ctx.friendsFailed).toBe(true); expect(f.render().rows).toHaveLength(1); expect(f.render().pending).toBe(false);
  f.start(); f.pending[2].resolve([{ id: 'fresh' }]); await flush();
  expect(f.render().rows).toEqual([{ id: 'fresh' }]); expect(f.ctx.friendsFailed).toBe(false);
});

test('a confirmed empty friend list remains an answered list on re-entry, while an initial failure ends the skeleton', async () => {
  const f = fixture(); f.start(); f.pending[0].resolve([]); await flush();
  f.start(); expect(f.render()).toEqual({ pending: false, rows: [] });
  f.pending[1].reject(Error('refresh failed')); await flush(); expect(f.render().pending).toBe(false);
  const initial = fixture(); initial.start(); initial.pending[0].reject(Error('offline')); await flush();
  expect(initial.ctx.friendsFailed).toBe(true); expect(initial.render().pending).toBe(false);
});

test('switching account or guest status hides cached friends before effects and rejects late results', async () => {
  const f = fixture(); f.start(); f.pending[0].resolve([{ id: 'private-old' }]); await flush();
  f.start(); f.ctx.me = { id: 'other', isGuest: false };
  expect(f.render()).toEqual({ pending: true, rows: [] });
  f.start(); f.pending[1].resolve([{ id: 'obsolete' }]); await flush();
  expect(f.render()).toEqual({ pending: true, rows: [] });
  f.pending[2].resolve([{ id: 'current' }]); await flush(); expect(f.render().rows).toEqual([{ id: 'current' }]);
  f.start(); f.ctx.me = { id: 'other', isGuest: true }; expect(f.render().rows).toEqual([]);
  f.pending[3].resolve([{ id: 'from-full-account' }]); await flush(); expect(f.render().rows).toEqual([]);
});

test('leaving the friend picker invalidates a pending answer without changing cached rows', async () => {
  const f = fixture(); f.start(); f.leave(); f.pending[0].resolve([{ id: 'late' }]); await flush();
  expect(f.ctx.setFriends).not.toHaveBeenCalled(); expect(f.ctx.setFriendsDataKey).not.toHaveBeenCalled();
});
