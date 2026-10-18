import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';

test('the actual game converter preserves creation content binding across write/read, legacy absence stays absent', () => {
  const source = ts.createSourceFile('firestore.ts', fs.readFileSync('src/firebase/firestore.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let converter = '';
  const walk = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'gameDocConverter') converter = node.initializer!.getText(source);
    ts.forEachChild(node, walk);
  }; walk(source);
  const context: Record<string, any> = { module: { exports: {} }, Date };
  // Run the complete real converter. Unrelated nested-domain readers return
  // their input; the creation field has no replacement reader in this adapter.
  for (const match of converter.matchAll(/\b(read\w+)\(/g)) context[match[1]] = (value: unknown) => value;
  vm.runInNewContext(ts.transpileModule(`module.exports = ${converter}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const actual = context.module.exports;
  const game = { id: 'target', groupId: 'club', title: 'ערב', startsAt: 1, fieldName: 'מגרש', maxPlayers: 10,
    players: [], waitlist: [], pending: [], participantIds: [], matches: [], status: 'open',
    currentMatchIndex: 0, createdBy: 'owner', createdAt: 1, creationFingerprint: 'bound-content' };
  const written = actual.toFirestore(game);
  expect(written.creationFingerprint).toBe('bound-content');
  expect(actual.fromFirestore({ id: game.id, data: () => written }).creationFingerprint).toBe('bound-content');
  delete written.creationFingerprint;
  expect(actual.fromFirestore({ id: game.id, data: () => written }).creationFingerprint).toBeUndefined();
  written.creationFingerprint = 42;
  expect(actual.fromFirestore({ id: game.id, data: () => written }).creationFingerprint).toBeUndefined();
});
