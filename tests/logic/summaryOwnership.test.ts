import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function declaration(file: string, name: string) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) initializer = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!initializer) throw Error(`Missing ${name}`);
  return (context: Record<string, unknown>) => vm.runInNewContext(ts.transpileModule(`(${initializer!.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}

test('club switch hides previous successful data before reset effect runs, even after old request failure', () => {
  const owns = declaration('src/screens/communities/CommunityStatsScreen.tsx', 'ownsClubData');
  const loading = declaration('src/screens/communities/CommunityStatsScreen.tsx', 'bootLoading');
  const failure = declaration('src/screens/communities/CommunityStatsScreen.tsx', 'blockingFailure');
  for (const loadFailed of [false, true]) {
    const context = { loadedGroup: { current: 'old-club' }, groupId: 'new-club', loading: false, champ: { points: 30 }, loadFailed, archiveFailed: true, scope: { k: 'all' }, slice: null, openedOnAllTime: true, allTime: null, ownsClubData: false };
    context.ownsClubData = owns(context);
    expect(context.ownsClubData).toBe(false);
    expect(loading(context)).toBe(true);
    expect(failure(context)).toBe(false);
  }
  expect(owns({ loadedGroup: { current: 'new-club' }, groupId: 'new-club' })).toBe(true);
});

test('summary ownership changes for either a new evening or a different player before effects run', () => {
  const owner = declaration('src/screens/games/EveningSummaryScreen.tsx', 'summaryOwner');
  const owns = declaration('src/screens/games/EveningSummaryScreen.tsx', 'ownsSummary');
  const loadedOwner = { current: owner({ gameId: 'g1', currentUser: { id: 'u1' } }) };
  for (const [gameId, id, expected] of [['g1', 'u1', true], ['g2', 'u1', false], ['g1', 'u2', false], ['g1', undefined, false]] as const) {
    const summaryOwner = owner({ gameId, currentUser: id ? { id } : null });
    expect(owns({ loadedOwner, summaryOwner })).toBe(expected);
  }
});
