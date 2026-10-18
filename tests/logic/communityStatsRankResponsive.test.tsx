import React from 'react';

let mockSlots: any[] = [], mockIndex = 0, mockPending: Array<() => void> = [];
const mockNavigate = jest.fn();
jest.mock('react', () => ({ ...jest.requireActual('react'),
  useState: (initial: any) => {
    const index = mockIndex++;
    if (!mockSlots[index]) mockSlots[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [mockSlots[index].value, (next: any) => { mockSlots[index].value = typeof next === 'function' ? next(mockSlots[index].value) : next; }];
  },
  useMemo: (calculate: () => unknown) => { mockIndex++; return calculate(); },
  useEffect: (effect: any, deps: any[]) => {
    const index = mockIndex++, previous = mockSlots[index];
    if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) mockPending.push(effect);
    mockSlots[index] = { deps };
  },
}));
jest.mock('react-native', () => ({ Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: (value: any) => value, hairlineWidth: 1 } }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@/components/Card', () => ({ Card: 'Card' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/anim/ChangeMotion', () => ({ ReorderMotion: 'Reorder' }));
jest.mock('@/services', () => ({ userService: { getUserById: jest.fn().mockResolvedValue(null) }, gameService: { getGameChampionship: jest.fn() } }));
jest.mock('@/services/gameEveningScores', () => ({ getGameEveningScores: jest.fn().mockResolvedValue({}) }));
jest.mock('@/theme', () => ({ RTL_LABEL_ALIGN: 'left', clubAccent: { blue: '#2563EB', red: '#DC2626' }, clubSurface: {}, colors: {}, spacing: { xs: 4, sm: 8, md: 12 }, typography: { body: {}, caption: {} } }));

import { CommunityStatsTable } from '@/components/community/CommunityStatsTable';
import { GameChampionship } from '@/components/match/GameChampionship';
import { gameService, userService } from '@/services';
import { getGameEveningScores } from '@/services/gameEveningScores';
import { he } from '@/i18n/he';

const row = (index: number) => ({ uid: `guest:g${index}`, wins: 40 - index, goals: index, assists: 1, rounds: 42, games: 2, ties: 0, losses: 2, cleanSheets: 0, penTaken: 0, penScored: 0, penFaced: 0, penSaved: 0, ownGoals: 0 });
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(React.Children.toArray(node.props?.children))];
const copy = (node: any): string => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(copy).join(' ') : node && typeof node === 'object' ? copy(React.Children.toArray(node.props?.children)) : '';
const flat = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flat)) : style ?? {};
const ranks = (tree: any) => nodes(tree).filter(node => node.type === 'Text' && flat(node.props.style).width === 24 && flat(node.props.style).fontVariant?.includes('tabular-nums'));
const rows = (tree: any) => nodes(tree).filter(node => node.type === 'Pressable' && Array.isArray(node.props.style) && flat(node.props.style).height === 56);
const render = (props: any): any => { mockIndex = 0; return CommunityStatsTable(props); };
const effects = async () => { const pending = mockPending; mockPending = []; pending.forEach(effect => effect()); for (let index = 0; index < 5; index++) await Promise.resolve(); };

beforeEach(() => { mockSlots = []; mockIndex = 0; mockPending = []; jest.clearAllMocks(); });

test.each(['cumulative', 'efficiency'])('two-digit %s ranks retain complete single-line values and aligned space for all thirty-three participants', async mode => {
  const players = Array.from({ length: 33 }, (_, index) => row(index)).reverse();
  const props = { players, mode, limit: 33, guestNames: Object.fromEntries(players.map(player => [player.uid, `אורח ${player.uid}`])) };
  const before = JSON.stringify(players); render(props); await effects(); const tree = render(props);
  const rankNodes = ranks(tree); expect(rankNodes.map(copy)).toEqual(Array.from({ length: 33 }, (_, index) => String(index + 1)));
  for (const node of rankNodes) {
    expect(node.props).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.75 });
    expect(flat(node.props.style)).toMatchObject({ width: 24, flexShrink: 0 });
  }
  const header = nodes(tree).find(node => node.type === 'Text' && copy(node) === '#');
  expect(flat(header.props.style).width).toBe(24); expect(header.props.numberOfLines).toBe(1);
  expect(rows(tree)).toHaveLength(33); expect(JSON.stringify(players)).toBe(before);
  expect(userService.getUserById).not.toHaveBeenCalled();
});

test('sorting still reorders player identities by the selected statistic without changing row values, guest behavior or rank numbering', async () => {
  const players = Array.from({ length: 12 }, (_, index) => row(index)).reverse();
  const guestNames = Object.fromEntries(players.map(player => [player.uid, `שחקן ${player.uid}`]));
  const props = { players, guestNames }; const before = JSON.stringify(players);
  render(props); await effects(); let tree = render(props);
  expect(rows(tree)[0].props.accessibilityLabel).toBe('שחקן guest:g0');
  const goalHeader = nodes(tree).find(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === he.champColGoals);
  goalHeader.props.onPress(); tree = render(props);
  expect(rows(tree).map(node => node.props.accessibilityLabel)).toEqual(Array.from({ length: 12 }, (_, index) => `שחקן guest:g${11 - index}`));
  expect(ranks(tree).map(copy)).toEqual(Array.from({ length: 12 }, (_, index) => String(index + 1)));
  rows(tree)[0].props.onPress(); expect(mockNavigate).not.toHaveBeenCalled();
  expect(JSON.stringify(players)).toBe(before); expect(userService.getUserById).not.toHaveBeenCalled();
});

test('the evening wrapper exposes all thirty-three recorded participants, including the last zero-stat guest, through the actual table', async () => {
  const players = Array.from({ length: 33 }, (_, index) => row(index));
  players[0] = { ...players[0], uid: 'qa' };
  players[32] = { ...players[32], wins: 0, goals: 0, assists: 0, rounds: 0, games: 0, losses: 0 };
  const guests = players.slice(1).map(player => ({ id: player.uid.slice('guest:'.length), name: player.uid === 'guest:g32' ? 'עידן ללא שערים' : `אורח ${player.uid}`, addedBy: 'qa', createdAt: 1 }));
  const attendedUids = players.map(player => player.uid), before = JSON.stringify(players);
  (gameService.getGameChampionship as jest.Mock).mockResolvedValueOnce({ players });
  (getGameEveningScores as jest.Mock).mockResolvedValueOnce({ qa: 9 });
  const wrapperProps = { gameId: 'eleven-test', attendedUids, guests };
  mockIndex = 0; expect(GameChampionship(wrapperProps)).toBeNull(); await effects();
  mockIndex = 0; const wrapper = GameChampionship(wrapperProps);
  const table = nodes(wrapper).find(node => node.type === CommunityStatsTable);
  expect(table.props.limit).toBe(33); expect(table.props.players).toBe(players);
  expect(gameService.getGameChampionship).toHaveBeenCalledWith('eleven-test', attendedUids);
  // Start the child with its own hook lifetime; preserve the actual props the
  // wrapper returned rather than rebuilding or increasing the limit in the test.
  mockSlots = []; mockPending = [];
  (userService.getUserById as jest.Mock).mockResolvedValueOnce({ id: 'qa', name: 'מנהל בדיקה' });
  render(table.props); await effects(); const tree = render(table.props);
  expect(rows(tree)).toHaveLength(33); expect(ranks(tree).map(copy)).toEqual(Array.from({ length: 33 }, (_, index) => String(index + 1)));
  expect(rows(tree).map(node => node.props.accessibilityLabel)).toEqual(['מנהל בדיקה', ...guests.map(guest => guest.name)]);
  expect(rows(tree).at(-1)!.props.accessibilityLabel).toBe('עידן ללא שערים');
  const grids = nodes(tree).filter(node => node.type === 'Reorder' && flat(node.props.style).height === 56);
  const lastValues = nodes(grids.at(-1)).filter(node => node.type === 'Text').map(copy);
  expect(lastValues.length).toBeGreaterThan(3); expect(lastValues.every(value => value === '0' || value === '—')).toBe(true);
  expect(JSON.stringify(players)).toBe(before);
});
