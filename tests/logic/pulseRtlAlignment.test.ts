import fs from 'fs';
import path from 'path';
import vm from 'vm';
import ts from 'typescript';

function theme(os: string) {
  const module = { exports: {} as any };
  const compiled = ts.transpileModule(fs.readFileSync('pulse/src/theme.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
  }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react-native') return { Platform: { OS: os } }; throw Error(name);
  } });
  return module.exports;
}

test.each(['android', 'ios'])('Pulse anchors labels to RTL paragraph start on %s and values to the other edge', os => {
  const t = theme(os);
  expect(t.RTL_LABEL_ALIGN).toBe('left');
  expect(t.RTL_VALUE_ALIGN).toBe('right');
  for (const key of ['h1', 'h2', 'title', 'body', 'small']) {
    expect(t.font[key]).toMatchObject({ direction: 'rtl', textAlign: 'left' });
    expect(t.font[key]).not.toHaveProperty('writingDirection');
  }
});

test('browser previews keep physical CSS alignment instead of copying the native swap', () => {
  const t = theme('web');
  expect(t.RTL_LABEL_ALIGN).toBe('right');
  expect(t.RTL_VALUE_ALIGN).toBe('left');
});

test.each(['מתן לוי', 'Lioz Madar', 'אלירן Teamder', '27.4.2026'])('player text isolates preserve the original value: %s', value => {
  expect(theme('android').isolateText(value)).toBe('\u2068' + value + '\u2069');
});

test('Pulse screen labels cannot silently reintroduce physical right alignment or explicit RTL writingDirection', () => {
  const violations: string[] = [];
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else if (/\.tsx?$/.test(file) && !file.endsWith('theme.ts') && !file.endsWith('secrets.ts')) {
        const text = fs.readFileSync(file, 'utf8');
        if (/textAlign:\s*'right'|writingDirection:\s*'rtl'/.test(text)) violations.push(file);
      }
    }
  }
  walk('pulse/src');
  expect(violations).toEqual([]);
});

test('native Pulse views contain no standalone raw text or spaces between child elements', () => {
  const violations: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (file.endsWith('.tsx')) {
        const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        function visit(node: ts.Node) {
          if (ts.isJsxText(node) && node.text.length && (node.text.trim().length > 0 || !node.text.includes('\n')) && ts.isJsxElement(node.parent)
            && ['View', 'Pressable', 'ScrollView', 'SafeAreaView'].includes(node.parent.openingElement.tagName.getText(ast))) {
            violations.push(file + ':' + (ast.getLineAndCharacterOfPosition(node.pos).line + 1));
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
  }
  walk('pulse/src');
  expect(violations).toEqual([]);
});
