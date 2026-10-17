import React from 'react';

let mockDimensions = { width: 390, height: 844, fontScale: 1 };
let mockAvailableWidth: number | undefined;
jest.mock('react', () => ({ ...jest.requireActual('react'), useState: (initial: number) => [mockAvailableWidth ?? initial, (value: number) => { mockAvailableWidth = value; }] }));
jest.mock('react-native', () => ({ Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => mockDimensions, StyleSheet: { create: (value: unknown) => value } }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/components/match/TeamShirt', () => ({ TeamShirtIllustration: 'Shirt' }));
import { MatchPlayerPicker } from '@/components/match/MatchPlayerPicker';

function nodes(node: any): any[] { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
const people = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: i === 0 ? 'אלכסנדר בן יהודה לוי' : `שחקן ${i}`, isFiller: i === 1 }));
const props = (count = 5) => ({ players: people(count), onSelect: jest.fn(), color: '#22C55E', title: 'מי כבש?' });
const buttons = (tree: any) => nodes(tree).filter(node => node.type === 'Pressable');
beforeEach(() => { mockDimensions = { width: 390, height: 844, fontScale: 1 }; mockAvailableWidth = undefined; });

test.each([4, 7, 11])('%s players remain in source order when the scorer becomes unavailable as assister', count => {
  const input = props(count), before = buttons(MatchPlayerPicker(input));
  const after = buttons(MatchPlayerPicker({ ...input, title: 'מי בישל?', selectedId: 'p2', disabledIds: ['p2'] }));
  expect(before.map(node => node.key)).toEqual(after.map(node => node.key));
  expect(after.map(node => node.props.accessibilityLabel)).toEqual(input.players.map(player => player.name));
  expect(after[2].props.disabled).toBe(true);
  expect(after[2].props.accessibilityState).toEqual({ disabled: true, selected: true });
  expect(after.filter(node => node.props.disabled)).toHaveLength(1);
  expect(nodes(MatchPlayerPicker(input)).filter(node => node.type === 'Avatar')).toHaveLength(count);
});

test('one available player tap returns the exact selected identifier once', () => {
  const input = props(), choices = buttons(MatchPlayerPicker(input));
  choices[3].props.onPress();
  expect(input.onSelect).toHaveBeenCalledTimes(1);
  expect(input.onSelect).toHaveBeenCalledWith('p3');
});

test('a pending save disables the entire roster and exposes that state to accessibility', () => {
  const actions = buttons(MatchPlayerPicker({ ...props(11), disabled: true }));
  expect(actions).toHaveLength(11);
  actions.forEach(node => { expect(node.props.disabled).toBe(true); expect(node.props.accessibilityState.disabled).toBe(true); });
});

test.each([{ width: 320, fontScale: 1, expected: 68 }, { width: 390, fontScale: 1.6, expected: 114 }])('small and enlarged-text layouts preserve all players and widen cells', dimensions => {
  mockDimensions = { ...mockDimensions, ...dimensions };
  const actions = buttons(MatchPlayerPicker(props(11)));
  expect(actions).toHaveLength(11);
  actions.forEach(node => expect(node.props.style[1].width).toBe(dimensions.expected));
});

test('measured fractional width always fits five cells without a rounded extra wrap', () => {
  const input = props(11), initial = MatchPlayerPicker(input);
  initial.props.onLayout({ nativeEvent: { layout: { width: 362.6666667 } } });
  const actions = buttons(MatchPlayerPicker(input)), cellWidth = actions[0].props.style[1].width;
  expect(cellWidth).toBe(72);
  expect(cellWidth * 5).toBeLessThanOrEqual(362.6666667);
  initial.props.onLayout({ nativeEvent: { layout: { width: 331.5 } } });
  expect(buttons(MatchPlayerPicker(input))[0].props.style[1].width * 5).toBeLessThanOrEqual(331.5);
});

test('an empty roster explains the missing choice instead of exposing an action', () => {
  const tree = MatchPlayerPicker(props(0));
  expect(buttons(tree)).toHaveLength(0);
  expect(nodes(tree).some(node => node.type === 'Text' && node.props.children === 'אין שחקנים לבחירה בהרכב הזה')).toBe(true);
});
