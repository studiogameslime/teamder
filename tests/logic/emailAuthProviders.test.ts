import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

// Execute the real screen handler without native auth, credentials or network I/O.
const source = fs.readFileSync('src/screens/auth/EmailAuthScreen.tsx', 'utf8');
const file = ts.createSourceFile('EmailAuthScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler() {
  let body = '';
  function walk(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'onProvider') body = node.initializer!.getText(file);
    ts.forEachChild(node, walk);
  }
  walk(file);
  if (!body) throw Error('Missing provider handler');
  return ts.transpileModule(`(${body})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
function setup(outcome: object, completed = true) {
  const refreshFromSession = jest.fn().mockResolvedValue(undefined);
  const finishParkedAction = jest.fn();
  const upgradeAnonymous = jest.fn().mockResolvedValue(outcome);
  const appAlert = jest.fn();
  const inFlight = { current: false };
  const run = vm.runInNewContext(handler(), {
    inFlight, setBusy: jest.fn(), setProvider: jest.fn(), upgradeAnonymous,
    useUserStore: { getState: () => ({ refreshFromSession, hasCompletedOnboarding: () => completed }) },
    finishParkedAction, appAlert, he: { error: 'שגיאה', signInFailed: 'נסה שוב' },
    logEvent: jest.fn(), AnalyticsEvent: {},
  });
  return { run, upgradeAnonymous, refreshFromSession, finishParkedAction, appAlert, inFlight };
}
test('email screen social sign-in restores the selected account before resuming a parked action', async () => {
  const s = setup({ status: 'switched', uid: 'existing', isNewAccount: false });
  await s.run('google');
  expect(s.refreshFromSession).toHaveBeenCalledWith('existing');
  expect(s.refreshFromSession.mock.invocationCallOrder[0]).toBeLessThan(s.finishParkedAction.mock.invocationCallOrder[0]);
  expect(s.inFlight.current).toBe(false);
});
test('new social account waits for profile completion instead of resuming early', async () => {
  const s = setup({ status: 'linked', uid: 'new', isNewAccount: true }, false);
  await s.run('apple');
  expect(s.refreshFromSession).toHaveBeenCalledWith('new');
  expect(s.finishParkedAction).not.toHaveBeenCalled();
});
test.each(['cancelled', 'failed'])('social %s does not navigate or resume', async status => {
  const s = setup({ status, code: 'offline', message: 'אין חיבור' });
  await s.run('google');
  expect(s.refreshFromSession).not.toHaveBeenCalled();
  expect(s.finishParkedAction).not.toHaveBeenCalled();
  expect(s.appAlert).toHaveBeenCalledTimes(status === 'failed' ? 1 : 0);
});
test('duplicate provider presses and profile read failures cannot resume an action', async () => {
  const s = setup({ status: 'switched', uid: 'existing' });
  s.refreshFromSession.mockRejectedValue(Error('offline'));
  await Promise.all([s.run('google'), s.run('google')]);
  expect(s.upgradeAnonymous).toHaveBeenCalledTimes(1);
  expect(s.finishParkedAction).not.toHaveBeenCalled();
  expect(s.inFlight.current).toBe(false);
});
