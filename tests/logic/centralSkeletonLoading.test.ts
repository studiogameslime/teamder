import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

const file = ts.createSourceFile('OwnPlayerCard.tsx', fs.readFileSync('src/components/profile/OwnPlayerCard.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'LoadState')!;
const createElement = (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } });
const read = vm.runInNewContext(ts.transpileModule('(' + declaration.getText(file) + ')', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText, { React: { createElement }, OwnCardSectionSkeleton: 'Skeleton', LoadingNotice: 'Refresh', View: 'View', Text: 'Text', Link: 'Link', s: { state: {}, body: {} } });

test.each(['upcoming', 'round', 'numbers', 'clubs', 'referrals', 'profile'])('an unanswered personal card section uses its own %s skeleton', kind => {
  expect(read({ remote: { loading: true }, retry: jest.fn(), kind })).toMatchObject({ type: 'Skeleton', props: { kind } });
});

test.each([0, [], { goals: 2 }])('refreshing an answered personal card section preserves its content, including zero and empty results: %p', value => {
  expect(read({ remote: { value, loading: true }, retry: jest.fn(), kind: 'numbers' }).type).toBe('Refresh');
  expect(read({ remote: { value }, retry: jest.fn() })).toBeNull();
});

test('a failed personal card section presents retry even if the refresh flag has not cleared', () => {
  const retry = jest.fn();
  const tree = read({ remote: { loading: true, failed: true }, retry, kind: 'clubs' });
  expect(tree.type).toBe('View');
  const action = tree.props.children.find((child: any) => child.type === 'Link');
  expect(action.props.title).toBe('נסה שוב');
  action.props.onPress(); expect(retry).toHaveBeenCalledTimes(1);
});
