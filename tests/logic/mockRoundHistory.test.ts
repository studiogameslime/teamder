import { saveMockRoundHistory } from '@/utils/mockRoundHistory';
import { roundParticipantSides } from '@/utils/roundParticipants';
import type { RoundHistoryDoc } from '@/utils/eveningStats';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';

const round = (roundId: string): RoundHistoryDoc => ({
  roundId, teamA: ['a', 'guest:x'], teamB: ['b'], teamAIndex: 0,
  teamBIndex: 1, scoreA: 1, scoreB: 0, winnerSide: 'A',
  goals: [{ scorerId: 'guest:x', assisterId: 'a', ownGoal: false, team: 'A', minute: 2 }],
  penalties: [], at: 100,
});

test('three completed demo games are available to the history reader', () => {
  const history: Record<string, RoundHistoryDoc[]> = {};
  for (const id of ['1', '2', '3']) saveMockRoundHistory(history, 'game', round(id));
  expect(history.game.map(r => r.roundId)).toEqual(['1', '2', '3']);
  expect(history.game[0].teamA).toContain('guest:x');
  expect(history.other).toBeUndefined();
});

test('clearing the live score and retrying cannot erase or duplicate a committed game', () => {
  const history: Record<string, RoundHistoryDoc[]> = {};
  const live = round('1');
  saveMockRoundHistory(history, 'game', live);
  live.goals.length = 0;
  live.teamA.length = 0;
  live.scoreA = 0;
  live.winnerSide = 'tie';
  const saved = saveMockRoundHistory(history, 'game', live);
  expect(history.game).toHaveLength(1);
  expect(saved.scoreA).toBe(1);
  expect(saved.winnerSide).toBe('A');
  expect(saved.goals).toHaveLength(1);
  expect(saved.teamA).toEqual(['a', 'guest:x']);
});

test('actual demo commit writes the history consumed by getRoundHistory before clearing live data', async () => {
  const file = path.resolve(__dirname, '../../src/services/gameService.ts');
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  let method = '';
  const visit = (node: ts.Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === '_commitRoundStatsAndClear') method = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const history: Record<string, RoundHistoryDoc[]> = {};
  const live = { scoreA: 1, scoreB: 0, goals: round('1').goals };
  const context = { module: { exports: {} as any }, USE_MOCK_DATA: true,
    mockRoundHistory: history, saveMockRoundHistory, roundParticipantSides,
    mockGamesV2: [{ id: 'demo', liveMatch: live }],
    effectiveRosterOf: (index: number) => index === 0 ? ['a', 'guest:x'] : ['b'],
    roundCommitKey: (rotation: { roundInstanceId: string }) => rotation.roundInstanceId,
    buildShootoutPenaltyPayload: () => [],
  };
  vm.runInNewContext(ts.transpileModule('module.exports = {' + method + '}', {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  const commit = context.module.exports._commitRoundStatsAndClear;
  const rotation = { playing: [0, 1], roundInstanceId: 'r1' };
  await commit('demo', live, rotation, { teams: [] }, 'A');
  expect(live.goals).toEqual([]);
  expect(history.demo[0]).toMatchObject({ scoreA: 1, winnerSide: 'A', teamA: ['a', 'guest:x'] });
  expect(history.demo[0].goals).toHaveLength(1);
  await commit('demo', live, rotation, { teams: [] }, null);
  expect(history.demo).toHaveLength(1);
  expect(history.demo[0].scoreA).toBe(1);
});
