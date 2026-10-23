import React from 'react';
let mockStates: any[] = [], mockIndex = 0;
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: (value: unknown) => { const i = mockIndex++; if (!(i in mockStates)) mockStates[i] = value; return [mockStates[i], (v: unknown) => { mockStates[i] = v; }]; } }));
jest.mock('react-native', () => ({ Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (x: unknown) => x } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/InfoTip', () => ({ InfoTip: 'InfoTip' }));
jest.mock('@/components/summary/SeasonSummaryIcon', () => ({ SeasonSummaryIcon: 'SummaryIcon' }));
jest.mock('@/components/SeasonTitleEmblem', () => ({ SeasonTitleEmblem: 'Emblem' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/chemistry/ChemistrySection', () => ({ ChemistrySection: 'Chemistry' }));
jest.mock('@/services/roundSummaryService', () => ({ roundSummaryService: {} }));
jest.mock('@/theme', () => ({ colors: { primary: '#26F', text: '#123', textMuted: '#666', surface: '#fff' }, RTL_LABEL_ALIGN: 'left' }));
import { SeasonAwardRows } from '@/components/summary/SeasonClubSummary';
function nodes(element: any): any[] { return !element || typeof element !== 'object' ? [] : [element, ...React.Children.toArray(element.props?.children).flatMap(nodes)]; }
beforeEach(() => { mockStates = []; mockIndex = 0; });
test('shared category exposes all five identities by long press and closes with the button', () => {
  const winners = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, name: 'שם משותף' }));
  const props = { awards: [{ key: 'deadlyDuo' as const, names: ['צמד ראשון', 'צמד שני', 'צמד שלישי'], winners, pairs: [[winners[0],winners[1]], [winners[0],winners[2]], [winners[3],winners[4]]], value: 5, mine: false }], all: true };
  const render = () => { mockIndex = 0; return nodes(SeasonAwardRows(props)); };
  let tree = render();
  expect(tree.find(n => n.type === 'Pressable' && n.props.disabled === false)?.props.accessibilityLabel).toContain('5 שחקנים');
  const category = tree.find(n => n.type === 'Pressable' && n.props.disabled === false)!;
  expect(tree.filter(n => n.type === 'Pressable' && n.props.onLongPress)).toHaveLength(9);
  expect(tree.find(n => n.type === 'Modal')!.props.visible).toBe(false);
  category.props.onLongPress(); tree = render();
  expect(tree.find(n => n.type === 'Modal')!.props.visible).toBe(true);
  expect(nodes(tree.find(n => n.type === 'Modal')).filter(n => n.type === 'Avatar').map(n => n.props.user.id)).toEqual(['a','b','a','c','d','e']);
  expect(nodes(tree.find(n => n.type === 'Modal')).filter(n => n.type === 'Text').map(n=>n.props.children).join(' ')).toContain('צמד 3');
  tree.find(n => n.props.accessibilityLabel === 'סגירה')!.props.onPress();
  expect(render().find(n => n.type === 'Modal')!.props.visible).toBe(false);
});



test('active MVP stays hidden even if a provisional winner is supplied', () => {
  const tree = nodes(SeasonAwardRows({ awards: [{ key: 'mvp', names: ['שם שצריך להישאר חסוי'], value: 9.23, mine: false }], all: true, provisional: true }));
  const text = tree.filter(n => n.type === 'Text').map(n => n.props.children).join(' ');
  expect(text).toContain('יתגלה בסיום העונה');
  expect(text).not.toContain('שם שצריך להישאר חסוי');
  expect(text).not.toContain('9.23');
});

test('shared MVP shows the genuine sample for each individual winner', () => {
  const awards = [{ key: 'mvp' as const, names: ['א', 'ב'], value: 8.03, mine: false,
    winners: [{ id: 'a', name: 'א', coverage: { rated: 10, of: 10 } }, { id: 'b', name: 'ב', coverage: { rated: 6, of: 10 } }] }];
  const render = () => { mockIndex = 0; return nodes(SeasonAwardRows({ awards, all: true })); };
  let tree = render();
  tree.find(n => n.type === 'Pressable' && n.props.disabled === false)!.props.onLongPress();
  tree = render();
  const text = tree.filter(n => n.type === 'Text').map(n => n.props.children).join(' ');
  expect(text).toContain('10 מתוך 10');
  expect(text).toContain('6 מתוך 10');
});


test('club leader uses the resolved avatar beside the title while unpublished MVP has no face', () => {
  const a = { key: 'topScorer' as const, names: ['דני'], winners: [{id: 'a', name: 'דני'}], value: 19, mine: false };
  const tree = nodes(SeasonAwardRows({ awards: [a], people: {a: {id: 'a', name: 'דני', avatarId: 'a03', photoUrl: 'https://example.test/avatar.png'}}, all: true, provisional: true }));
  const row = tree.find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('מלך השערים:'));
  const content=React.Children.toArray(row.props.children) as any[];
  expect(nodes(content[0]).some(n=>n.type==='Avatar')).toBe(true);
  expect(nodes(content[1]).some(n=>n.type==='Avatar')).toBe(false);
  expect(nodes(row).find(n => n.type === 'Avatar')?.props.user).toMatchObject({id: 'a', avatarId: 'a03', photoUrl: 'https://example.test/avatar.png'});
  const mvp = tree.find(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('השחקן המצטיין:'));
  expect(nodes(mvp).filter(n => n.type === 'Avatar')).toHaveLength(0);
});
