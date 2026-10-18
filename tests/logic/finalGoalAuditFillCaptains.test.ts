import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {applyChosenFill, resolveRoundInstance} from '@/services/rotationEngine';
import {rotationWriteSource} from '@/services/rotationWriteSource';

// Persist the real engine's chosen fill through the real public save method
// and transaction. Transport is isolated; captain projection is not replaced.
const file = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const methods: string[] = [];
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && ['commitFilledRotation', '_persistRotation'].includes(node.name.getText(file))) methods.push(node.getText(file));
  ts.forEachChild(node, visit);
}
visit(file);
const compiled = ts.transpileModule(`module.exports={${methods.join(',')}};`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

function world(mock: boolean, size: number) {
  const members = (prefix: string) => Array.from({length: size}, (_, i) => `${prefix}${i}`);
  const donor = ['guest:green0', ...members('green').slice(1)];
  const state: any = {id: 'captain-evening', status: 'open', format: `${size}v${size}`, players: [], guests: [{id: 'green0'}],
    liveMatch: {scoreA: 2, scoreB: 1, goals: [{id: 'kept', team: 'A'}], timerRunning: false, timerAccumulatedMs: 0},
    rotation: {round: 1, roundInstanceRound: 1, roundInstanceId: 'same-round', playing: [0, 1], waiting: [2], loans: [], updatedAt: 1},
    draftTeams: {teams: [
      {index: 0, captainId: 'red1', colorKey: 'red', playerIds: members('red').slice(0, -1)},
      {index: 1, captainId: 'blue1', colorKey: 'blue', playerIds: members('blue')},
      {index: 2, captainId: 'guest:green0', colorKey: 'green', playerIds: donor, customLabel: 'קבוצת הממתינים'},
    ]}};
  const update = jest.fn((_ref: unknown, patch: any) => Object.assign(state, patch));
  const context: any = {module: {exports: {}}, USE_MOCK_DATA: mock, mockGamesV2: [state], Date, resolveRoundInstance, rotationWriteSource,
    docs: {game: () => ({id: state.id})}, getFirebase: () => ({db: {}}),
    runTransaction: async (_db: unknown, fn: any) => fn({get: async () => ({exists: () => true, data: () => structuredClone(state)}), update})};
  vm.runInNewContext(compiled, context);
  const service = context.module.exports;
  const save = async (mode: 'temporary' | 'permanent') => {
    const before = structuredClone(state);
    const chosen = applyChosenFill(state.draftTeams.teams, state.rotation.loans, 0, ['guest:green0'], mode);
    await service.commitFilledRotation(state.id, state.draftTeams, {rotation: {...state.rotation, loans: chosen.loans}, teams: chosen.teams}, undefined, undefined, rotationWriteSource(state));
    return before;
  };
  return {state, save, update};
}

describe.each([false, true])('persisted fill captains (mock=%s)', mock => {
  test.each([4, 7, 11])('a permanent captain transfer chooses the remaining donor captain with team size %s', async size => {
    const x = world(mock, size); const before = await x.save('permanent');
    const [red, blue, green] = x.state.draftTeams.teams;
    expect(red.playerIds).toContain('guest:green0'); expect(green.playerIds).not.toContain('guest:green0');
    expect(green.captainId).toBe('green1');
    expect(red.captainId).toBe('red1'); expect(blue.captainId).toBe('blue1');
    expect(green).toMatchObject({colorKey: 'green', customLabel: 'קבוצת הממתינים'});
    expect(x.state.rotation.roundInstanceId).toBe('same-round'); expect(x.state.liveMatch).toEqual(before.liveMatch);
    expect(x.state.draftTeams.teams.every((team: any) => !team.playerIds.length || team.playerIds.includes(team.captainId))).toBe(true);
  });
  test('a temporary captain loan preserves the donor home captain', async () => {
    const x = world(mock, 11); await x.save('temporary');
    const green = x.state.draftTeams.teams[2];
    expect(green.captainId).toBe('guest:green0'); expect(green.playerIds).toContain('guest:green0');
    expect(x.state.rotation.loans).toEqual([{playerId: 'guest:green0', homeTeam: 2, filledTeam: 0}]);
  });
  test('an emptied donor team has no captain left assigned to another team', async () => {
    const x = world(mock, 4); x.state.draftTeams.teams[2].playerIds = ['guest:green0'];
    await x.save('permanent');
    expect(x.state.draftTeams.teams[2]).toMatchObject({playerIds: [], captainId: ''});
  });
});
