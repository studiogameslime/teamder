import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

function fixture(guest = false) {
  const source = ts.createSourceFile('home.tsx', fs.readFileSync('src/screens/tabs/ProfileScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback = '';
  function walk(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'useFocusEffect') {
      const text = n.getText(source);
      if (text.includes('getInboxCount(uid)')) callback = (n.arguments[0] as ts.CallExpression).arguments[0].getText(source);
    }
    ts.forEachChild(n, walk);
  }
  walk(source);
  expect(callback).not.toBe('');
  const setInboxCount = jest.fn(), getInboxCount = jest.fn();
  const remove = jest.fn();
  let stateChanged!: (s: string) => void;
  const effect = vm.runInNewContext(ts.transpileModule(`(${callback})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
    localUser: { id: 'owner', isGuest: guest }, setInboxCount, getInboxCount,
    AppState: { addEventListener: (_: string, cb: (s: string) => void) => { stateChanged = cb; return { remove }; } },
  });
  return { effect, setInboxCount, getInboxCount, remove, change: (s: string) => stateChanged(s) };
}

test('foreground refresh replaces a suspended request and ignores its late response', async () => {
  const f = fixture();
  let old!: (n: number) => void;
  f.getInboxCount.mockReturnValueOnce(new Promise(resolve => { old = resolve; })).mockResolvedValueOnce(7);
  const cleanup = f.effect();
  f.change('background');
  f.change('active');
  await Promise.resolve();
  expect(f.setInboxCount).toHaveBeenLastCalledWith(7);
  old(1); await Promise.resolve();
  expect(f.setInboxCount).toHaveBeenCalledTimes(1);
  cleanup(); expect(f.remove).toHaveBeenCalledTimes(1);
});

test('a pending result cannot write after leaving the screen', async () => {
  const f = fixture();
  let finish!: (n: number) => void;
  f.getInboxCount.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  f.effect()(); finish(8); await Promise.resolve();
  expect(f.setInboxCount).not.toHaveBeenCalled();
});

test('guest count clears without a network call or resume subscription', () => {
  const f = fixture(true);
  expect(f.effect()).toBeUndefined();
  expect(f.setInboxCount).toHaveBeenCalledWith(0);
  expect(f.getInboxCount).not.toHaveBeenCalled();
});
