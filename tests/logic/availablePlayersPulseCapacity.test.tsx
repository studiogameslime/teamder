import React from 'react';

// Retain hook state and execute the real screen. Native views are adapters;
// these tests verify capacity changes/actions, not Android layout or delivery.
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, effects: Array<() => void> = [];
  const same = (a?: any[], b?: any[]) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { cursor = 0; },
      flush: () => { const pending = effects; effects = []; pending.forEach(effect => effect()); },
      reset: () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; cursor = 0; effects = []; },
    },
    useState: (initial: any) => {
      const index = cursor++;
      const slot = slots[index] ?? (slots[index] = { value: typeof initial === 'function' ? initial() : initial });
      return [slot.value, (next: any) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
    },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }); },
    useMemo: (factory: () => any, deps: any[]) => {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps };
      return slots[index].value;
    },
    useEffect: (effect: () => any, deps?: any[]) => {
      const index = cursor++;
      if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index], next: any = { deps };
      slots[index] = next;
      effects.push(() => { previous?.cleanup?.(); next.cleanup = effect(); });
    },
  };
});
jest.mock('react-native', () => ({
  FlatList: 'FlatList', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
  StyleSheet: { create: (value: unknown) => value },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeAreaView' }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('react-native-svg', () => ({ __esModule: true, default: 'Svg', Rect: 'Rect', Circle: 'Circle', Line: 'Line' }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false }));
jest.mock('@/utils/format', () => ({ formatDayDate: () => 'מחר', formatTime: () => '20:00' }));
jest.mock('@/components/SoccerBallLoader', () => ({ SoccerBallLoader: 'Loader' }));
jest.mock('@/components/ScreenHeader', () => ({ ScreenHeader: 'Header' }));
jest.mock('@/components/PlayerIdentity', () => ({ PlayerIdentity: 'Identity' }));
jest.mock('@/components/Button', () => ({ Button: 'Button' }));
const mockAlert = jest.fn(), mockPage = jest.fn(), mockGetGame = jest.fn(), mockStartPulse = jest.fn(), mockInvite = jest.fn();
let mockLive: (data: { game?: any; liveMatch: null }) => void;
const mockStop = jest.fn();
jest.mock('@/components/AppDialog', () => ({ appAlert: (...args: any[]) => mockAlert(...args) }));
jest.mock('@/services', () => ({ userService: { findAvailablePlayersPage: (...args: any[]) => mockPage(...args) } }));
jest.mock('@/services/gameService', () => ({ gameService: {
  getGameById: (...args: any[]) => mockGetGame(...args),
  startFillerPulse: (...args: any[]) => mockStartPulse(...args),
  subscribeLiveGame: (_id: string, callback: typeof mockLive) => { mockLive = callback; return mockStop; },
} }));
jest.mock('@/services/notificationsService', () => ({ notificationsService: { inviteToGame: (...args: any[]) => mockInvite(...args) } }));
jest.mock('@/services/errorLog', () => ({ logError: jest.fn() }));
jest.mock('@/services/analyticsService', () => ({ logEvent: jest.fn(), AnalyticsEvent: {} }));
jest.mock('@/utils/errorObservation', () => ({ observeCaughtError: jest.fn() }));
const mockToast = { info: jest.fn(), success: jest.fn(), error: jest.fn() };
jest.mock('@/components/Toast', () => ({ toast: mockToast }));
const mockUser = { id: 'manager' }, mockGroups: any[] = [];
jest.mock('@/store/userStore', () => ({ useUserStore: (selector: any) => selector({ currentUser: mockUser }) }));
jest.mock('@/store/groupStore', () => ({ useGroupStore: (selector: any) => selector({ groups: mockGroups }) }));
jest.mock('@/theme', () => ({ colors: {}, spacing: {}, typography: {}, RTL_LABEL_ALIGN: 'left' }));
const mockParams = { gameId: 'round' };
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: mockParams }), useNavigation: () => ({ navigate: jest.fn() }) }));

import { availablePlayersPulseAvailability, AvailablePlayersScreen } from '@/screens/games/AvailablePlayersScreen';
import { occupancyOf } from '../../functions/src/fillerRules';
import { he } from '@/i18n/he';

const runtime = (require('react') as any).__runtime;
const nodes = (tree: any): any[] => tree == null || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(React.Children.toArray(tree.props?.children)), ...nodes(tree.props?.ListHeaderComponent), ...nodes(tree.props?.ListFooterComponent), ...nodes(tree.props?.ListEmptyComponent)];
const text = (tree: any): string => tree == null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? [text(tree.props?.children), text(tree.props?.ListHeaderComponent), text(tree.props?.ListFooterComponent)].join(' ') : '';
const button = (tree: any, title: string = he.sendPulseCta) => nodes(tree).find(node => node.type === 'Button' && node.props.title === title);
const baseGame = (players = 8, extra: Record<string, any> = {}) => ({ id: 'round', title: 'מחזור לדוגמה', startsAt: 1, maxPlayers: 10, players: Array.from({ length: players }, (_, index) => String(index)), guests: [], ...extra });
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function draw() { runtime.begin(); const tree = AvailablePlayersScreen(); runtime.flush(); return tree; }
async function loaded(game: any) { mockGetGame.mockResolvedValue(game); draw(); await flush(); return draw(); }
const update = (game: any) => mockLive({ game, liveMatch: null });
const confirmation = () => mockAlert.mock.calls[mockAlert.mock.calls.length - 1][2][1].onPress;
function deferred() {
  let resolve!: (value: any) => void, reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  runtime.reset(); jest.clearAllMocks();
  mockParams.gameId = 'round';
  mockGetGame.mockReset();
  (globalThis as any).__DEV__ = false;
  mockPage.mockResolvedValue({ players: [{ id: 'candidate', name: 'שחקן זמין' }], cursor: null });
  mockStartPulse.mockReset().mockResolvedValue({ started: true });
});
afterEach(() => { runtime.reset(); });

test('game and candidate reads start together while candidate publication waits for the confirmed game', async () => {
  const game = deferred(), page = deferred();
  mockGetGame.mockReturnValue(game.promise); mockPage.mockReturnValue(page.promise);
  draw();
  expect(mockGetGame).toHaveBeenCalledWith('round'); expect(mockPage).toHaveBeenCalledWith('round');
  page.resolve({ players: [{ id: 'early', name: 'שחקן' }], cursor: null }); await flush();
  expect(nodes(draw()).find(node => node.type === 'FlatList')).toBeUndefined();
  game.resolve(baseGame()); await flush();
  expect(nodes(draw()).find(node => node.type === 'FlatList').props.data).toEqual([{ id: 'early', name: 'שחקן' }]);
});

test('a missing game never publishes an independently resolved candidate page', async () => {
  mockGetGame.mockResolvedValue(null);
  mockPage.mockResolvedValue({ players: [{ id: 'hidden', name: 'שחקן' }], cursor: null });
  draw(); await flush();
  expect(nodes(draw()).find(node => node.type === 'FlatList')).toBeUndefined();
});

test.each([
  ['registered roster', baseGame(10), 0, 'roster-full'],
  ['active guest', baseGame(9, { guests: [{ id: 'guest' }] }), 0, 'roster-full'],
  ['reserved promotion', baseGame(8, { guests: [{ id: 'guest' }], pendingPromotion: { uid: 'offered' } }), 0, 'roster-full'],
  ['server-only waitlisted guest', baseGame(8, { guests: [{ id: 'guest' }, { id: 'waiting', waitlisted: true }] }), 1, 'pulse-full'],
  ['available slot', baseGame(8, { guests: [{ id: 'guest' }] }), 1, null],
  ['uncapped roster', baseGame(10, { maxPlayers: 0 }), null, null],
])('pulse gate preserves roster capacity for %s', (_name, game, free, blocked) => {
  expect(availablePlayersPulseAvailability(game as any)).toEqual({ free, blocked });
});

test('server occupancy excludes waiting guests while the existing client pulse gate stays conservative', () => {
  const reservation = baseGame(8, { guests: [{ id: 'guest' }], pendingPromotion: { uid: 'offered' } });
  const waitingGuest = baseGame(8, { guests: [{ id: 'guest' }, { id: 'waiting', waitlisted: true }] });
  expect(occupancyOf(reservation)).toBe(9);
  expect(availablePlayersPulseAvailability(reservation).blocked).toBe('roster-full');
  expect(occupancyOf(waitingGuest)).toBe(9);
  expect(availablePlayersPulseAvailability(waitingGuest)).toEqual({ free: 1, blocked: 'pulse-full' });
});

test('a full roster disables only pulses and explains that manual waitlist invitations remain available', async () => {
  const tree = await loaded(baseGame(10));
  expect(button(tree).props.disabled).toBe(true);
  expect(text(tree)).toContain('אפשר להזמין שחקנים ידנית לרשימת ההמתנה');
  button(tree).props.onPress();
  expect(mockAlert).not.toHaveBeenCalled();
  expect(mockStartPulse).not.toHaveBeenCalled();
  const list = nodes(tree).find(node => node.type === 'FlatList');
  const candidate = list.props.renderItem({ item: { id: 'candidate', name: 'שחקן זמין' } });
  expect(button(candidate, 'שלח הזמנה').props.disabled).toBe(false);
  expect(mockInvite).not.toHaveBeenCalled();
});

test('server-only capacity blocking keeps the displayed free slot and uses the distinct explanation', async () => {
  const tree = await loaded(baseGame(8, { guests: [{ id: 'guest' }, { id: 'waiting', waitlisted: true }] }));
  expect(button(tree).props.disabled).toBe(true);
  expect(text(tree)).toContain('1 מקומות פנויים בהרכב');
  expect(text(tree)).toContain('הזמנה בפעימות אינה זמינה כרגע');
  expect(text(tree)).not.toContain('ההרכב מלא.');
});

test('a live capacity change blocks the old button before render and reopens when a place is available', async () => {
  const initial = await loaded(baseGame(9));
  expect(button(initial).props.disabled).toBe(false);
  update(baseGame(10));
  button(initial).props.onPress();
  expect(mockAlert).not.toHaveBeenCalled();
  expect(button(draw()).props.disabled).toBe(true);
  update(baseGame(9));
  const reopened = draw();
  expect(button(reopened).props.disabled).toBe(false);
  expect(text(reopened)).toContain('1 מקומות פנויים בהרכב');
  expect(mockPage).toHaveBeenCalledTimes(1);
  expect(mockStartPulse).not.toHaveBeenCalled();
});

test.each([
  ['reservation', baseGame(8, { guests: [{ id: 'guest' }], pendingPromotion: { uid: 'offered' } })],
  ['waitlisted guest', baseGame(8, { guests: [{ id: 'guest' }, { id: 'waiting', waitlisted: true }] })],
])('an already open confirmation rechecks %s before any pulse starts', async (_name, changed) => {
  const tree = await loaded(baseGame(9));
  button(tree).props.onPress();
  const confirm = confirmation();
  update(changed);
  await confirm();
  expect(mockStartPulse).not.toHaveBeenCalled();
  expect(mockToast.info).toHaveBeenCalledTimes(1);
});

test('confirmation locks immediately and a stale confirmation cannot resend after success', async () => {
  const request = deferred(); mockStartPulse.mockReturnValue(request.promise);
  const tree = await loaded(baseGame(9)); button(tree).props.onPress();
  const confirm = confirmation(), first = confirm();
  await confirm();
  expect(mockStartPulse).toHaveBeenCalledTimes(1);
  request.resolve({ started: true }); await first;
  await confirm();
  expect(mockStartPulse).toHaveBeenCalledTimes(1);
  expect(button(draw(), he.sendPulseSentBtn).props.disabled).toBe(true);
});

test('the server remains authoritative when it reports full after the last client update', async () => {
  mockStartPulse.mockResolvedValue({ started: false, reason: 'GAME_FULL' });
  const tree = await loaded(baseGame(9)); button(tree).props.onPress();
  await confirmation()();
  expect(mockToast.error).toHaveBeenCalledWith(he.sendPulseFull);
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(button(draw()).props.disabled).toBe(false);
});

test('a failed pulse remains retryable and does not claim it was sent', async () => {
  mockStartPulse.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ started: true });
  const tree = await loaded(baseGame(9)); button(tree).props.onPress();
  const confirm = confirmation();
  await confirm();
  expect(mockToast.error).toHaveBeenCalledWith(he.sendPulseError);
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(button(draw()).props.disabled).toBe(false);
  await confirm();
  expect(mockStartPulse).toHaveBeenCalledTimes(2);
  expect(button(draw(), he.sendPulseSentBtn).props.disabled).toBe(true);
});

test('a rejected request from another round does not show its error in the current round', async () => {
  const oldRequest = deferred(); mockStartPulse.mockReturnValueOnce(oldRequest.promise);
  const first = await loaded(baseGame(9)); button(first).props.onPress();
  const pending = confirmation()();
  mockParams.gameId = 'next-round';
  await loaded(baseGame(9, { id: 'next-round' }));
  oldRequest.reject(new Error('old round offline'));
  await pending;
  expect(mockToast.error).not.toHaveBeenCalled();
  expect(mockToast.success).not.toHaveBeenCalled();
});

test('a successful pulse in the previous round does not mark the new round as sent', async () => {
  const first = await loaded(baseGame(9)); button(first).props.onPress();
  await confirmation()();
  expect(button(draw(), he.sendPulseSentBtn)).toBeDefined();
  mockParams.gameId = 'next-round';
  const next = await loaded(baseGame(9, { id: 'next-round' }));
  expect(button(next)).toBeDefined();
  expect(button(next).props.disabled).toBe(false);
  expect(button(next, he.sendPulseSentBtn)).toBeUndefined();
});

test.each(['reject', 'resolve'] as const)('a previous round %s cannot unlock a new round request or keep it busy', async completion => {
  const oldRequest = deferred(), nextRequest = deferred();
  mockStartPulse.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(nextRequest.promise);
  const first = await loaded(baseGame(9)); button(first).props.onPress();
  const oldPending = confirmation()();
  mockParams.gameId = 'next-round';
  const next = await loaded(baseGame(9, { id: 'next-round' }));
  expect(button(next).props.disabled).toBe(false);
  button(next).props.onPress();
  const confirmNext = confirmation(), nextPending = confirmNext();
  expect(mockStartPulse).toHaveBeenCalledTimes(2);
  if (completion === 'reject') oldRequest.reject(new Error('old round offline'));
  else oldRequest.resolve({ started: true });
  await oldPending;
  expect(mockToast.error).not.toHaveBeenCalled();
  expect(mockToast.success).not.toHaveBeenCalled();
  expect(button(draw()).props.loading).toBe(true);
  await confirmNext();
  expect(mockStartPulse).toHaveBeenCalledTimes(2);
  nextRequest.resolve({ started: true }); await nextPending;
  expect(button(draw(), he.sendPulseSentBtn).props.disabled).toBe(true);
});

test('returning to the same round does not revive a confirmation from its earlier context', async () => {
  const first = await loaded(baseGame(9)); button(first).props.onPress();
  const oldConfirm = confirmation();
  mockParams.gameId = 'next-round';
  await loaded(baseGame(9, { id: 'next-round' }));
  mockParams.gameId = 'round';
  const returned = await loaded(baseGame(9));
  await oldConfirm();
  expect(mockStartPulse).not.toHaveBeenCalled();
  button(returned).props.onPress();
  await confirmation()();
  expect(mockStartPulse).toHaveBeenCalledTimes(1);
});
