// Maintenance aid, not proof that a module can safely be deleted.
// Usage: node scripts/audit-source-reachability.cjs <output.json>
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = process.cwd();
const output = process.argv[2];
if (!output) throw new Error('Specify an output JSON file inside the repository');
const destination = path.resolve(root, output);
if (!destination.startsWith(root + path.sep)) throw new Error('Output must stay inside the repository');
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute);
    else if (/\.tsx?$/.test(entry.name)) files.push(absolute);
  }
}
walk(path.join(root, 'src'));
files.push(path.join(root, 'App.tsx'));
const candidates = new Set(files);
const edges = new Map();
const relative = value => path.relative(root, value).replaceAll('\\', '/');
function resolve(specifier, importer) {
  const base = specifier.startsWith('@/') ? path.join(root, 'src', specifier.slice(2))
    : specifier.startsWith('.') ? path.resolve(path.dirname(importer), specifier) : null;
  return base && [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')]
    .find(value => candidates.has(value));
}
for (const file of files) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = new Set();
  function visit(node) {
    let specifier;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(tree) === 'require')) specifier = node.arguments[0].text;
    if (specifier) { const dependency = resolve(specifier, file); if (dependency) imports.add(dependency); }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  edges.set(file, imports);
}
const reached = new Set();
function mark(file) { if (reached.has(file)) return; reached.add(file); for (const dependency of edges.get(file) || []) mark(dependency); }
mark(path.join(root, 'App.tsx'));
const retained = files.filter(file => !reached.has(file)).map(file => ({
  file: relative(file),
  decision: 'retain-outside-active-app',
  referencedBy: files.filter(importer => edges.get(importer).has(file)).map(relative),
}));
const result = { date: '2026-10-10', entry: 'App.tsx', sourceCount: files.length, reachable: reached.size,
  limitation: 'Static literal imports, including types; does not prove absence of test/tool/native/dynamic consumers.', retained };
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ sourceCount: result.sourceCount, reachable: result.reachable, retained: retained.length, output }));
