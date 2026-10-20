import React from 'react';
jest.mock('react-native', () => ({ View: 'View' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Circle: 'Circle', G: 'G', Path: 'Path', Polygon: 'Polygon', Rect: 'Rect' }));
jest.mock('@/theme', () => ({ colors: { primary: '#2563EB' } }));
import { SeasonTitleEmblem } from '@/components/SeasonTitleEmblem';
import { SEASON_TITLE_KEYS } from '@/utils/seasonAwards';
import { seasonTitleTint } from '@/utils/seasonTitleIcon';

function expand(element: any): any {
  if (Array.isArray(element)) return element.map(expand);
  if (!element || typeof element !== 'object') return element;
  if (typeof element.type === 'function') return expand(element.type(element.props));
  return { type: element.type === React.Fragment ? 'Fragment' : element.type, props: { ...element.props, children: React.Children.toArray(element.props.children).map(expand) } };
}
function all(element: any): any[] { return element && typeof element === 'object' ? [element, ...element.props.children.flatMap(all)] : []; }

test('all nine title keys have distinct vector symbols and stable distinct accents', () => {
  const symbols = SEASON_TITLE_KEYS.map(titleKey => {
    const tree = expand(SeasonTitleEmblem({ titleKey }));
    const symbol = all(tree).find(n => n.type === 'G' && n.props.transform === 'translate(25 32) scale(.78)');
    expect(symbol).toBeDefined(); expect(symbol.props.children.length).toBeGreaterThan(0);
    return JSON.stringify(symbol);
  });
  expect(new Set(symbols).size).toBe(9);
  expect(new Set(SEASON_TITLE_KEYS.map(seasonTitleTint)).size).toBe(9);
});

test('an unawarded title stays muted without hiding its symbol or implying another identity', () => {
  const tree = expand(SeasonTitleEmblem({ titleKey: 'topScorer', muted: true, size: 38 }));
  expect(tree.props.style).toMatchObject({ width: 38, height: 38, flexShrink: 0 });
  expect(JSON.stringify(tree)).toContain('#8B99AE');
  expect(JSON.stringify(tree)).not.toContain(seasonTitleTint('topScorer'));
  expect(all(tree).some(n => n.type === 'Circle')).toBe(true);
});

test('decorative emblems do not repeat nearby title labels, standalone use has an accessible image label', () => {
  expect(SeasonTitleEmblem({ titleKey: 'mvp' }).props.importantForAccessibility).toBe('no-hide-descendants');
  const standalone = SeasonTitleEmblem({ titleKey: 'mvp', size: 30, accessibilityLabel: 'מלך העונה' });
  expect(standalone.props).toMatchObject({ accessible: true, accessibilityRole: 'image', accessibilityLabel: 'מלך העונה' });
});
