import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import { mapConcurrent } from '../../src/utils/mapConcurrent';

function load(file: string, deps: Record<string, unknown>) {
  const module = { exports: {} as any };
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, require: (name: string) => deps[name] ?? {}, console });
  return module.exports;
}
function reader(page: unknown) {
  return load('src/services/seasonArchiveData.ts', {
    '@/utils/mapConcurrent': { mapConcurrent },
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

test('archive pages start in parallel, merge in source order, and leave the root untouched', async () => {
  const finish: Record<string, (value: unknown) => void> = {};
  const getDoc = jest.fn((id: string) => new Promise(resolve => { finish[id] = resolve; }));
  const read = load('src/services/seasonArchiveData.ts', {
    '@/utils/mapConcurrent': { mapConcurrent },
    'firebase/firestore': { doc: (_db: unknown, _col: string, id: string) => id, getDoc },
  }).readSeasonArchiveData;
  const root = { groupId: 'g', seasonId: 's', pairPages: ['a', 'b', 'c', 'd', 'e'], pairs: { original: 1, duplicate: 0 } };
  const pending = read({}, root);
  expect(getDoc.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c', 'd']);
  const page = (pairs: unknown) => ({ data: () => ({ groupId: 'g', seasonId: 's', pairs }) });
  finish.d(page({ duplicate: 4 }));
  await new Promise(setImmediate);
  expect(getDoc).toHaveBeenCalledTimes(5);
  finish.e(page({ duplicate: 5 })); finish.c(page({ duplicate: 3 }));
  finish.b(page({ duplicate: 2 })); finish.a(page({ duplicate: 1 }));
  expect((await pending).pairs).toEqual({ original: 1, duplicate: 5 });
  expect(root.pairs).toEqual({ original: 1, duplicate: 0 });
});

test('invalid page ids reject before any page read', async () => {
  const getDoc = jest.fn();
  const read = load('src/services/seasonArchiveData.ts', {
    '@/utils/mapConcurrent': { mapConcurrent },
    'firebase/firestore': { getDoc },
  }).readSeasonArchiveData;
  await expect(read({}, { pairPages: ['valid', null] })).rejects.toThrow('Invalid season pair page');
  expect(getDoc).not.toHaveBeenCalled();
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
