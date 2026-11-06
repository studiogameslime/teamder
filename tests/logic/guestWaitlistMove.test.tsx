import React from 'react';

// Execute the source screen and its guest rows. Native views and external I/O
// are adapters; controlled game state is shared exactly as in the players tab.
jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, jest.fn()],
  useRef: (initial: any) => ({ current: initial }),
  useEffect: jest.fn(), useCallback: (fn: any) => fn, useMemo: (fn: any) => fn(),
}));
jest.mock('react-native', () => ({
  Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: (value: any) => value, hairlineWidth: 1 },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({}), useRoute: () => ({ params: {} }), useFocusEffect: jest.fn() }));
jest.mock('@/theme', () => ({ colors: { primary: '#2563EB' }, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/hooks/useListMemory', () => ({ useRememberedScroll: () => ({ nearStart: true, scrollProps: {} }) }));
jest.mock('@/hooks/useListUpdates', () => ({ useListUpdates: (_scope: any, items: any) => ({ items, highlights: {}, pending: false }) }));
jest.mock('@/hooks/animations/useReducedMotion', () => ({ useReducedMotion: () => true }));
jest.mock('@/hooks/animations/useArrivalTracker', () => ({ useArrivalTracker: () => ({ arrivals: {}, observe: jest.fn() }) }));
jest.mock('@/components/anim/ArrivalMotion', () => ({ ArrivalMotion: 'ArrivalMotion' }));
jest.mock('@/components/anim/ChangeMotion', () => ({ ChangeMotion: 'ChangeMotion' }));
jest.mock('@/components/ListUpdateNotice', () => ({ ListUpdateNotice: 'ListUpdateNotice' }));
jest.mock('@/components/ScreenHeader', () => ({ ScreenHeader: 'ScreenHeader' }));
jest.mock('@/components/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/GuestModal', () => ({ GuestModal: 'GuestModal' }));
jest.mock('@/components/PlayerIdentity', () => ({ PlayerIdentity: 'PlayerIdentity' }));
jest.mock('@/components/SoccerBallLoader', () => ({ SoccerBallLoader: 'Loader' }));
jest.mock('@/components/community/CardCountBadges', () => ({ CardCountBadges: 'CardCountBadges' }));
jest.mock('@/components/match/PlayerActionMenu', () => ({ PlayerActionMenu: 'PlayerActionMenu' }));
jest.mock('@/components/AppDialog', () => ({ appAlert: jest.fn() }));
jest.mock('@/components/Toast', () => ({ toast: { info: jest.fn(), error: jest.fn() } }));
jest.mock('@/services/groupService', () => ({ groupService: {} }));
jest.mock('@/services/communityEventsService', () => ({ communityEventsService: {} }));
jest.mock('@/services/useGameEvents', () => ({ useGameEvents: jest.fn() }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/analyticsService', () => ({ logEvent: jest.fn(), AnalyticsEvent: { RosterReordered: 'reorder' } }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
const mockSave = jest.fn(), mockRead = jest.fn();
jest.mock('@/services/gameService', () => ({ gameService: {
  adminReorderGuests: (...args: any[]) => mockSave(...args), getGameById: (...args: any[]) => mockRead(...args),
} }));
let mockUser: any, mockGame: any;
const mockGroups = [{ id: 'club', adminIds: ['manager'], internalRating: true }];
const mockHydrate = jest.fn();
jest.mock('@/store/gameStore', () => ({ useGameStore: (select: any) => select({
  players: { manager: { id: 'manager', displayName: 'מנהל' }, member: { id: 'member', name: 'שחקן' } }, hydratePlayers: mockHydrate,
}) }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: (select: any) => select({ groups: mockGroups }) }));
jest.mock('@/store/userStore', () => ({ useUserStore: Object.assign((select: any) => select({ currentUser: mockUser }), {
  getState: () => ({ currentUser: mockUser }),
}) }));

import { MatchPlayersScreen } from '@/screens/games/MatchPlayersScreen';
import { activeGuestCount } from '@/types';
import { he } from '@/i18n/he';

const active = { id: 'active', name: 'אורח פעיל', addedBy: 'manager', createdAt: 1, estimatedRating: 4.5 };
const waiting = { id: 'waiting', name: 'אורח ממתין', addedBy: 'manager', createdAt: 2, waitlisted: true };
function nodes(tree: any): any[] {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree.type === 'function') return nodes(tree.type(tree.props));
  return [tree, ...nodes(React.Children.toArray(tree.props?.children))];
}
function draw(embedded = true) {
  return nodes(MatchPlayersScreen({ gameId: 'round', embedded, gameState: {
    game: mockGame, setGame: (next: any) => { mockGame = typeof next === 'function' ? next(mockGame) : next; },
  } }));
}
const demote = (tree = draw()) => tree.find(node => node.props.accessibilityLabel === `${he.playerMenuMoveToWaitlist}: ${active.name}`);
const flush = async () => { for (let index = 0; index < 16; index++) await Promise.resolve(); };

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { id: 'manager' };
  mockGame = { id: 'round', groupId: 'club', createdBy: 'manager', status: 'open', players: ['member'],
    waitlist: [], maxPlayers: 2, guests: [{ ...active }, { ...waiting }] };
  mockSave.mockReset().mockResolvedValue(undefined);
  mockRead.mockReset().mockImplementation(async () => mockGame);
});

test.each([true, false])('admin can move an active guest to the end of the waitlist (embedded=%s)', async embedded => {
  const original = mockGame;
  const tree = draw(embedded);
  expect(demote(tree)).toBeDefined();
  expect(demote(tree).props.accessibilityRole).toBe('button');
  demote(tree).props.onPress();
  await flush();
  expect(mockSave).toHaveBeenCalledWith('round', 'manager', [waiting, { ...active, waitlisted: true }]);
  expect(mockGame.players).toEqual(['member']);
  expect(mockGame.waitlist).toEqual([]);
  expect(activeGuestCount(mockGame.guests)).toBe(0);
  expect(mockGame.guests.filter((g: any) => g.waitlisted)).toHaveLength(2);
  expect(original.guests).toEqual([active, waiting]);
  expect(demote(draw(embedded))).toBeUndefined();
});

test('non-admin adder can still edit the guest but cannot move them to the waitlist', () => {
  mockGroups[0].adminIds = [];
  try {
    const tree = draw();
    expect(demote(tree)).toBeUndefined();
    expect(tree.some(node => node.type === 'Icon' && node.props.name === 'create-outline')).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
  } finally { mockGroups[0].adminIds = ['manager']; }
});

test.each(['finished', 'cancelled'])('does not offer demotion in a %s round', status => {
  mockGame.status = status;
  expect(demote()).toBeUndefined();
  expect(mockSave).not.toHaveBeenCalled();
});

test('failed save restores the authoritative roster rather than leaving a false waitlist placement', async () => {
  const original = mockGame;
  mockSave.mockRejectedValueOnce(new Error('save failed'));
  mockRead.mockResolvedValue(original);
  demote().props.onPress();
  expect(activeGuestCount(mockGame.guests)).toBe(0);
  await flush();
  expect(mockRead).toHaveBeenCalledWith('round');
  expect(mockGame).toBe(original);
  expect(activeGuestCount(mockGame.guests)).toBe(1);
  expect(demote()).toBeDefined();
});
