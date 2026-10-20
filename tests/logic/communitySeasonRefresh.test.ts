import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { readConsistentSeasonSnapshot, withSeasonReadTimeout } from '@/utils/seasonReadConsistency';

// Execute the real loading effect and its real dependencies in a hook harness.
// This covers the kept-mounted tab; snapshot consistency is tested separately.
function screen() {
  const source = fs.readFileSync('src/screens/communities/CommunityStatsScreen.tsx', 'utf8');
  const parsed = ts.createSourceFile('screen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'CommunityStatsScreen') as ts.FunctionDeclaration;
  const statement = component.body!.statements.find(n => ts.isExpressionStatement(n) &&
    ts.isCallExpression(n.expression) && n.expression.expression.getText(parsed) === 'useEffect' &&
    n.getText(parsed).includes('readConsistentSeasonSnapshot')) as ts.ExpressionStatement;
  const effect = statement.expression as ts.CallExpression;
  const groupService = { get: jest.fn().mockResolvedValue(null) };
  const context: any = { visible: true, props: { seasonRevision: 's1', seasonBusy: false }, groupId: 'club',
    reloadTick: 0, loadedGroup: { current: 'club' }, groupService, readConsistentSeasonSnapshot, withSeasonReadTimeout,
    logError: jest.fn(), console };
  for (const name of source.match(/\bset[A-Z]\w+/g) ?? []) context[name] = jest.fn();
  const code = ts.transpileModule(`globalThis.effect = ${effect.arguments[0].getText(parsed)};`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.createContext(context); vm.runInContext(code, context);
  let previous: unknown[] | undefined, cleanup: (() => void) | undefined;
  const render = async () => {
    const deps = vm.runInContext(effect.arguments[1].getText(parsed), context) as unknown[];
    if (!previous || deps.some((value, i) => !Object.is(value, previous![i]))) {
      cleanup?.(); cleanup = context.effect(); previous = deps;
    }
    await new Promise(resolve => setImmediate(resolve));
  };
  return { context, groupService, render };
}

test('returning to the kept-mounted tab reloads, but an unrelated render does not', async () => {
  const { context, groupService, render } = screen();
  await render(); await render(); expect(groupService.get).toHaveBeenCalledTimes(1);
  context.visible = false; await render(); expect(groupService.get).toHaveBeenCalledTimes(1);
  context.visible = true; await render(); expect(groupService.get).toHaveBeenCalledTimes(2);
});

test('a new season reloads both sources and an unfinished operation waits without reading partial counters', async () => {
  const { context, groupService, render } = screen();
  await render();
  context.props = { seasonRevision: 's1:operation', seasonBusy: true }; await render();
  expect(groupService.get).toHaveBeenCalledTimes(1);
  expect(context.setChamp).toHaveBeenCalledWith(null);
  context.props = { seasonRevision: 's2', seasonBusy: false }; await render();
  expect(groupService.get).toHaveBeenCalledTimes(2);
});
