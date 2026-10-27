import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function fixture(attempt = 0) {
  const path = process.env.TEAMDER_CHAT_AUDIT_SOURCE || 'src/components/chat/ChatView.tsx';
  const source = ts.createSourceFile(path, fs.readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let subscription = '', retry = '';
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0].getText(source).includes('chatService.subscribeMessages')) subscription = node.arguments[0].getText(source);
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'retryMessages') retry = node.initializer?.getText(source) ?? '';
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!subscription) throw Error('Actual subscription missing');
  const state = { failed: false, loading: true, denied: false, messages: [] as any[], retry: attempt, reload: 0 };
  let next!: (rows: any[]) => void, fail!: (error: any) => void;
  const unsub = jest.fn();
  const context = { scope: 'game', parentId: 'round', me: { id: 'viewer' }, previewMessages: undefined, retryTick: attempt,
    setLoading: (v: boolean) => { state.loading = v; }, setDenied: (v: boolean) => { state.denied = v; },
    setLoadFailed: (v: boolean) => { state.failed = v; }, setMessages: (v: any[]) => { state.messages = v; },
    setRetryTick: (v: number | ((n: number) => number)) => { state.retry = typeof v === 'function' ? v(state.retry) : v; },
    setReloadTick: (v: (n: number) => number) => { state.reload = v(state.reload); },
    observeMessages: jest.fn(), chatService: { subscribeMessages: (_s: any, _p: any, n: typeof next, f: typeof fail) => { next=n; fail=f; return unsub; } },
    logEvent: jest.fn(), logError: jest.fn(), AnalyticsEvent: {}, setTimeout, clearTimeout };
  const run = (s: string) => vm.runInNewContext(ts.transpileModule(`(${s})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText, context);
  const stop = run(subscription)();
  return { state, next: (rows: any[]) => next(rows), fail: (code='unavailable') => fail({code}), stop, unsub, retry: () => { if (!retry) throw Error('Retry missing'); run(retry)(); } };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test.each([0,4])('initial failure remains a failure at attempt %s, never a successful empty result', attempt => {
  const f=fixture(attempt); f.fail();
  expect(f.state.failed).toBe(true); expect(f.state.loading).toBe(false); expect(f.state.denied).toBe(false);
  expect(jest.getTimerCount()).toBe(attempt<4?1:0); f.stop();
});
test('success after a transient failure clears the failure and cancels its queued reconnect',()=>{
  const f=fixture(); f.fail(); f.next([]);
  expect(f.state.failed).toBe(false); expect(f.state.messages).toEqual([]); expect(jest.getTimerCount()).toBe(0);
  jest.runOnlyPendingTimers(); expect(f.state.retry).toBe(0); f.stop();
});
test('a transient disconnect preserves loaded messages and exposes failure',()=>{
  const f=fixture(); f.next([{id:'visible'}]); f.fail();
  expect(f.state.messages).toEqual([{id:'visible'}]); expect(f.state.failed).toBe(true); f.stop();
});
test('disposed callbacks cannot replace the current conversation or schedule retries',()=>{
  const f=fixture(); f.stop(); f.next([{id:'old'}]); f.fail();
  expect(f.state.messages).toEqual([]); expect(f.state.failed).toBe(false); expect(jest.getTimerCount()).toBe(0); expect(f.unsub).toHaveBeenCalledTimes(1);
});
test('permission failure retains the access-denied distinction',()=>{
  const f=fixture(); f.fail(); f.fail('permission-denied');
  expect(f.state.denied).toBe(true); expect(f.state.failed).toBe(false); expect(jest.getTimerCount()).toBe(0); f.stop();
});
test('manual retry restarts the exhausted budget and always changes subscription generation',()=>{
  const f=fixture(4); f.retry(); expect(f.state.retry).toBe(0); expect(f.state.reload).toBe(1);
  f.retry(); expect(f.state.reload).toBe(2); f.stop();
});
