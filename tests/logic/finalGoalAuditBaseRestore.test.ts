import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as engine from '@/services/rotationEngine';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {matchesRoundDecision} from '@/utils/roundDecision';
import {restoreTargetTeam} from '@/utils/restoreTarget';

const file = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['prepareRoundResult', 'commitFilledRotation', '_persistRotation', 'markPlayerWentHome', 'restorePlayer'];
const methods: string[] = [];
function visit(n: ts.Node) {if (ts.isMethodDeclaration(n) && names.includes(n.name.getText(file))) methods.push(n.getText(file)); ts.forEachChild(n, visit);}
visit(file);
const compiled = ts.transpileModule(`module.exports={${methods.join(',')}};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

function world(mock: boolean, result: 'winner' | 'bothOut' | 'balanced') {
  const count = result === 'bothOut' ? 4 : 3;
  const teams = Array.from({length: count}, (_, index) => ({index, captainId: `${index}:0`, colorKey: ['red', 'blue', 'green', 'yellow'][index],
    playerIds: Array.from({length: 11}, (_, i) => `${index}:${i}`)}));
  const base = teams.map(t => ({index: t.index, playerIds: [...t.playerIds]}));
  const state: any = {id: 'base-restore-evening', status: 'open', format: '11v11', advancedFillMode: 'permanent',
    players: teams.flatMap(t => t.playerIds), guests: [],
    draftTeams: {teams, ...(result === 'balanced' ? {completionMode: 'balanced'} : {})},
    rotation: {round: 1, roundInstanceId: 'first-round', roundInstanceRound: 1, playing: [0, 1], waiting: teams.slice(2).map(t => t.index),
      baseTeams: structuredClone(base), loans: [], wins: {}, updatedAt: 1},
    liveMatch: {scoreA: result === 'bothOut' ? 0 : 1, scoreB: 0, goals: [], timerRunning: false, timerAccumulatedMs: 44743}};
  const update = jest.fn((_ref: unknown, patch: any) => Object.assign(state, patch));
  const context: any = {module: {exports: {}}, USE_MOCK_DATA: mock, mockGamesV2: [state], Date,
    ...engine, effectiveRosterOf: engine.rosterOf, restoreTargetTeam, rotationWriteSource, matchesRoundDecision,
    playersPerTeamFor: () => 11, effFillMode: (g: any) => g.advancedFillMode,
    liveRosterTeams: (g: any) => g.draftTeams.teams.map((t: any) => ({index: t.index, playerIds: [...t.playerIds]})),
    docs: {game: () => ({id: state.id})}, getFirebase: () => ({db: {}}),
    runTransaction: async (_db: unknown, fn: any) => fn({get: async () => ({exists: () => true, data: () => structuredClone(state)}), update})};
  vm.runInNewContext(compiled, context);
  const service = context.module.exports;
  service.getGameById = async () => structuredClone(state);
  const resultWrite = jest.fn(async (_id, _live, rotation, _draft, winnerSide, tieResolution) => {
    state.lastCommittedRoundId = engine.roundCommitKey(rotation);
    state.liveMatch = {...state.liveMatch, scoreA: 0, scoreB: 0, goals: []};
    return {winnerSide, tieResolution};
  });
  service._commitRoundStatsAndClear = resultWrite;
  return {state, base, service, resultWrite, update};
}

test.each([false, true])('a normal winner transition preserves the refill baseline and restores its donor (mock=%s)', async mock => {
  await transitionThenRestore(mock, 'winner');
});
test.each([false, true])('a both-out transition preserves the refill baseline and restores its donor (mock=%s)', async mock => {
  await transitionThenRestore(mock, 'bothOut');
});
test.each([false, true])('the balanced transition keeps the same baseline contract (mock=%s)', async mock => {
  await transitionThenRestore(mock, 'balanced');
});

async function transitionThenRestore(mock: boolean, kind: 'winner' | 'bothOut' | 'balanced') {
  const x = world(mock, kind), {state, service} = x;
  const prepared = await service.prepareRoundResult(state.id, 'manager', undefined, kind === 'bothOut' ? 'bothOut' : undefined);
  await service.commitFilledRotation(state.id, prepared.draft, {rotation: prepared.skeleton.rotation, teams: prepared.skeleton.teams},
    undefined, undefined, prepared.skeleton.source);
  const target = state.rotation.playing[0], donor = state.rotation.waiting[0];
  const departed = `${target}:2`, filler = `${donor}:0`;
  await service.markPlayerWentHome(state.id, departed);
  const filled = engine.applyChosenFill(state.draftTeams.teams, state.rotation.loans, target, [filler], 'permanent');
  await service.commitFilledRotation(state.id, state.draftTeams, {rotation: {...state.rotation, loans: filled.loans}, teams: filled.teams},
    undefined, undefined, rotationWriteSource(state));
  const roundId = state.rotation.roundInstanceId, clock = structuredClone(state.liveMatch);
  await service.restorePlayer(state.id, departed); await service.restorePlayer(state.id, departed);
  const team = (index: number) => state.draftTeams.teams.find((t: any) => t.index === index);
  expect(team(target).playerIds).toHaveLength(11);
  expect(team(donor).playerIds).toHaveLength(11);
  expect(team(target).playerIds).toContain(departed); expect(team(target).playerIds).not.toContain(filler);
  expect(team(donor).playerIds).toContain(filler); expect(state.draftTeams.leftHome).toEqual([]);
  expect(state.rotation.baseTeams).toEqual(x.base); expect(state.rotation.round).toBe(2);
  expect(state.rotation.roundInstanceId).toBe(roundId); expect(state.liveMatch).toEqual(clock);
  expect(x.resultWrite).toHaveBeenCalledTimes(1);
}
