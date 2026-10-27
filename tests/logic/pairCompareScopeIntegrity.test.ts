import fs from 'fs';
import vm from 'vm';
import ts from 'typescript';
import * as chemistry from '@/utils/clubChemistry';
import * as orientation from '@/utils/pairOrientation';
import * as championship from '@/utils/championship';
import * as lifetime from '@/utils/allTimeTable';
import { seasonReadStamp } from '@/utils/seasonReadConsistency';

function fixture() {
  const group: any = { id: 'club', name: 'club', seasons: { enabled: true, currentId: 's3', currentNo: 3, revision: 1, count: 2 } };
  const player = (uid: string) => ({ uid, goals: 6, assists: 2, wins: 2, losses: 1, ties: 1, rounds: 4,
    games: 3, penTaken: 0, penScored: 0, penFaced: 0, penSaved: 0, cleanSheets: 1, ownGoals: 0 });
  const getGroup = jest.fn(async (..._args: any[]) => JSON.parse(JSON.stringify(group)));
  const getChamp = jest.fn(async (..._args: any[]) => ({ players: [player('a'), player('b')] }));
  const getStats = jest.fn(async (_club: string, season: any, ..._args: any[]) => ({ attendedByUser: { a: season ? 3 : 20, b: season ? 3 : 18 } }));
  const history = jest.fn(async () => [{ seasonId: 's1', nonSeason: false }, { seasonId: 's2', nonSeason: false }]);
  const imports: any = {
    '../utils/errorObservation': { observeCaughtError: jest.fn() },
    'firebase/firestore': { collection: (...args: any[]) => args, doc: (...args: any[]) => args,
      query: (...args: any[]) => args, where: (...args: any[]) => args, limit: (n: number) => n,
      getDocs: async () => ({ docs: [] }), getDoc: async () => ({ data: () => ({ chemistrySince: 1000 }) }) },
    '@/firebase/config': { USE_MOCK_DATA: false, getFirebase: () => ({ db: {} }) },
    '@/services/gameService': { gameService: { getCommunityChampionship: getChamp, getCommunityStats: getStats } },
    '@/services/groupService': { groupService: { get: getGroup } },
    '@/services/userService': { userService: { getUserById: async (id: string) => ({ id, name: id }) } },
    '@/services/seasonHistoryService': { seasonHistoryService: { list: history, table: async () => ({ players: [player('a'), player('b')], pairs: {}, names: {} }) } },
    '@/services/errorLog': { logError: jest.fn(), isExpectedDenial: () => false },
    '@/utils/clubChemistry': chemistry, '@/utils/allTimeTable': lifetime, '@/utils/pairOrientation': orientation,
    '@/utils/championship': championship, '@/utils/seasonReadConsistency': { seasonReadStamp }, '@/data/mockPairCompare': {} };
  const module = { exports: {} as any };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/pairCompareService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, require: (id: string) => imports[id], Date });
  const load = (extra = {}) => module.exports.pairCompareService.load({ groupId: 'club', viewerId: 'a', otherId: 'b', scope: { k: 'current' }, ...extra });
  return { load, getGroup, getChamp, getStats, history, group };
}

test('failed club metadata cannot turn a seasonal comparison into lifetime attendance', async () => {
  const f = fixture(); f.getGroup.mockRejectedValue(new Error('offline'));
  expect(await f.load()).toBeNull();
  expect(f.getStats).not.toHaveBeenCalled();
});

test('an active season operation withholds counters that may be partly reset', async () => {
  const f = fixture(); f.group.seasons.operation = { token: 'closing', phase: true };
  expect(await f.load()).toBeNull();
  expect(f.getChamp).not.toHaveBeenCalled();
});

test('rollover during the comparison cannot combine old attendance with a new table', async () => {
  const f = fixture();
  f.getChamp.mockImplementationOnce(async () => {
    f.group.seasons = { ...f.group.seasons, currentId: 's4', currentNo: 4, revision: 2, count: 3 };
    return { players: [] };
  });
  expect(await f.load()).toBeNull();
});

test('all-time archive completeness uses fresh club metadata even when the screen count is stale', async () => {
  const f = fixture(); f.history.mockResolvedValue([{ seasonId: 's1', nonSeason: false }]);
  expect(await f.load({ scope: { k: 'all' }, seasons: { enabled: true, count: 0 } })).toBeNull();
});

test('a stable comparison keeps seasonal attendance and verifies server metadata twice', async () => {
  const f = fixture(); const result = await f.load();
  expect(result.a.row).toMatchObject({ games: 3, goals: 6 });
  expect(result.comparison.find((row: any) => row.key === 'gpg')).toMatchObject({ a: 2, b: 2 });
  expect(f.getGroup).toHaveBeenCalledTimes(2);
  expect(f.getGroup.mock.calls.every(args => args[1]?.fromServer === true)).toBe(true);
});
