import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { isWearableApiUnavailable } from '../../src/utils/expectedIntegrationError';

function sourceFunction(file: string, name: string, context: Record<string, unknown>, variable = false) {
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let code = '';
  const walk = (node: ts.Node) => {
    if (!variable && ts.isFunctionDeclaration(node) && node.name?.text === name) code = node.getText(ast).replace(/^export\s+/, '');
    if (variable && ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      const initializer = node.initializer;
      code = ts.isCallExpression(initializer) ? initializer.arguments[0].getText(ast) : initializer.getText(ast);
    }
    ts.forEachChild(node, walk);
  };
  walk(ast);
  if (!code) throw new Error(name);
  const output = ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return vm.runInNewContext(output, context);
}

function watchFixture() {
  const bridge = { publishState: jest.fn(async () => undefined) };
  const computeWatchPayload = jest.fn(async () => ({ kind: 'notRegistered' }));
  const observeCaughtError = jest.fn(), drainNativeDiagnostics = jest.fn();
  const publish = sourceFunction('src/services/watchSyncService.ts', 'publishWatchState', {
    USE_MOCK_DATA: false, resolveWatchBridge: () => bridge, syncServerClock: async () => 0,
    publishSeq: 0, lastPublishedSeq: 0, computeWatchPayload, observeCaughtError,
    isWearableApiUnavailable, drainNativeDiagnostics, __DEV__: false,
  });
  return { publish, bridge, computeWatchPayload, observeCaughtError, drainNativeDiagnostics };
}

const unavailable = new Error('17: API: Wearable.API is not available on this device. ConnectionResult{statusCode=API_UNAVAILABLE}');
test('unavailable wearable relay does not report or disable later widget publishes', async () => {
  const f = watchFixture(); f.bridge.publishState.mockRejectedValueOnce(unavailable);
  await f.publish([], { id: 'owner', name: 'Owner' });
  await f.publish([], { id: 'owner', name: 'Owner' });
  expect(f.bridge.publishState).toHaveBeenCalledTimes(2);
  expect(f.observeCaughtError).not.toHaveBeenCalled();
  expect(f.drainNativeDiagnostics).toHaveBeenCalledTimes(2);
});

test('other wearable bridge failures still report', async () => {
  const f = watchFixture(), error = new Error('Wearable.API transmission failed');
  f.bridge.publishState.mockRejectedValueOnce(error);
  await f.publish([], { id: 'owner', name: 'Owner' });
  expect(f.observeCaughtError).toHaveBeenCalledWith(error, expect.anything());
});

test('capability-looking payload failures cannot be hidden as bridge absence', async () => {
  const f = watchFixture(); f.computeWatchPayload.mockRejectedValueOnce(unavailable);
  await f.publish([], { id: 'owner', name: 'Owner' });
  expect(f.observeCaughtError).toHaveBeenCalledWith(unavailable, expect.anything());
  expect(f.bridge.publishState).not.toHaveBeenCalled();
});

test.each(['src/components/RequestsBell.tsx', 'src/screens/games/GamesListScreen.tsx'])('%s skips guest requests and reads signed-in inbox counts', async file => {
  const getInboxCount = jest.fn(async () => 3), setCount = jest.fn(), setRequestCount = jest.fn();
  const user = { id: 'owner', isGuest: true };
  const context = { user, isGuest: true, alive: true, getInboxCount, setCount, setRequestCount, observeCaughtError: jest.fn() };
  const fetch = sourceFunction(file, 'fetchCount', context, true);
  fetch(); await Promise.resolve();
  expect(getInboxCount).not.toHaveBeenCalled();
  user.isGuest = false; context.isGuest = false;
  fetch(); await Promise.resolve();
  expect(getInboxCount).toHaveBeenCalledWith('owner');
  expect(file.includes('RequestsBell') ? setCount : setRequestCount).toHaveBeenLastCalledWith(3);
  context.alive = false; getInboxCount.mockResolvedValue(9);
  fetch(); await Promise.resolve();
  expect(file.includes('RequestsBell') ? setCount : setRequestCount).toHaveBeenLastCalledWith(3);
});

test('direct guest inbox navigation clears old data without requesting friends', async () => {
  const getInboxRequests = jest.fn(), setData = jest.fn();
  const empty = { friends: [], communities: [], games: [], total: 0 };
  const load = sourceFunction('src/screens/RequestsScreen.tsx', 'load', {
    me: { id: 'guest', isGuest: true }, loadVersion: { current: 0 }, EMPTY: empty,
    getInboxRequests, setData, setLoadFailed: jest.fn(), setLoading: jest.fn(), setRefreshing: jest.fn(),
  }, true);
  await load();
  expect(getInboxRequests).not.toHaveBeenCalled();
  expect(setData).toHaveBeenCalledWith(empty);
});
