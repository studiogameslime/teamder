// Static inventory only: these counts identify candidates, never measured latency.
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const crypto = require('crypto');
const root = path.resolve(__dirname, '../..');
function files(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(rel) : /\.tsx?$/.test(rel) ? [rel] : [];
  });
}
function inspect(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const result = { file, hash: crypto.createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex'),
    awaits: [], effects: [], loading: [], reads: [], navigation: [], actions: [], lists: [] };
  const add = (kind, node, code = node.getText(sf)) => result[kind].push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, code: code.slice(0, 220) });
  function visit(node) {
    if (ts.isAwaitExpression(node)) add('awaits', node);
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(sf);
      if (/^(React\.)?use(FocusEffect|Effect|LayoutEffect)$/.test(name)) add('effects', node, `${name}(${node.arguments.at(-1)?.getText(sf) ?? ''})`);
      if (/^set.*(Loading|Busy|Saving|Submitting)$/.test(name)) add('loading', node);
      if (/\.(get\w*|list\w*|load\w*|hydrate\w*|subscribe\w*|compute|deriveCounters)$/.test(name) || /^(getDocs?|getDocFromServer|httpsCallable|fetch)$/.test(name)) add('reads', node);
      // Array.push/String.replace are not navigation. Include dispatch-based
      // resets and casts, while retaining the original source for inspection.
      if (/\.(navigate|push|replace|reset|goBack|dispatch)$/.test(name) && /(nav|router)/i.test(name)) add('navigation', node);
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (/FlatList|ScrollView|ScrollSurface|SectionList/.test(tag)) add('lists', node, tag);
      for (const attr of node.attributes.properties) {
        if (ts.isJsxAttribute(attr) && /^on[A-Z]\w*$/.test(attr.name.getText(sf))) add('actions', attr);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return result;
}
const entries = [...files('src/screens'), ...files('src/components'), ...files('src/navigation'), ...files('src/services'), ...files('src/store')].sort().map(inspect);
const summary = {};
for (const area of ['screens', 'components', 'navigation', 'services', 'store']) {
  const rows = entries.filter(row => row.file.startsWith(`src/${area}/`));
  summary[area] = { files: rows.length, ...Object.fromEntries(['awaits', 'effects', 'loading', 'reads', 'navigation', 'actions'].map(key => [key, rows.reduce((total, row) => total + row[key].length, 0)])) };
}
const directory = path.join(root, 'artifacts/loading-performance-2026-10-24');
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'inventory.json'), JSON.stringify({ at: new Date().toISOString(), schema: 2, method: 'TypeScript AST; all JSX onX event attributes, navigation/router calls including dispatch, broad read candidates that may include non-network getters; static only, no runtime latency claims', summary, entries }, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
