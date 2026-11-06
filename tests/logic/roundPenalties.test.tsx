import React from 'react';
let mockViewer: string | undefined = 'viewer';
let mockFocused = true;
jest.mock('react', () => {
  let slots: any[] = [], cursor = 0, pending: (() => void)[] = [];
  const same = (a: any[], b: any[]) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    ...jest.requireActual('react'),
    __runtime: {
      begin: () => { cursor = 0; },
      effects: () => { const work = pending; pending = []; work.forEach(fn => fn()); },
      reset: () => { slots.forEach(s => s?.cleanup?.()); slots = []; cursor = 0; pending = []; },
    },
    useState: (value: any) => {
      const index = cursor++;
      slots[index] ??= { value: typeof value === 'function' ? value() : value };
      return [slots[index].value, (next: any) => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }];
    },
    useCallback: (fn: any, deps: any[]) => { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
    useEffect: (effect: any, deps: any[]) => {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.deps, deps)) {
        const slot: any = { deps }; slots[index] = slot;
        pending.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
      }
    },
  };
});
jest.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View', ActivityIndicator: 'Spinner', StyleSheet: { create: (x: any) => x } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
jest.mock('@/components/UserAvatar', () => ({ UserAvatar: 'Avatar' }));
jest.mock('@/components/community/ClubStatsDashboard', () => ({ clubStatsPalette: { ink: '#123', teal: '#246', muted: '#678', border: '#DDD' } }));
jest.mock('@/components/match/tabs/MatchTabShell', () => ({ TabSectionTitle: 'SectionTitle' }));
jest.mock('@/theme', () => ({ colors: { primary: '#246', textMuted: '#678', surface: '#FFF', border: '#DDD' }, RTL_LABEL_ALIGN: 'left' }));
jest.mock('@/services', () => ({ gameService: { getRoundHistory: jest.fn() } }));
jest.mock('@/store/userStore', () => ({ useUserStore: Object.assign((select: any) => select({ currentUser: mockViewer ? { id: mockViewer } : null }), { getState: () => ({ currentUser: mockViewer ? { id: mockViewer } : null }) }) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: any) => require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]) }));

import { eveningPenaltyAttempts, eveningPenaltyPlayers } from '@/utils/roundPenalties';
import type { RoundHistoryDoc } from '@/utils/eveningStats';
import { RoundPenaltiesCard } from '@/components/match/RoundPenaltiesCard';
import { RoundPenaltiesSection } from '@/components/match/RoundPenaltiesSection';
import { gameService } from '@/services';
const runtime = (React as any).__runtime;
const read = gameService.getRoundHistory as jest.Mock;
const round = (id: string, extra: Partial<RoundHistoryDoc> = {}): RoundHistoryDoc => ({ roundId: id, at: Number(id), teamA: ['a'], teamB: ['b'], scoreA: 0, scoreB: 0, winnerSide: 'tie', goals: [], ...extra });
const history = [round('2', { penalties: [
  { kickerId: 'a', keeperId: 'keeper', scored: true, team: 'A' },
  { kickerId: 'guest:one', keeperId: 'keeper', scored: false, outcome: 'save', team: 'A' },
  { kickerId: 'a', keeperId: 'keeper', scored: false, outcome: 'miss', team: 'A' },
  { kickerId: 'b', keeperId: 'legacyKeeper', scored: false, team: 'B' },
] }), round('1', { inPlayPenalties: [
  { id: 'ip', kickerId: 'a', keeperId: 'keeper', outcome: 'goal', team: 'A', minute: 0, at: 0 },
] })];
const users: Record<string, string> = { a: 'אלירן', b: 'אדיר', 'guest:one': 'אורח', keeper: 'איתן', legacyKeeper: 'גל' };
const userOf = (id: string) => ({ id, name: users[id] || '' });
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : Array.isArray(n) ? n.flatMap(nodes) : [n, ...nodes(n.props?.children)];
const copy = (n: any): string => typeof n === 'string' || typeof n === 'number' ? String(n).replace(/[\u2066-\u2069]/g, '') : !n ? '' : Array.isArray(n) ? n.map(copy).join(' ').replace(/\s+/g, ' ').trim() : copy(n.props?.children);
const card = (extra = {}) => { runtime.begin(); return RoundPenaltiesCard({ attempts: eveningPenaltyAttempts(history), hasHistory: true, userOf, ...extra }); };
const section = (gameId = 'one', refreshKey = 0) => { runtime.begin(); return RoundPenaltiesSection({ gameId, refreshKey, userOf, expectedRounds: 2, expectedShootouts: 1 }); };
const clickTab = (tree: any, label: string) => nodes(tree).find(n => n.props?.accessibilityRole === 'tab' && copy(n) === label).props.onPress();
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
beforeEach(() => { runtime.reset(); read.mockReset(); mockViewer = 'viewer'; mockFocused = true; });

test('uses chronological saved kicks and separates in-play goals from shootout attempts without mutating input', () => {
  const before = JSON.stringify(history), attempts = eveningPenaltyAttempts(history);
  expect(attempts[0]).toMatchObject({ gameNumber: 1, phase: 'inPlay', minute: 0 });
  expect(attempts[1]).toMatchObject({ gameNumber: 2, phase: 'shootout' });
  expect(eveningPenaltyPlayers(attempts, 'inPlay', 'kicker')[0]).toMatchObject({ id: 'a', successes: 1, pct: 100 });
  expect(eveningPenaltyPlayers(attempts, 'shootout', 'kicker')[0]).toMatchObject({ id: 'a', successes: 1, pct: 50 });
  expect(JSON.stringify(history)).toBe(before);
});
test('includes zero-success guests, counts every faced attempt, and never invents legacy saves', () => {
  const attempts = eveningPenaltyAttempts(history);
  expect(eveningPenaltyPlayers(attempts, 'shootout', 'kicker').find(p => p.id === 'guest:one')).toMatchObject({ successes: 0, pct: 0 });
  const keepers = eveningPenaltyPlayers(attempts, 'shootout', 'keeper');
  expect(keepers.find(p => p.id === 'keeper')).toMatchObject({ successes: 1, pct: 33, unknown: 0 });
  expect(keepers.find(p => p.id === 'keeper')?.attempts).toHaveLength(3);
  expect(keepers.find(p => p.id === 'legacyKeeper')).toMatchObject({ successes: 0, pct: null, unknown: 1 });
});
test('missing keeper identities do not erase kicks or produce invented goalkeeper rows', () => {
  const attempts = eveningPenaltyAttempts([round('1', { penalties: [{ kickerId: 'a', keeperId: null, scored: true, team: 'A' }] })]);
  expect(eveningPenaltyPlayers(attempts, 'shootout', 'kicker')).toHaveLength(1);
  expect(eveningPenaltyPlayers(attempts, 'shootout', 'keeper')).toEqual([]);
});
test('phase and role tabs change counts; expanding a player shows game, opponent and result', () => {
  let tree = card();
  expect(copy(tree)).toContain('1 מתוך 1');
  clickTab(tree, 'פנדלי הכרעה'); tree = card();
  expect(copy(tree)).toContain('1 מתוך 2');
  nodes(tree).find(n => n.props?.accessibilityLabel === 'פירוט הבעיטות של אלירן').props.onPress(); tree = card();
  expect(copy(tree)).toContain('משחק 2'); expect(copy(tree)).toContain('מול איתן'); expect(copy(tree)).toContain('החטאה');
  clickTab(tree, 'שוערים'); tree = card();
  expect(copy(tree)).toContain('1 מתוך 3'); expect(copy(tree)).toContain('33%'); expect(copy(tree)).toContain('חסר פירוט');
  expect(copy(tree)).not.toContain('משחק 2');
  nodes(tree).find(n => n.props?.accessibilityLabel === 'פירוט הבעיטות של גל').props.onPress(); tree = card();
  expect(copy(tree)).toContain('לא נשמר אם היתה עצירה או החטאה');
  expect(copy(tree)).toContain('בעט אדיר');
});
test('distinguishes missing history, recorded empty category and partial history', () => {
  expect(copy(card({ attempts: [], hasHistory: false }))).toContain('אין פירוט פנדלים שמור');
  expect(copy(card({ attempts: [], hasHistory: true }))).toContain('לא נרשמו פנדלי הכרעה');
  expect(copy(card({ partial: true }))).toContain('הפירוט השמור חלקי');
});
test('failure has retry instead of a false empty state, and retry restores recorded data', async () => {
  read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(history);
  section(); runtime.effects(); await flush(); let tree = section();
  expect(copy(tree)).toContain('לא הצלחנו לטעון'); expect(nodes(tree).some(n => n.type === RoundPenaltiesCard)).toBe(false);
  nodes(tree).find(n => n.props?.accessibilityRole === 'button').props.onPress();
  section(); runtime.effects(); await flush(); tree = section();
  expect(nodes(tree).find(n => n.type === RoundPenaltiesCard)?.props.attempts).toHaveLength(5);
});
test('same-owner refresh preserves data on failure, while switching games hides it immediately', async () => {
  read.mockResolvedValueOnce(history).mockRejectedValueOnce(new Error('offline')).mockReturnValue(new Promise(() => {}));
  section(); runtime.effects(); await flush(); section();
  section('one', 1); runtime.effects(); await flush(); const failed = section('one', 1);
  expect(copy(failed)).toContain('הפירוט הקודם נשאר מוצג'); expect(nodes(failed).some(n => n.type === RoundPenaltiesCard)).toBe(true);
  expect(nodes(section('two')).some(n => n.type === RoundPenaltiesCard)).toBe(false);
});
test('ignores late responses after game/account changes or focus loss', async () => {
  let resolve!: (value: RoundHistoryDoc[]) => void;
  read.mockReturnValueOnce(new Promise(yes => { resolve = yes; })).mockReturnValue(new Promise(() => {}));
  section(); runtime.effects(); section('two'); runtime.effects(); resolve(history); await flush();
  expect(nodes(section('two')).some(n => n.type === RoundPenaltiesCard)).toBe(false);
  runtime.reset();
  read.mockReturnValueOnce(new Promise(yes => { resolve = yes; })); section(); runtime.effects();
  mockViewer = 'other'; resolve(history); await flush();
  expect(nodes(section()).some(n => n.type === RoundPenaltiesCard)).toBe(false);
  runtime.reset(); mockViewer = 'viewer';
  read.mockReturnValueOnce(new Promise(yes => { resolve = yes; })); section(); runtime.effects();
  mockFocused = false; section(); runtime.effects(); resolve(history); await flush();
  expect(nodes(section()).some(n => n.type === RoundPenaltiesCard)).toBe(false);
});
