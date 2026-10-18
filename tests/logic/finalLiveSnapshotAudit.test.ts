import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import {matchesRoundDecision, roundDecisionContext} from '@/utils/roundDecision';

// Run the production subscriber and screen effect, not a replacement of their
// payload projection. The Firestore branch also uses the real game converter.
const serviceFile = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const screenFile = ts.createSourceFile('AdvancedLiveMatchScreen.tsx', fs.readFileSync('src/screens/AdvancedLiveMatchScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true);
function find(root: ts.Node, accept: (node: ts.Node) => boolean): ts.Node {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (accept(node)) result = node;
    if (!result) ts.forEachChild(node, visit);
  };
  visit(root);
  if (!result) throw new Error('Live subscription source node not found');
  return result;
}
const subscriber = find(serviceFile, node => ts.isMethodDeclaration(node) && node.name.getText(serviceFile) === 'subscribeLiveGame');
const effect = find(screenFile, node => ts.isCallExpression(node) && node.expression.getText(screenFile) === 'useEffect' &&
  node.arguments[0]?.getText(screenFile).includes('gameService.subscribeLiveGame')) as ts.CallExpression;
function compile(text: string): string {
  return ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
}

function gameReader() {
  const exports: any = {};
  const io = {
    collection: (_db: unknown, path: string) => ({withConverter: (converter: unknown) => ({path, converter})}),
    doc: (collection: any, id: string) => ({...collection, id}),
  };
  vm.runInNewContext(compile(fs.readFileSync('src/firebase/firestore.ts', 'utf8')), {
    exports, Date,
    require: (id: string) => ({
      'firebase/firestore': io,
      './config': {getFirebase: () => ({db: {}})},
      '@/types': {TEAM_SIZE_MIN: 2, TEAM_SIZE_MAX: 11},
    } as Record<string, unknown>)[id] ?? {},
  });
  return exports.docs;
}

function board(): any {
  return {id: 'snapshot-evening', groupId: 'existing-club', title: 'מחזור בדיקת מאזין', status: 'open',
    startsAt: 10, createdAt: 1, updatedAt: 1, createdBy: 'manager', format: '4v4', advancedMode: true,
    advancedFillMode: 'temporary', numberOfTeams: 3, matchDurationMinutes: 8, seasonId: 'same-season',
    players: ['a', 'b'], guests: [{id: 'first', name: 'אורח ראשון', addedBy: 'manager', createdAt: 1}],
    draftTeams: {teams: [{index: 0, playerIds: ['a', 'guest:first'], colorKey: 'red'},
      {index: 1, playerIds: ['b'], colorKey: 'blue'}], leftHome: [{playerId: 'gone', homeTeam: 0, at: 1}]},
    rotation: {round: 1, roundInstanceId: 'same-round', playing: [0, 1], waiting: [2], loans: [], updatedAt: 1},
    liveMatch: {phase: 'live', scoreA: 1, scoreB: 0, goals: [{id: 'same-goal', team: 'A', scorerId: 'a', assistStatus: 'none'}],
      timerRunning: false, timerAccumulatedMs: 0},
    lastCommittedRoundId: 'prior-round'};
}

function fixture(mock: boolean) {
  const games = [board()];
  let next: ((snap: any) => void) | undefined;
  let failure: ((error: Error) => void) | undefined;
  let reference: any;
  let listening = false;
  const read = jest.fn();
  const unsubscribe = jest.fn(() => {listening = false;});
  const onSnapshot = jest.fn((ref: any, callback: (snap: any) => void, fail: (error: Error) => void) => {
    reference = ref; next = callback; failure = fail; listening = true;
    return unsubscribe;
  });
  const scope: any = {module: {exports: {}}, USE_MOCK_DATA: mock, mockGamesV2: games,
    docs: gameReader(), onSnapshot, getDoc: read, getDocFromServer: read,
    setInterval, clearInterval, logError: jest.fn(), __DEV__: false};
  vm.runInNewContext(compile(`module.exports={${subscriber.getText(serviceFile)}};`), scope);
  const service = scope.module.exports;
  service.getGameById = read;
  const state: any = {game: {id: 'snapshot-evening', status: 'open', players: ['stale'], guests: []}};
  const setters = Object.fromEntries([
    ['setGame', 'game'], ['setLive', 'live'], ['setRotation', 'rotation'], ['setDraftTeams', 'draftTeams'],
    ['setLastCommittedRoundId', 'lastCommittedRoundId'], ['setLiveLoaded', 'liveLoaded'],
  ].map(([setter, key]) => [setter, jest.fn((value: any) => {state[key] = value;})]));
  const screenScope: any = {module: {exports: {}}, gameId: 'snapshot-evening', gameService: service,
    hydratePlayers: jest.fn(), ...setters};
  vm.runInNewContext(compile(`module.exports=${effect.arguments[0].getText(screenFile)};`), screenScope);
  const stop: () => void = screenScope.module.exports();

  const emit = (raw: any) => {
    if (mock) {
      games[0] = raw;
      jest.advanceTimersByTime(800);
      return;
    }
    if (listening) next!({exists: () => true, data: () => reference.converter.fromFirestore({id: reference.id, data: () => raw})});
  };
  if (!mock) emit(games[0]);
  return {state, emit, stop, read, onSnapshot, unsubscribe, games, setters,
    hydratePlayers: screenScope.hydratePlayers,
    fail: (error: Error) => failure!(error), logError: scope.logError,
    missing: () => next!({exists: () => false}),
    reference: () => reference,
  };
}

beforeEach(() => {jest.useFakeTimers();});
afterEach(() => {jest.clearAllTimers(); jest.useRealTimers();});

test.each([false, true])('clock activation delivers one coherent full game and all existing live parts (mock: %s)', mock => {
  const x = fixture(mock);
  const decision = roundDecisionContext(x.state.game)!;
  const next = {...board(), status: 'active', updatedAt: 2,
    liveMatch: {...board().liveMatch, timerRunning: true, timerLastStartedAt: 100}};
  x.emit(next);
  expect(x.state.game.status).toBe('active');
  expect(x.state.game.players).toEqual(['a', 'b']);
  expect(x.state.game.guests).toMatchObject([{id: 'first', name: 'אורח ראשון'}]);
  expect(x.state.game).toMatchObject({title: next.title, groupId: next.groupId, format: '4v4', seasonId: 'same-season',
    advancedMode: true, advancedFillMode: 'temporary', matchDurationMinutes: 8});
  expect(x.state.live).toBe(x.state.game.liveMatch);
  expect(x.state.rotation).toBe(x.state.game.rotation);
  expect(x.state.draftTeams).toBe(x.state.game.draftTeams);
  expect(x.state.lastCommittedRoundId).toBe('prior-round');
  expect(x.state.liveLoaded).toBe(true);
  expect(matchesRoundDecision(x.state.game, decision)).toBe(true);
  expect(x.hydratePlayers).toHaveBeenLastCalledWith(['a', 'guest:first', 'b', 'gone']);
  expect(x.read).not.toHaveBeenCalled();
  expect(x.onSnapshot).toHaveBeenCalledTimes(mock ? 0 : 1);
  if (!mock) {
    expect(x.reference()).toMatchObject({path: 'games', id: next.id});
    expect(x.state.game.matches).toEqual([]);
  }
  x.stop();
});

test.each([false, true])('roster-only updates replace registered users and guests without losing the existing board (mock: %s)', mock => {
  const x = fixture(mock);
  const originalLive = structuredClone(x.state.live), originalDraft = structuredClone(x.state.draftTeams);
  const decision = roundDecisionContext(x.state.game)!;
  const changed = {...board(), updatedAt: 2, players: ['b', 'new-member'], guests: [
    {id: 'replacement', name: 'אורח חדש', addedBy: 'manager', createdAt: 2, estimatedRating: 3.5},
    {id: 'queued', name: 'ממתין', addedBy: 'manager', createdAt: 2, waitlisted: true},
  ]};
  x.emit(changed);
  expect(x.state.game.players).toEqual(['b', 'new-member']);
  expect(x.state.game.guests).toEqual(changed.guests);
  expect(x.state.game.players).not.toContain('a');
  expect(x.state.game.guests.some((guest: any) => guest.id === 'first')).toBe(false);
  expect(x.state.live).toEqual(originalLive);
  expect(x.state.draftTeams).toEqual(originalDraft);
  expect(x.state.rotation.roundInstanceId).toBe('same-round');
  expect(x.state.lastCommittedRoundId).toBe('prior-round');
  expect(matchesRoundDecision(x.state.game, decision)).toBe(false);
  expect(x.read).not.toHaveBeenCalled();
  expect(x.onSnapshot).toHaveBeenCalledTimes(mock ? 0 : 1);
  x.stop();
});

test.each([false, true])('clearing the board and replacing all teams stays coherent with the complete snapshot (mock: %s)', mock => {
  const x = fixture(mock);
  x.emit({...board(), updatedAt: 2, liveMatch: undefined, rotation: undefined, draftTeams: undefined,
    lastCommittedRoundId: undefined, players: [], guests: []});
  expect(x.state.game.players).toEqual([]);
  expect(x.state.game.guests).toEqual([]);
  expect(x.state.live).toBeNull();
  expect(x.state.rotation).toBeNull();
  expect(x.state.draftTeams).toBeNull();
  expect(x.state.lastCommittedRoundId).toBeUndefined();
  expect(x.state.liveLoaded).toBe(true);
  expect(x.read).not.toHaveBeenCalled();
  x.stop();
});

test.each([false, true])('unsubscribe tears down the only live transport and stops later deliveries (mock: %s)', mock => {
  const x = fixture(mock);
  const calls = x.setters.setGame.mock.calls.length;
  x.stop();
  x.emit({...board(), updatedAt: 2, status: 'active', players: ['too-late']});
  expect(x.setters.setGame).toHaveBeenCalledTimes(calls);
  expect(x.state.game.players).toEqual(['a', 'b']);
  expect(x.unsubscribe).toHaveBeenCalledTimes(mock ? 0 : 1);
  if (mock) expect(jest.getTimerCount()).toBe(0);
  expect(x.read).not.toHaveBeenCalled();
});

test.each(['finished', 'cancelled'])('real converted terminal status %s reaches the screen and still invalidates an old decision', status => {
  const x = fixture(false);
  const decision = roundDecisionContext(x.state.game)!;
  x.emit({...board(), updatedAt: 2, status});
  expect(x.state.game.status).toBe(status);
  expect(matchesRoundDecision(x.state.game, decision)).toBe(false);
  expect(x.read).not.toHaveBeenCalled();
  x.stop();
});

test('a missing real document still clears live fields without fabricating an empty game', () => {
  const x = fixture(false), current = x.state.game;
  x.missing();
  expect(x.state.game).toBe(current);
  expect(x.state.live).toBeNull();
  expect(x.state.rotation).toBeNull();
  expect(x.state.draftTeams).toBeNull();
  expect(x.read).not.toHaveBeenCalled();
  x.stop();
});

test('a listener failure logs the source error without replacing the latest game by an empty roster', () => {
  const x = fixture(false), current = x.state.game, error = new Error('offline');
  x.fail(error);
  expect(x.state.game).toBe(current);
  expect(x.logError).toHaveBeenCalledWith('subscribeLiveGame', error, {gameId: current.id});
  expect(x.read).not.toHaveBeenCalled();
  x.stop();
});
