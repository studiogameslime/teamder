import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { waitForJoinResult } from '../../src/utils/joinRequestResult';

const source = fs.readFileSync('src/services/gameService.ts', 'utf8');
const ast = ts.createSourceFile('service.ts', source, ts.ScriptTarget.Latest, true);
let method = '';
const visit = (node: ts.Node) => { if (ts.isMethodDeclaration(node) && node.name.getText(ast) === 'requestJoinGame') method = node.getText(ast); ts.forEachChild(node, visit); };
visit(ast);
const flush = () => new Promise<void>(done => setImmediate(done));

test.each(['players', 'waitlist', 'pending'])('join success and elapsed time are recorded only after the server assigns %s', async bucket => {
  let receive!: (snapshot: unknown) => void;
  const stop = jest.fn(), log = jest.fn();
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: false,
    serverNow: Date.now, clearMyGamesCache: jest.fn(), LATE_REG_GRACE_MS: 3600000,
    docs: { game: () => ({}) }, getDoc: async () => ({ exists: () => true, data: () => ({ status: 'open', startsAt: Date.now() + 60000 }) }),
    gameService: { findRegistrationConflict: async () => null },
    getFirebase: () => ({ db: {}, auth: { currentUser: { uid: 'viewer' } } }),
    doc: () => ({}), deleteDoc: async () => {}, setDoc: async () => {}, serverTimestamp: () => 0,
    logEvent: log, AnalyticsEvent: { GameJoinRequested: 'requested', GameJoined: 'joined' },
    onSnapshot: (_: unknown, next: typeof receive) => { receive = next; return stop; }, waitForJoinResult,
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = {${method}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const result = context.module.exports.requestJoinGame('round', 'viewer', 'match_details');
  await flush();
  expect(log.mock.calls.map(call => call[0])).toEqual(['requested']);
  receive({ exists: () => true, data: () => ({ state: 'queued' }) }); await flush();
  expect(log).toHaveBeenCalledTimes(1);
  receive({ exists: () => true, data: () => ({ state: 'assigned', bucket }) });
  await expect(result).resolves.toEqual({ bucket });
  expect(log.mock.calls[1]).toEqual(['joined', expect.objectContaining({ gameId: 'round', source: 'match_details', bucket, requestMs: expect.any(Number), totalMs: expect.any(Number) })]);
  expect(log.mock.calls[1][1].totalMs).toBeGreaterThanOrEqual(log.mock.calls[1][1].requestMs);
  expect(stop).toHaveBeenCalledTimes(1);
});

function parallelWorld(serverKickoff: number) {
  let finishGame!: (v: any) => void, receive!: (snapshot: any) => void;
  const conflict = jest.fn().mockResolvedValue(null), stop = jest.fn();
  const gameRead = new Promise(done => { finishGame = done; });
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: false,
    serverNow: Date.now, clearMyGamesCache: jest.fn(), LATE_REG_GRACE_MS: 3600000,
    docs: { game: () => ({}) }, getDoc: () => gameRead,
    gameService: { findRegistrationConflict: conflict },
    getFirebase: () => ({ db: {}, auth: { currentUser: { uid: 'viewer' } } }),
    doc: () => ({}), deleteDoc: async () => {}, setDoc: async () => {}, serverTimestamp: () => 0,
    logEvent: jest.fn(), AnalyticsEvent: { GameJoinRequested: 'requested', GameJoined: 'joined' },
    onSnapshot: (_: unknown, next: typeof receive) => { receive = next; return stop; }, waitForJoinResult,
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = {${method}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { conflict, service: context.module.exports,
    resolveGame: () => finishGame({ exists: () => true, data: () => ({ status: 'open', startsAt: serverKickoff }) }),
    assign: () => receive({ exists: () => true, data: () => ({ state: 'assigned', bucket: 'players' }) }),
  };
}

test.each([false, true])('conflict lookup overlaps game read; changed kickoff=%s rechecks before registration', async changed => {
  const known = Date.now() + 60000, actual = known + (changed ? 60000 : 0);
  const w = parallelWorld(actual);
  const result = w.service.requestJoinGame('round', 'viewer', 'match_details', known);
  expect(w.conflict).toHaveBeenCalledWith('viewer', { id: 'round', startsAt: known });
  w.resolveGame(); await flush();
  expect(w.conflict).toHaveBeenCalledTimes(changed ? 2 : 1);
  expect(w.conflict).toHaveBeenLastCalledWith('viewer', { id: 'round', startsAt: actual });
  w.assign(); await expect(result).resolves.toEqual({ bucket: 'players' });
});
