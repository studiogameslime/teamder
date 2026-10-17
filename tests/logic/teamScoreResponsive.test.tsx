import React from 'react';

let mockDimensions = { width: 320, height: 569, fontScale: 1.4 };
jest.mock('react', () => ({
  ...jest.requireActual('react'), useEffect: () => {}, useRef: (value: unknown) => ({ current: value }),
}));
jest.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View', useWindowDimensions: () => mockDimensions,
  Animated: { Value: class { constructor(public value: number) {} }, View: 'AnimatedView' },
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/anim/ArrivalMotion', () => ({ ArrivalMotion: 'Arrival' }));
jest.mock('@/hooks/animations/useArrivalTracker', () => ({ useArrivalTracker: () => ({ arrivals: {}, observe: jest.fn() }) }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/match/PlayerActionMenu', () => ({ MeasurablePressable: 'MeasuredPressable' }));
jest.mock('@/components/match/TeamShirt', () => ({ TeamShirtIllustration: 'Shirt' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/i18n/he', () => ({ he: { rotationWinsLabel: 'ניצחונות', matchPlayersOpenSlot: 'מקום פנוי', rotationStreak: (wins: number) => `${wins} ניצחונות` } }));
jest.mock('@/components/match/rotationView', () => ({
  firstName: (name: string) => name.trim().split(/\s+/)[0],
  teamName: () => 'הירוקים', teamColor: () => '#22C55E', teamTextColor: () => '#15803D',
}));
import { TeamScore } from '@/components/match/TeamScore';

function expand(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(expand);
  if (typeof node.type === 'function') return expand(node.type(node.props));
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } };
}
function nodes(node: any, type?: string): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodes(child, type));
  return [...(!type || node.type === type ? [node] : []), ...nodes(node.props?.children, type)];
}
function flatten(style: any): any {
  if (typeof style === 'function') return flatten(style({ pressed: false }));
  return Object.assign({}, ...((Array.isArray(style) ? style : [style]).filter(Boolean)));
}
const people = (count: number) => Array.from({ length: count }, (_, index) => ({
  id: `player-${index}`, name: index === 0 ? 'אלכסנדר בן יהודה לוי' : index === 1 ? 'יוסי לוי' : index === 2 ? 'יוסי כהן' : `שחקן${index} שם משפחה`,
  avatarId: `face-${index}`, isFiller: index === 3,
}));
const props = (count = 7) => ({
  teamIdx: 1, roster: people(count), wins: 1, align: 'right' as const, variant: 'list' as const, compact: true,
  goalsByPlayer: { 'player-0': 2, 'player-3': 1 }, onPlayerPress: jest.fn(),
});
beforeEach(() => { mockDimensions = { width: 320, height: 569, fontScale: 1.4 }; });

test.each([4, 7, 11])('%s player rows retain every identity, avatar and goal when compact labels stack', count => {
  const input = props(count), tree = expand(TeamScore(input)), rows = nodes(tree, 'Pressable');
  expect(rows).toHaveLength(count);
  expect(rows.map(row => row.props.accessibilityLabel)).toEqual(input.roster.map(player => player.name));
  expect(nodes(tree, 'Avatar').map(avatar => avatar.props.user.id)).toEqual(input.roster.map(player => player.id));
  for (const row of rows) {
    expect(flatten(row.props.style).minHeight).toBeGreaterThanOrEqual(60);
    const name = nodes(row, 'Text').find(text => text.props.accessibilityLabel === row.props.accessibilityLabel);
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.adjustsFontSizeToFit).toBe(true);
    expect(name.props.maxFontSizeMultiplier).toBe(1.2);
    expect(flatten(name.props.style).width).toBe('100%');
    const details = nodes(row, 'View').find(view => flatten(view.props.style).flexDirection === 'column');
    expect(flatten(details.props.style)).toMatchObject({ flex: 1, minWidth: 0, alignItems: 'stretch' });
    const badge = nodes(details, 'View').find(view => flatten(view.props.style).height === 18);
    expect(flatten(badge.props.style)).toMatchObject({ flexDirection: 'row', minWidth: 0, paddingHorizontal: 0 });
    // Under forceRTL source order is right-to-left: count, then football.
    expect(badge.props.children[0].type).toBe('Text');
    expect(badge.props.children[1].type).toBe('Icon');
    expect(badge.props.children[1].props.name).toBe('football');
  }
  expect(rows.map(row => nodes(row, 'Text').find(text => typeof text.props.children === 'number').props.children))
    .toEqual(input.roster.map(player => input.goalsByPlayer[player.id as keyof typeof input.goalsByPlayer] ?? 0));
});

test.each([
  { width: 359, fontScale: 1, lines: 2 },
  { width: 360, fontScale: 1.2, lines: 1 },
  { width: 430, fontScale: 1.21, lines: 2 },
  { width: 430, fontScale: 1, lines: 1 },
])('width $width and font scale $fontScale select the correct layout without changing actions', dimensions => {
  mockDimensions = { ...mockDimensions, ...dimensions };
  const input = props(4), tree = expand(TeamScore(input));
  const rows = nodes(tree, 'Pressable');
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    const name = nodes(row, 'Text').find(text => text.props.accessibilityLabel === row.props.accessibilityLabel);
    expect(name.props.numberOfLines).toBe(dimensions.lines);
    expect(name.props.adjustsFontSizeToFit).toBe(dimensions.lines === 2);
  }
});

test('a whole-row tap selects the exact player once and anchors to the separately measured avatar', () => {
  const input = props(11), rows = nodes(expand(TeamScore(input)), 'Pressable'), row = rows[3];
  const face = nodes(row, 'View').find(view => view.props.collapsable === false);
  expect(nodes(face, 'Avatar')).toHaveLength(1);
  expect(nodes(face, 'Text')).toHaveLength(0);
  expect(flatten(face.props.style).flexShrink).toBe(0);
  const measure = jest.fn(callback => callback(247, 386, 36, 36));
  face.props.ref.current = { measureInWindow: measure };
  row.props.onPress();
  expect(measure).toHaveBeenCalledTimes(1);
  expect(input.onPlayerPress).toHaveBeenCalledTimes(1);
  expect(input.onPlayerPress).toHaveBeenCalledWith(input.roster[3], { x: 247, y: 386, width: 36, height: 36 });
});

test('an unmounted avatar cannot open a player menu with an invented anchor', () => {
  const input = props(), row = nodes(expand(TeamScore(input)), 'Pressable')[0];
  row.props.onPress();
  expect(input.onPlayerPress).not.toHaveBeenCalled();
});

test('conflicting first names remain distinguishable and full names are available for accessibility', () => {
  const tree = expand(TeamScore(props(4))), rows = nodes(tree, 'Pressable');
  const labels = rows.map(row => nodes(row, 'Text').find(text => text.props.accessibilityLabel === row.props.accessibilityLabel));
  expect(labels.map(label => label.props.children)).toEqual(['אלכסנדר', 'יוסי ל׳', 'יוסי כ׳', 'שחקן3']);
  expect(labels.map(label => label.props.accessibilityLabel)).toEqual(people(4).map(player => player.name));
});

test('open-slot selection remains a separate move action without replacing any roster row', () => {
  const input = props(4), move = jest.fn();
  const tree = expand(TeamScore({ ...input, swapMode: true, swapSourceId: 'player-0', openSlots: 2, onOpenSlotPress: move }));
  expect(nodes(tree, 'Pressable')).toHaveLength(4);
  const slots = nodes(tree, 'MeasuredPressable');
  expect(slots).toHaveLength(2);
  slots[1].props.onMeasured({ x: 0, y: 0, width: 36, height: 36 });
  expect(move).toHaveBeenCalledTimes(1);
  expect(input.onPlayerPress).not.toHaveBeenCalled();
});

test('read-only rows and the grid keep all players without introducing selection controls', () => {
  const input = props(7);
  for (const variant of ['list', 'grid'] as const) {
    const tree = expand(TeamScore({ ...input, variant, onPlayerPress: undefined }));
    expect(nodes(tree, 'Avatar')).toHaveLength(7);
    expect(nodes(tree, 'Pressable')).toHaveLength(0);
  }
});
