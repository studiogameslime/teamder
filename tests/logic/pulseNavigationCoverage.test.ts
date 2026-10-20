import fs from 'node:fs';
import ts from 'typescript';

test('every menu destination remains registered after regrouping, with unique route names', () => {
  const menu = ts.createSourceFile('menu.tsx', fs.readFileSync('pulse/src/components/AppMenu.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && node.name.getText(menu) === 'route' && ts.isStringLiteral(node.initializer)) routes.push(node.initializer.text);
    ts.forEachChild(node, visit);
  }; visit(menu);
  const navigation = fs.readFileSync('pulse/src/navigation/RootTabs.tsx', 'utf8');
  const registered = [...navigation.matchAll(/name[:=]\s*(?:'([^']+)'|"([^"]+)")/g)].map(m => m[1] ?? m[2]);
  expect(new Set(routes).size).toBe(routes.length);
  expect(new Set(registered).size).toBe(registered.length);
  for (const route of routes) expect(registered).toContain(route);
  expect(navigation).toContain('<Tab.Screen name="Users" component={UsersStack}');
});
