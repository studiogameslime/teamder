import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

const ast = ts.createSourceFile('MatchDetails.tsx', fs.readFileSync('src/screens/games/MatchDetailsScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let callback = '';
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('initialTabApplied.current')) callback = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
function world() {
  const context: any = { game: { id: 'one' }, route: { params: { gameId: 'one', initialTab: 'players' } }, initialTabApplied: { current: null }, dataTabsLocked: false, showTab: jest.fn() };
  return { context, apply: vm.runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) };
}
test('a reused screen applies the requested destination for the new game, only after that game loads', () => {
  const { context: c, apply } = world(); apply(); expect(c.showTab).toHaveBeenLastCalledWith('players');
  c.route.params = { gameId: 'two', initialTab: 'stats' }; apply(); expect(c.showTab).toHaveBeenCalledTimes(1);
  c.game = { id: 'two' }; apply(); expect(c.showTab).toHaveBeenLastCalledWith('stats'); expect(c.showTab).toHaveBeenCalledTimes(2);
});
test('ordinary game updates do not undo the tab chosen by the viewer', () => {
  const { context: c, apply } = world(); apply(); c.game = { id: 'one', updatedAt: 2 }; apply(); expect(c.showTab).toHaveBeenCalledTimes(1);
});
test('a newly requested tab on the same game is honored, while a locked statistics destination opens information', () => {
  const { context: c, apply } = world(); apply(); c.route.params.initialTab = 'stats'; c.dataTabsLocked = true; apply(); expect(c.showTab).toHaveBeenLastCalledWith('info');
  c.route.params.initialTab = 'players'; apply(); expect(c.showTab).toHaveBeenLastCalledWith('players');
});
