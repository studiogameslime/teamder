import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

// Execute the screen's actual navigation-listener effect with a mocked save.
// This isolates closure lifetime without invoking profile/media services.
function fixture() {
  const file = ts.createSourceFile('profile.tsx', fs.readFileSync('src/screens/tabs/ProfileEditScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const screen = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProfileEditScreen') as ts.FunctionDeclaration;
  if (!screen?.body) throw new Error('Missing profile editor');
  const body = screen.body.statements;
  const listener = body.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(file) === 'useEffect' && node.getText(file).includes("'beforeRemove'"));
  if (!listener) throw new Error('Missing leave listener');
  const latestRef = body.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'saveRef'));
  const assignment = body.find(node => ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression) && node.expression.left.getText(file) === 'saveRef.current');
  const code = ts.transpileModule(`function render(save) { ${latestRef?.getText(file) || ''}\n${listener.getText(file)}\n${assignment?.getText(file) || ''} }; globalThis.render=render;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  let listenerCallback: any, mounted = false, ref: any;
  const dirtyRef = { current: true }, savingRef = { current: false }, alert = jest.fn(), dispatch = jest.fn();
  const context: any = {
    dirtyRef, savingRef, appAlert: alert,
    he: { profileEditUnsavedSave: 'שמור', profileEditUnsavedDiscard: 'התעלם וצא', cancel: 'בטל' },
    nav: { addListener: jest.fn((_event: string, callback: any) => { listenerCallback = callback; return jest.fn(); }), dispatch },
    useRef: (value: any) => ref ?? (ref = { current: value }),
    useEffect: (effect: any) => { if (!mounted) { effect(); mounted = true; } },
  };
  vm.runInNewContext(code, context);
  const attempt = () => {
    const preventDefault = jest.fn(), action = { type: 'GO_BACK' };
    listenerCallback({ preventDefault, data: { action } });
    return { preventDefault, action };
  };
  const option = (label: string) => alert.mock.calls[alert.mock.calls.length - 1][2].find((button: any) => button.text === label);
  return { render: context.render as (save: () => any) => void, attempt, option, alert, dispatch, dirtyRef, savingRef, addListener: context.nav.addListener };
}

test('profile exit saves the latest name/photo draft using the existing listener', async () => {
  const f = fixture(), persist = jest.fn();
  f.render(() => persist({ name: 'שם קודם', photoUrl: 'old' }));
  f.render(() => persist({ name: 'שם עדכני', photoUrl: 'new' }));
  f.attempt(); await f.option('שמור').onPress();
  expect(persist).toHaveBeenCalledWith({ name: 'שם עדכני', photoUrl: 'new' });
  expect(f.addListener).toHaveBeenCalledTimes(1);
});

test('an already-open profile exit dialog saves current edits after a rerender', async () => {
  const f = fixture(), original = jest.fn(), latest = jest.fn();
  f.render(original); f.attempt(); const save = f.option('שמור');
  f.render(latest); await save.onPress();
  expect(original).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1);
});

test('the profile listener keeps dirty/saving and discard navigation behavior unchanged', () => {
  const f = fixture(); f.render(jest.fn());
  f.savingRef.current = true; expect(f.attempt().preventDefault).not.toHaveBeenCalled();
  f.savingRef.current = false; f.dirtyRef.current = false; expect(f.attempt().preventDefault).not.toHaveBeenCalled();
  f.dirtyRef.current = true; const { preventDefault, action } = f.attempt();
  expect(preventDefault).toHaveBeenCalledTimes(1); f.option('התעלם וצא').onPress();
  expect(f.dispatch).toHaveBeenCalledWith(action);
});
