#!/usr/bin/env node
// Structural inventory and repeatable additive instrumentation; no regex rewrites.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const boundaries = {
  'src/utils/errorIdentity.ts': 'Error identity inspection must not recursively report its own protected-property failure.',
  'functions/src/errorIdentity.ts': 'Error identity inspection recursion boundary; mirrored across runtimes.',
  'pulse/src/services/errorIdentity.ts': 'Error identity inspection recursion boundary; mirrored across runtimes.',
  'src/services/errorLog.ts': 'Reporter delivery/retry and global-handler installation: avoid recursive reports.',
  'src/services/diagnosticStorage.ts': 'Reporter persistence: unavailable storage must not recursively persist itself.',
  'src/services/diagnosticJournal.ts': 'Reporter journal: must not recursively record its own failure.',
  'src/utils/diagnosticRedaction.ts': 'Reporter sanitizer: must not report unredacted fallback values.',
  'src/utils/errorObservation.ts': 'Reporter dispatch recursion boundary.',
  'functions/src/serverErrorLog.ts': 'Reporter transport: terminal failure remains in server logs.',
  'functions/src/diagnosticRedaction.ts': 'Reporter sanitizer recursion boundary; mirrored from client sanitizer.',
  'functions/src/clientDiagnostics.ts': 'Diagnostic ingestion must not report its own delivery failures.',
  'pulse/src/services/errorLog.ts': 'Reporter transport: isolated from automatic observation.',
  'pulse/src/services/errorObservation.ts': 'Reporter dispatch recursion boundary.',
  'pulse/src/services/diagnosticRedaction.ts': 'Reporter sanitizer recursion boundary.',
  'pulse/src/services/adminSession.ts': 'Reporter authentication transport: failures reported by callers; no recursive retry.',
};
function domain(file) {
  if (/^(src\/|modules\/.*\.tsx?$|App\.tsx$)/.test(file)) return 'app';
  if (file.startsWith('functions/src/')) return 'server';
  if (/^pulse\/(src\/|App\.tsx$)/.test(file)) return 'pulse';
  return 'tooling-or-third-party';
}
function functionName(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) {
      if (p.name) return p.name.getText();
      if (p.parent && (ts.isVariableDeclaration(p.parent) || ts.isPropertyAssignment(p.parent))) return p.parent.name.getText();
    }
  }
  return 'module';
}
function inspect(file, source, write = false) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const runtime = domain(file), changes = [], rows = [];
  const add = (at, text) => changes.push({ at, text });
  let needCatch = false, needSettled = false, needRejection = false, needListener = false;
  function isHttpResponse(name, node) {
    for (let scope=node.parent;scope;scope=scope.parent) {
      if (!scope.statements) continue;
      for (const statement of scope.statements) if (ts.isVariableStatement(statement)) {
        const declaration=statement.declarationList.declarations.find(d=>ts.isIdentifier(d.name)&&d.name.text===name);
        if (!declaration) continue;
        let value=declaration.initializer;
        if (value && ts.isAwaitExpression(value)) value=value.expression;
        return !!value && ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text==='fetch';
      }
    }
    return false;
  }
  function visit(node) {
    let block, callback, kind;
    if (ts.isIfStatement(node) && runtime !== 'tooling-or-third-party' && !boundaries[file]) {
      const check = node.expression.getText(sf).match(/^!([A-Za-z_$][\w$]*)\.ok$/) ?? node.expression.getText(sf).match(/^([A-Za-z_$][\w$]*)\.status\s*!==?\s*200$/);
      const body = node.thenStatement.getText(sf);
      if (check && isHttpResponse(check[1],node) && /\breturn\b/.test(body) && !/\bthrow\b/.test(body)) {
        const handler=functionName(node),line=sf.getLineAndCharacterOfPosition(node.getStart(sf)).line+1;
        const covered=body.includes('observeCaughtError(');
        rows.push({file,line,runtime,kind:'http-fallback',handler,state:covered?'observed':'uncovered'});
        if (write && !covered) {
          const origin=JSON.stringify({source:file,handler,site:`${path.basename(file)}:http:${line}`});
          const statement=`observeCaughtError(Object.assign(new Error('HTTP request failed'), {code: 'http/' + ${check[1]}.status}), ${origin});`;
          if (ts.isBlock(node.thenStatement)) add(node.thenStatement.getStart(sf)+1,`\n    ${statement}`);
          else {add(node.thenStatement.getStart(sf),`{ ${statement} `);add(node.thenStatement.end,' }');}
          needCatch=true;
        }
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'onSnapshot') {
      const index = ts.isObjectLiteralExpression(node.arguments[1]) ? 3 : 2;
      const handler = functionName(node), line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const arg = node.arguments[index];
      const covered = !!arg?.getText(sf).includes('observedListener(');
      rows.push({file,line,runtime,kind:'snapshot-error',handler,state:covered?'observed':'uncovered'});
      if (write && !covered && runtime === 'app') {
        const origin=JSON.stringify({source:file,handler,site:`${path.basename(file)}:snapshot:${line}`});
        if (arg) {add(arg.getStart(sf),'observedListener(');add(arg.end,`, ${origin})`);}
        else add(node.arguments[node.arguments.length-1].end,`, observedListener(undefined, ${origin})`);
        needListener=true;
      }
    }
    if (ts.isCatchClause(node)) { block = node.block; kind = 'catch'; }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text;
      if (name === 'catch' || name === 'then' && node.arguments.length > 1) {
        callback = node.arguments[name === 'catch' ? 0 : 1];
        if (callback && callback.kind !== ts.SyntaxKind.UndefinedKeyword && callback.getText(sf) !== 'undefined' && callback.kind !== ts.SyntaxKind.NullKeyword) {
          kind = name === 'catch' ? 'promise-catch' : 'promise-rejection';
          if ((ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) && ts.isBlock(callback.body)) block = callback.body;
        }
      }
      if (name === 'allSettled' && node.expression.expression.getText(sf) === 'Promise') kind = 'all-settled';
    }
    if (kind) {
      const handler = functionName(node);
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      // Read the actual callback/block, not an earlier promise in the chain.
      const body = block?.getText(sf) ?? callback?.getText(sf) ?? '';
      const covered = /\b(observeCaughtError|observedRejection)\(/.test(body) || kind === 'all-settled' && node.parent?.parent?.getText(sf).includes('observeSettledErrors(');
      const boundary = boundaries[file];
      const row = { file, line, runtime, kind, handler, state: boundary ? 'recursion-boundary' : covered ? 'observed' : 'uncovered', ...(boundary ? {reason: boundary} : {}) };
      rows.push(row);
      if (write && !covered && !boundary && runtime !== 'tooling-or-third-party') {
        const hash = crypto.createHash('sha256').update(`${file}:${handler}:${line}:${kind}`).digest('hex').slice(0, 10);
        const origin = JSON.stringify({ source: file, handler, site: `${path.basename(file).replace(/\.[^.]+$/, '')}:${hash}` });
        if (kind === 'all-settled') {
          add(node.end, `.then(results => observeSettledErrors(results, ${origin}))`); needSettled = true;
        } else if (ts.isCatchClause(node)) {
          const binding = node.variableDeclaration;
          if (binding && !ts.isIdentifier(binding.name)) { row.state = 'manual-review'; }
          else {
            const name = binding?.name.text ?? `caughtError${hash}`;
            if (!binding) add(node.getStart(sf) + 5, ` (${name})`);
            add(block.getStart(sf) + 1, `\n    observeCaughtError(${name}, ${origin});`); needCatch = true;
          }
        } else if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const first = callback.parameters[0];
          if (first && (!ts.isIdentifier(first.name) || first.dotDotDotToken)) row.state = 'manual-review';
          else {
            const name = first?.name.text ?? `caughtError${hash}`;
            if (!first) {
              const open = source.indexOf('(', callback.getStart(sf));
              add(open + 1, `${name}: unknown`);
            }
            if (block) add(block.getStart(sf) + 1, `\n    observeCaughtError(${name}, ${origin});`);
            else {
              add(callback.body.getStart(sf), `{ observeCaughtError(${name}, ${origin}); return `);
              add(callback.body.end, '; }');
            }
            needCatch = true;
          }
        } else if (callback && ts.isIdentifier(callback)) {
          add(callback.getStart(sf), 'observedRejection('); add(callback.end, `, ${origin})`); needRejection = true;
        } else row.state = 'manual-review';
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  if (changes.length) {
    const target = runtime === 'app' ? 'src/utils/errorObservation' : runtime === 'server' ? 'functions/src/serverErrorLog' : 'pulse/src/services/errorObservation';
    let relative = path.posix.relative(path.posix.dirname(file), target);
    if (!relative.startsWith('.')) relative = './' + relative;
    const names = [needCatch && 'observeCaughtError', needSettled && 'observeSettledErrors', needRejection && 'observedRejection', needListener && 'observedListener'].filter(Boolean);
    const existing = sf.statements.filter(n => ts.isImportDeclaration(n) && n.moduleSpecifier.text === relative)
      .flatMap(n => n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings) ? n.importClause.namedBindings.elements.map(e=>e.name.text) : []);
    const needed = names.filter(n => !existing.includes(n));
    if (needed.length) add(0, `import { ${needed.join(', ')} } from '${relative}';\n`);
    for (const change of changes.sort((a, b) => b.at - a.at)) source = source.slice(0, change.at) + change.text + source.slice(change.at);
  }
  return { rows, source };
}
function main() {
  const write = process.argv.includes('--write');
  const requested = process.argv.find(a => a.startsWith('--domain='))?.split('=')[1];
  const files = cp.execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean);
  const rows = [], counts = {};
  const additionalRuntimeSites = [];
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file) || requested && domain(file) !== requested) continue;
    const before = fs.readFileSync(path.join(root, file), 'utf8');
    const result = inspect(file, before, write);
    rows.push(...result.rows);
    if (write && result.source !== before) fs.writeFileSync(path.join(root, file), result.source);
  }
  for (const row of rows) { const key = `${row.runtime}:${row.state}`; counts[key] = (counts[key] ?? 0) + 1; }
  for (const file of files.filter(f => /^(plugins\/|modules\/|targets\/|public\/|vendor\/)/.test(f) && /\.(kt|java|swift|html|js|ts|tsx)$/.test(f))) {
    if (domain(file) === 'app') continue;
    fs.readFileSync(path.join(root,file),'utf8').split('\n').forEach((line,index) => {
      if (/\bcatch\s*[({]|\brunCatching\b|\btry\?/.test(line)) additionalRuntimeSites.push({file,line:index+1,state:'requires-platform-review'});
    });
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify({ counts, filesInventoried:files.length, additionalRuntimeSites, rows }, null, 2));
  else { console.log(counts); for (const r of rows.filter(r => r.state === 'manual-review')) console.log(r); }
  if (process.argv.includes('--check') && rows.some(r => r.runtime !== 'tooling-or-third-party' && !['observed','recursion-boundary'].includes(r.state))) process.exitCode = 1;
}
module.exports = { inspect, boundaries };
if (require.main === module) main();
