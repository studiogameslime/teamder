import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

test('every menu destination remains registered after regrouping, with unique destinations', () => {
  const menu = ts.createSourceFile('menu.tsx', fs.readFileSync('pulse/src/components/AppMenu.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const destinations: { route: string; screen?: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isObjectLiteralExpression(node)) {
      const strings = Object.fromEntries(node.properties.filter(ts.isPropertyAssignment)
        .filter(p => ts.isStringLiteral(p.initializer))
        .map(p => [p.name.getText(menu), (p.initializer as ts.StringLiteral).text]));
      if (strings.route) destinations.push({ route: strings.route, screen: strings.screen });
    }
    ts.forEachChild(node, visit);
  }; visit(menu);
  const navigation = fs.readFileSync('pulse/src/navigation/RootTabs.tsx', 'utf8');
  const registered = [...navigation.matchAll(/name[:=]\s*(?:'([^']+)'|"([^"]+)")/g)].map(m => m[1] ?? m[2]);
  expect(destinations.length).toBeGreaterThan(0);
  expect(new Set(destinations.map(d => `${d.route}/${d.screen ?? ''}`)).size).toBe(destinations.length);
  expect(new Set(registered).size).toBe(registered.length);
  for (const { route, screen } of destinations) {
    expect(registered).toContain(route);
    if (!screen) continue;
    const component = navigation.match(new RegExp(`<Tab.Screen\\s+name="${route}"\\s+component=\\{(\\w+)\\}`))?.[1]
      ?? navigation.match(new RegExp(`name: '${route}'[^\\n]*component: (\\w+)`))?.[1];
    expect(component).toBeDefined();
    const module = navigation.match(new RegExp(`import \\{ ${component} \\} from '([^']+)'`))?.[1];
    expect(module).toBeDefined();
    const stack = fs.readFileSync(path.resolve('pulse/src/navigation', `${module}.tsx`), 'utf8');
    const children = [...stack.matchAll(/<Stack.Screen\s+name=['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(children).toContain(screen);
  }
  expect(navigation).toContain('<Tab.Screen name="Users" component={UsersStack}');
});
