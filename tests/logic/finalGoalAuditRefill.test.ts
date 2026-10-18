import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {rosterOf, roundCommitKey} from '@/services/rotationEngine';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {roundDecisionContext, matchesRoundDecision} from '@/utils/roundDecision';

const source = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const screen = ts.createSourceFile('AdvancedLiveMatchScreen.tsx', fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true);
const compile = (text: string) => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
function find(root: ts.Node, accept: (n: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (n: ts.Node) => {if (accept(n)) result = n; if (!result) ts.forEachChild(n, visit);};
  visit(root); if (!result) throw Error('Source node missing'); return result;
}
const methods = ['markPlayerWentHome', 'prepareRefillPlaying'].map(name => find(source, n => ts.isMethodDeclaration(n) && n.name.getText(source) === name).getText(source));
const helpers = source.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === 'waitForRosterMutation').map(n => n.getText(source));
const callback = find(screen, n => ts.isVariableDeclaration(n) && n.name.getText(screen) === 'onPlayerWentHome') as ts.VariableDeclaration;
const flush = () => new Promise<void>(resolve => jest.requireActual<typeof import('timers')>('timers').setImmediate(resolve));

function world(stale = false, side = 0) {
  const board: any = {id: 'refill-qa', status: 'open', format: '11v11', players: [], guests: [], advancedFillMode: 'permanent',
    rotation: {round: 1, roundInstanceRound: 1, roundInstanceId: 'one', playing: [0, 1], waiting: [2], loans: [], updatedAt: 1},
    draftTeams: {teams: [0, 1, 2].map(index => ({index, captainId: `p${index}0`, colorKey: ['red', 'blue', 'green'][index], playerIds: Array.from({length: 11}, (_, i) => `p${index}${i}`)}))},
    liveMatch: {phase: 'roundReady', scoreA: 0, scoreB: 0, goals: [], timerRunning: false, timerAccumulatedMs: 0}};
  const before = structuredClone(board); let patchApplied = false;
  const update = jest.fn((_ref: unknown, patch: any) => {Object.assign(board, patch); patchApplied = true;});
  let next: ((snapshot: any) => void) | undefined;
  const unsubscribe = jest.fn();
  const onSnapshot = jest.fn((_ref: unknown, _options: unknown, callback: (snapshot: any) => void) => {next = callback; return unsubscribe;});
  const context: any = {module: {exports: {}}, USE_MOCK_DATA: false, Date, roundCommitKey, rotationWriteSource, roundDecisionContext, matchesRoundDecision,
    playersPerTeamFor: () => 11, effFillMode: (g: any) => g.advancedFillMode, effectiveRosterOf: rosterOf,
    docs: {game: () => ({id: board.id})}, getFirebase: () => ({db: {}}), onSnapshot, setTimeout, clearTimeout,
    runTransaction: async (_db: unknown, fn: any) => fn({get: async () => ({exists: () => true, data: () => structuredClone(board)}), update})};
  vm.runInNewContext(compile(`${helpers.join('\n')}\nmodule.exports={${methods.join(',')}};`), context);
  const service = context.module.exports;
  service.getGameById = jest.fn(async () => structuredClone(stale && patchApplied ? before : board));
  let confirm: (() => Promise<void>) | undefined;
  const scope: any = {module: {exports: {}}, gameId: board.id, pendingSavedRound: false, roundBusy: false, winnerOpen: false, playersMap: {}, timerRunning: false,
    homeActionRef: {current: false}, finalizingRef: {current: false}, committingRef: {current: false}, fillFlowRef: {current: null}, gameService: service,
    he: {wentHomeConfirmTitle: () => 'אישור', wentHomeConfirmOk: 'אישור'},
    appAlert: (_title: unknown, _body: unknown, buttons: any[]) => {confirm = buttons[1].onPress;},
    beginFillFlow: jest.fn(), offerRetireEmptyTeam: jest.fn(), logError: jest.fn(), logEvent: jest.fn(), AnalyticsEvent: {}};
  vm.runInNewContext(compile(`module.exports=${callback.initializer!.getText(screen)};`), scope);
  scope.module.exports({id: `p${side}2`, name: 'שחקן יוצא'});
  return {board, before, service, update, scope, onSnapshot, unsubscribe, confirm: () => confirm!(),
    emit: (value: any = board, metadata = {fromCache: false, hasPendingWrites: false}) => next?.({metadata, exists: () => !!value, data: () => structuredClone(value)})};
}

test('the actual leave callback opens an 11-player permanent refill before any clock start', async () => {
  const x = world(); await x.confirm();
  expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);
  expect(x.scope.beginFillFlow.mock.calls[0][0]).toMatchObject({playing: [0, 1], perTeam: 11, fillMode: 'permanent'});
  expect(x.scope.beginFillFlow.mock.calls[0][3]).toBe(true);
  expect(x.board.liveMatch).toEqual(x.before.liveMatch); expect(x.update).toHaveBeenCalledTimes(1);
});

test('a cached pre-departure read waits for the acknowledged lineup instead of silently returning no refill', async () => {
  const x = world(true); const pending = x.confirm(); await flush();
  expect(x.service.getGameById).toHaveBeenCalledWith('refill-qa', {source: 'server'});
  expect(x.onSnapshot).toHaveBeenCalledTimes(1); expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  x.emit(x.before); await flush(); expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  x.emit(); await pending;
  expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
  expect(x.scope.beginFillFlow.mock.calls[0][0].teams[0].playerIds).toHaveLength(10);
});

test.each(['round', 'lineup', 'goal', 'restored', 'finished', 'committed', 'format', 'fill-mode'])('a %s change while waiting never opens the stale refill', async change => {
  const x = world(true); const pending = x.confirm(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  const changed = structuredClone(x.board);
  if (change === 'round') changed.rotation.roundInstanceId = 'next';
  if (change === 'lineup') changed.draftTeams.teams[1].playerIds.push('late');
  if (change === 'goal') changed.liveMatch.scoreA = 1;
  if (change === 'restored') {changed.draftTeams.teams[0].playerIds.push('p02'); changed.draftTeams.leftHome = [];}
  if (change === 'finished') changed.status = 'finished';
  if (change === 'committed') changed.lastCommittedRoundId = 'one';
  if (change === 'format') changed.format = '7v7';
  if (change === 'fill-mode') changed.advancedFillMode = 'temporary';
  x.emit(changed); await pending;
  expect(x.scope.beginFillFlow).not.toHaveBeenCalled(); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
  expect(x.scope.logError).toHaveBeenCalledTimes(1); expect(x.scope.homeActionRef.current).toBe(false);
});

test('a waiting-team departure is confirmed without offering a playing-team refill', async () => {
  const x = world(true, 2); const pending = x.confirm(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1); x.emit(); await pending;
  expect(x.scope.beginFillFlow).not.toHaveBeenCalled(); expect(x.scope.logError).not.toHaveBeenCalled();
});

test('pending/cache snapshots do not open refill; a clock-only change does not block its confirmed roster', async () => {
  const x = world(true); const pending = x.confirm(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  x.emit(x.board, {fromCache: true, hasPendingWrites: false}); x.emit(x.board, {fromCache: false, hasPendingWrites: true}); await flush();
  expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  const fresh = structuredClone(x.board); fresh.status = 'active'; fresh.liveMatch.timerRunning = true; fresh.liveMatch.timerLastStartedAt = 500;
  x.emit(fresh); await pending; expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);
});

test('the departure wait is bounded and repeated confirmation stays behind its existing latch', async () => {
  jest.useFakeTimers();
  try {
    const x = world(true); const pending = x.confirm(); await flush(); await x.confirm();
    expect(x.update).toHaveBeenCalledTimes(1); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(8000); await pending;
    expect(x.scope.beginFillFlow).not.toHaveBeenCalled(); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
    expect(x.scope.homeActionRef.current).toBe(false); expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});

test.each(['fillFlowRef', 'finalizingRef', 'committingRef'])('a local %s begun during the read keeps its flow instead of being replaced by refill', async name => {
  const x = world(true); const pending = x.confirm(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  x.scope[name].current = name === 'fillFlowRef' ? {kind: 'other-fill'} : true;
  x.emit(); await pending;
  expect(x.scope.beginFillFlow).not.toHaveBeenCalled(); expect(x.scope.logError).not.toHaveBeenCalled();
  expect(x.unsubscribe).toHaveBeenCalledTimes(1);
});
