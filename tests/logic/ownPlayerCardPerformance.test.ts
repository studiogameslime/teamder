import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import React from 'react';

let mockOwner: any;
const mockReadUser = jest.fn();
const mockGetDocs = jest.fn();
jest.mock('firebase/firestore', () => ({ collection: (_db: unknown, name: string) => name, query: (...args: any[]) => args,
  where: (...args: any[]) => args, limit: (value: number) => value, getDocs: (...args: any[]) => mockGetDocs(...args) }));
jest.mock('@/firebase/firestore', () => ({ col: { games: () => 'games' } }));
jest.mock('@/firebase/config', () => ({ USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) }));
jest.mock('@/store/userStore', () => ({ useUserStore: { getState: () => ({ currentUser: mockOwner }) } }));
jest.mock('@/services/userService', () => ({ userService: { getUserById: (...args: any[]) => mockReadUser(...args) } }));
import { ownPlayerCardService } from '@/services/ownPlayerCardService';
import { publicCardStats } from '@/utils/ownPlayerCard';

const source = fs.readFileSync('src/components/profile/OwnPlayerCard.tsx', 'utf8');
const tree = ts.createSourceFile('OwnPlayerCard.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate: (node: ts.Node) => boolean) {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => { if (predicate(node)) result = node; ts.forEachChild(node, visit); };
  visit(tree); if (!result) throw Error('Missing source node'); return result;
}
const focusCall = find(node => ts.isCallExpression(node) && node.expression.getText(tree) === 'useFocusEffect') as ts.CallExpression;
const focusCallback = (focusCall.arguments[0] as ts.CallExpression).arguments[0];
const focusCode = ts.transpileModule('globalThis.start = ' + focusCallback.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
const last = { id: 'server-round', title: 'מחזור אחרון', status: 'finished', startsAt: 1, players: ['owner'] };
const serverUser = { id: 'owner', isGuest: false, name: 'בעלים', socialPrivacy: { statistics: 'everyone' }, stats: { goals: 7, assists: 3 } };
const gamesSnapshot = (rows = [last]) => ({ docs: rows.map(row => ({ data: () => row })) });

function fixture(seed: Record<string, any> = {}) {
  const profile = deferred(), games = deferred(), stats = deferred(), clubs = deferred(), referrals = deferred();
  mockReadUser.mockReturnValue(profile.promise);
  mockGetDocs.mockImplementation((input: any) => input[0] === 'games' ? games.promise : stats.promise);
  const state: any = { data: { loading: true }, clubs: { loading: true }, referrals: { loading: true }, lastStats: { loading: true }, ...seed };
  const context: any = { preview: undefined, user: mockOwner, generation: { current: 0 },
    current: () => mockOwner?.id === 'owner' && !mockOwner.isGuest,
    useUserStore: { getState: () => ({ currentUser: mockOwner }) },
    lastStatsGameId: { current: seed.data?.value?.last?.id ?? null }, ownPlayerCardService,
    groupService: { listForUser: jest.fn(() => clubs.promise) }, userService: { getInvitedUsersCount: jest.fn(() => referrals.promise) }, observeCaughtError: jest.fn() };
  for (const key of ['data', 'clubs', 'referrals', 'lastStats']) context['set' + key[0].toUpperCase() + key.slice(1)] = jest.fn(value => {
    state[key] = typeof value === 'function' ? value(state[key]) : value;
  });
  vm.runInNewContext(focusCode, context);
  const numbers = () => {
    const variables = ['fresh', 'total', 'allNumbers', 'shareNumbers'].map(name => find(node => ts.isVariableDeclaration(node) && node.name.getText(tree) === name));
    const program = variables.map(node => 'const ' + node.getText(tree) + ';').join('\n') + '\n({allNumbers,shareNumbers});';
    return vm.runInNewContext(ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
      { data: state.data, user: mockOwner, publicCardStats });
  };
  return { context, state, profile, games, stats, clubs, referrals, numbers, start: () => context.start() };
}
beforeEach(() => {
  mockOwner = { id: 'owner', isGuest: false, name: 'בעלים', socialPrivacy: { statistics: 'everyone' }, stats: { goals: 0, assists: 0 } };
  mockReadUser.mockReset(); mockGetDocs.mockReset();
});

test('rounds and last-round stats arrive before a slow fresh profile, while local zero lifetime counters stay unknown', async () => {
  const f = fixture(); f.start(); f.games.resolve(gamesSnapshot()); await settle();
  expect(f.state.data).toMatchObject({ loading: true, pendingProfile: true, value: { attendedCount: 1, last } });
  expect(mockGetDocs.mock.calls.filter(([input]) => input[0] === 'gamePlayerStats')).toHaveLength(1);
  expect(f.numbers().allNumbers.map((item: any) => item.value)).toEqual([1, null, null]);
  expect(f.numbers().shareNumbers).toBeNull();
  f.stats.resolve({ docs: [{ data: () => ({ goals: 2, assists: 1, rounds: 4 }) }] }); await settle();
  expect(f.state.lastStats).toEqual({ value: { goals: 2, assists: 1, games: 4 } });
  f.profile.resolve(serverUser); await settle();
  expect(f.state.data).toEqual({ value: { user: serverUser, attendedCount: 1, next: null, last } });
  expect(f.numbers().allNumbers.map((item: any) => item.value)).toEqual([1, 7, 3]);
  expect(mockReadUser).toHaveBeenCalledTimes(1);
  expect(mockGetDocs).toHaveBeenCalledTimes(2); // One full scan plus one personal stat row.
});

test('a failed fresh profile keeps confirmed rounds and leaves lifetime counters unknown', async () => {
  const f = fixture(); f.start(); f.games.resolve(gamesSnapshot()); await settle();
  f.profile.reject(Error('offline')); await settle();
  expect(f.state.data).toMatchObject({ loading: false, failed: true, pendingProfile: true, value: { attendedCount: 1, last } });
  expect(f.numbers().allNumbers.map((item: any) => item.value)).toEqual([1, null, null]);
  expect(f.numbers().shareNumbers).toBeNull();
});

test('a profile failure before the scan finishes cannot emit late loading or a false successful empty history', async () => {
  const f = fixture(); f.start(); f.profile.reject(Error('offline')); await settle();
  expect(f.state.data).toMatchObject({ failed: true, loading: false });
  f.games.resolve(gamesSnapshot([])); await settle();
  expect(f.state.data.value).toBeUndefined();
  expect(f.state.data).toMatchObject({ failed: true, loading: false });
  expect(mockGetDocs).toHaveBeenCalledTimes(1);
});

test('a round scan failure never fabricates a zero attendance result', async () => {
  const f = fixture(); f.start(); f.games.reject(Error('offline')); f.profile.resolve(serverUser); await settle();
  expect(f.state.data).toMatchObject({ failed: true, loading: false });
  expect(f.state.data.value).toBeUndefined(); expect(mockGetDocs).toHaveBeenCalledTimes(1);
});

test.each([{ id: 'other', isGuest: false }, { id: 'owner', isGuest: true }])('a fresh profile that is not the full owner is rejected: %j', async profile => {
  const f = fixture(); f.start(); f.profile.resolve(profile); await settle(); f.games.resolve(gamesSnapshot()); await settle();
  expect(f.state.data).toMatchObject({ failed: true, loading: false });
  expect(f.state.data.value).toBeUndefined();
  expect(mockGetDocs).toHaveBeenCalledTimes(1);
});

test.each(['blur', 'generation', 'account', 'guest'])('a progressive response after %s does not populate the card or start personal stats', async change => {
  const f = fixture(), stop = f.start();
  if (change === 'blur') stop();
  if (change === 'generation') f.context.generation.current++;
  if (change === 'account') mockOwner = { id: 'other', isGuest: false };
  if (change === 'guest') mockOwner = { id: 'owner', isGuest: true };
  f.games.resolve(gamesSnapshot()); f.profile.resolve(serverUser); await settle();
  expect(f.state.data.value).toBeUndefined();
  expect(mockGetDocs).toHaveBeenCalledTimes(1);
});

test('refocus keeps prior verified values, including a real zero and empty club list, while every section refreshes', async () => {
  const previous = { user: serverUser, attendedCount: 1, last, next: null };
  const f = fixture({ data: { value: previous }, clubs: { value: [] }, referrals: { value: 0 }, lastStats: { value: { goals: 2, assists: 1, games: 4 } } });
  f.start();
  expect(f.state.data).toMatchObject({ value: previous, loading: true });
  expect(f.state.clubs).toEqual({ value: [], loading: true, failed: false });
  expect(f.state.referrals).toEqual({ value: 0, loading: true, failed: false });
  expect(f.state.lastStats).toMatchObject({ value: { goals: 2 }, loading: true });
  f.clubs.reject(Error('offline')); f.referrals.reject(Error('offline')); await settle();
  expect(f.state.clubs).toEqual({ value: [], failed: true, loading: false });
  expect(f.state.referrals).toEqual({ value: 0, failed: true, loading: false });
  expect(f.context.groupService.listForUser).toHaveBeenCalledTimes(1);
  expect(f.context.userService.getInvitedUsersCount).toHaveBeenCalledTimes(1);
});

test('a different last round clears the previous round stats before showing the new round', async () => {
  const f = fixture({ data: { value: { user: serverUser, last: { ...last, id: 'older' }, attendedCount: 1, next: null } }, lastStats: { value: { goals: 99 } } });
  f.start(); f.games.resolve(gamesSnapshot()); await settle();
  expect(f.state.data.value.last.id).toBe(last.id);
  expect(f.state.lastStats).toEqual({ loading: true });
  f.stats.resolve({ docs: [] }); await settle();
  expect(f.state.lastStats).toEqual({ value: { goals: null, assists: null, games: null } });
});

test.each(['guest', 'another account'])('%s cannot start an owner-card read', async scenario => {
  const f = fixture();
  mockOwner = scenario === 'guest' ? { id: 'owner', isGuest: true } : { id: 'other' };
  f.start(); await settle();
  expect(mockReadUser).not.toHaveBeenCalled(); expect(mockGetDocs).not.toHaveBeenCalled();
});

test('the current privacy setting prevents stale public statistics from entering the shared image', async () => {
  const f = fixture({ data: { value: { user: serverUser, last, next: null, attendedCount: 1 } } });
  mockOwner.socialPrivacy.statistics = 'onlyMe';
  expect(f.numbers().shareNumbers).toBeNull();
});

test('entering the personal route evaluates only the personal card branch', () => {
  const routeSource = fs.readFileSync('src/screens/players/PlayerCardScreen.tsx', 'utf8');
  const routeTree = ts.createSourceFile('PlayerCardScreen.tsx', routeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = routeTree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PlayerCardScreen')!;
  const load = jest.fn(() => ({ OwnPlayerCard: 'OwnCard' }));
  const exported: any = {};
  vm.runInNewContext(ts.transpileModule(declaration.getText(routeTree), { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports: exported, React, require: load, useRoute: () => ({ params: { userId: 'owner' } }), useUserStore: (select: any) => select({ currentUser: mockOwner }),
      useEffect: () => {}, LegacyPlayerCardScreen: 'LegacyCard', AnalyticsEvent: {}, logEvent: jest.fn() });
  expect(exported.PlayerCardScreen().type).toBe('OwnCard');
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith('@/components/profile/OwnPlayerCard');
});

test('controlled latency: rounds appear at 200 ms and their personal stats at 500 ms while fresh profile waits until 2200 ms', async () => {
  jest.useFakeTimers(); jest.setSystemTime(0);
  const f = fixture(); f.start();
  setTimeout(() => f.games.resolve(gamesSnapshot([{ ...last, startsAt: -1 }])), 200);
  setTimeout(() => f.stats.resolve({ docs: [{ data: () => ({ goals: 2, assists: 1, rounds: 4 }) }] }), 500);
  setTimeout(() => f.profile.resolve(serverUser), 2200);
  try {
    jest.advanceTimersByTime(200); await settle();
    expect(f.state.data.value.last.id).toBe(last.id);
    expect(f.state.data.pendingProfile).toBe(true);
    jest.advanceTimersByTime(300); await settle();
    expect(Date.now()).toBe(500);
    expect(f.state.lastStats.value).toEqual({ goals: 2, assists: 1, games: 4 });
    expect(f.numbers().allNumbers.map((item: any) => item.value)).toEqual([1, null, null]);
    jest.advanceTimersByTime(1700); await settle();
    expect(f.state.data.loading).toBeUndefined();
    expect(f.numbers().allNumbers.map((item: any) => item.value)).toEqual([1, 7, 3]);
    expect(mockReadUser).toHaveBeenCalledTimes(1); expect(mockGetDocs).toHaveBeenCalledTimes(2);
  } finally { jest.useRealTimers(); }
});
