import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file = ts.createSourceFile('compare.tsx', fs.readFileSync('src/screens/players/PlayerCompareScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect!: ts.Expression;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(file) === 'useEffect' && node.arguments[0].getText(file).includes('pairCompareService.load')) effect = node.arguments[0];
  ts.forEachChild(node, visit);
}
visit(file);
const code = ts.transpileModule(`globalThis.start = ${effect.getText(file)}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const account = { id: 'viewer', isGuest: false };
  const context: any = { viewerId: 'viewer', otherUid: 'target', groupId: 'club', seasonsLoaded: true, seasons: { enabled: true }, pastSeasons: [], scope: { k: 'current' },
    comparisonVisits: { current: new Map() }, pairCompareService: { load: jest.fn().mockResolvedValue({ a: {}, b: {} }) },
    comparisonActivityService: { record: jest.fn().mockResolvedValue(undefined) }, randomUUID: jest.fn(() => 'unique-visit-00001'),
    useUserStore: { getState: () => ({ currentUser: account }) }, observeCaughtError: jest.fn(), isStaleSession: () => false,
    setModel: jest.fn(), setLoading: jest.fn(), setScope: jest.fn() };
  vm.runInNewContext(code, context);
  return { context, account, start: () => context.start() };
}

test('loaded comparison records exactly once across refresh, scope and tab reloads', async () => {
  const f = fixture(); f.start(); await flush();
  expect(f.context.comparisonActivityService.record).toHaveBeenCalledWith({ expectedUid: 'viewer', targetId: 'target', groupId: 'club', visitId: 'unique-visit-00001', scope: { k: 'current' } });
  f.context.scope = { k: 'all' }; f.start(); await flush(); f.start(); await flush();
  expect(f.context.comparisonActivityService.record).toHaveBeenCalledTimes(1);
});

test('a failed receipt can retry the same id without blocking visible comparison data', async () => {
  const f = fixture(); f.context.comparisonActivityService.record.mockRejectedValueOnce(new Error('offline'));
  f.start(); await flush();
  expect(f.context.setModel).toHaveBeenCalled(); expect(f.context.observeCaughtError).toHaveBeenCalled();
  f.start(); await flush();
  expect(f.context.comparisonActivityService.record).toHaveBeenCalledTimes(2);
  expect(f.context.comparisonActivityService.record.mock.calls[0][0].visitId).toBe(f.context.comparisonActivityService.record.mock.calls[1][0].visitId);
});

test.each(['failed comparison', 'late load', 'account change', 'guest', 'self'])('%s never creates an activity receipt', async scenario => {
  const f = fixture();
  if (scenario === 'failed comparison') f.context.pairCompareService.load.mockResolvedValue(null);
  if (scenario === 'account change') f.account.id = 'other';
  if (scenario === 'guest') f.account.isGuest = true;
  if (scenario === 'self') f.context.otherUid = 'viewer';
  const stop = f.start(); if (scenario === 'late load') stop(); await flush();
  expect(f.context.comparisonActivityService.record).not.toHaveBeenCalled();
});
