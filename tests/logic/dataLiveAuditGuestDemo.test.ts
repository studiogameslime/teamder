import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { roundParticipantSides } from '@/utils/roundParticipants';
import { saveMockRoundHistory } from '@/utils/mockRoundHistory';
import { reduceRounds, type RoundHistoryDoc } from '@/utils/eveningStats';
import { rosterOf } from '@/services/rotationEngine';
import { toGuestRosterId } from '@/types';

const source = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let method = '';
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === '_commitRoundStatsAndClear') method = node.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const compiled = ts.transpileModule('module.exports = {' + method + '}', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

function demoWorld(role: 'scorer' | 'assister' | 'removed') {
  const teams = [
    { index: 0, playerIds: ['a', 'a2', 'a3', 'guest:out'] },
    { index: 1, playerIds: ['b', 'b2', 'b3', 'b4'] },
    { index: 2, playerIds: ['c', 'c2', 'c3', 'guest:in'] },
  ];
  const rotation = { playing: [0, 1], waiting: [2], roundInstanceId: 'r1', loans: [
    { playerId: 'guest:out', homeTeam: 0, filledTeam: 2, swapId: 'swap' },
    { playerId: 'guest:in', homeTeam: 2, filledTeam: 0, swapId: 'swap' },
  ] };
  const live = { scoreA: role === 'removed' ? 0 : 1, scoreB: 0, goals: role === 'removed' ? [] : [
    { id: 'g1', scorerId: role === 'scorer' ? 'guest:out' : 'a', assisterId: role === 'assister' ? 'guest:out' : null,
      ownGoal: false, team: 'A', minute: 1 },
  ] };
  const game = { id: 'demo', players: teams.flatMap(t => t.playerIds).filter(id => !id.startsWith('guest:')),
    guests: [{ id: 'out' }, { id: 'in' }], draftTeams: { teams }, rotation, liveMatch: live };
  const history: Record<string, RoundHistoryDoc[]> = {};
  const context = { module: { exports: {} as any }, USE_MOCK_DATA: true, mockGamesV2: [game], mockGame: { id: 'other' },
    mockRoundHistory: history, saveMockRoundHistory, roundParticipantSides, toGuestRosterId, effectiveRosterOf: rosterOf,
    roundCommitKey: () => 'r1', buildShootoutPenaltyPayload: () => [],
  };
  vm.runInNewContext(compiled, context);
  return { game, live, history, commit: () => context.module.exports._commitRoundStatsAndClear('demo', live, rotation, game.draftTeams, 'A') };
}

test.each(['scorer', 'assister'] as const)('actual demo commit preserves an outgoing guest %s without changing temporary swap or next lineup', async role => {
  const world = demoWorld(role);
  const before = JSON.parse(JSON.stringify({ draft: world.game.draftTeams, rotation: world.game.rotation }));
  expect(rosterOf(0, world.game.draftTeams.teams, world.game.rotation.loans)).not.toContain('guest:out');

  await world.commit();

  const saved = world.history.demo[0];
  expect(saved.teamA).toHaveLength(5);
  expect(saved.teamA).toEqual(expect.arrayContaining(['guest:in', 'guest:out']));
  expect(reduceRounds('guest:out', [saved])).toMatchObject({ playedRounds: 1, heldPitch: 1,
    bestMiniGame: { goals: role === 'scorer' ? 1 : 0, assists: role === 'assister' ? 1 : 0 },
  });
  expect(world.live.goals).toEqual([]);
  expect({ draft: world.game.draftTeams, rotation: world.game.rotation }).toEqual(before);
  expect(rosterOf(0, world.game.draftTeams.teams, world.game.rotation.loans)).not.toContain('guest:out');
  await world.commit();
  expect(world.history.demo).toHaveLength(1);
  expect(world.history.demo[0].teamA.filter(id => id === 'guest:out')).toHaveLength(1);
});

test('actual demo commit does not recover a waiting guest from a goal that was undone', async () => {
  const world = demoWorld('removed');
  await world.commit();
  expect(world.history.demo[0].teamA).not.toContain('guest:out');
  expect(reduceRounds('guest:out', world.history.demo).playedRounds).toBe(0);
});
