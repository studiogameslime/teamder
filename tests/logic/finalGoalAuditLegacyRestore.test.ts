import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {rosterOf} from '@/services/rotationEngine';
import {restoreTargetTeam} from '@/utils/restoreTarget';

const serviceSource = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const screenSource = ts.createSourceFile('AdvancedLiveMatchScreen.tsx', fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true);
function find(root: ts.Node, predicate: (n: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (n: ts.Node) => {if (predicate(n)) result = n; if (!result) ts.forEachChild(n, visit);};
  visit(root); if (!result) throw Error('Source node not found'); return result;
}
const method = find(serviceSource, n => ts.isMethodDeclaration(n) && n.name.getText(serviceSource) === 'restorePlayer').getText(serviceSource);
const mode = find(serviceSource, n => ts.isFunctionDeclaration(n) && n.name?.text === 'effFillMode').getText(serviceSource);
const callback = find(screenSource, n => ts.isVariableDeclaration(n) && n.name.getText(screenSource) === 'onRestorePlayer') as ts.VariableDeclaration;
const compile = (text: string) => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

function world(mock: boolean) {
  const target = Array.from({length: 10}, (_, i) => `red${i}`), donor = Array.from({length: 10}, (_, i) => `blue${i}`);
  const state: any = {id: 'legacy-full', status: 'active', format: '11v11', advancedMode: true, advancedFillMode: 'permanent',
    draftTeams: {fillMode: 'temporary', teams: [{index: 0, playerIds: [...target, 'guest:filler']}, {index: 1, playerIds: donor}],
      leftHome: [{playerId: 'departed', homeTeam: 0, at: 1}]},
    rotation: {round: 3, roundInstanceId: 'same-round', playing: [0, 1], waiting: [2], loans: []},
    liveMatch: {scoreA: 1, scoreB: 1, goals: [{id: 'goal', team: 'A'}], timerRunning: false, timerAccumulatedMs: 44743,
      shootout: {firstTeam: 'A', kicks: []}}};
  const update = jest.fn((_ref: unknown, patch: any) => Object.assign(state, patch));
  const transaction = jest.fn(async (_db: unknown, fn: any) => fn({get: async () => ({exists: () => true, data: () => structuredClone(state)}), update}));
  const scope: any = {module: {exports: {}}, USE_MOCK_DATA: mock, mockGamesV2: [state], Date,
    effectiveRosterOf: rosterOf, restoreTargetTeam, playersPerTeamFor: () => 11,
    getFirebase: () => ({db: {}}), docs: {game: () => ({id: state.id})}, runTransaction: transaction};
  vm.runInNewContext(compile(`${mode}\nmodule.exports={${method}};`), scope);
  return {state, target, donor, service: scope.module.exports, update, transaction};
}

describe.each([false, true])('legacy permanent restore (mock=%s)', mock => {
  test.each(['missing', 'empty'])('a full team without a %s baseline rejects atomically', async shape => {
    const x = world(mock); if (shape === 'empty') x.state.rotation.baseTeams = [];
    const before = structuredClone(x.state);
    await expect(x.service.restorePlayer(x.state.id, 'departed')).rejects.toMatchObject({code: 'RESTORE_REQUIRES_SPACE'});
    expect(x.state).toEqual(before); expect(x.update).not.toHaveBeenCalled();
  });
  test('space made through an intervening roster action permits one idempotent restore', async () => {
    const x = world(mock);
    await expect(x.service.restorePlayer(x.state.id, 'departed')).rejects.toMatchObject({code: 'RESTORE_REQUIRES_SPACE'});
    x.state.draftTeams.teams[0].playerIds = [...x.target];
    x.state.draftTeams.teams[1].playerIds.push('guest:filler');
    const live = structuredClone(x.state.liveMatch), rotation = structuredClone(x.state.rotation);
    await x.service.restorePlayer(x.state.id, 'departed'); await x.service.restorePlayer(x.state.id, 'departed');
    expect(x.state.draftTeams.teams.map((t: any) => t.playerIds.length)).toEqual([11, 11]);
    expect(x.state.draftTeams.teams[0].playerIds.filter((id: string) => id === 'departed')).toHaveLength(1);
    expect(x.state.draftTeams.leftHome).toEqual([]); expect(x.state.liveMatch).toEqual(live); expect(x.state.rotation).toEqual(rotation);
  });
  test('a known permanent baseline still returns the filler and restores the player', async () => {
    const x = world(mock);
    x.state.rotation.baseTeams = [{index: 0, playerIds: [...x.target, 'departed']}, {index: 1, playerIds: [...x.donor, 'guest:filler']}];
    await x.service.restorePlayer(x.state.id, 'departed');
    expect(x.state.draftTeams.teams.map((t: any) => t.playerIds.length)).toEqual([11, 11]);
    expect(x.state.draftTeams.teams[1].playerIds).toContain('guest:filler'); expect(x.state.draftTeams.leftHome).toEqual([]);
  });
  test('a known covering loan remains reversible even without a permanent baseline', async () => {
    const x = world(mock);
    x.state.draftTeams.teams[0].playerIds = [...x.target];
    x.state.draftTeams.teams[1].playerIds.push('guest:filler');
    x.state.rotation.loans = [{playerId: 'guest:filler', homeTeam: 1, filledTeam: 0}];
    await x.service.restorePlayer(x.state.id, 'departed');
    expect(x.state.draftTeams.teams.map((t: any) => t.playerIds.length)).toEqual([11, 11]);
    expect(x.state.rotation.loans).toEqual([]); expect(x.state.draftTeams.leftHome).toEqual([]);
  });
  test('the actual restore confirmation surfaces the specific error and releases its latch', async () => {
    const x = world(mock); let confirm!: () => Promise<void>;
    const scope: any = {module: {exports: {}}, gameId: x.state.id, pendingSavedRound: false, roundBusy: false, timerRunning: false,
      homeActionRef: {current: false}, playersMap: {}, gameService: x.service,
      he: {restoreConfirmTitle: () => 'החזרה'}, appAlert: (_title: unknown, _body: unknown, buttons: any[]) => {confirm = buttons[1].onPress;},
      logEvent: jest.fn(), logError: jest.fn(), toast: {error: jest.fn()}, AnalyticsEvent: {}};
    vm.runInNewContext(compile(`module.exports=${callback.initializer!.getText(screenSource)};`), scope);
    scope.module.exports({id: 'departed', name: 'שחקן חוזר'});
    const before = structuredClone(x.state); await confirm();
    expect(scope.toast.error).toHaveBeenCalledWith(expect.stringContaining('חילופים'));
    expect(scope.toast.error).toHaveBeenCalledWith(expect.stringContaining('נסו שוב'));
    expect(scope.logError).not.toHaveBeenCalled();
    expect(scope.logEvent).not.toHaveBeenCalled(); expect(scope.homeActionRef.current).toBe(false);
    expect(x.state).toEqual(before); expect(x.update).not.toHaveBeenCalled();
  });
});
