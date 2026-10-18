import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { activeDraftRosterIds, validateDraftRoster } from '@/utils/draftIntegrity';
import { createManualDraft } from '@/utils/manualAllocation';
import { rotationWriteSource } from '@/services/rotationWriteSource';
import type { Game } from '@/types';

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const state = (): Game => ({
  id: 'audit', groupId: 'club', title: 'בדיקת כוחות', startsAt: 1, createdAt: 1, fieldName: 'מגרש בדיקה',
  maxPlayers: 8, waitlist: [], matches: [], currentMatchIndex: 0, locked: true,
  status: 'active', format: '4v4', numberOfTeams: 2,
  players: ['a', 'b', 'c', 'gone'],
  guests: [{ id: 'active', name: 'אורח', addedBy: 'a', createdAt: 1 },
    { id: 'gone', name: 'עזב', addedBy: 'a', createdAt: 1 },
    { id: 'waiting', name: 'ממתין', addedBy: 'a', createdAt: 1, waitlisted: true }],
  draftTeams: { ...createManualDraft([['a', 'b'], ['c', 'guest:active']], 'owner', 1),
    leftHome: [{ playerId: 'gone', homeTeam: 0, at: 2 }, { playerId: 'guest:gone', homeTeam: 1, at: 3 }] },
  rotation: { playing: [0, 1], waiting: [], round: 3, roundInstanceId: 'round3', roundInstanceRound: 3,
    wins: { 0: 1, 1: 1 }, loans: [], baseTeams: [{ index: 0, playerIds: ['a', 'b', 'gone'] }, { index: 1, playerIds: ['c', 'guest:active', 'guest:gone'] }] },
  liveMatch: { phase: 'roundRunning', assignments: {}, benchOrder: [], scoreA: 1, scoreB: 0,
    goals: [{ id: 'goal', scorerId: 'a', team: 'A', minute: 1, at: 1 }], timerRunning: false, timerAccumulatedMs: 0 },
});

function screenMemo(file: string, name: string) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer && ts.isCallExpression(node.initializer)) {
      callback = node.initializer.arguments[0].getText(ast);
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  const game = state();
  const context: any = { module: { exports: {} }, game, playersMap: {}, activeDraftRosterIds,
    toGuestRosterId: (id: string) => `guest:${id}`,
    roster: ['a', 'b', 'c', 'gone', 'guest:active', 'guest:gone', 'guest:waiting'].map(id => ({ id, waitlisted: id === 'guest:waiting' })),
  };
  vm.runInNewContext(ts.transpileModule('module.exports=' + callback, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.module.exports();
}

test.each(['DraftSetupScreen', 'DraftBoardScreen'])('actual %s selectable roster excludes departed captains and members', screen => {
  expect(screenMemo(`src/screens/games/${screen}.tsx`, 'participants').map((player: any) => player.id)).toEqual(['a', 'b', 'c', 'guest:active']);
});

/** Runs the production method with transactional I/O isolated; no rewritten save logic. */
function serviceWorld(mock: boolean) {
  const ast = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let method = '';
  const walk = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'saveDraftTeams') method = node.getText(ast);
    ts.forEachChild(node, walk);
  };
  walk(ast);
  const current = state();
  const write = jest.fn((_ref, patch) => Object.assign(current, clone(patch)));
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: mock, mockGamesV2: [current],
    activeDraftRosterIds, validateDraftRoster, docs: { game: () => ({}) }, getFirebase: () => ({ db: {} }),
    stripUndefined: (value: any) => value, Date,
    runTransaction: async (_db: unknown, fn: any) => fn({ get: async () => ({ exists: () => true, data: () => clone(current) }), update: write }),
  };
  vm.runInNewContext(ts.transpileModule('module.exports={' + method + '}', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { service: context.module.exports, current, write };
}

test('draftable membership excludes departed real players and guests without cancelling their registration', () => {
  const game = state();
  expect(activeDraftRosterIds(game)).toEqual(['a', 'b', 'c', 'guest:active']);
  expect(game.players).toContain('gone');
  expect(game.guests?.find(guest => guest.id === 'gone')).toBeDefined();
  expect(() => validateDraftRoster(createManualDraft([['a', 'b'], ['c', 'guest:active']], 'owner', 4), game, game)).not.toThrow();
  expect(() => validateDraftRoster(createManualDraft([['a', 'b', 'gone'], ['c', 'guest:active', 'guest:gone']], 'owner', 4), game, game)).toThrow('DRAFT_ROSTER_CHANGED');
});

test('an explicit restoration makes that participant draftable again', () => {
  const game = state();
  game.draftTeams!.leftHome = game.draftTeams!.leftHome!.filter(entry => entry.playerId !== 'gone');
  expect(activeDraftRosterIds(game)).toEqual(['a', 'b', 'c', 'gone', 'guest:active']);
});

test.each([false, true])('a new split keeps departures and historical/live results intact (mock=%s)', async mock => {
  const { service, current } = serviceWorld(mock);
  const departed = clone(current.draftTeams!.leftHome);
  const live = clone(current.liveMatch);
  const previousSource = rotationWriteSource(current);
  for (const [index, groups] of [[['c', 'a'], ['b', 'guest:active']], [['b', 'c'], ['a', 'guest:active']]].entries()) {
    await service.saveDraftTeams('audit', createManualDraft(groups, 'owner', 10 + index), undefined, true, current);
    expect(current.draftTeams!.leftHome).toEqual(departed);
    expect(current.draftTeams!.teams.flatMap(team => team.playerIds)).not.toEqual(expect.arrayContaining(['gone']));
    expect(current.draftTeams!.originalTeams?.flatMap(team => team.playerIds)).not.toEqual(expect.arrayContaining(['guest:gone']));
    expect(current.rotation!.baseTeams?.map(team => team.playerIds)).toEqual(groups);
    expect(current.rotation!.playing).toEqual([0, 1]);
    expect(current.rotation!.roundInstanceId).toBe('round3');
    expect(current.rotation!.wins).toEqual({ 0: 1, 1: 1 });
    expect(current.liveMatch).toEqual(live);
  }
  expect(rotationWriteSource(current)).not.toBe(previousSource);
});

test.each([false, true])('departure after editor load rejects the old full roster atomically (mock=%s)', async mock => {
  const { service, current, write } = serviceWorld(mock);
  const next = createManualDraft([['a', 'b'], ['c', 'guest:active']], 'owner', 4);
  current.draftTeams!.leftHome!.push({ playerId: 'b', homeTeam: 0, at: 5 });
  current.draftTeams!.teams[0].playerIds = ['a'];
  const before = clone(current);
  await expect(service.saveDraftTeams('audit', next, undefined, true, current)).rejects.toThrow('DRAFT_ROSTER_CHANGED');
  expect(current).toEqual(before);
  expect(write).not.toHaveBeenCalled();
});
