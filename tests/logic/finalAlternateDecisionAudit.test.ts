import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as rotationEngine from '@/services/rotationEngine';
import {rotationWriteSource} from '@/services/rotationWriteSource';
import {roundDecisionContext, matchesRoundDecision} from '@/utils/roundDecision';
import {shootoutFingerprint} from '@/utils/shootoutDecision';

const serviceFile = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const screenFile = ts.createSourceFile('AdvancedLiveMatchScreen.tsx', fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true);
const compile = (text: string) => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
function find(root: ts.Node, accept: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {if (accept(node)) result = node; if (!result) ts.forEachChild(node, visit);};
  visit(root); if (!result) throw Error('Source node not found'); return result;
}
const method = (name: string) => find(serviceFile, node => ts.isMethodDeclaration(node) && node.name.getText(serviceFile) === name).getText(serviceFile);
function converter() {
  const exports: any = {};
  vm.runInNewContext(compile(fs.readFileSync('src/firebase/firestore.ts', 'utf8')), {exports, Date,
    require: (id: string) => ({
      'firebase/firestore': {collection: () => ({withConverter: (c: unknown) => ({converter: c})}), doc: (c: any, id: string) => ({...c, id})},
      './config': {getFirebase: () => ({db: {}})}, '@/types': {TEAM_SIZE_MIN: 2, TEAM_SIZE_MAX: 11},
    } as Record<string, unknown>)[id] ?? {},
  });
  return exports.docs.game('g').converter;
}

// Legacy two-step caller compatibility. The current screen has an atomic
// contract covered by finalAtomicAlternativeAudit. Here the retained public
// clear/prepare methods, real server reader and converter are exercised against
// the OLD caller sequence, including both acknowledgement barriers.
function world(mock: boolean, callback: 'onTieWinner' | 'resolveTie', mutateAfterClear?: (raw: any) => void,
  staleFirstRead = false, synchronousStream = false, staleReceiptRead = false) {
  const raw: any = {status: 'open', format: '4v4', players: ['manager'], guests: [{id: 'guest', name: 'אורח', addedBy: 'manager', createdAt: 1}],
    rotation: {round: 3, roundInstanceId: 'third-round', roundInstanceRound: 3, playing: [1, 2], waiting: [0, 3], loans: [], wins: {}, updatedAt: 1},
    draftTeams: {teams: [0, 1, 2, 3].map(index => ({index, captainId: `p${index}`, playerIds: [`p${index}`], colorKey: ['red', 'blue', 'green', 'white'][index]}))},
    liveMatch: {phase: 'roundReady', scoreA: 0, scoreB: 0, goals: [], timerRunning: false, timerAccumulatedMs: 0,
      shootout: {firstTeam: 'A', keeperA: null, keeperB: 'p2', kicks: [{id: 'kick-one', team: 'A', kickerId: 'p1', keeperId: 'p2', scored: true, outcome: 'goal', at: 1}]}},
  };
  const readConverter = converter();
  const readRaw = (value: any) => readConverter.fromFirestore({id: 'g', data: () => structuredClone(value)});
  const data = () => readRaw(raw);
  const beforeClear = structuredClone(raw);
  const original = data(); const mockGame = {...structuredClone(original), matches: []};
  const state = () => mock ? mockGame : raw;
  const update = jest.fn((_ref: unknown, patch: Record<string, any>) => {
    for (const [key, value] of Object.entries(patch)) {
      const path = key.split('.'); let target = raw;
      for (const part of path.slice(0, -1)) target = target[part];
      if (value?.deleted) delete target[path[path.length - 1]]; else target[path[path.length - 1]] = value;
    }
  });
  let cleared = false; let postClearReads = 0; let oldReceiptSnapshot: any;
  const getDocFromServer = jest.fn(async () => ({exists: () => true,
    data: (() => {
      if (oldReceiptSnapshot) {const old = oldReceiptSnapshot; oldReceiptSnapshot = undefined; return () => readRaw(old);}
      return cleared && postClearReads++ === 0 && staleFirstRead ? () => readRaw(beforeClear) : data;
    })()}));
  let next: ((snapshot: any) => void) | undefined; let fail: ((error: Error) => void) | undefined;
  const unsubscribe = jest.fn();
  const emit = (value: any = raw, metadata = {fromCache: false, hasPendingWrites: false}) => next?.({metadata, exists: () => !!value, data: () => readRaw(value)});
  const onSnapshot = jest.fn((_ref: unknown, _options: unknown, callback: (snapshot: any) => void, error: (e: Error) => void) => {
    next = callback; fail = error; if (synchronousStream) emit(); return unsubscribe;
  });
  const context: any = {module: {exports: {}}, ...rotationEngine, rotationWriteSource, matchesRoundDecision, roundDecisionContext, shootoutFingerprint,
    USE_MOCK_DATA: mock, mockGamesV2: [mockGame], mockGame: {id: 'other'},
    docs: {game: () => 'g'}, getFirebase: () => ({db: {}}),
    runTransaction: async (_db: unknown, fn: any) => fn({get: async () => ({exists: () => true, data}), update}),
    getDocFromServer, getDoc: jest.fn(), deleteField: () => ({deleted: true}), onSnapshot, setTimeout, clearTimeout,
    playersPerTeamFor: () => 4, effFillMode: () => 'off', Date, console,
  };
  const waitHelper = serviceFile.statements.filter(node => ts.isFunctionDeclaration(node) && ['waitForClearedShootout', 'waitForCommittedRound'].includes(node.name?.text ?? '')).map(node => node.getText(serviceFile)).join('\n');
  vm.runInNewContext(compile(`${waitHelper}\nmodule.exports={${method('getGameById')},${method('clearShootout')},${method('prepareRoundResult')}};`), context);
  const service = context.module.exports;
  const clear = service.clearShootout.bind(service);
  service.clearShootout = jest.fn(async (...args: any[]) => {await clear(...args); cleared = true; mutateAfterClear?.(state());});
  const commits = jest.fn(async (_gameId, live, rotation, _draft, winnerSide, tieResolution) => {
    expect(live.shootout).toBeUndefined();
    if (staleReceiptRead) oldReceiptSnapshot = structuredClone(state());
    state().lastCommittedRoundId = rotation.roundInstanceId;
    return {winnerSide, tieResolution};
  });
  service._commitRoundStatsAndClear = commits;
  const scope: any = {module: {exports: {}}, gameId: 'g', me: {id: 'manager'}, game: original,
    live: original.liveMatch, rotation: original.rotation, draftTeams: original.draftTeams, roundDecisionContext,
    shootoutDecision: {gameId: 'g', roundId: 'third-round', playing: '1:2', fingerprint: shootoutFingerprint(original.liveMatch.shootout)},
    finalizingRef: {current: false}, committingRef: {current: false}, fillFlowRef: {current: null},
    gameService: service, markBusy: jest.fn(), captureRoundForResult: jest.fn(), beginFillFlow: jest.fn(),
    setWinnerOpen: jest.fn(), setDecisionOpen: jest.fn(), logEvent: jest.fn(), logError: jest.fn(), AnalyticsEvent: {},
    toast: {error: jest.fn()}, roundSaveError: (_: unknown, text: string) => text, he: {roundFinalizeFailed: 'השמירה נכשלה'}, __DEV__: false, timerMs: 0,
  };
  vm.runInNewContext(compile(`module.exports=async () => {
    if (finalizingRef.current) return;
    finalizingRef.current=true;
    try {
      await gameService.clearShootout(gameId,shootoutDecision);
      const expected=roundDecisionContext({...game,liveMatch:{...live,shootout:undefined}});
      const res=await gameService.prepareRoundResult(gameId,me.id,${callback==='onTieWinner'?"'B',undefined":"undefined,'bothOut'"},false,shootoutDecision,expected);
      if(res&&res.outcome!==null)beginFillFlow(res.skeleton,res.draft);
    } catch(error) {toast.error(error.message);setDecisionOpen(true);}
    finally {finalizingRef.current=false;}
  };`), scope);
  return {invoke: () => scope.module.exports(callback === 'onTieWinner' ? 2 : 'bothOut'), state, commits, scope, service, update, getDocFromServer,
    emit, emitOld: () => emit(beforeClear), fail: (error: Error) => fail?.(error), onSnapshot, unsubscribe};
}
// VM promises can require another turn; do not guess a microtask count. The
// real timer-module immediate also works while the deadline uses fake timers.
const flush = () => new Promise<void>(resolve => jest.requireActual<typeof import('timers')>('timers').setImmediate(resolve));

test.each([false, true])('manual alternative commits the selected side after the actual shootout deletion (mock: %s)', async mock => {
  const x = world(mock, 'onTieWinner'); await x.invoke();
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.commits.mock.calls[0][4]).toBe('B');
  expect(x.state().liveMatch.shootout).toBeUndefined(); expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);
  expect(x.scope.toast.error).not.toHaveBeenCalled();
});
test.each([false, true])('both-out alternative commits after the actual shootout deletion (mock: %s)', async mock => {
  const x = world(mock, 'resolveTie'); await x.invoke();
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.commits.mock.calls[0][5]).toBe('bothOut');
  expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1); expect(x.scope.toast.error).not.toHaveBeenCalled();
});
test.each(['lineup', 'goal', 'restarted-shootout'])('another %s arriving between clear and prepare still blocks the alternative', async change => {
  const x = world(false, 'onTieWinner', raw => {
    if (change === 'lineup') raw.draftTeams.teams[1].playerIds = ['new-player'];
    if (change === 'goal') raw.liveMatch = {...raw.liveMatch, scoreA: 1, goals: [{id: 'new-goal', team: 'A', scorerId: 'p1'}]};
    if (change === 'restarted-shootout') raw.liveMatch.shootout = {firstTeam: 'B', kicks: []};
  });
  await x.invoke(); expect(x.commits).not.toHaveBeenCalled(); expect(x.scope.toast.error).toHaveBeenCalledTimes(1);
  expect(x.scope.setDecisionOpen).toHaveBeenCalledWith(true);
});

test.each(['onTieWinner', 'resolveTie'] as const)('%s waits for the exact confirmed clear when the immediate server read still contains the deleted kick', async callback => {
  const x = world(false, callback, undefined, true);
  const pending = x.invoke(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1); expect(x.commits).not.toHaveBeenCalled();
  x.emitOld(); await flush(); expect(x.commits).not.toHaveBeenCalled();
  x.emit(); await pending;
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.commits.mock.calls[0][1].shootout).toBeUndefined();
  expect(x.unsubscribe).toHaveBeenCalledTimes(1); expect(x.scope.toast.error).not.toHaveBeenCalled();
});

test.each(['lineup', 'goal', 'another-series', 'round', 'playing', 'finished', 'deleted'])('a server-confirmed %s while awaiting clear rejects instead of accepting a different board', async change => {
  const x = world(false, 'onTieWinner', undefined, true);
  const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  const changed = structuredClone(x.state());
  if (change === 'lineup') changed.draftTeams.teams[1].playerIds = ['new-player'];
  if (change === 'goal') changed.liveMatch.scoreA = 1;
  if (change === 'another-series') changed.liveMatch.shootout = {firstTeam: 'B', kicks: []};
  if (change === 'round') changed.rotation.roundInstanceId = 'next-round';
  if (change === 'playing') changed.rotation.playing = [2, 1];
  if (change === 'finished') changed.status = 'finished';
  x.emit(change === 'deleted' ? null : changed); await pending;
  expect(x.commits).not.toHaveBeenCalled(); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
  expect(x.scope.toast.error).toHaveBeenCalledTimes(1); expect(x.scope.setDecisionOpen).toHaveBeenCalledWith(true);
});

test('cached or pending cleared snapshots do not confirm the result; the exact server snapshot does', async () => {
  const x = world(false, 'onTieWinner', undefined, true);
  const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  x.emit(x.state(), {fromCache: true, hasPendingWrites: false});
  x.emit(x.state(), {fromCache: false, hasPendingWrites: true}); await flush();
  expect(x.commits).not.toHaveBeenCalled(); x.emit(); await pending;
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
});

test('a bounded clear wait cleans up and keeps the decision retryable on timeout', async () => {
  jest.useFakeTimers();
  try {
    const x = world(false, 'onTieWinner', undefined, true);
    const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(8000); await pending;
    expect(x.commits).not.toHaveBeenCalled(); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
    expect(x.scope.setDecisionOpen).toHaveBeenCalledWith(true); expect(x.scope.finalizingRef.current).toBe(false);
    // A second confirmation reads the now-cleared board and commits once.
    await x.invoke(); expect(x.commits).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});

test.each([false, true])('clear-wait cleanup also covers %s (false = listener failure, true = synchronous success)', async synchronous => {
  const x = world(false, 'onTieWinner', undefined, true, synchronous);
  const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  if (!synchronous) x.fail(new Error('connection unavailable'));
  await pending;
  expect(x.commits).toHaveBeenCalledTimes(synchronous ? 1 : 0); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
});

test('a repeated confirmation while waiting for clear cannot start a second commit or subscription', async () => {
  const x = world(false, 'onTieWinner', undefined, true);
  const pending = x.invoke(); await flush(); await x.invoke();
  expect(x.service.clearShootout).toHaveBeenCalledTimes(1); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  x.emit(); await pending; expect(x.commits).toHaveBeenCalledTimes(1);
});

test.each(['onTieWinner', 'resolveTie'] as const)('%s waits for its acknowledged receipt instead of failing on the previous receipt', async callback => {
  const x = world(false, callback, undefined, false, false, true);
  const pending = x.invoke(); await flush();
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  const old = structuredClone(x.state()); delete old.lastCommittedRoundId;
  x.emit(old); await flush(); expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  x.emit(); await pending;
  expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1); expect(x.commits).toHaveBeenCalledTimes(1);
  expect(x.unsubscribe).toHaveBeenCalledTimes(1); expect(x.scope.toast.error).not.toHaveBeenCalled();
});

test.each(['lineup', 'round', 'different-receipt', 'finished', 'old-board-new-goal'])('receipt waiting refuses %s without another result write', async change => {
  const x = world(false, 'onTieWinner', undefined, false, false, true);
  const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
  const changed = structuredClone(x.state());
  if (change === 'lineup') changed.draftTeams.teams[1].playerIds = ['late-player'];
  if (change === 'round') changed.rotation.roundInstanceId = 'next-round';
  if (change === 'different-receipt') changed.lastCommittedRoundId = 'other-receipt';
  if (change === 'finished') changed.status = 'finished';
  if (change === 'old-board-new-goal') {delete changed.lastCommittedRoundId; changed.liveMatch.scoreA = 1;}
  x.emit(changed); await pending;
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  expect(x.scope.toast.error).toHaveBeenCalledTimes(1); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
});

test('receipt waiting ignores local snapshots and is bounded after a confirmed result', async () => {
  jest.useFakeTimers();
  try {
    const x = world(false, 'onTieWinner', undefined, false, false, true);
    const pending = x.invoke(); await flush(); expect(x.onSnapshot).toHaveBeenCalledTimes(1);
    x.emit(x.state(), {fromCache: true, hasPendingWrites: false});
    x.emit(x.state(), {fromCache: false, hasPendingWrites: true}); await flush();
    expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
    jest.advanceTimersByTime(8000); await pending;
    expect(x.commits).toHaveBeenCalledTimes(1); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
    expect(x.scope.finalizingRef.current).toBe(false); expect(jest.getTimerCount()).toBe(0);
  } finally {jest.useRealTimers();}
});

test('both acknowledgement bridges compose without another clear, result write or leaked subscription', async () => {
  const x = world(false, 'onTieWinner', undefined, true, false, true);
  const pending = x.invoke(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(1); expect(x.commits).not.toHaveBeenCalled();
  x.emit(); await flush();
  expect(x.onSnapshot).toHaveBeenCalledTimes(2); expect(x.unsubscribe).toHaveBeenCalledTimes(1);
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.scope.beginFillFlow).not.toHaveBeenCalled();
  await x.invoke(); expect(x.service.clearShootout).toHaveBeenCalledTimes(1);
  x.emit(); await pending;
  expect(x.commits).toHaveBeenCalledTimes(1); expect(x.scope.beginFillFlow).toHaveBeenCalledTimes(1);
  expect(x.unsubscribe).toHaveBeenCalledTimes(2); expect(x.getDocFromServer).toHaveBeenCalledTimes(2);
});
