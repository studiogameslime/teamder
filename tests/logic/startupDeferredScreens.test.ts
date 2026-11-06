import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

const stacks = ['ProfileStack', 'GameStack', 'CommunitiesStack', 'ChatStack', 'AuthStack', 'EntryStack'];

function loadStack(name: string, isGuest = false, sourceOverride?: string) {
  const evaluated: string[] = [];
  const cache = new Map<string, any>();
  const exported: any = {};
  const stack = { Navigator: 'Navigator', Screen: 'Screen' };
  const source = sourceOverride ?? fs.readFileSync(`src/navigation/${name}.tsx`, 'utf8');
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText, {
    exports: exported,
    require: (id: string) => {
      if (id === 'react') return React;
      if (id === '@react-navigation/native-stack') return { createNativeStackNavigator: () => stack };
      if (id === '@/hooks/useAuthenticatedAction') return { useIsGuest: () => isGuest };
      if (id === '@/navigation/homeRouting') return { homeRouteFor: (guest: boolean) => guest ? 'GuestHome' : 'Profile' };
      if (id.startsWith('@/screens/')) {
        if (!cache.has(id)) {
          evaluated.push(id);
          const screenSource = fs.readFileSync(`src/${id.slice(2)}.tsx`, 'utf8');
          const tree = ts.createSourceFile(id, screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
          const moduleExports: any = {};
          for (const node of tree.statements) {
            if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
              for (const specifier of node.exportClause.elements) moduleExports[specifier.name.text] = () => null;
            }
            if (!ts.canHaveModifiers(node) || !ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
            if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
              if (node.name) moduleExports[node.name.text] = () => null;
            } else if (ts.isVariableStatement(node)) {
              for (const declaration of node.declarationList.declarations) moduleExports[declaration.name.getText(tree)] = () => null;
            }
          }
          cache.set(id, moduleExports);
        }
        return cache.get(id);
      }
      throw new Error(`Unexpected stack dependency ${id}`);
    },
  });
  const tree = exported[name]({ initialRoute: 'SignIn' });
  const screens = React.Children.toArray(tree.props.children).filter(React.isValidElement) as React.ReactElement<any>[];
  return { evaluated, screens, tree };
}

test.each(stacks)('%s registers all routes without evaluating any screen, then evaluates only the requested target', name => {
  const fixture = loadStack(name);
  expect(fixture.evaluated).toEqual([]);
  expect(fixture.screens.length).toBeGreaterThan(1);
  const selected = fixture.screens.find(screen => screen.props.name === 'MatchDetails') ?? fixture.screens[0];
  const first = selected.props.getComponent();
  expect(typeof first).toBe('function');
  expect(fixture.evaluated).toHaveLength(1);
  expect(selected.props.getComponent()).toBe(first);
  expect(fixture.evaluated).toHaveLength(1);
});

test.each(stacks)('%s resolves every route to an existing exported screen', name => {
  const fixture = loadStack(name);
  for (const screen of fixture.screens) expect(typeof screen.props.getComponent()).toBe('function');
  expect(new Set(fixture.screens.map(screen => screen.props.name)).size).toBe(fixture.screens.length);
});

test.each([false, true])('home root preserves the actual guest decision: %s', isGuest => {
  expect(loadStack('ProfileStack', isGuest).tree.props.initialRouteName).toBe(isGuest ? 'GuestHome' : 'Profile');
});

test('shared routes remain registered in all four tab stacks', () => {
  const required = ['MatchDetails', 'EveningSummary', 'MyActivity', 'Achievements', 'PlayerCard', 'CommunityDetails', 'EmailAuth'];
  for (const name of stacks.slice(0, 4)) {
    expect(loadStack(name).screens.map(screen => screen.props.name)).toEqual(expect.arrayContaining(required));
  }
});
