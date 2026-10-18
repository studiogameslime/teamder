import fs from 'fs';
import ts from 'typescript';
import vm from 'vm';
const source = ts.createSourceFile('gameService.ts', fs.readFileSync('src/services/gameService.ts', 'utf8'), ts.ScriptTarget.Latest, true);
let method = '';
function visit(node: ts.Node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'getGameChampionship') method = node.getText(source);
  ts.forEachChild(node, visit);
} visit(source);
function setup() {
  const getDocs = jest.fn(), logError = jest.fn();
  const context: any = { module: { exports: {} }, USE_MOCK_DATA: false, __DEV__: false,
    getFirebase: () => ({ db: {} }), getDocs, logError, query: (...args: any[]) => args,
    collection: (...args: any[]) => args, where: (...args: any[]) => args, rankChampionshipRows: (rows: any[]) => rows,
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = {${method}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { getDocs, logError, read: context.module.exports.getGameChampionship };
}
test.each(['unavailable', 'permission-denied'])('%s stays a retryable read failure instead of an empty leaderboard', async code => {
  const s = setup(), error = Object.assign(Error('failed read'), { code }); s.getDocs.mockRejectedValue(error);
  await expect(s.read('round')).rejects.toBe(error); expect(s.logError).toHaveBeenCalledTimes(1);
});
test('successful empty legacy coverage remains empty', async () => {
  const s = setup(); s.getDocs.mockResolvedValue({ docs: [] });
  await expect(s.read('legacy')).resolves.toEqual({ players: [] });
  expect(s.logError).not.toHaveBeenCalled();
});
