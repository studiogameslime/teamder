import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';
import { ratingSeries } from '../../src/utils/managerDashboard';

const moduleFixture = { exports: {} as any };
const code = ts.transpileModule(fs.readFileSync('src/components/manager/ManagerRatingFilters.tsx', 'utf8'), {
  fileName: 'ManagerRatingFilters.tsx',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const dependencies: Record<string, any> = {
  react: { default: React },
  'react-native': { Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: (value: any) => value } },
  '@expo/vector-icons': { Ionicons: 'Icon' }, '@/theme': { RTL_LABEL_ALIGN: 'left' },
};
vm.runInNewContext(code, { module: moduleFixture, exports: moduleFixture.exports, require: (name: string) => dependencies[name] });
const { ManagerRatingFilters, availableManagerRatingFilter } = moduleFixture.exports;
const nodes = (tree: any): any[] => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children))];
const text = (tree: any) => nodes(tree).filter(node => node.type === 'Text').map(node => React.Children.toArray(node.props.children).join('')).join(' ');
const draw = (props = {}) => ManagerRatingFilters({ filter: 'all', complete: false, count: 0, up: 0, down: 0, onSelect() {}, ...props });

test('pending score filters never claim zero players or zero recommendations', () => {
  const tree = draw();
  expect(text(tree)).toBe('הכול העלאה הורדה');
  expect(text(tree)).not.toContain('(0)');
  expect(nodes(tree).filter(node => node.type === 'Pressable' && node.props.disabled)).toHaveLength(2);
});

test('partial scores show only the explicitly available player count and keep the available list selected', () => {
  const preview = JSON.parse(fs.readFileSync('tests/fixtures/manager-dashboard-preview.json', 'utf8'));
  const data = preview.partialData;
  const series = ratingSeries(data.group, data.games, data.scores);
  expect(series.length).toBe(3);
  const tree = draw({ filter: 'up', count: series.length });
  expect(text(tree)).toBe('זמינים (3) העלאה הורדה');
  expect(text(tree)).not.toContain('(0)');
  expect(availableManagerRatingFilter('up', false)).toBe('all');
  const selected = nodes(tree).filter(node => node.type === 'Pressable' && node.props.accessibilityState.selected);
  expect(selected).toHaveLength(1);
  expect(text(selected[0])).toBe('זמינים (3)');
});

test('a completed empty read can show measured zeroes and reenable recommendation filters', () => {
  const tree = draw({ complete: true });
  expect(text(tree)).toBe('הכול (0) העלאה (0) הורדה (0)');
  expect(nodes(tree).filter(node => node.type === 'Pressable' && node.props.disabled)).toHaveLength(0);
});

test('a completed history restores the selected recommendation filter and its measured count', () => {
  const tree = draw({ filter: 'down', complete: true, count: 7, up: 2, down: 1 });
  expect(text(tree)).toBe('הכול (7) העלאה (2) הורדה (1)');
  const selected = nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityState.selected);
  expect(text(selected)).toBe('הורדה (1)');
});
