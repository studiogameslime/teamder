import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

// Evaluate the actual JSX copy, including its render guard. This keeps count
// zero distinct from a visible warning, without adding product-only helpers.
function copyExpression(file: string, token: string) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = '';
  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression) && node.expression.getText(tree).includes(token) && !node.expression.getText(tree).includes('<')) expression = node.expression.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!expression) throw Error(`Missing real copy: ${token}`);
  const code = ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return (context: object) => vm.runInNewContext(code, context);
}
const remaining = copyExpression('src/components/draft/ManualAllocation.tsx', 'שחקנים לשיבוץ');
const tie = copyExpression('src/components/match/Shootout.tsx', 'אישור הכרעה אחרת ימחק');
const winner = copyExpression('src/components/match/WinnerPickerModal.tsx', 'אישור המנצחת ימחק');

test.each([
  [0, 'כל השחקנים שובצו'],
  [1, 'נותר שחקן אחד לשיבוץ'],
  [2, 'נותרו 2 שחקנים לשיבוץ'],
])('manual allocation explains %s remaining players without changing the zero state', (count, expected) => {
  expect(remaining({ pool: { length: count } })).toBe(expected);
});

// Select the outer JSX expression to retain the condition that hides warnings
// for count zero. Inner JSX expressions hold only the text.
function guardedWarning(file: string, token: string) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let outer = '';
  function visit(node: ts.Node) {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression) && node.expression.getText(tree).includes(token)) outer = node.expression.getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree); if (!outer) throw Error('Missing actual warning visibility condition');
  const code = ts.transpileModule(`(${outer})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return (count: number) => vm.runInNewContext(code, {
    discardedPenaltyCount: count, Text: 'Text', s: { hint: {} }, styles: { subtitle: {} },
    React: { createElement: (_type: unknown, _props: unknown, text: string) => text },
  });
}
const tieVisible = guardedWarning('src/components/match/Shootout.tsx', 'אישור הכרעה אחרת ימחק');
const winnerVisible = guardedWarning('src/components/match/WinnerPickerModal.tsx', 'אישור המנצחת ימחק');
test.each([
  [0, false, false],
  [1, 'אישור הכרעה אחרת ימחק את הבעיטה שנרשמה. חזרה לפנדלים תשמור אותה.', 'אישור המנצחת ימחק את הבעיטה שנרשמה בפנדלים.'],
  [2, 'אישור הכרעה אחרת ימחק את 2 הבעיטות שנרשמו. חזרה לפנדלים תשמור אותן.', 'אישור המנצחת ימחק את 2 הבעיטות שנרשמו בפנדלים.'],
])('tie and winner warnings describe %s kicks and preserve zero visibility', (count, tieExpected, winnerExpected) => {
  expect(tieVisible(count as number)).toBe(tieExpected);
  expect(winnerVisible(count as number)).toBe(winnerExpected);
  if (count) {
    expect(tie({ discardedPenaltyCount: count })).toBe(tieExpected);
    expect(winner({ discardedPenaltyCount: count })).toBe(winnerExpected);
  }
});
