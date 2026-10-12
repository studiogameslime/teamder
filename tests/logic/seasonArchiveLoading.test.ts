import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';

function load(file: string, deps: Record<string, unknown>) {
  const module = { exports: {} as any };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => deps[name] ?? {}, console });
  return module.exports;
}
function reader(page: unknown) {
  return load('src/services/seasonArchiveData.ts', {
    'firebase/firestore': { doc: (_db: unknown, _col: string, id: string) => id, getDoc: async () => ({ data: () => page }) },
  }).readSeasonArchiveData;
}
test('archive overflow pairs are joined to the root before totals are computed', async () => {
  const result = await reader({ groupId: 'g', seasonId: 's1', pairs: { second: { sameTeam: 7 } } })({}, {
    groupId: 'g', seasonId: 's1', pairs: { first: { sameTeam: 3 } }, pairPages: ['page'],
  });
  expect(result.pairs).toEqual({ first: { sameTeam: 3 }, second: { sameTeam: 7 } });
});
test.each([undefined, { groupId: 'other', seasonId: 's1' }])('a missing or foreign page fails instead of presenting partial totals', async (page) => {
  await expect(reader(page)({}, { groupId: 'g', seasonId: 's1', pairPages: ['page'] })).rejects.toThrow('Missing season pair page');
});
test('a requested missing historical season cannot silently return the current season', async () => {
  const getDocs = jest.fn(() => { throw new Error('must not query live statistics'); });
  const service = load('src/services/seasonSummaryService.ts', {
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) },
    'firebase/firestore': { doc: (_db: unknown, col: string) => col, getDoc: async (col: string) => ({
      exists: () => col === 'groups', data: () => ({ name: 'club', seasons: { enabled: true, currentId: 's2' } }),
    }), getDocs },
    '@/services/errorLog': { logError: () => {} },
  }).seasonSummaryService;
  expect(await service.load({ groupId: 'g', userId: 'u', seasonId: 's1' })).toBeNull();
  expect(getDocs).not.toHaveBeenCalled();
});
