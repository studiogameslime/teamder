import React from 'react';
import { SocialPlayerProfile } from '@/components/social/SocialPlayerProfile';
import { SocialAction } from '@/components/social/SocialUI';
import type { SocialProfile } from '@/types/social';

let mockWindow = { width: 390, fontScale: 1 };
jest.mock('react', () => ({
  ...jest.requireActual('react'), useState: (initial: unknown) => [initial, jest.fn()],
  useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
}));
jest.mock('react-native', () => ({
  View: 'View', Text: 'Text', ScrollView: 'ScrollView', Pressable: 'Pressable', ImageBackground: 'ImageBackground',
  StyleSheet: { create: (styles: unknown) => styles }, useWindowDimensions: () => mockWindow,
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeArea' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}), useFocusEffect: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: 'Gradient' }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/store/userStore', () => ({ useUserStore: () => null }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: () => [] }));
jest.mock('@/components/ScreenHeader', () => ({ ScreenHeader: 'Header' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/DraggableMenuSheet', () => ({ DraggableMenuSheet: 'Sheet' }));
jest.mock('@/components/loading/CentralSkeletons', () => ({ PlayerCardSkeleton: 'Skeleton' }));
jest.mock('@/components/profile/FriendActionButton', () => ({ FriendActionButton: 'FriendAction' }));
jest.mock('@/components/AppDialog', () => ({}));
jest.mock('@/components/Toast', () => ({}));
jest.mock('@/services/socialPlayersService', () => ({}));
jest.mock('@/services/friendsService', () => ({}));
jest.mock('@/services/notificationsService', () => ({}));
jest.mock('@/services/gameService', () => ({}));
jest.mock('@/services/chatService', () => ({}));
jest.mock('@/navigation/navigationRef', () => ({}));
jest.mock('@/utils/errorObservation', () => ({}));
jest.mock('@/data/coverImages', () => ({ getCoverSource: () => undefined }));
jest.mock('@/assets/images/synthetic-pitch.png', () => 1);

const preview: SocialProfile = {
  player: { id: 'player', name: 'אבינועם', city: 'פתח תקווה', friend: false, commonClubCount: 1, sharedRounds: 1 },
  clubs: [{ id: 'club', name: 'כדורגל לאבות עייפים', isCommon: true, isOpen: false }],
  canSeeStatistics: false, statistics: null, together: null,
};
type Element = React.ReactElement<any>;
function children(node: Element): Element[] {
  return React.Children.toArray(node.props.children).filter(React.isValidElement) as Element[];
}
function nodes(node: Element): Element[] { return [node, ...children(node).flatMap(nodes)]; }
const style = (node: Element, key = 'style') => Object.assign({}, ...[node.props[key]].flat().filter(Boolean));
function draw(width: number, fontScale: number) {
  mockWindow = { width, fontScale };
  const tree = nodes(SocialPlayerProfile({ userId: 'player', preview }));
  const club = tree.find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.includes(preview.clubs[0].name))!;
  const cover = children(club).find(node => node.type === 'ImageBackground')!;
  return { tree, club, cover, badge: children(cover)[0] };
}

test('the reported city and closed status have room to wrap at twice the system font size', () => {
  const { tree, club, cover, badge } = draw(320, 2);
  const city = tree.find(node => node.type === 'Text' && node.props.accessibilityLabel === 'פתח תקווה')!;
  expect(React.Children.toArray(city.props.children)[0]).toBe('פתח תקווה');
  expect(style(city)).toMatchObject({ alignSelf: 'stretch', textAlign: 'center' });
  const label = children(badge)[0];
  const name = children(club).find(node => node.type === 'Text')!;
  expect(label.props.children).toBe('סגור');
  expect(club.props.accessibilityLabel).toContain('סגור');
  expect(name.props.children).toBe(preview.clubs[0].name);
  for (const node of [city, label, name]) {
    expect(node.props.numberOfLines).toBeUndefined();
    expect(node.props.allowFontScaling).not.toBe(false);
    expect(style(node).height).toBeUndefined();
  }
  expect(style(cover).minHeight).toBeGreaterThan(0);
  expect(style(cover).height).toBeUndefined();
  expect(style(badge).width).toBeGreaterThan(style(draw(390, 1).badge).width);
});

test.each([[390, 1, false], [320, 2, true]] as const)('at width %s and scale %s the club and both action slots respond to available space', (width, scale, stacked) => {
  const { tree, club } = draw(width, scale);
  expect(style(club).width === '100%').toBe(stacked);
  if (!stacked) expect(parseFloat(style(club).maxWidth)).toBeLessThanOrEqual(50);
  const row = tree.find(node => children(node).some(slot =>
    children(slot).some(action => action.type === SocialAction && action.props.title === 'שלח הזמנה')))!;
  expect(style(row)).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap' });
  const slots = children(row);
  expect(slots.map(slot => children(slot)[0].props.title)).toEqual(['שלח הודעה', 'שלח הזמנה']);
  const scroll = tree.find(node => node.type === 'ScrollView')!;
  const available = width - 2 * style(scroll, 'contentContainerStyle').padding;
  const required = slots.reduce((sum, slot) => sum + style(slot).flexBasis, style(row).gap);
  expect(required > available).toBe(stacked);
});
