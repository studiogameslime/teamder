import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

type Element = { type: string; props: Record<string, any>; children: any[] };
const file = 'src/screens/communities/CommunityDetailsScreen.tsx';
const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'StatCell');
const styles = source.statements.flatMap(node => ts.isVariableStatement(node) ? Array.from(node.declarationList.declarations) : [])
  .find(node => node.name.getText(source) === 'statsSectionStyles');
if (!declaration || !styles?.initializer) throw Error('Missing actual stat cell source');
const context = {
  React: { createElement: (type: string, props: Record<string, any>, ...children: any[]): Element => ({ type, props: props ?? {}, children: children.flat() }) },
  View: 'View', Text: 'Text', Ionicons: 'Icon', StyleSheet: { create: (value: unknown) => value },
  spacing: { sm: 8, md: 12, lg: 16 }, colors: { surface: '#fff', text: '#111' },
  clubShadow: {}, clubSurface: { subtle: '#777' }, RTL_LABEL_ALIGN: 'left',
};
const render = vm.runInNewContext(ts.transpileModule(`const statsSectionStyles = ${styles.initializer.getText(source)};
${declaration.getText(source)};
StatCell;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
function nodes(element: Element): Element[] { return [element, ...element.children.flatMap(child => child && typeof child === 'object' && child.type ? nodes(child) : [])]; }

test.each([
  ['שחקנים', '23'], ['גולים', '—'], ['מחזורים', '42'], ['משחקים', '328'],
])('club counter %s preserves its value and permits the enlarged caption to wrap', (label, value) => {
  const tree = render({ label, value, icon: 'football', tint: '#123456' });
  const all = nodes(tree);
  const caption = all.find(node => node.type === 'Text' && node.children.includes(label))!;
  const number = all.find(node => node.type === 'Text' && node.children.includes(value))!;
  expect(caption).toBeDefined(); expect(number).toBeDefined();
  expect(caption.props.numberOfLines).toBe(2);
  expect(caption.props.allowFontScaling).not.toBe(false);
  expect(caption.props.maxFontSizeMultiplier).toBeUndefined();
  expect(caption.props.adjustsFontSizeToFit).not.toBe(true);
  expect(caption.props.style.lineHeight).toBeGreaterThanOrEqual(caption.props.style.fontSize);
  // The caption owns the card width below the value/icon row. Allowing two
  // lines in the former narrow number column still split the final Hebrew
  // letter onto a line alone at 320/140%; line count by itself was insufficient.
  expect(tree.children[1]).toBe(caption);
  expect(nodes(tree.children[0]).some(node => node.type === 'Icon')).toBe(true);
  expect(tree.children[0].props.style.flexDirection).toBe('row');
  expect(tree.props.style.alignItems).toBe('stretch');
  // Text and its ancestors must grow with native font metrics; a second line
  // cannot be clipped by a fixed card/text height. Native screenshots verify
  // the actual wrapping at 320 points and 140%, beyond this contract check.
  for (const node of all.filter(item => item === caption || (item.type === 'View' && nodes(item).includes(caption)))) {
    const style = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    expect(style?.height).toBeUndefined(); expect(style?.maxHeight).toBeUndefined();
  }
  expect(all.filter(node => node.type === 'Icon')).toHaveLength(1);
  expect(number.children).toEqual([value]);
});
