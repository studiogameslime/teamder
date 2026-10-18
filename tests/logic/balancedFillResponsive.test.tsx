import React from 'react';

let mockDimensions = { width: 320, height: 569, fontScale: 1.4 };
let mockSlots: any[] = [], mockIndex = 0, mockEffects: Array<() => void> = [];
jest.mock('react', () => ({ ...jest.requireActual('react'),
  useState: (initial: any) => {
    const index = mockIndex++;
    if (!mockSlots[index]) mockSlots[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [mockSlots[index].value, (next: any) => { mockSlots[index].value = typeof next === 'function' ? next(mockSlots[index].value) : next; }];
  },
  useEffect: (effect: any, deps: any[]) => {
    const index = mockIndex++, previous = mockSlots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) mockEffects.push(effect);
    mockSlots[index] = { deps };
  },
}));
jest.mock('react-native', () => ({ View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: (v: any) => v }, useWindowDimensions: () => mockDimensions }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/SafeModal', () => ({ SafeModal: 'Modal' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/match/TeamShirt', () => ({ TeamShirtIllustration: 'Shirt' }));
jest.mock('@/components/anim/ArrivalMotion', () => ({ ArrivalMotion: 'Arrival' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/theme/overlays', () => ({ overlayTheme: { backdrop: '#0008' } }));

import { BalancedFillModal, type BalancedFillRequest } from '@/components/match/BalancedFillModal';

const player = (id: string, name = id) => ({ id, name, homeLabel: 'הירוקים' });
function request(size = 11, sequential = true): BalancedFillRequest {
  return { capacity: size, sides: [
    { index: 0, label: 'האדומים', color: '#EF4444', playerIds: Array.from({ length: sequential ? size : size - 1 }, (_, i) => `a${i}`), members: Array.from({ length: sequential ? size : size - 1 }, (_, i) => player(`a${i}`, `הרכב אדום ${i}`)) },
    { index: 1, label: 'הכחולים', color: '#3B82F6', playerIds: Array.from({ length: size - 1 }, (_, i) => `b${i}`), members: Array.from({ length: size - 1 }, (_, i) => player(`b${i}`, `הרכב כחול ${i}`)) },
  ], players: Array.from({ length: size }, (_, i) => player(`donor${i}`, i === size - 1 ? 'אלכסנדר אורח אחרון' : `מועמד ${i}`)),
  ratings: {}, usage: {}, savedResult: 'התוצאה נשמרה: 1–1', editableSide: sequential ? 1 : undefined,
    showUsage: true, showComparison: true, fillMode: 'temporary', keepClock: false };
}
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(React.Children.toArray(node.props?.children))];
const copy = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : node && typeof node === 'object' ? copy(React.Children.toArray(node.props?.children)) : '';
const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style ?? {};
const testNode = (tree: any, id: string) => nodes(tree).find(node => node.props.testID === id);
const candidates = (tree: any) => nodes(testNode(tree, 'balanced-fill-candidates')).filter(node => node.props.accessibilityRole === 'checkbox');
const confirm = (tree: any) => nodes(testNode(tree, 'balanced-fill-footer')).find(node => node.type === 'Pressable' && copy(node).startsWith('אישור'));
const tick = () => { const pending = mockEffects; mockEffects = []; pending.forEach(effect => effect()); };
const render = (props: any): any => { mockIndex = 0; return BalancedFillModal(props); };
const layout = (node: any, height: number) => node.props.onLayout({ nativeEvent: { layout: { height } } });

beforeEach(() => { mockSlots = []; mockIndex = 0; mockEffects = []; mockDimensions = { width: 320, height: 569, fontScale: 1.4 }; });

test.each([4, 7, 11])('the measured small viewport bounds a %i-player sheet and reserves independent scrolling above its fixed actions', size => {
  const props = { request: request(size), onConfirm: jest.fn(), onCancel: jest.fn() };
  let tree = render(props); tick(); tree = render(props);
  expect(flat(testNode(tree, 'balanced-fill-roster-frame').props.style).height).toBe(114);
  const backdrop = React.Children.toArray(tree.props.children)[0] as any;
  layout(backdrop, 520); layout(testNode(tree, 'balanced-fill-body'), 280); tree = render(props);
  const sheet = (React.Children.toArray((React.Children.toArray(tree.props.children)[0] as any).props.children)[0] as any);
  expect(flat(sheet.props.style).height).toBe(508);
  const body = testNode(tree, 'balanced-fill-body'), footer = testNode(tree, 'balanced-fill-footer');
  expect(flat(body.props.style)).toMatchObject({ flexBasis: 0, flexGrow: 1, flexShrink: 1, minHeight: 0 });
  expect(flat(footer.props.style).flexShrink).toBe(0);
  expect(nodes(body)).not.toContain(footer);
  const roster = testNode(tree, 'balanced-fill-rosters'), picker = testNode(tree, 'balanced-fill-candidates');
  const rosterFrame = testNode(tree, 'balanced-fill-roster-frame');
  expect(rosterFrame.props.collapsable).toBe(false);
  expect(flat(rosterFrame.props.style)).toMatchObject({ height: 114, flexGrow: 0, flexShrink: 0 });
  expect(flat(roster.props.style)).toMatchObject({ flex: 1 });
  expect(flat(rosterFrame.props.style).flexBasis).toBeUndefined();
  expect(flat(picker.props.style)).toMatchObject({ flexBasis: 0, flexGrow: 1 });
  expect(flat(roster.props.style).maxHeight).toBeUndefined(); expect(flat(picker.props.style).maxHeight).toBeUndefined();
  expect(roster.type).toBe('ScrollView'); expect(picker.type).toBe('ScrollView');
  expect(candidates(tree)).toHaveLength(size); expect(copy(candidates(tree).at(-1))).toContain('אלכסנדר אורח אחרון');
  const rosterUsers = nodes(roster).filter(node => typeof node.type === 'function' && node.type.name === 'RosterMember');
  expect(nodes(roster).filter(node => node.type === 'Shirt').map(node => [node.props.color, node.props.width])).toEqual([['#EF4444', 20], ['#3B82F6', 20]]);
  expect(rosterUsers.map(node => node.props.player.id)).toEqual([...props.request.sides[0].playerIds, ...props.request.sides[1].playerIds]);
  expect(confirm(tree).props.disabled).toBe(true);
  expect(copy(footer)).toContain('אחר כך');
  expect(nodes(body).some(node => node.type === 'Text' && copy(node).includes('חזרה כשהמקור'))).toBe(true);
});

test('last-candidate selection survives layout, font and visibility changes, and only the existing confirm completes', () => {
  const props = { request: request(), onConfirm: jest.fn(), onCancel: jest.fn(), visible: true };
  render(props); tick(); let tree = render(props);
  candidates(tree).at(-1)!.props.onPress(); tree = render(props);
  expect(props.onConfirm).not.toHaveBeenCalled(); expect(confirm(tree).props.disabled).toBe(false);
  expect(candidates(tree).at(-1)!.props.accessibilityState.checked).toBe(true);
  layout(testNode(tree, 'balanced-fill-body'), 190);
  mockDimensions = { width: 411, height: 868, fontScale: 1 };
  render({ ...props, visible: false }); tree = render(props); tick(); tree = render(props);
  expect(candidates(tree).at(-1)!.props.accessibilityState.checked).toBe(true);
  expect(confirm(tree).props.disabled).toBe(false); confirm(tree).props.onPress();
  expect(props.onConfirm).toHaveBeenCalledTimes(1); expect(props.onConfirm).toHaveBeenCalledWith([[], ['donor10']]);
});

test('single missing-slot replacement and details do not lose a sequential selection', () => {
  const props = { request: request(), onConfirm: jest.fn(), onCancel: jest.fn() };
  render(props); tick(); let tree = render(props); candidates(tree)[0].props.onPress(); tree = render(props);
  candidates(tree).at(-1)!.props.onPress(); tree = render(props);
  expect(candidates(tree)[0].props.accessibilityState.checked).toBe(false);
  expect(candidates(tree).at(-1)!.props.accessibilityState.checked).toBe(true);
  nodes(tree).find(node => node.props.accessibilityLabel === 'הצגת פירוט').props.onPress(); tree = render(props);
  expect(copy(testNode(tree, 'balanced-fill-candidates'))).toContain('משחקים שהסתיימו');
  expect(confirm(tree).props.disabled).toBe(false); confirm(tree).props.onPress();
  expect(props.onConfirm).toHaveBeenCalledWith([[], ['donor10']]);
});

test('shared two-side selection keeps automatic side advance and prevents selecting the same donor twice', () => {
  const props = { request: request(4, false), onConfirm: jest.fn(), onCancel: jest.fn() };
  render(props); tick(); let tree = render(props); candidates(tree)[0].props.onPress(); tree = render(props);
  expect(copy(testNode(tree, 'balanced-fill-candidates'))).toContain('משלימים לקבוצת הכחולים');
  expect(candidates(tree)[0].props.disabled).toBe(true);
  candidates(tree)[1].props.onPress(); tree = render(props);
  expect(confirm(tree).props.disabled).toBe(false); confirm(tree).props.onPress();
  expect(props.onConfirm).toHaveBeenCalledWith([['donor0'], ['donor1']]);
});

test('complete rosters receive all remaining body space, and both close routes remain unchanged', () => {
  const full = request(4); full.sides[1].playerIds.push('b3'); full.sides[1].members.push(player('b3')); full.players = [];
  const props = { request: full, onConfirm: jest.fn(), onCancel: jest.fn() };
  render(props); tick(); const tree = render(props);
  expect(testNode(tree, 'balanced-fill-candidates')).toBeUndefined();
  expect(flat(testNode(tree, 'balanced-fill-roster-frame').props.style).flexGrow).toBe(1);
  expect(confirm(tree).props.disabled).toBe(false);
  nodes(tree).find(node => node.props.accessibilityLabel === 'סגירה').props.onPress();
  nodes(testNode(tree, 'balanced-fill-footer')).find(node => node.type === 'Pressable' && copy(node) === 'אחר כך').props.onPress();
  expect(props.onCancel).toHaveBeenCalledTimes(2); expect(props.onConfirm).not.toHaveBeenCalled();
});
