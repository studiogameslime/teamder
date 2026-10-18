import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { toGuestRosterId } from '@/types';
import { rosterOf } from '@/services/rotationEngine';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fixture(mock = false, caller = 'owner') {
  const source = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const helpers: string[] = []; let method = '';
  const walk = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && ['pruneMemberFromTeams', 'assertGuestPermission'].includes(node.name?.text ?? '')) helpers.push(node.getText(source));
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'removeGuest') method = node.getText(source);
    ts.forEachChild(node, walk);
  };
  walk(source);
  const current: any = {
    id: 'audit', createdBy: 'owner', groupId: 'club', status: 'active', players: ['a', 'guest-id'],
    guests: [{ id: 'guest-id', name: 'אורח', addedBy: 'owner', createdAt: 1 }],
    draftTeams: { teams: [{ index: 0, playerIds: ['a', 'guest:guest-id'] }, { index: 1, playerIds: ['guest-id'] }],
      originalTeams: [{ index: 0, playerIds: ['a', 'guest:guest-id'] }, { index: 1, playerIds: ['guest-id'] }],
      leftHome: [{ playerId: 'guest:guest-id', homeTeam: 0, at: 1 }] },
    rotation: { playing: [0, 1], waiting: [2], round: 2, roundInstanceId: 'round2', wins: { 0: 1 },
      baseTeams: [{ index: 0, playerIds: ['a', 'guest:guest-id'] }, { index: 1, playerIds: ['guest-id'] }],
      loans: [{ playerId: 'guest:guest-id', homeTeam: 0, filledTeam: 1 }, { playerId: 'other', homeTeam: 2, filledTeam: 0 }] },
    liveMatch: { assignments: { 'guest:guest-id': 'team1', a: 'team1' }, benchOrder: ['guest:guest-id', 'a'],
      goals: [{ id: 'kept', team: 'A', scorerId: 'guest:guest-id' }], scoreA: 1, scoreB: 0, timerRunning: true,
      shootout: { kicks: [{ id: 'kick', kickerId: 'guest:guest-id', keeperId: 'guest-id', team: 'A', scored: true }] } },
  };
  const writes: any[] = [], listener = jest.fn();
  let concurrent: (() => void) | undefined;
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: mock, __DEV__: false, Date, toGuestRosterId,
    mockGamesV2: [current], mockLiveSubscribers: new Map([['audit', new Set([listener])]]),
    docs: { game: () => ({ kind: 'game' }), group: () => ({ kind: 'group' }) }, getFirebase: () => ({ db: {} }),
    getDoc: async (ref: any) => ({ exists: () => true, data: () => ref.kind === 'group' ? { adminIds: ['admin'] } : clone(current) }),
    require: () => ({ groupService: { get: async () => ({ adminIds: ['admin'] }) } }),
    runTransaction: async (_db: unknown, callback: any) => {
      if (concurrent) { concurrent(); concurrent = undefined; }
      await callback({ get: async () => ({ exists: () => true, data: () => clone(current) }),
        update: (_ref: unknown, patch: any) => { writes.push(patch); Object.assign(current, patch); } });
    },
    logEvent: jest.fn(), logError: jest.fn(), AnalyticsEvent: { GuestRemoved: 'guest_removed' },
  };
  vm.runInNewContext(ts.transpileModule(helpers.join('\n') + ';module.exports={' + method + '}', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  return { current, writes, listener, remove: () => context.module.exports.removeGuest('audit', caller, 'guest-id'),
    concurrently: (fn: () => void) => { concurrent = fn; } };
}

test.each([false, true])('guest removal prunes all working lineups immediately but retains historical events (mock=%s)', async mock => {
  const x = fixture(mock), history = clone(x.current.draftTeams.originalTeams), goals = clone(x.current.liveMatch.goals), kicks = clone(x.current.liveMatch.shootout);
  await x.remove();
  expect(x.current.guests).toEqual([]);
  expect(x.current.draftTeams.teams[0].playerIds).toEqual(['a']);
  expect(x.current.draftTeams.teams[1].playerIds).toEqual(['guest-id']); // Raw id is a distinct real user.
  expect(x.current.draftTeams.leftHome).toEqual([]);
  expect(x.current.rotation.baseTeams[0].playerIds).toEqual(['a']);
  expect(x.current.rotation.loans).toEqual([{ playerId: 'other', homeTeam: 2, filledTeam: 0 }]);
  expect(rosterOf(1, x.current.draftTeams.teams, x.current.rotation.loans)).toEqual(['guest-id']);
  expect(x.current.liveMatch.assignments).toEqual({ a: 'team1' });
  expect(x.current.liveMatch.benchOrder).toEqual(['a']);
  expect(x.current.liveMatch.goals).toEqual(goals);
  expect(x.current.liveMatch.shootout).toEqual(kicks);
  expect(x.current.liveMatch.scoreA).toBe(1);
  expect(x.current.liveMatch.timerRunning).toBe(true);
  expect(x.current.draftTeams.originalTeams).toEqual(history);
  expect(x.current.rotation.roundInstanceId).toBe('round2');
  expect(x.current.rotation.wins).toEqual({ 0: 1 });
  if (!mock) expect(x.writes).toHaveLength(1);
});

test('guest removal uses the transaction current lineup and preserves a concurrent substitution', async () => {
  const x = fixture();
  x.concurrently(() => { x.current.draftTeams.teams[1].playerIds.push('new-player'); x.current.rotation.playing = [2, 1]; });
  await x.remove();
  expect(x.current.draftTeams.teams[1].playerIds).toEqual(['guest-id', 'new-player']);
  expect(x.current.rotation.playing).toEqual([2, 1]);
  expect(x.current.draftTeams.teams[0].playerIds).toEqual(['a']);
});

test.each([false, true])('a regular participant cannot remove a guest or change any lineup (mock=%s)', async mock => {
  const x = fixture(mock, 'a'), before = clone(x.current);
  await expect(x.remove()).rejects.toThrow('PERMISSION_DENIED');
  expect(x.current).toEqual(before);
  expect(x.writes).toHaveLength(0);
});

test('a club admin uses the same supported removal path', async () => {
  const x = fixture(false, 'admin'); await x.remove();
  expect(x.current.draftTeams.teams[0].playerIds).toEqual(['a']);
  expect(x.writes).toHaveLength(1);
});
